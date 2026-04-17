import * as Localization from 'expo-localization';

import { evaluateIngredientsWithAi, evaluateProductWithAi } from '../api/openai';
import { getProductByBarcode } from '../api/openFoodFacts';
import { buildAiInput } from './buildAiInput';
import { getAppLanguage } from './deviceLanguage';
import { t } from './i18n';
import { extractCleanOffComposition } from './offCompositionClean';
import { computeRuleBasedBaseVerdict } from './productRules';
import { buildScanAnalysisContextKey } from './scanAnalysisContext';
import { getAvoidPreferences, getChildAge } from './storage';
import type { RecentScan } from '../types/scan';

export type BuildRecentScanOutcome = {
  scan: RecentScan;
  /** True when Open Food Facts returned a product and evaluation completed for that product. */
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
    const [childAge, avoidPreferences] = await Promise.all([getChildAge(), getAvoidPreferences()]);
    const product = await getProductByBarcode(barcode);
    if (!product) {
      return { scan: createFallbackRecentScan(barcode, childAge, lang), isSuccessfulProductScan: false };
    }

    const age = typeof childAge === 'number' && Number.isFinite(childAge) ? childAge : 4;
    const ruleBasedBaseVerdict = computeRuleBasedBaseVerdict(age, product);
    const aiInput = buildAiInput(childAge, product, avoidPreferences, 'advanced', ruleBasedBaseVerdict, lang);
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
        childAge: age,
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

    scan.analysisContextKey = buildScanAnalysisContextKey(scan.barcode, childAge, avoidPreferences);

    console.warn('[prefs][scan]', 'preferenceMatches stored on scan object', {
      scanId: scan.id,
      preferenceMatches: scan.preferenceMatches ?? [],
    });

    return { scan, isSuccessfulProductScan: true };
  } catch {
    const childAge = await getChildAge();
    return { scan: createFallbackRecentScan(barcode, childAge, lang), isSuccessfulProductScan: false };
  }
}
