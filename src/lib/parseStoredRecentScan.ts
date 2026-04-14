import { clampFinalVerdictToBase } from './preferenceMatchers';
import type { RecentScan, Verdict } from '../types/scan';

const VERDICTS: readonly Verdict[] = ['good', 'sometimes', 'avoid', 'unknown'];

function isVerdict(v: unknown): v is Verdict {
  return typeof v === 'string' && (VERDICTS as readonly string[]).includes(v);
}

function asTrimmedStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((s) => s.trim())
    .slice(0, max);
}

function ingredientBreakdownFromUnknown(o: Record<string, unknown>): string[] {
  const fromArr = asTrimmedStringArray(o.ingredientBreakdown, 8);
  if (fromArr.length >= 2) {
    return fromArr;
  }
  if (typeof o.ingredientBreakdown === 'string' && o.ingredientBreakdown.trim()) {
    const parts = o.ingredientBreakdown
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length >= 8);
    if (parts.length >= 2) {
      return parts;
    }
    if (parts.length === 1) {
      return [parts[0], 'This older saved scan may not include the full ingredient breakdown.'];
    }
  }
  const notes = asTrimmedStringArray(o.ingredientNotes, 12);
  if (notes.length >= 2) {
    return notes;
  }
  if (notes.length === 1) {
    return [notes[0], 'This older saved scan stored shorter ingredient notes than current scans.'];
  }
  return [
    'Ingredient detail was not stored for this older scan.',
    'Scan the product again to refresh the full breakdown.',
  ];
}

function allergyNotesFromUnknown(o: Record<string, unknown>): string[] {
  const fromArr = asTrimmedStringArray(o.allergyNotes, 8);
  if (fromArr.length > 0) {
    return fromArr;
  }
  if (typeof o.allergyNotes === 'string' && o.allergyNotes.trim()) {
    return [o.allergyNotes.trim()];
  }
  return [];
}

/** Accepts persisted JSON (v3 or v4) and returns a RecentScan safe to render. */
export function parseStoredRecentScan(raw: unknown): RecentScan | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id : null;
  const barcode = typeof o.barcode === 'string' ? o.barcode : null;
  const productName = typeof o.productName === 'string' ? o.productName : null;
  const scannedAt = typeof o.scannedAt === 'string' ? o.scannedAt : null;
  if (!id || !barcode || !productName || !scannedAt) {
    return null;
  }
  if (!isVerdict(o.verdict)) {
    return null;
  }
  const baseVerdictStored = isVerdict(o.baseVerdict) ? o.baseVerdict : o.verdict;
  const verdictStored = isVerdict(o.verdict) ? o.verdict : baseVerdictStored;
  const verdictClamped = clampFinalVerdictToBase(baseVerdictStored, verdictStored);
  const summary = typeof o.summary === 'string' && o.summary.trim() ? o.summary.trim() : null;
  if (!summary) {
    return null;
  }
  const reasonsRaw = o.reasons;
  if (!Array.isArray(reasonsRaw) || reasonsRaw.length < 3 || reasonsRaw.length > 8) {
    return null;
  }
  const reasons = reasonsRaw.map((r) => (typeof r === 'string' ? r.trim() : ''));
  if (reasons.some((r) => !r)) {
    return null;
  }

  const whyText =
    typeof o.whyText === 'string' && o.whyText.trim().length > 0
      ? o.whyText.trim()
      : 'This is an older saved scan without a stored explanation for the verdict.';
  const parentTakeaway =
    typeof o.parentTakeaway === 'string' && o.parentTakeaway.trim().length > 0
      ? o.parentTakeaway.trim()
      : typeof o.parentNote === 'string' && o.parentNote.trim().length > 0
        ? o.parentNote.trim()
        : 'Scan again for a refreshed parent takeaway.';

  const categories = Array.isArray(o.categories) ? asTrimmedStringArray(o.categories, 40) : [];
  const preferenceMatchesRaw = asTrimmedStringArray(o.preferenceMatches, 12);

  const out: RecentScan = {
    id,
    barcode,
    productName,
    brand: typeof o.brand === 'string' && o.brand.trim() ? o.brand.trim() : undefined,
    imageUrl: typeof o.imageUrl === 'string' && o.imageUrl.trim() ? o.imageUrl.trim() : undefined,
    ingredientsText: typeof o.ingredientsText === 'string' && o.ingredientsText.trim() ? o.ingredientsText.trim() : undefined,
    categories: categories.length > 0 ? categories : undefined,
    allergensText: typeof o.allergensText === 'string' && o.allergensText.trim() ? o.allergensText.trim() : undefined,
    baseVerdict: baseVerdictStored,
    verdict: verdictClamped,
    summary,
    reasons,
    whyText,
    ingredientBreakdown: ingredientBreakdownFromUnknown(o),
    allergyNotes: allergyNotesFromUnknown(o),
    parentTakeaway,
    scannedAt,
  };

  const nutritionSnap = asTrimmedStringArray(o.nutritionSnapshot, 12);
  if (nutritionSnap.length > 0) {
    out.nutritionSnapshot = nutritionSnap;
  }
  const flagsStored = asTrimmedStringArray(o.ingredientFlags, 16);
  if (flagsStored.length > 0) {
    out.ingredientFlags = flagsStored;
  }

  if (preferenceMatchesRaw.length > 0) {
    out.preferenceMatches = preferenceMatchesRaw;
  }

  const nm = o.nutriments;
  if (nm && typeof nm === 'object' && !Array.isArray(nm)) {
    const rec = nm as Record<string, unknown>;
    const numMap: Record<string, number> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        numMap[k] = v;
      }
    }
    if (Object.keys(numMap).length > 0) {
      out.nutriments = numMap;
    }
  }

  const rj = o.rawJson;
  if (rj && typeof rj === 'object' && !Array.isArray(rj)) {
    out.rawJson = rj as Record<string, unknown>;
  }

  const ack = o.analysisContextKey;
  if (typeof ack === 'string' && ack.trim()) {
    out.analysisContextKey = ack.trim();
  }

  return out;
}
