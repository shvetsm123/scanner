import type { NormalizedProduct } from '../api/openFoodFacts';
import { AVOID_PREFERENCE_IDS, type AvoidPreference } from '../types/preferences';
import { listingSuggestsAddedOrClearSweetening } from './productRules';

/** Product fields sufficient to infer avoid-list hits (matches AI input subset). */
export type ListingForPreferenceInference = Pick<
  NormalizedProduct,
  'productName' | 'brand' | 'ingredientsText' | 'categories' | 'allergensText' | 'nutriments'
>;

const SWEETENER_TERMS =
  /\b(aspartame|acesulfame|sucralose|stevia|steviol|saccharin|neotame|advantame|xylitol|erythritol|sorbitol|maltitol|mannitol|isomalt|polyol|artificial sweetener|sweetener e\d{3})\b/i;

const CAFFEINE_TERMS = /\b(caffeine|guarana|taurine|coffee extract|cola|energy drink|energy shot)\b/i;

const JUNK_CATEGORY_TAGS =
  /en:(sweets|candies|chocolates|biscuits-and-cakes|snacks|desserts|sugared-beverages|sodas|energy-drinks|chips-and-fries|appetizers)/;

const CHIPS = /\b(chip|crisp|potato snack|tortilla chip)\b/i;
const CANDY = /\b(candy|sweet|lollipop|gummy|chocolate bar|confection)\b/i;
const COOKIE_BAKERY = /\b(cookie|biscuit|brownie|muffin|cake|pastry|donut|doughnut|croissant)\b/i;

const SOY = /\b(soy|soya|soja|soybean|soybeans|textured soy|soy protein|soy lecithin|lecithin\s*\(\s*soy)/i;
const PLANT_MILK_PHRASE = /\b(almond|coconut|oat|rice|soy|hazelnut)\s+milk\b/i;
const DAIRY_TOKENS =
  /\b(dairy|lactose|whey|casein|milk powder|skimmed milk powder|whole milk powder|cream cheese|butter|cheese|yogurt|yoghurt|skyr|quark|fromage)\b/i;
const GLUTEN = /\b(gluten|wheat|barley|rye|spelt|triticale|malt(?!ed barley syrup)|bulgur|couscous|semolina)\b/i;
const NUTS = /\b(peanut|peanuts|peanut butter|almond|hazelnut|walnut|cashew|pistachio|pecan|macadamia|brazil nut|tree nuts|nuts\b|nüsse|noix)\b/i;
const EGGS = /\b(egg|eggs|albumen|ovalbumin|lysozyme|ovo)\b/i;
const PALM = /\b(palm oil|palm fat|palm kernel|palmitate|palmolein|vegetable fat\s*\(.*palm)/i;
const COLORS = /\b(e1[0-6][0-9]|colour|coloring|colouring|tartrazine|sunset yellow|brilliant blue|allura red|azorubine|carmoisine|ponceau)\b/i;
const FLAVORS = /\b(artificial (flavour|flavor)|artificial flavouring|artificial flavoring)\b/i;
const PRESERVATIVES = /\b(preservative|sodium benzoate|potassium sorbate|sodium nitrite|sodium nitrate|sulphite|sulfite|benzoic acid|sorbic acid|e211|e202|e200|e201|e203|e210|e220|e221|e222|e223|e224|e249|e250)\b/i;

function corpus(p: ListingForPreferenceInference): string {
  return [p.productName, p.brand, p.ingredientsText, p.allergensText, ...(p.categories ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function categoriesBlob(p: ListingForPreferenceInference): string {
  return (p.categories ?? []).join(' ').toLowerCase();
}

function saltPer100g(p: ListingForPreferenceInference): number | null {
  const salt = p.nutriments?.salt_100g;
  if (typeof salt === 'number' && Number.isFinite(salt)) {
    return salt;
  }
  const na = p.nutriments?.sodium_100g;
  if (typeof na === 'number' && Number.isFinite(na)) {
    return na * 2.5;
  }
  return null;
}

/**
 * Conservative listing-derived hits for the parent's selected avoid topics.
 * Used to backstop the model so preferenceMatches always reach the UI when the listing supports them.
 */
export function inferPreferenceMatchIdsFromListing(
  product: ListingForPreferenceInference,
  selected: readonly AvoidPreference[],
): AvoidPreference[] {
  if (!selected.length) {
    return [];
  }
  const allowed = new Set<AvoidPreference>(selected);
  const c = corpus(product);
  const cat = categoriesBlob(product);
  const out: AvoidPreference[] = [];

  const push = (id: AvoidPreference) => {
    if (!allowed.has(id) || out.includes(id)) {
      return;
    }
    out.push(id);
  };

  for (const id of selected) {
    if (!AVOID_PREFERENCE_IDS.includes(id)) {
      continue;
    }
    switch (id) {
      case 'added_sugar':
        if (listingSuggestsAddedOrClearSweetening(product)) {
          push(id);
        }
        break;
      case 'sweeteners':
        if (SWEETENER_TERMS.test(c)) {
          push(id);
        }
        break;
      case 'caffeine':
        if (CAFFEINE_TERMS.test(c)) {
          push(id);
        }
        break;
      case 'ultra_processed':
        if (JUNK_CATEGORY_TAGS.test(cat) || CHIPS.test(c) || CANDY.test(c) || COOKIE_BAKERY.test(c)) {
          push(id);
        }
        break;
      case 'soy':
        if (SOY.test(c)) {
          push(id);
        }
        break;
      case 'milk':
        if (DAIRY_TOKENS.test(c) || (/\bmilk\b/i.test(c) && !PLANT_MILK_PHRASE.test(c))) {
          push(id);
        }
        break;
      case 'gluten':
        if (GLUTEN.test(c)) {
          push(id);
        }
        break;
      case 'nuts':
        if (NUTS.test(c)) {
          push(id);
        }
        break;
      case 'eggs':
        if (EGGS.test(c)) {
          push(id);
        }
        break;
      case 'high_salt': {
        const s = saltPer100g(product);
        if (s != null && s >= 1.2) {
          push(id);
        }
        break;
      }
      case 'artificial_colors':
        if (COLORS.test(c)) {
          push(id);
        }
        break;
      case 'artificial_flavors':
        if (FLAVORS.test(c)) {
          push(id);
        }
        break;
      case 'preservatives':
        if (PRESERVATIVES.test(c)) {
          push(id);
        }
        break;
      case 'palm_oil':
        if (PALM.test(c)) {
          push(id);
        }
        break;
      default:
        break;
    }
  }

  return out.slice(0, 12);
}

export function sanitizeAiPreferenceMatchIds(
  raw: readonly string[],
  allowed: readonly AvoidPreference[] | undefined,
): AvoidPreference[] {
  if (!allowed?.length) {
    return [];
  }
  const allow = new Set(allowed);
  const out: AvoidPreference[] = [];
  for (const s of raw) {
    if (typeof s !== 'string') {
      continue;
    }
    const t = s.trim();
    if (!t || !allow.has(t as AvoidPreference)) {
      continue;
    }
    if (!(AVOID_PREFERENCE_IDS as readonly string[]).includes(t)) {
      continue;
    }
    const id = t as AvoidPreference;
    if (!out.includes(id)) {
      out.push(id);
    }
  }
  return out;
}

export function mergePreferenceMatchIds(
  fromAi: readonly string[],
  product: ListingForPreferenceInference,
  selected: readonly AvoidPreference[] | undefined,
): string[] {
  if (!selected?.length) {
    return [];
  }
  const aiIds = sanitizeAiPreferenceMatchIds(fromAi, selected);
  const inferred = inferPreferenceMatchIdsFromListing(product, selected);
  const merged: string[] = [];
  for (const id of aiIds) {
    merged.push(id);
  }
  for (const id of inferred) {
    if (!merged.includes(id)) {
      merged.push(id);
    }
  }
  return merged.slice(0, 12);
}
