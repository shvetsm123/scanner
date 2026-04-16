import type { AppLanguage } from '../lib/deviceLanguage';
import type { AvoidPreference, ResultStyle } from './preferences';
import type { Verdict } from './scan';

/** Single canonical model output per product (same verdict for all display modes). */
export type AiResult = {
  /** Verdict from child age + product facts only (ignore avoid list). */
  baseVerdict: Verdict;
  /** Shown verdict after preference conflicts; never more lenient than baseVerdict. */
  verdict: Verdict;
  summary: string;
  /** Factual bullets (see normalizeCanonicalAiPayload). */
  reasons: string[];
  preferenceMatches: string[];
  /** Legacy model field; UI uses OFF-only ingredient tab. */
  ingredientBreakdown: string[];
  allergyNotes: string[];
  /** Short framing: why the verdict matters for this age (no repeated nutrition numbers from bullets). */
  whyThisMatters: string;
  parentTakeaway: string;
  /** Per-100g (or per-100ml) facts only; omit unknowns. */
  nutritionSnapshot: string[];
  /** Short flag lines grounded in ingredients / allergens / categories. */
  ingredientFlags: string[];
  /** Advanced "official context" lines; empty for quick scans. */
  guidanceContext: string[];
};

/** Second OpenAI call: only cleaned OFF ingredient tokens + classification context. */
export type IngredientsAiInput = {
  /** Device / app UI language — all model output names and notes must match this only. */
  outputLanguage: AppLanguage;
  /** BCP-47 locale from the device when available (e.g. ru-RU, uk-UA). */
  localeHint?: string;
  childAge: number;
  avoidPreferenceIds: AvoidPreference[];
  cleanedIngredientLines: string[];
  additivesTags: string[];
  allergensDeclared: string[];
  traceDeclared: string[];
};

export type KidsAiInput = {
  mode: 'kids';
  childAge: number;
  /** App-enforced verdict from rule engine; AI must not contradict. */
  ruleBasedBaseVerdict: Verdict;
  /** Shown result depth; does not change verdict. */
  resultStyle: ResultStyle;
  /** BCP-47 language code root (e.g. en, de); AI must write explanatory text in this language. */
  outputLanguage: AppLanguage;
  /** Omitted when the parent has not selected any avoid topics. */
  avoidPreferences?: AvoidPreference[];
  product: {
    barcode: string;
    productName: string;
    brand?: string;
    ingredientsText?: string;
    categories?: string[];
    imageUrl?: string;
    allergensText?: string;
    /** Numeric per-100g / per-100ml facts from the listing when present. */
    nutriments?: Record<string, number>;
  };
};

export type { Plan } from './preferences';

/** Row shape for home favorites list (Supabase-backed). */
export type FavoriteListItem = {
  favoriteId: string;
  productId: string;
  createdAt: string;
  barcode: string;
  productName: string;
  brand: string | null;
  imageUrl: string | null;
};
