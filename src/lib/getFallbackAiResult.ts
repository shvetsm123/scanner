import type { AiResult } from '../types/ai';
import type { ResultStyle } from '../types/preferences';
import type { Verdict } from '../types/scan';

const FALLBACK_BREAKDOWN_PARA1 =
  'We could not load fresh ingredient text for this scan, so this breakdown cannot describe sugar, the main base, or how simple versus prepared the product looks.';
const FALLBACK_BREAKDOWN_PARA2 =
  'When the listing is available again, expect a short read on composition from the ingredient list and categories—grounded in what the product page actually shows.';
const FALLBACK_BREAKDOWN_PARA3 =
  'If product details stay limited, the wording stays cautious rather than overconfident; nothing here replaces reading the label yourself.';
const FALLBACK_BREAKDOWN: [string, string, string] = [
  FALLBACK_BREAKDOWN_PARA1,
  FALLBACK_BREAKDOWN_PARA2,
  FALLBACK_BREAKDOWN_PARA3,
];

export function getFallbackAiResult(
  ruleBasedBaseVerdict: Verdict = 'unknown',
  resultStyle: ResultStyle = 'quick',
): AiResult {
  const advanced = resultStyle === 'advanced';
  return {
    baseVerdict: ruleBasedBaseVerdict,
    verdict: ruleBasedBaseVerdict,
    summary: 'For this age, the check did not finish—try again.',
    reasons: advanced
      ? [
          'Product listing could not be re-checked in the app this time',
          'Sugar, salt, and saturated fat values need a fresh fetch from the database',
          'Ingredient order and sweetener cues were not reloaded for this pass',
          'Allergen lines from the package are not available in this fallback',
          'Scan again online for a full fact pass for this barcode',
        ]
      : [
          'Product listing could not be re-checked here',
          'Sugar, salt, and ingredient details may be on the package',
          'Scan again when you are online',
        ],
    preferenceMatches: [],
    nutritionSnapshot: [],
    ingredientFlags: advanced
      ? [
          'Fresh AI flags unavailable',
          'Sweetener and caffeine cues need a completed scan',
          'Ingredient list length not re-evaluated here',
        ]
      : [],
    ingredientBreakdown: advanced ? FALLBACK_BREAKDOWN : [FALLBACK_BREAKDOWN_PARA1, FALLBACK_BREAKDOWN_PARA2],
    allergyNotes: [],
    parentTakeaway: 'Try again when you have a connection.',
  };
}
