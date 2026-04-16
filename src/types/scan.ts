export type Verdict = 'good' | 'sometimes' | 'avoid' | 'unknown';

/** Single ingredient line in the Ingredients tab (second AI pass output). */
export type IngredientPanelEntry = {
  name: string;
  note: string;
};

/** Strict second-pass JSON: grouped by tier. */
export type IngredientAiPanel = {
  good: IngredientPanelEntry[];
  neutral: IngredientPanelEntry[];
  redFlags: IngredientPanelEntry[];
};

/** Full evaluation persisted once per scan; UI depth uses current result style only. */
export type SavedScanResult = {
  id: string;
  barcode: string;
  productName: string;
  brand?: string;
  imageUrl?: string;
  /** Product-only verdict before avoid constraints (same as verdict when no avoids / legacy). */
  baseVerdict?: Verdict;
  verdict: Verdict;
  summary: string;
  reasons: string[];
  preferenceMatches?: string[];
  whyText?: string;
  /** “Why this matters” for the General tab (preferred over legacy `whyText`). */
  whyThisMatters?: string;
  ingredientBreakdown?: string[];
  allergyNotes?: string[];
  parentTakeaway?: string;
  scannedAt: string;
  /** Extra product context from Open Food Facts (not shown as primary modal fields). */
  ingredientsText?: string;
  categories?: string[];
  allergensText?: string;
  /** Nutrition snapshot for remote product row (when OFF provides it). */
  nutriments?: Record<string, number>;
  /** Factual nutrition lines for Advanced (from AI). */
  nutritionSnapshot?: string[];
  /** Short composition / allergen-style flags (from AI). */
  ingredientFlags?: string[];
  /** Short official-guidance-style context (advanced; optional on older saves). */
  guidanceContext?: string[];
  /** Raw Open Food Facts `product` object for Supabase `raw_json`. */
  rawJson?: Record<string, unknown>;
  /** Fingerprint of child age + avoids when this result was produced; used for reuse. */
  analysisContextKey?: string;
  /** Ingredients tab: validated second AI pass output only (no raw OFF strings). */
  ingredientPanel?: IngredientAiPanel;
};

export type RecentScan = SavedScanResult;
