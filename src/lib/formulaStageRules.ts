import type { NormalizedProduct } from '../api/openFoodFacts';
import type { AgeBucketId } from './childAgeContext';
import type { AiResult } from '../types/ai';
import type { Verdict } from '../types/scan';
import { verdictStrictness } from './preferenceMatchers';

/** Fields sufficient for stage heuristics (matches KidsAiInput.product subset). */
export type FormulaStageProductSlice = Pick<
  NormalizedProduct,
  'productName' | 'brand' | 'ingredientsText' | 'categories'
>;

export type FormulaStageId = 'stage1' | 'stage2' | 'stage3';

/** Deterministic marketing stage → inclusive target month band on the label. */
export const FORMULA_STAGE_TARGET_MONTHS: Record<
  FormulaStageId,
  { targetAgeMinMonths: number; targetAgeMaxMonths: number }
> = {
  stage1: { targetAgeMinMonths: 0, targetAgeMaxMonths: 6 },
  stage2: { targetAgeMinMonths: 6, targetAgeMaxMonths: 12 },
  stage3: { targetAgeMinMonths: 12, targetAgeMaxMonths: 240 },
};

export function getTargetAgeRangeMonths(formulaStage: FormulaStageId): {
  targetAgeMinMonths: number;
  targetAgeMaxMonths: number;
} {
  return FORMULA_STAGE_TARGET_MONTHS[formulaStage];
}

export function hasAvoidConflictFromPreferenceMatches(preferenceMatches: readonly string[]): boolean {
  return preferenceMatches.length > 0;
}

export type FormulaDeterministicSnapshot = {
  childAgeMonths: number | null;
  isFormulaProduct: boolean;
  formulaStage: FormulaStageId | null;
  targetAgeMinMonths: number | null;
  targetAgeMaxMonths: number | null;
  hasAvoidConflict: boolean;
  hasAllergyConflict: boolean;
  /** `null` = no deterministic formula verdict (not formula, unknown stage, unknown age, or hard disqualifier). */
  verdict: Verdict | null;
};

function corpus(p: FormulaStageProductSlice): string {
  const parts = [p.productName, p.brand, p.ingredientsText, ...(p.categories ?? [])].filter(Boolean).join(' ').toLowerCase();
  return parts;
}

function categoriesBlob(p: FormulaStageProductSlice): string {
  return (p.categories ?? []).join(' ').toLowerCase();
}

/** Lowercase + normalize common unicode / spacing so stage digits still match. */
function normForStageMatch(p: FormulaStageProductSlice): string {
  return corpus(p)
    .replace(/\uFF0B/g, '+')
    .replace(/\uFF0D|\u2212/g, '-')
    .replace(/\s+/g, ' ');
}

const CAFFEINE = /\b(caffeine|guarana|taurine|coffee extract|cola|energy drink|energy shot)\b/i;
const ARTIFICIAL_SWEETENER =
  /\b(aspartame|acesulfame|sucralose|stevia|steviol|saccharin|neotame|advantame|xylitol|erythritol|sorbitol|maltitol|mannitol|isomalt|polyol|artificial sweetener|sweetener e\d{3})\b/i;

const FORMULA_CATEGORY =
  /\b(baby-formulas?|infant-formulas?|follow-on-formulas?|first-age-milk|second-age-milk|infant-milks|growing-up-milk|toddler-milk|starting-milks?|initial-milks?)\b/i;

export function isFormulaProduct(product: FormulaStageProductSlice): boolean {
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

/** @deprecated use {@link isFormulaProduct} */
export function isFormulaLikeProduct(product: FormulaStageProductSlice): boolean {
  return isFormulaProduct(product);
}

function trailingStageDigitFromName(product: FormulaStageProductSlice): 1 | 2 | 3 | 4 | null {
  const name = (product.productName ?? '').trim().toLowerCase();
  if (!name) {
    return null;
  }
  const m = /\b([1-4])\s*$/.exec(name.replace(/\uFF0B/g, '+').trim());
  if (!m) {
    return null;
  }
  return Number(m[1]) as 1 | 2 | 3 | 4;
}

/**
 * Single resolved month for formula age gates: exact floor when birthdate-known,
 * otherwise a stable bucket midpoint when only `ageBucket` is available.
 */
export function getChildAgeMonthsForFormula(
  ageInMonths: number | null,
  ageBucket: AgeBucketId | undefined,
): number | null {
  if (ageInMonths != null && Number.isFinite(ageInMonths) && ageInMonths >= 0) {
    return Math.floor(ageInMonths);
  }
  switch (ageBucket) {
    case 'm0_5':
      return 3;
    case 'm6_7':
      return 6;
    case 'm8_11':
      return 9;
    case 'm12_23':
      return 18;
    case 'y2_3':
      return 30;
    case 'y4_6':
      return 54;
    case 'y7_plus':
      return 84;
    default:
      return null;
  }
}

const ALLERGEN_AVOID_IDS = new Set(['milk', 'soy', 'gluten', 'nuts', 'eggs']);

export function hasAllergyConflictFromPreferenceMatches(preferenceMatches: readonly string[]): boolean {
  return preferenceMatches.some((id) => ALLERGEN_AVOID_IDS.has(id));
}

/**
 * Marketing stage from name + OFF categories (deterministic heuristics only).
 */
export function getFormulaStage(product: FormulaStageProductSlice): FormulaStageId | null {
  if (!isFormulaProduct(product)) {
    return null;
  }
  const c = normForStageMatch(product);
  const cat = categoriesBlob(product);

  const stage34 =
    /\b(stage|stufe|step)\s*[34]\b/i.test(c) ||
    /\bpremium\s*\+\s*[34]\b/i.test(c) ||
    /\bpremium\+\s*[34]\b/i.test(c);
  const stage12 = /\b(stage|stufe|step)\s*([12])\b/i.exec(c);

  if (
    stage34 ||
    /\b(third[-\s]?age|fourth[-\s]?age|growing[-\s]?up|toddler\s+formula|toddler\s+milk|preschool)\b/i.test(c) ||
    /\b12\s*\+\s*months?\b/i.test(c) ||
    /\b12\s*[-–]\s*36\s*months?\b/i.test(c) ||
    /\b(from|ab)\s*1\s*year\b/i.test(c) ||
    /\b(growing-up|third-age|fourth-age)\b/i.test(cat)
  ) {
    return 'stage3';
  }

  if (
    /\b(follow[-\s]?on|folgemilch|continuation\s+formula|second[-\s]?age)\b/i.test(cat) ||
    /\b(follow[-\s]?on\s+formula|folgemilch|continuation\s+formula|second[-\s]?age)\b/i.test(c) ||
    /\b6\s*[-–/]\s*12\s*months?\b/i.test(c) ||
    /\b6\s+to\s+12\s+months?\b/i.test(c) ||
    /\bpremium\s*\+\s*2\b/i.test(c) ||
    /\bpremium\+\s*2\b/i.test(c) ||
    (stage12 && stage12[2] === '2') ||
    /en:(follow-on-formulas?|second-age-milk)\b/.test(cat)
  ) {
    return 'stage2';
  }

  if (
    /\b(nutrilon|aptamil|hipp\b|nan\b|similac|enfamil|friso)\b[^,]{0,55}\b2\b/i.test(c) &&
    !/\b20\d\d\b|\b2\s*,\s*5\s*l\b|\b250\s*ml\b/i.test(c)
  ) {
    return 'stage2';
  }

  if (
    /\b(first[-\s]?age|starting[-\s]?milk|initial[-\s]?milk|anfangsmilch|\bPRE\b|newborn)\b/i.test(c) ||
    /\b0\s*[-–/]\s*6\s*months?\b/i.test(c) ||
    /\bpremium\s*\+\s*1\b/i.test(c) ||
    /\bpremium\+\s*1\b/i.test(c) ||
    (stage12 && stage12[2] === '1') ||
    /en:first-age-milk\b/.test(cat) ||
    /en:starting-milks?\b/.test(cat) ||
    /en:initial-milks?\b/.test(cat)
  ) {
    return 'stage1';
  }

  if (/\b(nutrilon|aptamil|hipp\b|nan\b)\b[^,]{0,55}\b1\b/i.test(c)) {
    return 'stage1';
  }

  if (/en:baby-formulas?\b/.test(cat) && !/follow-on|second-age/.test(cat)) {
    const d = trailingStageDigitFromName(product);
    if (d === 2) {
      return 'stage2';
    }
    if (d === 1) {
      return 'stage1';
    }
    if (d === 3 || d === 4) {
      return 'stage3';
    }
  }

  return null;
}

/** @deprecated use {@link getFormulaStage} */
export function detectFormulaMarketingStage(product: FormulaStageProductSlice): 'first' | 'followon' | 'growing' | null {
  const s = getFormulaStage(product);
  if (s === 'stage1') {
    return 'first';
  }
  if (s === 'stage2') {
    return 'followon';
  }
  if (s === 'stage3') {
    return 'growing';
  }
  return null;
}

function verdictForChildVsTargetRange(childMonths: number, min: number, max: number): Verdict {
  if (childMonths < min) {
    return 'avoid';
  }
  if (childMonths > max) {
    return 'sometimes';
  }
  return 'good';
}

function maxStrictVerdict(a: Verdict, b: Verdict): Verdict {
  return verdictStrictness(a) >= verdictStrictness(b) ? a : b;
}

/**
 * Full deterministic formula snapshot (age × stage × optional avoid/allergy flags).
 * When `hasAvoidConflict` or `hasAllergyConflict` is true, the returned `verdict` is raised to at least
 * `sometimes` (allergen-related) or `avoid` (any avoid conflict) so it never contradicts parent prefs.
 */
export function computeFormulaDeterministicSnapshot(
  ageInMonths: number | null,
  ageBucket: AgeBucketId | undefined,
  product: FormulaStageProductSlice,
  conflict: { hasAvoidConflict: boolean; hasAllergyConflict: boolean },
): FormulaDeterministicSnapshot {
  const isFormula = isFormulaProduct(product);
  const childAgeMonths = getChildAgeMonthsForFormula(ageInMonths, ageBucket);
  const formulaStage = isFormula ? getFormulaStage(product) : null;
  const { hasAvoidConflict, hasAllergyConflict } = conflict;

  const empty: FormulaDeterministicSnapshot = {
    childAgeMonths,
    isFormulaProduct: isFormula,
    formulaStage,
    targetAgeMinMonths: null,
    targetAgeMaxMonths: null,
    hasAvoidConflict,
    hasAllergyConflict,
    verdict: null,
  };

  if (!isFormula || childAgeMonths == null) {
    return empty;
  }

  const c = normForStageMatch(product);
  if (CAFFEINE.test(c) || ARTIFICIAL_SWEETENER.test(c)) {
    return empty;
  }

  if (!formulaStage) {
    return empty;
  }

  const { targetAgeMinMonths, targetAgeMaxMonths } = getTargetAgeRangeMonths(formulaStage);
  let verdict = verdictForChildVsTargetRange(childAgeMonths, targetAgeMinMonths, targetAgeMaxMonths);

  if (hasAvoidConflict) {
    verdict = maxStrictVerdict(verdict, 'avoid');
  } else if (hasAllergyConflict) {
    verdict = maxStrictVerdict(verdict, 'sometimes');
  }

  return {
    childAgeMonths,
    isFormulaProduct: true,
    formulaStage,
    targetAgeMinMonths,
    targetAgeMaxMonths,
    hasAvoidConflict,
    hasAllergyConflict,
    verdict,
  };
}

/** Enforce at least `floor` strictness (e.g. pull `good` up to `sometimes`). */
function verdictAtLeast(floor: Verdict, current: Verdict): Verdict {
  if (verdictStrictness(current) >= verdictStrictness(floor)) {
    return current;
  }
  return floor;
}

/**
 * Deterministic age × stage verdict for infant milks. Returns null when not applicable.
 */
export function resolveDeterministicFormulaStageVerdict(
  ageInMonths: number | null,
  ageBucket: AgeBucketId | undefined,
  product: FormulaStageProductSlice,
): Verdict | null {
  return computeFormulaDeterministicSnapshot(ageInMonths, ageBucket, product, {
    hasAvoidConflict: false,
    hasAllergyConflict: false,
  }).verdict;
}

/**
 * After AI + preference merge: lock verdicts to deterministic formula rules.
 * Any avoid-topic match skips the override (parent prefs win).
 */
export function applyDeterministicFormulaStageVerdictPatch(
  ageInMonths: number | null,
  ageBucket: AgeBucketId | undefined,
  product: FormulaStageProductSlice,
  result: AiResult,
): AiResult {
  if (result.preferenceMatches.length > 0) {
    return result;
  }

  const snap = computeFormulaDeterministicSnapshot(ageInMonths, ageBucket, product, {
    hasAvoidConflict: false,
    hasAllergyConflict: false,
  });

  const required = snap.verdict;
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
