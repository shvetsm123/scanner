import type { NormalizedProduct } from '../api/openFoodFacts';
import type { AppLanguage } from './deviceLanguage';
import type { AvoidPreference, ResultStyle } from '../types/preferences';
import type { KidsAiInput } from '../types/ai';
import type { Verdict } from '../types/scan';

const DEFAULT_CHILD_AGE = 4;

export function buildAiInput(
  childAge: number | null,
  product: NormalizedProduct,
  avoidPreferences: AvoidPreference[],
  resultStyle: ResultStyle,
  ruleBasedBaseVerdict: Verdict,
  outputLanguage: AppLanguage,
): KidsAiInput {
  const age = typeof childAge === 'number' && Number.isFinite(childAge) ? childAge : DEFAULT_CHILD_AGE;

  const base: KidsAiInput = {
    mode: 'kids',
    childAge: age,
    ruleBasedBaseVerdict,
    resultStyle,
    outputLanguage,
    product: {
      barcode: product.barcode,
      productName: product.productName,
      brand: product.brand,
      ingredientsText: product.ingredientsText,
      categories: product.categories,
      imageUrl: product.imageUrl,
      allergensText: product.allergensText,
      nutriments: product.nutriments,
    },
  };

  if (avoidPreferences.length > 0) {
    return { ...base, avoidPreferences };
  }

  return base;
}
