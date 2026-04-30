import { barcodesEquivalent, getProductByBarcode, type NormalizedProduct } from '../api/openFoodFacts';
import { evaluateIngredientsWithAi, evaluateProductWithAi, fetchNormalizedProductByBarcodeWithAi } from '../api/openai';
import { buildAiInput } from './buildAiInput';
import { serializeChildAgePreferenceForContext } from './childAgeContext';
import { getAppLanguage } from './deviceLanguage';
import { t } from './i18n';
import { extractCleanOffComposition } from './offCompositionClean';
import { getCachedNormalizedProduct, setCachedNormalizedProduct } from './productBarcodeCache';
import { computeRuleBasedBaseVerdict, productRulesChildInputFromProfile } from './productRules';
import { buildScanAnalysisContextKey } from './scanAnalysisContext';
import { getAvoidPreferences, getChildAgeProfile } from './storage';
import type { RecentScan } from '../types/scan';

export type BuildRecentScanOutcome = {
  scan: RecentScan;
  /** True when a product was resolved (Open Food Facts or AI barcode lookup) and evaluation completed. */
  isSuccessfulProductScan: boolean;
};

/** Optional progress keys map to `t(key, lang)` in the UI (see i18n `scan.progress.*`). */
export type BuildRecentScanOptions = {
  onProgress?: (stageKey: string) => void;
  /** When set, a prior successful scan for the same barcode can skip remote product lookup. */
  recentScansForProductReuse?: RecentScan[];
};

function newScanId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

function emitProgress(onProgress: BuildRecentScanOptions['onProgress'], key: string) {
  try {
    onProgress?.(key);
  } catch {
    /* ignore UI callback errors */
  }
}

function findRecentScanForProductReuse(scans: RecentScan[] | undefined, barcode: string): RecentScan | null {
  if (!scans?.length) {
    return null;
  }
  for (const s of scans) {
    if (!barcodesEquivalent(s.barcode, barcode)) {
      continue;
    }
    if (s.verdict === 'unknown') {
      continue;
    }
    if (!String(s.productName ?? '').trim()) {
      continue;
    }
    return s;
  }
  return null;
}

function recentScanToNormalizedProduct(s: RecentScan): NormalizedProduct {
  return {
    barcode: s.barcode.trim(),
    productName: s.productName.trim(),
    brand: s.brand,
    imageUrl: s.imageUrl,
    ingredientsText: s.ingredientsText,
    categories: s.categories,
    allergensText: s.allergensText,
    nutriments: s.nutriments,
    rawJson: s.rawJson,
  };
}

export function createFallbackRecentScan(barcode: string, _childAge: number | null = null, lang = getAppLanguage()): RecentScan {
  const code = barcode.trim();
  return {
    id: newScanId(),
    barcode: code || barcode,
    productName: 'Unknown product',
    brand: undefined,
    imageUrl: undefined,
    ingredientsText: undefined,
    categories: undefined,
    allergensText: undefined,
    baseVerdict: 'unknown',
    verdict: 'unknown',
    summary: t('unknown.summary', lang),
    reasons: [t('unknown.r1', lang), t('unknown.r2', lang), t('unknown.r3', lang), t('unknown.r4', lang)],
    nutritionSnapshot: [],
    ingredientFlags: [],
    guidanceContext: [],
    ingredientBreakdown: [],
    allergyNotes: [],
    whyThisMatters: t('unknown.why', lang),
    parentTakeaway: t('unknown.parent', lang),
    scannedAt: new Date().toISOString(),
  };
}

export async function buildRecentScanFromBarcode(
  barcode: string,
  options?: BuildRecentScanOptions,
): Promise<BuildRecentScanOutcome> {
  const lang = getAppLanguage();
  const onProgress = options?.onProgress;
  const emit = (key: string) => emitProgress(onProgress, key);

  try {
    const [profile, avoidPreferences] = await Promise.all([getChildAgeProfile(), getAvoidPreferences()]);
    const normBarcode = barcode.trim();

    emit('scan.progress.checking_db');

    let product: NormalizedProduct | null = getCachedNormalizedProduct(normBarcode) ?? null;

    if (!product) {
      const reused = findRecentScanForProductReuse(options?.recentScansForProductReuse, normBarcode);
      if (reused) {
        product = recentScanToNormalizedProduct(reused);
        setCachedNormalizedProduct(normBarcode, product);
      }
    }

    if (!product) {
      product = await getProductByBarcode(normBarcode);
      if (product) {
        setCachedNormalizedProduct(normBarcode, product);
      }
    }

    if (product) {
      emit('scan.progress.product_found');
    } else {
      emit('scan.progress.no_match_db');
      emit('scan.progress.web_sources');
      product = await fetchNormalizedProductByBarcodeWithAi(normBarcode);
      if (product) {
        setCachedNormalizedProduct(normBarcode, product);
        emit('scan.progress.matching_details');
      }
    }

    if (!product) {
      return { scan: createFallbackRecentScan(barcode, profile.completedWholeYears, lang), isSuccessfulProductScan: false };
    }

    const rulesInput = productRulesChildInputFromProfile(profile);
    const ruleBasedBaseVerdict = computeRuleBasedBaseVerdict(rulesInput, product);
    const aiInput = buildAiInput(profile, product, avoidPreferences, 'advanced', ruleBasedBaseVerdict, lang);
    console.warn('[prefs][scan]', 'avoid list used for analysis', avoidPreferences);

    emit('scan.progress.analyzing_child');

    const cleaned = extractCleanOffComposition(product.rawJson, product.ingredientsText, product.productName);
    const localeHint = 'en-US';

    const hasIngredientLines = cleaned.ingredientLines.length > 0;
    if (hasIngredientLines) {
      emit('scan.progress.ingredients_breakdown');
      console.warn('[IngredientsPipeline]', 'OFF → second AI', {
        rawCount: cleaned.rawLineCount,
        cleanedCountBeforeAggressiveFilter: cleaned.cleanedCountBeforeAggressiveFilter,
        cleanedCountAfterAggressiveFilter: cleaned.cleanedCountAfterAggressiveFilter,
        cleanedCandidateCount: cleaned.ingredientLines.length,
        cleanedCandidates: cleaned.ingredientLines,
      });
      console.warn('[IngredientsPipeline]', 'deviceAppLanguage for Ingredients second AI', {
        outputLanguage: lang,
        localeHint,
      });
    } else {
      console.warn('[IngredientsPipeline]', 'no cleaned lines — skip second AI');
    }

    const ingredientsPromise = hasIngredientLines
      ? evaluateIngredientsWithAi({
          outputLanguage: lang,
          localeHint,
          childAge: profile.completedWholeYears,
          childAgeMonths: profile.ageInMonths,
          ageDisplayLabel: profile.ageDisplayLabel,
          ageBucket: profile.ageBucket,
          avoidPreferenceIds: avoidPreferences,
          cleanedIngredientLines: cleaned.ingredientLines,
          additivesTags: cleaned.additivesTags,
          allergensDeclared: cleaned.allergens,
          traceDeclared: cleaned.traces,
        })
      : Promise.resolve(null);

    const [ai, panel] = await Promise.all([evaluateProductWithAi(aiInput), ingredientsPromise]);
    console.warn('[prefs][scan]', 'preferenceMatches returned from analysis', ai.preferenceMatches);

    let ingredientPanel = undefined as RecentScan['ingredientPanel'];
    if (panel) {
      ingredientPanel = panel;
      console.warn('[IngredientsPipeline][render]', 'renderer will use structured AI output', {
        good: panel.good.length,
        neutral: panel.neutral.length,
        redFlags: panel.redFlags.length,
      });
    } else if (hasIngredientLines) {
      console.warn('[IngredientsPipeline][render]', 'renderer will use fallback (second AI missing or validation failed)');
    }

    emit('scan.progress.almost_ready');

    const scan: RecentScan = {
      id: newScanId(),
      barcode: product.barcode,
      productName: product.productName,
      brand: product.brand,
      imageUrl: product.imageUrl,
      ingredientsText: product.ingredientsText,
      categories: product.categories,
      allergensText: product.allergensText,
      nutriments: product.nutriments,
      rawJson: product.rawJson,
      baseVerdict: ai.baseVerdict,
      verdict: ai.verdict,
      summary: ai.summary,
      reasons: ai.reasons,
      scannedAt: new Date().toISOString(),
      ingredientBreakdown: ai.ingredientBreakdown,
      allergyNotes: ai.allergyNotes,
      parentTakeaway: ai.parentTakeaway,
      whyThisMatters: ai.whyThisMatters,
      whyText: ai.whyThisMatters,
      nutritionSnapshot: ai.nutritionSnapshot,
      ingredientFlags: ai.ingredientFlags,
      guidanceContext: ai.guidanceContext,
      ingredientPanel,
    };

    if (avoidPreferences.length > 0) {
      scan.preferenceMatches = ai.preferenceMatches;
    }

    scan.analysisContextKey = buildScanAnalysisContextKey(
      scan.barcode,
      serializeChildAgePreferenceForContext(profile),
      avoidPreferences,
    );

    console.warn('[prefs][scan]', 'preferenceMatches stored on scan object', {
      scanId: scan.id,
      preferenceMatches: scan.preferenceMatches ?? [],
    });

    return { scan, isSuccessfulProductScan: true };
  } catch {
    const profile = await getChildAgeProfile();
    return { scan: createFallbackRecentScan(barcode, profile.completedWholeYears, lang), isSuccessfulProductScan: false };
  }
}
