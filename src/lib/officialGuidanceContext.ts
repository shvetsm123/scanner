import type { RecentScan } from '../types/scan';
import type { ResultStyle } from '../types/preferences';
import type { AppLanguage } from './deviceLanguage';
import { t } from './i18n';
import { listingSuggestsAddedOrClearSweetening } from './productRules';
import { parseChildAgeFromAnalysisContextKey } from './scanAnalysisContext';

const NHS_FREE_SUGAR_G_DAY: ReadonlyArray<{ minAge: number; maxAge: number; grams: number }> = [
  { minAge: 2, maxAge: 3, grams: 14 },
  { minAge: 4, maxAge: 6, grams: 19 },
  { minAge: 7, maxAge: 10, grams: 24 },
];

function nhsFreeSugarGuidanceGrams(childAge: number): number | null {
  for (const row of NHS_FREE_SUGAR_G_DAY) {
    if (childAge >= row.minAge && childAge <= row.maxAge) {
      return row.grams;
    }
  }
  return null;
}

function ageBandLabel(childAge: number): string | null {
  if (childAge >= 2 && childAge <= 3) {
    return '2–3';
  }
  if (childAge >= 4 && childAge <= 6) {
    return '4–6';
  }
  if (childAge >= 7 && childAge <= 10) {
    return '7–10';
  }
  return null;
}

function saltGPer100g(nm?: Record<string, number>): number | null {
  if (!nm) {
    return null;
  }
  const salt = nm['salt_100g'];
  if (typeof salt === 'number' && Number.isFinite(salt)) {
    return salt;
  }
  const sodium = nm['sodium_100g'];
  if (typeof sodium === 'number' && Number.isFinite(sodium)) {
    return sodium * 2.5;
  }
  return null;
}

export type OfficialGuidanceProductFields = Pick<
  RecentScan,
  'productName' | 'brand' | 'ingredientsText' | 'categories'
>;

/**
 * Short, parent-facing lines tied to listing data only (no invented numbers).
 */
export function buildOfficialGuidanceContextLines(
  childAge: number | null,
  nutriments: Record<string, number> | undefined,
  product: OfficialGuidanceProductFields,
  lang: AppLanguage,
): string[] {
  const sugars =
    nutriments && typeof nutriments['sugars_100g'] === 'number' && Number.isFinite(nutriments['sugars_100g'])
      ? nutriments['sugars_100g']
      : null;
  const kcal =
    nutriments && typeof nutriments['energy-kcal_100g'] === 'number' && Number.isFinite(nutriments['energy-kcal_100g'])
      ? nutriments['energy-kcal_100g']
      : null;
  const listingSweet = listingSuggestsAddedOrClearSweetening(product);
  const lines: string[] = [];

  if (childAge != null && childAge < 2) {
    const numericSweetEvidence = sugars != null && sugars >= 8;
    if (listingSweet || numericSweetEvidence) {
      lines.push(t('guidance.under2', lang));
    }
  }

  if (childAge != null && childAge >= 2 && childAge <= 10 && sugars != null && sugars > 0) {
    const cap = nhsFreeSugarGuidanceGrams(childAge);
    const label = ageBandLabel(childAge);
    if (cap != null && label != null) {
      const ratio = sugars / cap;
      if (ratio >= 0.85) {
        lines.push(t('guidance.nhs.close', lang, { label, cap: String(cap) }));
      } else if (ratio >= 0.45) {
        lines.push(t('guidance.nhs.noticeable', lang, { label }));
      } else if (ratio >= 0.22) {
        lines.push(t('guidance.nhs.meaningful', lang, { label }));
      }
    }
  }

  if (sugars != null && sugars > 0 && kcal != null && kcal > 30) {
    const sugarKcal = sugars * 4;
    const pct = (sugarKcal / kcal) * 100;
    if (pct >= 18) {
      lines.push(t('guidance.who.high', lang));
    } else if (pct >= 12) {
      lines.push(t('guidance.who.mid', lang));
    }
  }

  if (childAge != null && childAge <= 10) {
    const salt = saltGPer100g(nutriments);
    if (salt != null && salt >= 1.2) {
      lines.push(t('guidance.salt', lang));
    }
  }

  return lines.slice(0, 3);
}

export function buildOfficialGuidanceContextLinesFromScan(scan: RecentScan, lang: AppLanguage): string[] {
  const childAge = parseChildAgeFromAnalysisContextKey(scan.analysisContextKey);
  return buildOfficialGuidanceContextLines(childAge, scan.nutriments, scan, lang);
}

export function resolvedGuidanceContextLines(mode: ResultStyle, scan: RecentScan, lang: AppLanguage): string[] {
  if (mode !== 'advanced') {
    return [];
  }
  const fromScan = scan.guidanceContext?.map((s) => s.trim()).filter((s) => s.length > 0) ?? [];
  if (fromScan.length > 0) {
    return fromScan.slice(0, 3);
  }
  return buildOfficialGuidanceContextLinesFromScan(scan, lang);
}
