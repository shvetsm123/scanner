import type { IngredientAiPanel, IngredientPanelEntry } from '../types/scan';

const LOG = '[IngredientsPanel][validate]';

function isPanelEntry(x: unknown): x is IngredientPanelEntry {
  if (!x || typeof x !== 'object') {
    return false;
  }
  const o = x as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const note = typeof o.note === 'string' ? o.note.trim() : '';
  return name.length >= 1 && note.length >= 1;
}

function normalizeEntry(x: unknown): IngredientPanelEntry {
  const o = x as Record<string, unknown>;
  return {
    name: String(o.name).trim(),
    note: String(o.note).trim(),
  };
}

/**
 * Structural validation only: object with good[], neutral[], redFlags[] of { name, note }.
 * Cleaned OFF lines are not compared to row counts or coverage.
 */
export function parseIngredientAiPanelJson(raw: unknown): IngredientAiPanel | null {
  if (!raw || typeof raw !== 'object') {
    console.warn(LOG, 'fail: not an object', typeof raw);
    return null;
  }
  const o = raw as Record<string, unknown>;
  const goodRaw = o.good;
  const neutralRaw = o.neutral;
  let redRaw: unknown = o.redFlags;
  if (!Array.isArray(redRaw) && Array.isArray((o as { red?: unknown }).red)) {
    redRaw = (o as { red: unknown[] }).red;
  }
  if (!Array.isArray(goodRaw) || !Array.isArray(neutralRaw) || !Array.isArray(redRaw)) {
    console.warn(LOG, 'fail: missing good|neutral|redFlags arrays', {
      hasGood: Array.isArray(goodRaw),
      hasNeutral: Array.isArray(neutralRaw),
      hasRedFlags: Array.isArray(o.redFlags),
      hasRedAlias: Array.isArray((o as { red?: unknown }).red),
    });
    return null;
  }
  const good = goodRaw.filter(isPanelEntry).map(normalizeEntry);
  const neutral = neutralRaw.filter(isPanelEntry).map(normalizeEntry);
  const redFlags = redRaw.filter(isPanelEntry).map(normalizeEntry);
  const total = good.length + neutral.length + redFlags.length;
  if (total === 0) {
    console.warn(LOG, 'fail: empty panel (no valid entries)');
    return null;
  }

  console.warn(LOG, 'OK: structural panel accepted', {
    good: good.length,
    neutral: neutral.length,
    redFlags: redFlags.length,
  });
  return { good, neutral, redFlags };
}
