import type { NormalizedProduct } from '../api/openFoodFacts';
import type { Verdict } from '../types/scan';
import type { ChildAgeProfile } from './childAgeContext';
import { resolveDeterministicFormulaStageVerdict } from './formulaStageRules';
import { verdictStrictness } from './preferenceMatchers';

export type AgeBand = '0_1' | '1_2' | '2_3' | '4_6' | '7_10' | '11_plus';

const SUGAR_FREE = /\b(no added sugar|sugar[- ]free|without added sugar|unsweetened|zuckerfrei)\b/i;

const ADDED_SUGAR_OR_SWEETENED = /\b(sucrose|added sugar|sugar syrup|glucose[- ]?fructose|high fructose|invert sugar|cane sugar|brown sugar|icing sugar|powdered sugar|sweetened|contains sugar|sugars?:\s*[1-9]|syrup|glucose|fructose|maltose|dextrose|honey|agave|molasses|muscovado)\b/i;

const SWEETENER_TERMS =
  /\b(aspartame|acesulfame|sucralose|stevia|steviol|saccharin|neotame|advantame|xylitol|erythritol|sorbitol|maltitol|mannitol|isomalt|polyol|artificial sweetener|sweetener e\d{3})\b/i;

const CAFFEINE_TERMS = /\b(caffeine|guarana|taurine|coffee extract|cola|energy drink|energy shot)\b/i;

const YOGURT_HINT = /\b(yogurt|yoghurt|yogourt|fromage blanc|skyr|quark)\b/i;
const FLAVORED_DESSERT_YOGURT =
  /\b(flavou?red yogurt|flavou?red yoghurt|fruit yogurt|dessert yogurt|vanilla yogurt|strawberry yogurt|sweet yogurt|kids yogurt|yogurt dessert)\b/i;

const PLAIN_YOGURTISH =
  /\b(natural yogurt|plain yogurt|greek yogurt|unsweetened yogurt|plain yoghurt|natural yoghurt)\b/i;

const COOKIE_BAKERY = /\b(cookie|biscuit|brownie|muffin|cake|pastry|donut|doughnut|croissant|sweet roll|bakery)\b/i;
const CHIPS = /\b(chip|crisp|potato snack|tortilla chip)\b/i;
const CANDY = /\b(candy|sweet|lollipop|gummy|chocolate bar|confection)\b/i;
const ENERGY = /\b(energy drink|energy shot|pre[- ]?workout)\b/i;
const SWEET_DRINK = /\b(soda|soft drink|lemonade|fruit drink|juice drink|nectar)\b/i;

const JUNK_CATEGORY_TAGS =
  /en:(sweets|candies|chocolates|biscuits-and-cakes|snacks|desserts|sugared-beverages|sodas|energy-drinks|chips-and-fries|appetizers)/;

/** Clear “treat / bakery / confection” wording in name or ingredients (under-12 tightening). */
const YOUNG_BABY_TREAT_DESCRIPTORS =
  /\b(chocolate bar|chocolate biscuit|chocolate spread|cake|cupcake|brownie|muffin|dessert|confection|lollipop|candy|cereal bar|snack bar|cookie|biscuit|croissant|danish|donut|doughnut|waffle|pancake mix)\b/i;

function corpus(product: NormalizedProduct): string {
  const parts = [
    product.productName,
    product.brand,
    product.ingredientsText,
    ...(product.categories ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return parts;
}

function categoriesBlob(product: NormalizedProduct): string {
  return (product.categories ?? []).join(' ').toLowerCase();
}

export function getAgeBand(childAge: number): AgeBand {
  if (!Number.isFinite(childAge)) {
    return '4_6';
  }
  if (childAge < 1) {
    return '0_1';
  }
  if (childAge < 2) {
    return '1_2';
  }
  if (childAge <= 3) {
    return '2_3';
  }
  if (childAge <= 6) {
    return '4_6';
  }
  if (childAge <= 10) {
    return '7_10';
  }
  return '11_plus';
}

/** Rule engine input: month-precise when `ageInMonths` is set, else legacy integer years. */
export type ProductRulesChildInput = {
  ageInMonths: number | null;
  legacyYearsInt: number | null;
  /** Floored whole years (0 for infants under 1). */
  completedWholeYearsApprox: number;
  /** Birthdate-known 0–5 completed months — stricter treat / salt / plain dairy handling. */
  infantStrict: boolean;
  /** Birthdate-known under 12 completed months — stricter than 12–23 month toddlers. */
  infantUnder12: boolean;
  /** 6–11 completed months (weaning-age band, still very conservative). */
  infant611: boolean;
};

export function productRulesChildInputFromProfile(profile: ChildAgeProfile): ProductRulesChildInput {
  const legacyYearsInt = profile.source === 'legacy_age' && profile.legacyChildAgeYears != null ? profile.legacyChildAgeYears : null;
  const m = profile.ageInMonths;
  const infantStrict = m != null && m <= 5;
  const infantUnder12 = m != null && m < 12;
  const infant611 = m != null && m >= 6 && m <= 11;
  return {
    ageInMonths: profile.ageInMonths,
    legacyYearsInt,
    completedWholeYearsApprox: profile.completedWholeYears,
    infantStrict,
    infantUnder12,
    infant611,
  };
}

function isUnder24MonthsInput(input: ProductRulesChildInput): boolean {
  if (input.ageInMonths != null) {
    return input.ageInMonths < 24;
  }
  if (input.legacyYearsInt != null) {
    return input.legacyYearsInt < 2;
  }
  return false;
}

function dataTooLimited(product: NormalizedProduct, c: string): boolean {
  const hasIng = !!(product.ingredientsText && product.ingredientsText.trim().length > 8);
  const hasCat = !!(product.categories && product.categories.length > 0);
  const hasName = !!(product.productName && product.productName.trim().length > 2);
  return !hasIng && !hasCat && !hasName;
}

function hasSweeteners(c: string): boolean {
  return SWEETENER_TERMS.test(c);
}

function hasCaffeine(c: string): boolean {
  return CAFFEINE_TERMS.test(c);
}

function hasAddedSugarOrClearlySweetened(c: string): boolean {
  if (SUGAR_FREE.test(c)) {
    return false;
  }
  return ADDED_SUGAR_OR_SWEETENED.test(c);
}

/** True when the product name / ingredients / categories suggest added or clearly sweetened sugars (not lab “total sugar” alone). */
export function listingSuggestsAddedOrClearSweetening(
  product: Pick<NormalizedProduct, 'productName' | 'brand' | 'ingredientsText' | 'categories'>,
): boolean {
  return hasAddedSugarOrClearlySweetened(corpus(product as NormalizedProduct));
}

function isFlavoredOrDessertYogurt(c: string): boolean {
  if (!YOGURT_HINT.test(c)) {
    return false;
  }
  if (PLAIN_YOGURTISH.test(c) && !hasAddedSugarOrClearlySweetened(c) && !FLAVORED_DESSERT_YOGURT.test(c)) {
    return false;
  }
  if (FLAVORED_DESSERT_YOGURT.test(c)) {
    return true;
  }
  if (YOGURT_HINT.test(c) && hasAddedSugarOrClearlySweetened(c)) {
    return true;
  }
  if (/\b(fruit preparation|fruit puree|jam|conserve|flavour|flavor)\b/i.test(c) && hasAddedSugarOrClearlySweetened(c)) {
    return true;
  }
  return false;
}

function isPlainUnsweetenedYogurt(c: string): boolean {
  if (!YOGURT_HINT.test(c)) {
    return false;
  }
  if (PLAIN_YOGURTISH.test(c) && !hasAddedSugarOrClearlySweetened(c)) {
    return true;
  }
  if (YOGURT_HINT.test(c) && SUGAR_FREE.test(c) && !FLAVORED_DESSERT_YOGURT.test(c)) {
    return true;
  }
  return false;
}

function isSweetSnackJunk(c: string, cat: string): boolean {
  if (COOKIE_BAKERY.test(c) && (hasAddedSugarOrClearlySweetened(c) || /\b(chocolate|frosting|icing)\b/i.test(c))) {
    return true;
  }
  if (CHIPS.test(c)) {
    return true;
  }
  if (CANDY.test(c)) {
    return true;
  }
  if (JUNK_CATEGORY_TAGS.test(cat)) {
    return true;
  }
  return false;
}

function isEnergyOrCaffeinatedSnack(c: string): boolean {
  return ENERGY.test(c) || (hasCaffeine(c) && /\b(energy|sport drink|cola|soda|drink|shot)\b/i.test(c));
}

function isSweetenedYogurtOrDessertLike(c: string): boolean {
  return isFlavoredOrDessertYogurt(c) || (YOGURT_HINT.test(c) && hasAddedSugarOrClearlySweetened(c));
}

function highSaltVerdict(product: NormalizedProduct, input: ProductRulesChildInput): Verdict | null {
  const salt = product.nutriments?.salt_100g;
  if (salt == null || !Number.isFinite(salt)) {
    return null;
  }
  if (salt >= 2.4) {
    return 'avoid';
  }
  if (input.infantStrict && salt >= 1.0) {
    return 'sometimes';
  }
  if (input.infant611 && salt >= 0.75) {
    return 'sometimes';
  }
  if (input.infantUnder12 && !input.infantStrict && salt >= 0.85) {
    return 'sometimes';
  }
  if (salt >= 1.5 && input.completedWholeYearsApprox <= 10) {
    return 'sometimes';
  }
  return null;
}

/** Under 12 months: obvious treat/snack/sweet-drink positioning → avoid when listing supports it. */
function youngBabyProcessedAvoid(c: string, cat: string, input: ProductRulesChildInput): boolean {
  if (!input.infantUnder12) {
    return false;
  }
  if (JUNK_CATEGORY_TAGS.test(cat)) {
    return true;
  }
  if (SWEET_DRINK.test(c)) {
    return true;
  }
  if (YOUNG_BABY_TREAT_DESCRIPTORS.test(c)) {
    return true;
  }
  return false;
}

function maxStrict(a: Verdict, b: Verdict): Verdict {
  return verdictStrictness(a) >= verdictStrictness(b) ? a : b;
}

function neverGoodIfJunk(candidate: Verdict, c: string, cat: string): Verdict {
  if (candidate !== 'good') {
    return candidate;
  }
  if (JUNK_CATEGORY_TAGS.test(cat) || CHIPS.test(c) || CANDY.test(c) || (COOKIE_BAKERY.test(c) && hasAddedSugarOrClearlySweetened(c))) {
    return 'sometimes';
  }
  if (SWEET_DRINK.test(c) && hasAddedSugarOrClearlySweetened(c)) {
    return 'sometimes';
  }
  return candidate;
}

/**
 * Hard rule-based verdict from age + product fields only (no avoid list).
 */
function nameOnlyObviousTreatUnderTwo(product: NormalizedProduct, c: string): boolean {
  if (product.ingredientsText && product.ingredientsText.trim().length > 8) {
    return false;
  }
  return /\b(skittle|m&m|gummy|lollipop|candy bar|chocolate bar|marshmallow)\b/i.test(c);
}

export function computeRuleBasedBaseVerdict(input: ProductRulesChildInput, product: NormalizedProduct): Verdict {
  const c = corpus(product);
  const cat = categoriesBlob(product);
  const under24 = isUnder24MonthsInput(input);

  if (under24 && nameOnlyObviousTreatUnderTwo(product, c)) {
    return 'avoid';
  }

  if (dataTooLimited(product, c)) {
    return 'unknown';
  }

  if (under24) {
    if (hasCaffeine(c)) {
      return 'avoid';
    }
    if (hasSweeteners(c)) {
      return 'avoid';
    }
    if (input.infantUnder12 && /\bhoney\b/i.test(c)) {
      return 'avoid';
    }
    const formulaDet = resolveDeterministicFormulaStageVerdict(input.ageInMonths, product);
    if (formulaDet !== null) {
      return formulaDet;
    }
    if (hasAddedSugarOrClearlySweetened(c) && !isPlainUnsweetenedYogurt(c)) {
      return 'avoid';
    }
    if (isFlavoredOrDessertYogurt(c) || isSweetSnackJunk(c, cat)) {
      return 'avoid';
    }
    if (input.infantStrict && YOGURT_HINT.test(c) && /\b(maltodextrin|dextrose|glucose syrup|glucose-fructose syrup)\b/i.test(c)) {
      return 'avoid';
    }
    if (isEnergyOrCaffeinatedSnack(c)) {
      return 'avoid';
    }
    if (youngBabyProcessedAvoid(c, cat, input)) {
      return 'avoid';
    }
    if (isPlainUnsweetenedYogurt(c)) {
      return input.infantStrict || input.infant611 ? 'sometimes' : 'good';
    }
    return 'sometimes';
  }

  const formulaDetOlder = resolveDeterministicFormulaStageVerdict(input.ageInMonths, product);
  if (formulaDetOlder !== null) {
    return formulaDetOlder;
  }

  let v: Verdict = 'sometimes';

  if (isEnergyOrCaffeinatedSnack(c)) {
    v = maxStrict(v, 'avoid');
  }
  if (CHIPS.test(c) || CANDY.test(c) || (COOKIE_BAKERY.test(c) && hasAddedSugarOrClearlySweetened(c))) {
    v = maxStrict(v, 'avoid');
  }

  const saltV = highSaltVerdict(product, input);
  if (saltV) {
    v = maxStrict(v, saltV);
  }

  if (isPlainUnsweetenedYogurt(c) && !hasAddedSugarOrClearlySweetened(c) && !hasSweeteners(c) && v !== 'avoid') {
    v = 'good';
  }

  if (isSweetenedYogurtOrDessertLike(c)) {
    v = maxStrict(v, 'sometimes');
  }
  if (hasSweeteners(c)) {
    v = maxStrict(v, 'sometimes');
  }
  if (hasAddedSugarOrClearlySweetened(c) && !isPlainUnsweetenedYogurt(c)) {
    v = maxStrict(v, 'sometimes');
  }

  if (/\b(sparkling water|mineral water|spring water)\b/i.test(c) && !hasAddedSugarOrClearlySweetened(c) && !hasSweeteners(c)) {
    if (v !== 'avoid') {
      v = 'good';
    }
  }

  v = neverGoodIfJunk(v, c, cat);

  if (v === 'good' && (JUNK_CATEGORY_TAGS.test(cat) || isSweetenedYogurtOrDessertLike(c) || hasSweeteners(c))) {
    v = 'sometimes';
  }

  return v;
}
