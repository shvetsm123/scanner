import type { AvoidPreference } from '../types/preferences';
import type { RecentScan } from '../types/scan';

export function buildScanAnalysisContextKey(
  barcode: string,
  childAge: number | null,
  avoidPreferences: AvoidPreference[],
): string {
  const b = barcode.trim();
  const age = childAge == null || !Number.isFinite(childAge) ? 'na' : String(Math.round(childAge));
  const sorted = [...avoidPreferences].slice().sort().join(',');
  return `${b}::${age}::${sorted}`;
}

/** Reads the rounded child age embedded in `analysisContextKey`, if present. */
export function parseChildAgeFromAnalysisContextKey(key: string | undefined): number | null {
  if (!key || typeof key !== 'string') {
    return null;
  }
  const seg = key.split('::')[1];
  if (!seg || seg === 'na') {
    return null;
  }
  const n = Number(seg);
  return Number.isFinite(n) ? n : null;
}

/** Newest-first list: returns first saved scan that matches barcode + analysis context (non-unknown). */
export function findRecentScanForReuse(
  scans: RecentScan[],
  barcode: string,
  contextKey: string,
): RecentScan | null {
  const b = barcode.trim();
  for (const s of scans) {
    if (s.barcode.trim() !== b) {
      continue;
    }
    if (s.verdict === 'unknown') {
      continue;
    }
    if (!s.analysisContextKey || s.analysisContextKey !== contextKey) {
      continue;
    }
    return s;
  }
  return null;
}
