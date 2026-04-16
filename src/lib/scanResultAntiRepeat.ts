import { humanizePreferenceMatchLine } from './i18n';

function normalizeLoose(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[•·]/g, '')
    .trim();
}

const SUGAR_RE =
  /\b(added sugar|added sugars|sugars?|sweetened|sweetening|sweetener|syrup|glucose|fructose|honey|cane sugar|invert sugar|high sugar|significant sugar|sugar content|free sugar)\b/i;

/** Sugar overlap with nutrition lines: metric-style only (avoids dropping “fruit in syrup” etc.). */
const SUGAR_METRIC_OVERLAP_RE = /\b(added sugars?|sugars?)\b/i;

function corpusCoversSugar(summary: string, preferenceLines: string[]): boolean {
  if (SUGAR_RE.test(normalizeLoose(summary))) {
    return true;
  }
  const pref = preferenceLines.map((p) => normalizeLoose(humanizePreferenceMatchLine(p))).join(' ');
  return SUGAR_RE.test(pref);
}

function avoidListImpliesAddedSugar(avoidIds: readonly string[]): boolean {
  return avoidIds.some((id) => id === 'added_sugar' || id === 'sweeteners');
}

function bulletIsSugarCentric(bullet: string): boolean {
  return SUGAR_RE.test(bullet);
}

function bulletRedundantWithSummary(summary: string, bullet: string): boolean {
  const sn = normalizeLoose(summary);
  const bn = normalizeLoose(bullet);
  if (bn.length < 14 || sn.length < 10) {
    return false;
  }
  if (sn.includes(bn)) {
    return true;
  }
  const words = bn.split(/\s+/).filter((w) => w.length > 4);
  if (words.length < 2) {
    return false;
  }
  const hits = words.filter((w) => sn.includes(w)).length;
  return hits / words.length >= 0.68;
}

function bulletRestatesNutritionTopic(bullet: string, nutritionLines: string[]): boolean {
  if (nutritionLines.length === 0) {
    return false;
  }
  const b = normalizeLoose(bullet);
  const nutBlob = normalizeLoose(nutritionLines.join(' '));
  if (/\b(salt|sodium)\b/.test(b) && /\b(salt|sodium)\b/.test(nutBlob)) {
    return true;
  }
  if (SUGAR_METRIC_OVERLAP_RE.test(b) && SUGAR_METRIC_OVERLAP_RE.test(nutBlob)) {
    return true;
  }
  if (/\b(energy|kcal|calories?|\bkj\b)\b/.test(b) && /\b(energy|kcal|calories?|\bkj\b)\b/.test(nutBlob)) {
    return true;
  }
  if (/\b(saturated|sat\.?\s*fat)\b/.test(b) && /\b(saturated|sat\.?\s*fat)\b/.test(nutBlob)) {
    return true;
  }
  if (/\b(protein)\b/.test(b) && /\bprotein\b/.test(nutBlob)) {
    return true;
  }
  if (/\b(fibre|fiber)\b/.test(b) && /\b(fibre|fiber)\b/.test(nutBlob)) {
    return true;
  }
  return false;
}

function nearDuplicateBullet(a: string, b: string): boolean {
  const x = normalizeLoose(a);
  const y = normalizeLoose(b);
  if (!x || !y || x === y) {
    return x === y && x.length > 0;
  }
  if (x.length >= 28 && y.length >= 28 && (x.includes(y.slice(0, 32)) || y.includes(x.slice(0, 32)))) {
    return true;
  }
  return false;
}

function shouldSkipBulletStrict(
  bullet: string,
  summary: string,
  sugarCoveredBySummaryOrAvoid: boolean,
  nutritionLines: string[],
): boolean {
  if (bulletRedundantWithSummary(summary, bullet)) {
    return true;
  }
  if (sugarCoveredBySummaryOrAvoid && bulletIsSugarCentric(bullet)) {
    return true;
  }
  if (bulletRestatesNutritionTopic(bullet, nutritionLines)) {
    return true;
  }
  return false;
}

/**
 * Picks reasons that add information beyond summary + avoid matches + nutrition snapshot,
 * with a second pass that relaxes rules if too few lines remain.
 */
export function selectDistinctDisplayReasons(params: {
  mode: 'quick' | 'advanced';
  summary: string;
  preferenceLines: string[];
  avoidPreferenceIds: readonly string[];
  reasons: string[];
  nutritionLines: string[];
}): string[] {
  const { mode, summary, preferenceLines, avoidPreferenceIds, reasons, nutritionLines } = params;
  const maxCap = mode === 'advanced' ? 6 : 5;
  const minCap = 4;
  const raw = reasons.map((r) => (typeof r === 'string' ? r.trim() : '')).filter(Boolean);

  const sugarCovered =
    corpusCoversSugar(summary, preferenceLines) || avoidListImpliesAddedSugar(avoidPreferenceIds);

  const tryBuild = (strictSugar: boolean, strictNutrition: boolean): string[] => {
    const out: string[] = [];
    for (const bullet of raw) {
      if (out.length >= maxCap) {
        break;
      }
      if (out.some((prev) => nearDuplicateBullet(prev, bullet))) {
        continue;
      }
      if (bulletRedundantWithSummary(summary, bullet)) {
        continue;
      }
      if (strictSugar && sugarCovered && bulletIsSugarCentric(bullet)) {
        continue;
      }
      if (strictNutrition && bulletRestatesNutritionTopic(bullet, nutritionLines)) {
        continue;
      }
      out.push(bullet);
    }
    return out;
  };

  let out = tryBuild(true, true);
  if (out.length < minCap) {
    out = tryBuild(false, true);
  }
  if (out.length < minCap) {
    out = tryBuild(false, false);
  }
  if (out.length < minCap) {
    out = [];
    for (const bullet of raw) {
      if (out.length >= maxCap) {
        break;
      }
      if (!out.some((prev) => nearDuplicateBullet(prev, bullet))) {
        out.push(bullet);
      }
    }
  }

  return out.slice(0, maxCap);
}
