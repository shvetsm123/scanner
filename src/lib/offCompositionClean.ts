/**
 * Step 2: clean Open Food Facts composition only (no product marketing, no web).
 * Used before the second AI pass for the Ingredients tab.
 */

export type CleanedOffComposition = {
  /** Lines from OFF before aggressive scrub (ingredients[] or ingredients_text split). */
  rawLineCount: number;
  /** After scrub + product filter + dedupe, before aggressive metadata strip. */
  cleanedCountBeforeAggressiveFilter: number;
  /** After aggressive strip, before appending additive tags. */
  cleanedCountAfterAggressiveFilter: number;
  /** Ordered real ingredient tokens (includes additive codes appended from tags when not redundant). */
  ingredientLines: string[];
  additivesTags: string[];
  allergens: string[];
  traces: string[];
};

const CLEAN_LOG = '[OFFCleaner]';

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeHtmlEntities(s: string): string {
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

const COUNTRY_OR_CITY_LINE =
  /^(bulgaria|romania|germany|france|italy|spain|poland|greece|turkey|ukraine|netherlands|belgium|austria|hungary|serbia|croatia|slovakia|czech|portugal|ireland|denmark|sweden|norway|finland|china|india|usa|u\.s\.a|united states|united kingdom|uk|eu|e\.u\.|european union|българия|румъния|германия|франция|испания|полша|гърция|турция|украйна|холандия|нидерландия|белгия|австрия|унгария|сърбия|хърватия|словакия|чехия|португалия|ирландия|денмарк|швеция|норвегия|финландия|китай|индия|софия|sofia|пловдив|варна|бургас|русе|плевен|стара\s*загора|шумен|добрич|сливен|кърджали|благоевград|съставки)$/i;

const JUNK_SUBSTR =
  /\b(kcal|kj\b|ккал|кдж|килоджаул|енергийна\s+стойност|хранителна\s+стойност|хранителни\s+стойности|nutrition facts|nutritional information|nutrition information|nutritional value|energy value|per\s*100|на\s*100|за\s*100|на\s*100\s*г|на\s*100\s*мл|typical values|average values|storage|store in|refrigerat|хладилник|съхранение|съхранявай|съхранявайте|вносител|дистрибутор|производител|произведено|произход|произведен|origin|importer|imported by|distributed by|manufactured in|made in|packed in|lot\.?\s*no|batch no|best before|use by|mindesthaltbarkeit|mhd\b|употреба|годен\s*до|изтича|партида|серия|batch\s*code|serial\s*no|www\.|http|@\.com|тел\.|gsm|e-?mail|адрес|address|обем|тегло|нето\s*тегло|net\s*weight|drained\s*weight)\b/i;

/** Address / contact / lot noise sometimes split into pseudo-ingredient tokens. */
const ADDRESS_OR_CONTACT =
  /^(ул\.|ул\b|бул\.|ж\.к\.|жк\b|п\.к\.|pk\s*\d|address|адрес|тел\.|tel\.|gsm|e-?mail|@)/i;
const PHONE_LIKE = /\b\d{3}[-\s./]?\d{3}[-\s./]?\d{2,4}\b/;
const LOT_OR_EXP_LINE = /^(lot|batch|партида|серия|№|n\s*°|exp\.|best\s+before|bbd\b|изтича|годен)/i;

/** Company / legal-form noise often pasted after ingredients on the same page. */
const COMPANY_NOISE = /\b(оод|ood|еад|ead|а\.д\.|gmbh|ltd\.?|plc\.?|inc\.?|s\.?\s*a\.?\s*s\.?)\b/i;

function isJunkLine(lower: string): boolean {
  if (lower.length < 2) {
    return true;
  }
  if (/^#{1,6}\s/.test(lower) || /^\*\s+/.test(lower)) {
    return true;
  }
  if (/^(sku|артикул|штрихкод|barcode\s*#)\b/i.test(lower)) {
    return true;
  }
  if (/^(ingredients?|zutaten|ingredientes|ingrédients|ingredienti|składniki|bestanddelen|съставки)\b/i.test(lower)) {
    return lower.length < 48;
  }
  const digitGroups = lower.match(/\d+[.,]?\d*/g);
  if (digitGroups && digitGroups.length >= 3 && /(г|g|ml|mg|kcal|kj|ккал|кдж)\b/i.test(lower) && !/[a-z\u0400-\u04ff]{4,}/i.test(lower.replace(/\d+[.,]?\d*/g, ''))) {
    return true;
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
  if (/^(best before|use by|lot\.?|batch|packaged in|country of|партида|серия|изтича|годен|mindesthaltbarkeit)\b/i.test(lower)) {
    return true;
  }
  if (LOT_OR_EXP_LINE.test(lower)) {
    return true;
  }
  if (ADDRESS_OR_CONTACT.test(lower)) {
    return true;
  }
  if (PHONE_LIKE.test(lower) && lower.replace(/\d/g, '').trim().length < 12) {
    return true;
  }
  if (JUNK_SUBSTR.test(lower)) {
    return true;
  }
  if (COUNTRY_OR_CITY_LINE.test(lower.trim())) {
    return true;
  }
  if (COMPANY_NOISE.test(lower) && lower.length > 45) {
    return true;
  }
  return false;
}

/** Drop weight-only tokens, origin noise, and other non-ingredient fragments. */
function scrubIngredientToken(s: string): string | null {
  let t = stripNoiseTokens(decodeHtmlEntities(s));
  t = t
    .replace(/^(ingredients?|zutaten|ingredientes|ingrédients|ingredienti|składniki|bestanddelen|съставки)\s*[:\-–]?\s*/i, '')
    .trim();
  t = t.replace(/^[`´‚′‹›]+/g, '').replace(/[`´′]+$/g, '').trim();
  const l = t.toLowerCase();
  if (t.length < 2 || isJunkLine(l)) {
    return null;
  }
  if (/^съставки$/i.test(t)) {
    return null;
  }
  if (/^\d+([.,]\d+)?\s*(g|kg|mg|ml|l|cl)\b$/i.test(t)) {
    return null;
  }
  if (/^\d+\s*([,.]\s*\d+)?\s*%$/i.test(t)) {
    return null;
  }
  if (/^[±+\-]?\d+([.,]\d+)?\s*%?$/i.test(t)) {
    return null;
  }
  if (/^[‚'`'′][\d.,±]+$/i.test(t)) {
    return null;
  }
  if (/^[\d\s.,±%\/\-+]+$/i.test(t) && !/[a-z\u0400-\u04FF]/i.test(t)) {
    return null;
  }
  if (/^(origin|country of|country|произход|страна|държава|произведено|net weight|нето|drained)\b/i.test(t)) {
    return null;
  }
  if (/^\(?\s*[A-Z]{2}\s*\)?$/i.test(t)) {
    return null;
  }
  if (t.length < 3 && !/^e\d+/i.test(t)) {
    return null;
  }
  if (JUNK_SUBSTR.test(l)) {
    return null;
  }
  const letters = t.replace(/[^a-z\u0400-\u04FF]/gi, '').length;
  if (letters < 2 && !/^e\d+/i.test(t)) {
    return null;
  }
  const digitCount = (t.match(/\d/g) ?? []).length;
  if (t.length >= 10 && digitCount / t.length > 0.38) {
    return null;
  }
  if (t.length > 48 && COMPANY_NOISE.test(l)) {
    return null;
  }
  return t;
}

/** Second pass: drop tokens that still look like label metadata (not food substances). */
function looksLikeNonIngredientToken(t: string): boolean {
  const l = t.toLowerCase().trim();
  if (!l) {
    return true;
  }
  if (isJunkLine(l) || JUNK_SUBSTR.test(l)) {
    return true;
  }
  if (ADDRESS_OR_CONTACT.test(l) || LOT_OR_EXP_LINE.test(l)) {
    return true;
  }
  if (PHONE_LIKE.test(t) && l.replace(/\d/g, '').trim().length < 14) {
    return true;
  }
  if (/^#?\d{10,}$/.test(l)) {
    return true;
  }
  if (t.length > 110) {
    return true;
  }
  if (t.length > 52 && COMPANY_NOISE.test(l)) {
    return true;
  }
  if (/^\(?(eu|eea|bg|ro|de|fr|uk|us|pl|nl|it|es)\)?$/i.test(t)) {
    return true;
  }
  if (COUNTRY_OR_CITY_LINE.test(l)) {
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

type OffIngredientEntry = { text?: string };

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
    const low = cleaned.toLowerCase();
    if (cleaned.length < 2 || isJunkLine(low) || JUNK_SUBSTR.test(low)) {
      continue;
    }
    out.push(cleaned);
  }
  return out;
}

/** Keep only lines before obvious nutrition / importer / metadata blocks. */
function takeBlobUpToJunkLines(raw: string): string {
  const lines = raw.split(/\n/).map((l) => decodeHtmlEntities(l).trim()).filter((l) => l.length > 0);
  const out: string[] = [];
  for (const line of lines) {
    const low = line.toLowerCase();
    if (isJunkLine(low)) {
      break;
    }
    if (JUNK_SUBSTR.test(low) && line.length > 32) {
      break;
    }
    if (COMPANY_NOISE.test(low) && line.length > 36) {
      break;
    }
    out.push(line);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/** Cut a single-line blob at the first strong nutrition / distributor marker. */
function clipInlineJunk(s: string): string {
  const n = s.replace(/\s+/g, ' ').trim();
  if (!n) {
    return '';
  }
  let cut = n.length;
  const patterns = [
    /\bхранителн/i,
    /\bенергийн/i,
    /\bnutrition\s+facts\b/i,
    /\bnutrition\s+information\b/i,
    /\btypical\s+values\b/i,
    /\benergy\s+value\b/i,
    /\bper\s+100\b/i,
    /\bна\s+100\b/i,
    /\bккал\b/i,
    /\bkcal\b/i,
    /\bвносител/i,
    /\bдистрибутор/i,
    /\bпроизводител/i,
  ];
  for (const re of patterns) {
    const i = n.search(re);
    if (i >= 16 && i < cut) {
      cut = i;
    }
  }
  return n.slice(0, cut).replace(/[,;:\-\s]+$/g, '').trim();
}

function prepareIngredientsText(ingredientsText: string): string {
  return clipInlineJunk(takeBlobUpToJunkLines(ingredientsText));
}

/**
 * OFF often explodes `ingredients[]` into dozens of fragments (percent chunks, OCR noise).
 * Prefer human `ingredients_text` when it exists and the array is suspiciously long.
 */
function chooseRawIngredientLines(
  rawJson: Record<string, unknown> | undefined,
  ingredientsText: string | undefined,
): { lines: string[]; source: 'ingredients_text' | 'ingredients_array' } {
  const fromArr = readIngredientsArray(rawJson);
  const text = (ingredientsText ?? '').trim();
  const prepared = text.length >= 8 ? prepareIngredientsText(text) : '';
  const fromText = prepared.length >= 4 ? splitIngredientsText(prepared) : [];
  const preferText =
    fromText.length > 0 &&
    (fromArr.length === 0 ||
      fromArr.length > 22 ||
      (text.length >= 20 && fromText.length >= 5 && fromText.length * 2 <= fromArr.length));
  const lines = preferText ? fromText : fromArr;
  const source: 'ingredients_text' | 'ingredients_array' = preferText ? 'ingredients_text' : 'ingredients_array';
  console.warn(CLEAN_LOG, 'raw candidates source', source, 'raw line count', lines.length);
  return { lines, source };
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
    if ((ch === ',' || ch === ';' || ch === '•' || ch === '·' || ch === '|') && depth === 0) {
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

function tagToLabel(tag: string): string {
  const m = tag.match(/^(en:)?e(\d+[a-z]?)$/i);
  if (m) {
    return `E${m[2]!.toUpperCase()}`;
  }
  return tag.replace(/^en:/, '').replace(/-/g, ' ');
}

function readAllergensTraces(
  rawJson: Record<string, unknown> | undefined,
  allergensText?: string,
): { allergens: string[]; traces: string[] } {
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
  pushSplit(allergensText, allergens);
  if (rawJson && typeof rawJson === 'object') {
    const a = rawJson.allergens;
    const tr = rawJson.traces;
    if (typeof a === 'string') {
      pushSplit(a, allergens);
    }
    if (typeof tr === 'string') {
      pushSplit(tr, traces);
    }
    const at = rawJson.allergens_tags;
    if (Array.isArray(at)) {
      for (const x of at) {
        if (typeof x === 'string' && x.startsWith('en:')) {
          allergens.push(x.slice(3).replace(/-/g, ' '));
        }
      }
    }
    const tt = rawJson.traces_tags;
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

/**
 * Builds a single ordered ingredient line list from OFF `ingredients` / `ingredients_text`,
 * then appends additive codes from `additives_tags` when not already present.
 * Allergens / traces are returned separately for classification context (not mixed as fake ingredients).
 */
export function extractCleanOffComposition(
  rawJson: Record<string, unknown> | undefined,
  ingredientsText: string | undefined,
  productName?: string,
): CleanedOffComposition {
  const { lines: rawChosen, source: rawSource } = chooseRawIngredientLines(rawJson, ingredientsText);
  let names = rawChosen;
  const rawLineCount = names.length;
  const pn = (productName ?? '').trim().toLowerCase();
  names = names
    .map((n) => scrubIngredientToken(n))
    .filter((n): n is string => n != null)
    .filter((n) => {
      const l = n.toLowerCase();
      if (pn.length >= 4 && (l === pn || l.includes(pn) || pn.includes(l))) {
        return false;
      }
      return true;
    });
  names = dedupeOrdered(names);
  const cleanedCountBeforeAggressive = names.length;
  names = names.filter((n) => !looksLikeNonIngredientToken(n));
  const cleanedCountAfterAggressive = names.length;
  const additivesTags = readAdditivesTags(rawJson);
  const { allergens, traces } = readAllergensTraces(rawJson, ingredientsText);
  const existingLower = new Set(names.map((n) => n.toLowerCase()));
  for (const tag of additivesTags) {
    const label = tagToLabel(tag);
    if (!existingLower.has(label.toLowerCase())) {
      names.push(label);
      existingLower.add(label.toLowerCase());
    }
  }
  console.warn(CLEAN_LOG, 'raw line count', rawLineCount, 'rawSource', rawSource);
  console.warn(
    CLEAN_LOG,
    'cleaned count before aggressive post-filter',
    cleanedCountBeforeAggressive,
    'cleaned count after aggressive post-filter',
    cleanedCountAfterAggressive,
    'final line count (incl. additives tags)',
    names.length,
  );
  console.warn(CLEAN_LOG, 'cleaned ingredient candidates', names);
  return {
    rawLineCount,
    cleanedCountBeforeAggressiveFilter: cleanedCountBeforeAggressive,
    cleanedCountAfterAggressiveFilter: cleanedCountAfterAggressive,
    ingredientLines: names,
    additivesTags,
    allergens,
    traces,
  };
}
