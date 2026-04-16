import type { AppLanguage } from './deviceLanguage';
import type { AvoidPreference } from '../types/preferences';
import type { RecentScan } from '../types/scan';
import { t } from './i18n';

export type IngredientTier = 'good' | 'neutral' | 'red';

export type IngredientRow = {
  key: string;
  name: string;
  tier: IngredientTier;
  note: string;
};

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeHtmlEntities(s: string): string {
  let out = s.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
    const code = Number.parseInt(hex, 16);
    return Number.isFinite(code) ? String.fromCodePoint(code) : _;
  });
  out = out.replace(/&#(\d+);/g, (_, dec) => {
    const code = Number.parseInt(dec, 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : _;
  });
  out = out.replace(/&([a-z]+);/gi, (m, name) => HTML_ENTITY_MAP[name.toLowerCase()] ?? m);
  return out;
}

function stripNoiseTokens(s: string): string {
  return s
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\s*[\d.]+\s*%?\s*[-–—:]*\s*/i, '')
    .replace(/\s*\(\s*\d+\s*%?\s*\)/g, '')
    .trim();
}

function isJunkLine(lower: string): boolean {
  if (lower.length < 2) {
    return true;
  }
  if (/^(ingredients?|zutaten|ingredientes|ingrédients|ingredienti|składniki|bestanddelen)\b/i.test(lower)) {
    return lower.length < 28;
  }
  if (
    /\b(manufactured|produced|packed|imported|distributed|www\.|http|@|\.com|\.org|ltd\.|inc\.|gmbh|s\.a\.|sas|plc)\b/i.test(
      lower,
    )
  ) {
    return true;
  }
  if (/^\d{4}\b|^[A-Z]{2}-\d{2}-\d{3}\b/.test(lower)) {
    return true;
  }
  return false;
}

function dedupeOrdered(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const k = raw.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!k || seen.has(k)) {
      continue;
    }
    seen.add(k);
    out.push(raw);
  }
  return out;
}

type OffIngredientEntry = { text?: string; id?: string; percent?: number };

function readIngredientsArray(rawJson: Record<string, unknown> | undefined): string[] {
  if (!rawJson || typeof rawJson !== 'object') {
    return [];
  }
  const arr = rawJson.ingredients;
  if (!Array.isArray(arr)) {
    return [];
  }
  const out: string[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const e = item as OffIngredientEntry;
    const text = typeof e.text === 'string' ? e.text.trim() : '';
    if (!text) {
      continue;
    }
    const cleaned = stripNoiseTokens(decodeHtmlEntities(text));
    if (cleaned.length >= 2) {
      out.push(cleaned);
    }
  }
  return out;
}

function splitIngredientsText(text: string): string[] {
  const decoded = decodeHtmlEntities(text).replace(/\s+/g, ' ').trim();
  if (!decoded) {
    return [];
  }
  const parts: string[] = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < decoded.length; i += 1) {
    const ch = decoded[i]!;
    if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
    }
    if (ch === ',' && depth === 0) {
      const t = stripNoiseTokens(buf);
      if (t.length >= 2) {
        parts.push(t);
      }
      buf = '';
    } else {
      buf += ch;
    }
  }
  const last = stripNoiseTokens(buf);
  if (last.length >= 2) {
    parts.push(last);
  }
  return parts;
}

function readAdditivesTags(rawJson: Record<string, unknown> | undefined): string[] {
  if (!rawJson || typeof rawJson !== 'object') {
    return [];
  }
  const tags = rawJson.additives_tags;
  if (!Array.isArray(tags)) {
    return [];
  }
  return tags
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim().toLowerCase());
}

function readAllergensTraces(scan: RecentScan): { allergens: string[]; traces: string[] } {
  const raw = scan.rawJson;
  const allergens: string[] = [];
  const traces: string[] = [];
  const pushSplit = (s: string | undefined, into: string[]) => {
    if (!s || !s.trim()) {
      return;
    }
    for (const part of s.split(/[,;]/)) {
      const t = part.trim().toLowerCase();
      if (t.length >= 2) {
        into.push(t);
      }
    }
  };
  pushSplit(scan.allergensText, allergens);
  if (raw && typeof raw === 'object') {
    const a = raw.allergens;
    const tr = raw.traces;
    if (typeof a === 'string') {
      pushSplit(a, allergens);
    }
    if (typeof tr === 'string') {
      pushSplit(tr, traces);
    }
    const at = raw.allergens_tags;
    if (Array.isArray(at)) {
      for (const x of at) {
        if (typeof x === 'string' && x.startsWith('en:')) {
          allergens.push(x.slice(3).replace(/-/g, ' '));
        }
      }
    }
    const tt = raw.traces_tags;
    if (Array.isArray(tt)) {
      for (const x of tt) {
        if (typeof x === 'string' && x.startsWith('en:')) {
          traces.push(x.slice(3).replace(/-/g, ' '));
        }
      }
    }
  }
  return { allergens: dedupeOrdered(allergens), traces: dedupeOrdered(traces) };
}

function tagToDisplayName(tag: string): string {
  const m = tag.match(/^(en:)?e(\d+[a-z]?)$/i);
  if (m) {
    return `E${m[2]!.toUpperCase()}`;
  }
  return tag.replace(/^en:/, '').replace(/-/g, ' ');
}

const SUGAR_RE =
  /\b(sugar|sucrose|glucose(\s*-?\s*fructose)?\s*syrup|fructose|dextrose|maltodextrin|invert\s*sugar|molasses|honey|agave|maple\s*syrup|rice\s*syrup|corn\s*syrup|hfcs|isoglucose)\b/i;
const INTENSE_SWEETENER_RE =
  /\b(aspartame|acesulfame|sucralose|saccharin|cyclamate|steviol|stevia|neotame|advantame|thaumatin)\b/i;
const HYDRO_RE = /\b(partially\s+)?hydrogenated\b/i;
const PRESERV_RE =
  /\b(benzoate|sorbate|nitrite|nitrate|sulphite|sulfite|propionate|bha|bht|tbhq|disodium\s+inosinate|disodium\s+guanylate|sodium\s+acetate)\b/i;
const COLOR_RE = /\b(artificial\s+colou?r|colou?r\s*\(|e(1[0-9]{2}|2[0-4][0-9])\b)/i;
const MSG_RE = /\b(msg|monosodium\s+glutamate|e621)\b/i;
const CAFFEINE_RE = /\b(caffeine|guarana|taurine|coffee|espresso|black\s+tea|green\s+tea\s*extract)\b/i;
const PALM_RE = /\bpalm(\s+oil|\s+fat|\s+kernel)\b/i;
const ART_FLAVOR_RE = /\b(artificial\s+flavou?r|artificial\s+flavor)\b/i;

function avoidSet(prefs: AvoidPreference[]): Set<AvoidPreference> {
  return new Set(prefs);
}

function matchesAvoidToken(lower: string, id: AvoidPreference): boolean {
  const tests: Record<AvoidPreference, RegExp> = {
    added_sugar: SUGAR_RE,
    sweeteners: INTENSE_SWEETENER_RE,
    artificial_colors: COLOR_RE,
    caffeine: CAFFEINE_RE,
    ultra_processed: /\b(hydroly[sz]ed|textured|isolate|concentrate\s+protein)\b/i,
    milk: /\b(milk|lactose|whey|casein|butter(milk)?|cream|ghee|fromage)\b/i,
    soy: /\b(soy|soja|lecithin)\b/i,
    gluten: /\b(wheat|barley|rye|malt\s+extract|gluten)\b/i,
    nuts: /\b(almond|hazelnut|cashew|pecan|walnut|pistachio|macadamia|brazil\s+nut|tree\s+nuts?)\b/i,
    eggs: /\b(egg|albumin|lysozyme\s*\(egg\)|ovalbumin)\b/i,
    high_salt: /\b(salt|sodium\s+chloride|sea\s+salt|cooking\s+salt)\b/i,
    artificial_flavors: ART_FLAVOR_RE,
    preservatives: PRESERV_RE,
    palm_oil: PALM_RE,
  };
  return tests[id]?.test(lower) ?? false;
}

function classify(
  name: string,
  lang: AppLanguage,
  prefs: AvoidPreference[],
  childAge: number | null,
): { tier: IngredientTier; note: string } {
  const lower = name.toLowerCase();
  const av = avoidSet(prefs);

  for (const id of prefs) {
    if (matchesAvoidToken(lower, id)) {
      return { tier: 'red', note: t('ing.note.red.avoidMatch', lang, { topic: t(`avoid.${id}`, lang) }) };
    }
  }

  if (HYDRO_RE.test(lower)) {
    return { tier: 'red', note: t('ing.note.red.hydrogenated', lang) };
  }
  if (MSG_RE.test(lower)) {
    return { tier: 'red', note: t('ing.note.red.msg', lang) };
  }
  if (INTENSE_SWEETENER_RE.test(lower)) {
    return { tier: 'red', note: t('ing.note.red.intenseSweetener', lang) };
  }
  if (SUGAR_RE.test(lower)) {
    if (typeof childAge === 'number' && childAge < 2) {
      return { tier: 'red', note: t('ing.note.red.sugarUnder2', lang) };
    }
    return { tier: 'red', note: t('ing.note.red.addedSugar', lang) };
  }
  if (PRESERV_RE.test(lower)) {
    return { tier: 'red', note: t('ing.note.red.preservative', lang) };
  }
  if (COLOR_RE.test(lower)) {
    return { tier: 'red', note: t('ing.note.red.color', lang) };
  }
  if (CAFFEINE_RE.test(lower)) {
    return { tier: 'red', note: t('ing.note.red.caffeine', lang) };
  }
  if (PALM_RE.test(lower) && av.has('palm_oil')) {
    return { tier: 'red', note: t('ing.note.red.palmAvoid', lang) };
  }
  if (ART_FLAVOR_RE.test(lower) && av.has('artificial_flavors')) {
    return { tier: 'red', note: t('ing.note.red.artFlavorAvoid', lang) };
  }

  if (
    /\b(water|apple|banana|carrot|oats?|oat\b|barley|quinoa|lentil|chickpea|bean|pea\b|spinach|broccoli|blueberry|strawberry)\b/i.test(
      lower,
    ) &&
    !SUGAR_RE.test(lower)
  ) {
    return { tier: 'good', note: t('ing.note.good.whole', lang) };
  }

  if (/\b(milk|cream|butter|egg|wheat|soy|gluten|lactose|whey)\b/i.test(lower)) {
    return { tier: 'neutral', note: t('ing.note.neutral.commonAllergen', lang) };
  }

  if (/\b(sunflower|rapeseed|canola|olive)\s+oil\b/i.test(lower) && !HYDRO_RE.test(lower)) {
    return { tier: 'neutral', note: t('ing.note.neutral.oil', lang) };
  }

  return { tier: 'neutral', note: t('ing.note.neutral.base', lang) };
}

function classifyAdditiveTag(tag: string, lang: AppLanguage, prefs: AvoidPreference[]): { tier: IngredientTier; note: string } {
  const lower = tag.toLowerCase().replace(/^en:/, '');
  if (/^e1\d{2}$/i.test(lower) || /color/i.test(tag)) {
    if (prefs.includes('artificial_colors')) {
      return { tier: 'red', note: t('ing.note.red.color', lang) };
    }
    return { tier: 'red', note: t('ing.note.red.additiveColor', lang) };
  }
  if (/^e(9[5-9]\d|[0-8]\d{2,3})$/i.test(lower) || /sweetener/i.test(tag)) {
    if (prefs.includes('sweeteners')) {
      return { tier: 'red', note: t('ing.note.red.avoidMatch', lang, { topic: t('avoid.sweeteners', lang) }) };
    }
    return { tier: 'red', note: t('ing.note.red.intenseSweetener', lang) };
  }
  if (/nitrit|benzo|sorb|sulphit|sulfite|propion|gallate|inosinate|guanylate/.test(lower)) {
    return { tier: 'red', note: t('ing.note.red.preservative', lang) };
  }
  return { tier: 'neutral', note: t('ing.note.additive.generic', lang) };
}

/**
 * Parses Open Food Facts composition fields only (scan.rawJson + scan fields). No network.
 */
export function buildOffIngredientRows(
  scan: RecentScan,
  lang: AppLanguage,
  avoidPreferences: AvoidPreference[],
  childAge: number | null,
): { ok: true; rows: IngredientRow[] } | { ok: false } {
  const rawJson = scan.rawJson;
  const fromArr = readIngredientsArray(rawJson);
  const fromText =
    fromArr.length > 0 ? [] : scan.ingredientsText ? splitIngredientsText(scan.ingredientsText) : [];
  let names = fromArr.length > 0 ? fromArr : fromText;
  names = names.map((n) => stripNoiseTokens(n)).filter((n) => {
    const l = n.toLowerCase();
    return n.length >= 2 && !isJunkLine(l);
  });
  names = dedupeOrdered(names);
  const additivesTags = readAdditivesTags(rawJson);
  const { allergens, traces } = readAllergensTraces(scan);

  const rows: IngredientRow[] = names.map((name, i) => {
    const { tier, note } = classify(name, lang, avoidPreferences, childAge);
    return { key: `i-${i}-${name.slice(0, 24)}`, name, tier, note };
  });

  const existingLower = new Set(names.map((n) => n.toLowerCase()));
  let addIdx = 0;
  for (const tag of additivesTags) {
    const label = tagToDisplayName(tag);
    if (existingLower.has(label.toLowerCase())) {
      continue;
    }
    const { tier, note } = classifyAdditiveTag(tag, lang, avoidPreferences);
    rows.push({ key: `a-${addIdx}-${tag}`, name: label, tier, note });
    addIdx += 1;
  }

  for (const a of allergens) {
    const title = a.charAt(0).toUpperCase() + a.slice(1);
    const line = t('ing.allergen.contains', lang, { name: title });
    if (!existingLower.has(line.toLowerCase())) {
      rows.push({
        key: `al-${a}`,
        name: line,
        tier: 'neutral',
        note: t('ing.note.allergen.off', lang),
      });
    }
  }
  for (const tr of traces) {
    const title = tr.charAt(0).toUpperCase() + tr.slice(1);
    const line = t('ing.trace.mayContain', lang, { name: title });
    rows.push({
      key: `tr-${tr}`,
      name: line,
      tier: 'neutral',
      note: t('ing.note.trace.off', lang),
    });
  }

  if (rows.length === 0) {
    return { ok: false };
  }
  const seenName = new Set<string>();
  const deduped = rows.filter((r) => {
    const k = r.name.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seenName.has(k)) {
      return false;
    }
    seenName.add(k);
    return true;
  });
  return { ok: true, rows: deduped };
}
