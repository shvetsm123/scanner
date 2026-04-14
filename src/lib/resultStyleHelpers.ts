import type { AiResult } from '../types/ai';
import type { Plan, ResultStyle } from '../types/preferences';
import type { Verdict } from '../types/scan';
import { clampFinalVerdictToBase } from './preferenceMatchers';

/** Scan result UI depth: Free → Quick only; Unlimited → user’s stored quick/advanced. */
export function resolveUiResultStyle(plan: Plan, storedStyle: ResultStyle): ResultStyle {
  return plan === 'free' ? 'quick' : storedStyle;
}

const VERDICTS: readonly Verdict[] = ['good', 'sometimes', 'avoid', 'unknown'];

function isVerdict(value: unknown): value is Verdict {
  return typeof value === 'string' && (VERDICTS as readonly string[]).includes(value);
}

function isStringArray(value: unknown, maxLen: number): value is string[] {
  if (!Array.isArray(value)) {
    return false;
  }
  if (value.length > maxLen) {
    return false;
  }
  return value.every((item) => typeof item === 'string' && item.trim().length > 0);
}

function parsePreferenceMatches(raw: unknown): string[] | null {
  if (raw == null) {
    return [];
  }
  if (!isStringArray(raw, 12)) {
    return null;
  }
  return (raw as string[]).map((s) => s.trim());
}

function parseBoundedStringList(raw: unknown, maxItems: number, maxItemLen: number): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      continue;
    }
    const t = item.trim();
    if (!t || t.length > maxItemLen) {
      continue;
    }
    out.push(t);
    if (out.length >= maxItems) {
      break;
    }
  }
  return out;
}

function capIngredientBreakdownParagraphs(parts: string[]): string[] | null {
  if (parts.length < 2) {
    return null;
  }
  return parts.length > 4 ? parts.slice(0, 4) : parts;
}

function parseIngredientBreakdownParagraphs(raw: unknown, minParaLen: number): string[] | null {
  if (raw == null) {
    return null;
  }
  if (typeof raw === 'string') {
    const parts = raw
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length >= minParaLen);
    return capIngredientBreakdownParagraphs(parts);
  }
  if (Array.isArray(raw) && raw.length > 0 && raw.every((x) => typeof x === 'string')) {
    const parts = (raw as string[]).map((s) => s.trim()).filter((s) => s.length >= minParaLen);
    return capIngredientBreakdownParagraphs(parts);
  }
  return null;
}

function parseAllergyNotesList(raw: unknown): string[] {
  if (raw == null) {
    return [];
  }
  if (typeof raw === 'string') {
    const t = raw.trim();
    return t ? [t] : [];
  }
  if (isStringArray(raw, 8)) {
    return (raw as string[]).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function roundNutrient(v: number): string {
  if (!Number.isFinite(v)) {
    return '';
  }
  const a = Math.abs(v);
  if (a >= 10) {
    return v.toFixed(1).replace(/\.0$/, '');
  }
  if (a >= 1) {
    return v.toFixed(1);
  }
  return v
    .toFixed(2)
    .replace(/0+$/, '')
    .replace(/\.$/, '');
}

/**
 * Builds plain nutrition lines from Open Food Facts nutriments when the model did not supply a snapshot.
 */
export function formatNutritionSnapshotFromNutriments(nm?: Record<string, number>): string[] {
  if (!nm || typeof nm !== 'object') {
    return [];
  }
  const lines: string[] = [];
  const sugars = nm['sugars_100g'];
  if (typeof sugars === 'number' && Number.isFinite(sugars)) {
    lines.push(`Sugar: ${roundNutrient(sugars)} g / 100 g`);
  }
  const salt = nm['salt_100g'];
  if (typeof salt === 'number' && Number.isFinite(salt)) {
    lines.push(`Salt: ${roundNutrient(salt)} g / 100 g`);
  } else {
    const sodium = nm['sodium_100g'];
    if (typeof sodium === 'number' && Number.isFinite(sodium)) {
      const mg = sodium * 1000;
      lines.push(`Sodium: ${Math.round(mg)} mg / 100 g`);
    }
  }
  const sat = nm['saturated-fat_100g'];
  if (typeof sat === 'number' && Number.isFinite(sat)) {
    lines.push(`Saturated fat: ${roundNutrient(sat)} g / 100 g`);
  }
  const kcal = nm['energy-kcal_100g'];
  if (typeof kcal === 'number' && Number.isFinite(kcal)) {
    lines.push(`Energy: ${Math.round(kcal)} kcal / 100 g`);
  } else {
    const kj = nm['energy_100g'];
    if (typeof kj === 'number' && Number.isFinite(kj)) {
      lines.push(`Energy: ${Math.round(kj)} kJ / 100 g`);
    }
  }
  return lines;
}

function normNutritionLineKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/,/g, '.');
}

/** Prefer model snapshot; if empty, use OFF-derived lines (Quick-style). */
export function resolvedNutritionSnapshotLines(
  snapshot: string[] | undefined,
  nutriments: Record<string, number> | undefined,
): string[] {
  return resolvedNutritionSnapshotLinesForMode('quick', snapshot, nutriments);
}

/** Advanced merges listing nutriments with the model snapshot when both exist. */
export function resolvedNutritionSnapshotLinesForMode(
  mode: ResultStyle,
  snapshot: string[] | undefined,
  nutriments: Record<string, number> | undefined,
): string[] {
  const fromAi = snapshot?.map((s) => s.trim()).filter(Boolean) ?? [];
  const fromOff = formatNutritionSnapshotFromNutriments(nutriments);
  if (mode !== 'advanced') {
    return fromAi.length > 0 ? fromAi : fromOff;
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of fromAi) {
    const k = normNutritionLineKey(line);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(line.trim());
    }
  }
  for (const line of fromOff) {
    const k = normNutritionLineKey(line);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(line);
    }
    if (out.length >= 14) {
      break;
    }
  }
  return out;
}

/**
 * Validates one canonical AI JSON object (verdict + all depth fields). Returns null if invalid.
 */
export function normalizeCanonicalAiPayload(
  raw: unknown,
  ruleBasedBaseVerdict: Verdict,
  resultStyle: ResultStyle,
): AiResult | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const o = raw as Record<string, unknown>;

  const finalRaw = o.finalVerdict ?? o.verdict;
  const proposedFinal = isVerdict(finalRaw) ? finalRaw : null;
  if (!proposedFinal) {
    return null;
  }
  const verdict = clampFinalVerdictToBase(ruleBasedBaseVerdict, proposedFinal);
  if (typeof o.summary !== 'string' || !o.summary.trim()) {
    return null;
  }
  const advanced = resultStyle === 'advanced';
  const minReasons = advanced ? 5 : 3;
  const maxReasons = advanced ? 8 : 5;
  if (!Array.isArray(o.reasons) || o.reasons.length < minReasons || o.reasons.length > maxReasons) {
    return null;
  }
  const reasons = o.reasons.map((r) => (typeof r === 'string' ? r.trim() : ''));
  const reasonMaxLen = advanced ? 180 : 160;
  if (reasons.some((r) => r.length < 8 || r.length > reasonMaxLen)) {
    return null;
  }

  const summary = o.summary.trim();
  const preferenceMatches = parsePreferenceMatches(o.preferenceMatches);
  if (preferenceMatches === null) {
    return null;
  }

  const nutritionSnapshot = parseBoundedStringList(
    o.nutritionSnapshot,
    advanced ? 14 : 6,
    100,
  );
  const ingredientFlags = parseBoundedStringList(o.ingredientFlags, advanced ? 18 : 8, 120);

  const minPara = advanced ? 32 : 20;
  const ingredientBreakdown = parseIngredientBreakdownParagraphs(o.ingredientBreakdown ?? o.ingredientNotes, minPara);
  if (!ingredientBreakdown) {
    return null;
  }

  const parentTakeawayRaw = o.parentTakeaway;
  const parentTakeaway =
    typeof parentTakeawayRaw === 'string' && parentTakeawayRaw.trim().length >= 8 && parentTakeawayRaw.trim().length <= 220
      ? parentTakeawayRaw.trim()
      : undefined;
  if (!parentTakeaway) {
    return null;
  }

  const allergyNotes = parseAllergyNotesList(o.allergyNotes);

  return {
    baseVerdict: ruleBasedBaseVerdict,
    verdict,
    summary,
    reasons,
    preferenceMatches,
    nutritionSnapshot,
    ingredientFlags,
    ingredientBreakdown,
    allergyNotes,
    parentTakeaway,
  };
}
