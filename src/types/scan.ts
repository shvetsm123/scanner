export type Verdict = 'good' | 'sometimes' | 'avoid' | 'unknown';

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
  /** Raw Open Food Facts `product` object for Supabase `raw_json`. */
  rawJson?: Record<string, unknown>;
  /** Fingerprint of child age + result style + avoids when this result was produced; used for reuse. */
  analysisContextKey?: string;
};

export type RecentScan = SavedScanResult;
