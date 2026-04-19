import type { NormalizedProduct } from '../api/openFoodFacts';
import type { AiResult } from '../types/ai';
import type { Verdict } from '../types/scan';
import { verdictStrictness } from './preferenceMatchers';

/** Fields sufficient for stage heuristics (matches KidsAiInput.product subset). */
export type FormulaStageProductSlice = Pick<
  NormalizedProduct,
  'productName' | 'brand' | 'ingredientsText' | 'categories'
>;

function corpus(p: FormulaStageProductSlice): string {
  const parts = [p.productName, p.brand, p.ingredientsText, ...(p.categories ?? [])].filter(Boolean).join(' ').toLowerCase();
  return parts;
}

function categoriesBlob(p: FormulaStageProductSlice): string {
  return (p.categories ?? []).join(' ').toLowerCase();
}

const CAFFEINE = /\b(caffeine|guarana|taurine|coffee extract|cola|energy drink|energy shot)\b/i;
const ARTIFICIAL_SWEETENER =
  /\b(aspartame|acesulfame|sucralose|stevia|steviol|saccharin|neotame|advantame|xylitol|erythritol|sorbitol|maltitol|mannitol|isomalt|polyol|artificial sweetener|sweetener e\d{3})\b/i;

const FORMULA_CATEGORY =
  /\b(baby-formulas?|infant-formulas?|follow-on-formulas?|first-age-milk|second-age-milk|infant-milks|growing-up-milk|toddler-milk|starting-milks?|initial-milks?)\b/i;

export function isFormulaLikeProduct(product: FormulaStageProductSlice): boolean {
  const cat = categoriesBlob(product);
  if (FORMULA_CATEGORY.test(cat)) {
    return true;
  }
  const c = corpus(product);
  if (/\b(infant formula|baby formula|follow-on formula|folgemilch|anfangsmilch)\b/i.test(c)) {
    return true;
  }
  if (
    /\b(nutrilon|aptamil|hipp\b|nan\b|similac|enfamil|friso|sma\b|bebelac|kabrita)\b/i.test(c) &&
    /\b(formula|milch|milk|мляко|mlijeko)\b/i.test(c)
  ) {
    return true;
  }
  return false;
}

export type FormulaMarketingStage = 'first' | 'followon' | 'growing';

/**
 * Rough marketing stage from name + OFF categories only (no clinical claim).
 */
export function detectFormulaMarketingStage(product: FormulaStageProductSlice): FormulaMarketingStage | null {
  if (!isFormulaLikeProduct(product)) {
    return null;
  }
  const c = corpus(product);
  const cat = categoriesBlob(product);

  if (
    /\b(third[-\s]?age|fourth[-\s]?age|growing[-\s]?up|toddler milk|preschool|kid(s)?\s+milk|1[-\s]?3\s*year|12\+\s*months?)\b/i.test(c) ||
    /\b(growing-up|third-age|fourth-age)\b/i.test(cat)
  ) {
    return 'growing';
  }

  if (
    /\b(follow[-\s]?on|folgemilch|continuation|second[-\s]?age)\b/i.test(cat) ||
    /\b(follow[-\s]?on|folgemilch|continuation formula|second[-\s]?age)\b/i.test(c)
  ) {
    return 'followon';
  }

  if (/\bpremium\+\s*2\b|\bstage\s*2\b|\b\sstep\s*2\b/i.test(c)) {
    return 'followon';
  }

  if (/\bpremium\+\s*3\b|\bstage\s*[34]\b|\b\sstep\s*[34]\b/i.test(c)) {
    return 'growing';
  }

  if (/\bpremium\+\s*1\b|\bstage\s*1\b|\bPRE\b|\banfangsmilch\b|\bfirst[-\s]?age\b/i.test(c)) {
    return 'first';
  }

  if (
    /\b(nutrilon|aptamil|hipp\b|nan\b|similac|enfamil|friso)\b[^,]{0,48}\b2\b/i.test(c) &&
    !/\b20\d\d\b|\b2\s*,\s*5\s*l\b|\b250\s*ml\b/i.test(c)
  ) {
    return 'followon';
  }

  if (/\b(nutrilon|aptamil|hipp\b|nan\b)\b[^,]{0,48}\b1\b/i.test(c)) {
    return 'first';
  }

  if (/en:(follow-on-formulas?|second-age-milk)\b/.test(cat)) {
    return 'followon';
  }
  if (/en:(first-age-milk|starting-milks?|initial-milks?|baby-formulas?)\b/.test(cat) && !/follow-on|second-age/.test(cat)) {
    return 'first';
  }

  return null;
}

/**
 * Deterministic age × stage verdict for infant milks. Returns null when not applicable
 * (unknown stage, unknown month age, or hard disqualifiers such as caffeine / artificial sweeteners).
 */
export function resolveDeterministicFormulaStageVerdict(
  ageInMonths: number | null,
  product: FormulaStageProductSlice,
): Verdict | null {
  if (!isFormulaLikeProduct(product)) {
    return null;
  }
  const c = corpus(product);
  if (CAFFEINE.test(c) || ARTIFICIAL_SWEETENER.test(c)) {
    return null;
  }

  if (ageInMonths == null || !Number.isFinite(ageInMonths) || ageInMonths < 0) {
    return null;
  }

  const m = Math.floor(ageInMonths);
  const stage = detectFormulaMarketingStage(product);
  if (!stage) {
    return null;
  }

  switch (stage) {
    case 'followon':
      if (m <= 5) {
        return 'avoid';
      }
      if (m >= 6 && m <= 12) {
        return 'good';
      }
      return 'sometimes';
    case 'first':
      if (m <= 5) {
        return 'good';
      }
      return 'sometimes';
    case 'growing':
      if (m <= 5) {
        return 'avoid';
      }
      if (m >= 12) {
        return 'good';
      }
      return 'sometimes';
    default:
      return null;
  }
}

/** Enforce at least `floor` strictness (e.g. pull `good` up to `sometimes`). */
function verdictAtLeast(floor: Verdict, current: Verdict): Verdict {
  if (verdictStrictness(current) >= verdictStrictness(floor)) {
    return current;
  }
  return floor;
}

/**
 * After AI + preference merge: lock verdicts to deterministic formula rules when
 * there are no avoid-topic matches (caller should pass result after preference merge).
 */
export function applyDeterministicFormulaStageVerdictPatch(
  ageInMonths: number | null,
  product: FormulaStageProductSlice,
  result: AiResult,
): AiResult {
  if (result.preferenceMatches.length > 0) {
    return result;
  }

  const required = resolveDeterministicFormulaStageVerdict(ageInMonths, product);
  if (required == null) {
    return result;
  }

  if (required === 'good') {
    return { ...result, baseVerdict: 'good', verdict: 'good' };
  }
  if (required === 'avoid') {
    return { ...result, baseVerdict: 'avoid', verdict: 'avoid' };
  }
  return {
    ...result,
    baseVerdict: verdictAtLeast('sometimes', result.baseVerdict),
    verdict: verdictAtLeast('sometimes', result.verdict),
  };
}
