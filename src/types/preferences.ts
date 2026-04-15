/** Paid tier is only `unlimited`; legacy tokens are normalized in storage. */
export type Plan = 'free' | 'unlimited';

/** `balanced` / `detailed` are migrated to `quick` / `advanced` in storage. */
export type ResultStyle = 'quick' | 'advanced';

export type AvoidPreference =
  | 'added_sugar'
  | 'sweeteners'
  | 'artificial_colors'
  | 'caffeine'
  | 'ultra_processed'
  | 'milk'
  | 'soy'
  | 'gluten'
  | 'nuts'
  | 'eggs'
  | 'high_salt'
  | 'artificial_flavors'
  | 'preservatives'
  | 'palm_oil';

/** Single source for storage filter + remote parse allowlist. */
export const AVOID_PREFERENCE_IDS: readonly AvoidPreference[] = [
  'added_sugar',
  'sweeteners',
  'artificial_colors',
  'caffeine',
  'ultra_processed',
  'milk',
  'soy',
  'gluten',
  'nuts',
  'eggs',
  'high_salt',
  'artificial_flavors',
  'preservatives',
  'palm_oil',
];

export const AVOID_PREFERENCE_LABELS: Record<AvoidPreference, string> = {
  added_sugar: 'Added sugar',
  sweeteners: 'Sweeteners',
  artificial_colors: 'Artificial colors',
  caffeine: 'Caffeine',
  ultra_processed: 'Ultra-processed snacks',
  milk: 'Milk',
  soy: 'Soy',
  gluten: 'Gluten',
  nuts: 'Nuts',
  eggs: 'Eggs',
  high_salt: 'High salt',
  artificial_flavors: 'Artificial flavors',
  preservatives: 'Preservatives',
  palm_oil: 'Palm oil',
};

export const AVOID_PREFERENCE_OPTIONS: { id: AvoidPreference; label: string }[] = AVOID_PREFERENCE_IDS.map((id) => ({
  id,
  label: AVOID_PREFERENCE_LABELS[id],
}));

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Human-readable label for a stored avoid id, or title-cased fallback. */
export function labelForAvoidPreferenceId(id: string): string {
  if ((AVOID_PREFERENCE_IDS as readonly string[]).includes(id)) {
    return AVOID_PREFERENCE_LABELS[id as AvoidPreference];
  }
  return id
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** @deprecated Use `humanizePreferenceMatchLine` from `src/lib/i18n` (localized). */
export function humanizePreferenceMatchLine(line: string): string {
  let out = line;
  for (const id of AVOID_PREFERENCE_IDS) {
    const label = AVOID_PREFERENCE_LABELS[id];
    out = out.replace(new RegExp(`\\b${escapeRegExp(id)}\\b`, 'g'), label);
  }
  return out;
}
