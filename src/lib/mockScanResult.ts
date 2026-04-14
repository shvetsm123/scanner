import { evaluateProductWithAi } from '../api/openai';
import { getProductByBarcode } from '../api/openFoodFacts';
import { buildAiInput } from './buildAiInput';
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

export function createFallbackRecentScan(barcode: string, _childAge: number | null = null): RecentScan {
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
    summary: 'For this age, no product match—try scanning again.',
    reasons: ['No product page matched this barcode', 'Sugar and salt not available here', 'Scan again with a clearer barcode'],
    nutritionSnapshot: [],
    ingredientFlags: [],
    ingredientBreakdown: [
      'Without a matched product, we cannot summarize what the ingredient list looks like.',
      'Try scanning again with a clearer view of the barcode so we can load real product text.',
    ],
    allergyNotes: [],
    parentTakeaway: 'Scan again when the barcode is readable.',
    scannedAt: new Date().toISOString(),
  };
}

export async function buildRecentScanFromBarcode(barcode: string): Promise<BuildRecentScanOutcome> {
  try {
    const [childAge, avoidPreferences, resultStyle] = await Promise.all([
      getChildAge(),
      getAvoidPreferences(),
      getResultStyle(),
    ]);
    const product = await getProductByBarcode(barcode);
    if (!product) {
      return { scan: createFallbackRecentScan(barcode, childAge), isSuccessfulProductScan: false };
    }

    const age = typeof childAge === 'number' && Number.isFinite(childAge) ? childAge : 4;
    const ruleBasedBaseVerdict = computeRuleBasedBaseVerdict(age, product);
    const aiInput = buildAiInput(childAge, product, avoidPreferences, resultStyle, ruleBasedBaseVerdict);
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
    };

    if (avoidPreferences.length > 0 && ai.preferenceMatches.length > 0) {
      scan.preferenceMatches = ai.preferenceMatches;
    }

    scan.analysisContextKey = buildScanAnalysisContextKey(scan.barcode, childAge, resultStyle, avoidPreferences);

    return { scan, isSuccessfulProductScan: true };
  } catch {
    const childAge = await getChildAge();
    return { scan: createFallbackRecentScan(barcode, childAge), isSuccessfulProductScan: false };
  }
}
