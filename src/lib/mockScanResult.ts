import { evaluateProductWithAi } from '../api/openai';
import { getProductByBarcode } from '../api/openFoodFacts';
import { buildAiInput } from './buildAiInput';
import { getAppLanguage } from './deviceLanguage';
import { t } from './i18n';
import { computeRuleBasedBaseVerdict } from './productRules';
import { buildScanAnalysisContextKey } from './scanAnalysisContext';
import { getAvoidPreferences, getChildAge, getResultStyle } from './storage';
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
    reasons: [t('unknown.r1', lang), t('unknown.r2', lang), t('unknown.r3', lang)],
    nutritionSnapshot: [],
    ingredientFlags: [],
    guidanceContext: [],
    ingredientBreakdown: [t('unknown.b1', lang), t('unknown.b2', lang)],
    allergyNotes: [],
    parentTakeaway: t('unknown.parent', lang),
    scannedAt: new Date().toISOString(),
  };
}

export async function buildRecentScanFromBarcode(barcode: string): Promise<BuildRecentScanOutcome> {
  const lang = getAppLanguage();
  try {
    const [childAge, avoidPreferences, resultStyle] = await Promise.all([
      getChildAge(),
      getAvoidPreferences(),
      getResultStyle(),
    ]);
    const product = await getProductByBarcode(barcode);
    if (!product) {
      return { scan: createFallbackRecentScan(barcode, childAge, lang), isSuccessfulProductScan: false };
    }

    const age = typeof childAge === 'number' && Number.isFinite(childAge) ? childAge : 4;
    const ruleBasedBaseVerdict = computeRuleBasedBaseVerdict(age, product);
    const aiInput = buildAiInput(childAge, product, avoidPreferences, resultStyle, ruleBasedBaseVerdict, lang);
    const ai = await evaluateProductWithAi(aiInput);

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
      nutritionSnapshot: ai.nutritionSnapshot,
      ingredientFlags: ai.ingredientFlags,
      guidanceContext: ai.guidanceContext,
    };

    if (avoidPreferences.length > 0 && ai.preferenceMatches.length > 0) {
      scan.preferenceMatches = ai.preferenceMatches;
    }

    scan.analysisContextKey = buildScanAnalysisContextKey(scan.barcode, childAge, resultStyle, avoidPreferences);

    return { scan, isSuccessfulProductScan: true };
  } catch {
    const childAge = await getChildAge();
    return { scan: createFallbackRecentScan(barcode, childAge, lang), isSuccessfulProductScan: false };
  }
}
