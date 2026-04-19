import * as Localization from 'expo-localization';

import { evaluateIngredientsWithAi, evaluateProductWithAi, fetchNormalizedProductByBarcodeWithAi } from '../api/openai';
import { getProductByBarcode } from '../api/openFoodFacts';
import { buildAiInput } from './buildAiInput';
import { serializeChildAgePreferenceForContext } from './childAgeContext';
import { getAppLanguage } from './deviceLanguage';
import { t } from './i18n';
import { extractCleanOffComposition } from './offCompositionClean';
import { computeRuleBasedBaseVerdict, productRulesChildInputFromProfile } from './productRules';
import { buildScanAnalysisContextKey } from './scanAnalysisContext';
import { getAvoidPreferences, getChildAgeProfile } from './storage';
import type { RecentScan } from '../types/scan';

export type BuildRecentScanOutcome = {
  scan: RecentScan;
  /** True when a product was resolved (Open Food Facts or AI barcode lookup) and evaluation completed. */
  isSuccessfulProductScan: boolean;
};

function newScanId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
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

export async function buildRecentScanFromBarcode(barcode: string): Promise<BuildRecentScanOutcome> {
  const lang = getAppLanguage();
  try {
    const [profile, avoidPreferences] = await Promise.all([getChildAgeProfile(), getAvoidPreferences()]);
    let product = await getProductByBarcode(barcode);
    if (!product) {
      product = await fetchNormalizedProductByBarcodeWithAi(barcode);
    }
    if (!product) {
      return { scan: createFallbackRecentScan(barcode, profile.completedWholeYears, lang), isSuccessfulProductScan: false };
    }

    const rulesInput = productRulesChildInputFromProfile(profile);
    const ruleBasedBaseVerdict = computeRuleBasedBaseVerdict(rulesInput, product);
    const aiInput = buildAiInput(profile, product, avoidPreferences, 'advanced', ruleBasedBaseVerdict, lang);
    console.warn('[prefs][scan]', 'avoid list used for analysis', avoidPreferences);
    const ai = await evaluateProductWithAi(aiInput);
    console.warn('[prefs][scan]', 'preferenceMatches returned from analysis', ai.preferenceMatches);

    const cleaned = extractCleanOffComposition(product.rawJson, product.ingredientsText, product.productName);
    let ingredientPanel = undefined as RecentScan['ingredientPanel'];
    if (cleaned.ingredientLines.length > 0) {
      const localeHint = Localization.getLocales()?.[0]?.languageTag ?? lang;
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
      const panel = await evaluateIngredientsWithAi({
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
      });
      if (panel) {
        ingredientPanel = panel;
        console.warn('[IngredientsPipeline]', 'renderer will use structured AI output', {
          good: panel.good.length,
          neutral: panel.neutral.length,
          redFlags: panel.redFlags.length,
        });
      } else {
        console.warn('[IngredientsPipeline]', 'renderer will use fallback (second AI missing or validation failed)');
      }
    } else {
      console.warn('[IngredientsPipeline]', 'no cleaned lines — skip second AI');
    }

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
