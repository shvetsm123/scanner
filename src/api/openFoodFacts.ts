export type NormalizedProduct = {
  barcode: string;
  productName: string;
  brand?: string;
  imageUrl?: string;
  ingredientsText?: string;
  categories?: string[];
  allergensText?: string;
  nutriments?: Record<string, number>;
  rawJson?: Record<string, unknown>;
};

/** `rawJson.source` for AI web-research barcode rows (not Open Food Facts). */
export const BARCODE_AI_FALLBACK_SOURCE = 'barcode_ai_fallback' as const;

export function barcodesEquivalent(a: string, b: string): boolean {
  const da = a.replace(/\D/g, '');
  const db = b.replace(/\D/g, '');
  if (!da || !db) {
    return false;
  }
  const strip = (s: string) => s.replace(/^0+/, '') || '0';
  return da === db || strip(da) === strip(db);
}

function isValidHttpsProductImageUrl(s: string): boolean {
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') {
      return false;
    }
    const host = u.hostname.toLowerCase();
    if (!host.includes('.') || host.length < 4) {
      return false;
    }
    if (/^(localhost|127\.)/i.test(host)) {
      return false;
    }
    if (/example\.(com|net|org)$/.test(host)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function coerceStringArrayOrEmpty(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim());
}

type OffV0Response = {
  status?: number;
  product?: {
    product_name?: string;
    product_name_en?: string;
    generic_name?: string;
    brands?: string;
    brand_owner?: string;
    image_front_url?: string;
    image_front_small_url?: string;
    ingredients_text?: string;
    categories?: string;
    categories_tags?: string[];
    allergens?: string;
    allergens_from_ingredients?: string;
    nutriments?: Record<string, unknown>;
  };
};

const OFF_USER_AGENT = 'Scanner/1.0 (Expo; contact: local-app)';

const NUTRIMENT_KEYS = [
  'sugars_100g',
  'salt_100g',
  'sodium_100g',
  'saturated-fat_100g',
  'fat_100g',
  'carbohydrates_100g',
  'proteins_100g',
  'fiber_100g',
  'fibre_100g',
  'energy-kcal_100g',
  'energy_100g',
] as const;

function pickNutriments(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const n = raw as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const key of NUTRIMENT_KEYS) {
    const v = n[key];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[key] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseCategories(product: NonNullable<OffV0Response['product']>): string[] | undefined {
  if (Array.isArray(product.categories_tags) && product.categories_tags.length > 0) {
    return product.categories_tags;
  }
  if (product.categories && product.categories.trim()) {
    return product.categories
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return undefined;
}

export async function getProductByBarcode(barcode: string): Promise<NormalizedProduct | null> {
  const code = barcode.trim();
  if (!code) {
    return null;
  }

  try {
    const url = `https://world.openfoodfacts.org/api/v0/product/${encodeURIComponent(code)}.json`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': OFF_USER_AGENT,
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as OffV0Response;
    if (data.status !== 1 || !data.product) {
      return null;
    }

    const p = data.product;
    const productName = (p.product_name || p.product_name_en || p.generic_name || '').trim();
    if (!productName) {
      return null;
    }

    let brand: string | undefined;
    if (p.brands && p.brands.trim()) {
      brand = p.brands.split(',')[0]?.trim() || undefined;
    } else if (p.brand_owner && p.brand_owner.trim()) {
      brand = p.brand_owner.trim();
    }

    const imageUrl = p.image_front_small_url || p.image_front_url;
    const ingredientsText = p.ingredients_text?.trim() || undefined;
    const categories = parseCategories(p);
    const allergensText = (p.allergens_from_ingredients || p.allergens || '').trim() || undefined;

    const nutriments = pickNutriments(p.nutriments);

    return {
      barcode: code,
      productName,
      brand,
      imageUrl,
      ingredientsText,
      categories,
      allergensText,
      nutriments,
      rawJson: p as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

export type AiBarcodeLookupNormalizeResult =
  | { ok: true; product: NormalizedProduct }
  | { ok: false; reasons: string[] };

const AI_BARCODE_NAME_MAX = 100;
const AI_BARCODE_BRAND_MAX = 50;
const AI_BARCODE_INGREDIENTS_MAX = 350;
const AI_BARCODE_ALLERGENS_MAX = 150;
const AI_BARCODE_CATEGORY_MAX = 8;
const AI_BARCODE_CATEGORY_ITEM_MAX = 40;

function clampText(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) {
    return t;
  }
  return t.slice(0, Math.max(1, max - 1)) + '…';
}

/**
 * Same rules as `normalizeAiBarcodeLookupProduct` but returns explicit rejection reason(s) for debugging.
 */
export function normalizeAiBarcodeLookupProductDetailed(enforcedBarcode: string, loose: unknown): AiBarcodeLookupNormalizeResult {
  const reasons: string[] = [];

  if (!loose || typeof loose !== 'object' || Array.isArray(loose)) {
    reasons.push(`payload: expected non-null object (got ${loose === null ? 'null' : typeof loose})`);
    return { ok: false, reasons };
  }
  const o = loose as Record<string, unknown>;

  const productNameRaw = clampText(
    typeof o.productName === 'string'
      ? o.productName
      : typeof o.product_name === 'string'
        ? o.product_name
        : '',
    AI_BARCODE_NAME_MAX,
  );
  if (productNameRaw.length < 2) {
    reasons.push(
      `productName: missing or too short (len=${productNameRaw.length}, preview=${JSON.stringify(productNameRaw.slice(0, 80))})`,
    );
    return { ok: false, reasons };
  }

  const codeFromPayload = typeof o.barcode === 'string' ? o.barcode.trim() : '';
  if (!codeFromPayload) {
    reasons.push('barcode: missing or not a non-empty string on product object');
    return { ok: false, reasons };
  }
  if (!barcodesEquivalent(codeFromPayload, enforcedBarcode.trim())) {
    reasons.push(
      `barcode: mismatch (payload=${JSON.stringify(codeFromPayload)} vs enforced=${JSON.stringify(enforcedBarcode.trim())})`,
    );
    return { ok: false, reasons };
  }
  const code = enforcedBarcode.trim();

  const rj = o.rawJson;
  if (rj == null || typeof rj !== 'object' || Array.isArray(rj)) {
    reasons.push(`rawJson: missing or not a plain object (type=${rj === null ? 'null' : Array.isArray(rj) ? 'array' : typeof rj})`);
    return { ok: false, reasons };
  }
  const meta = rj as Record<string, unknown>;
  if (meta.source !== BARCODE_AI_FALLBACK_SOURCE) {
    reasons.push(
      `rawJson.source: expected ${JSON.stringify(BARCODE_AI_FALLBACK_SOURCE)}, got ${JSON.stringify(meta.source)}`,
    );
    return { ok: false, reasons };
  }
  const conf = meta.confidence;
  if (conf !== 'high' && conf !== 'medium') {
    reasons.push(`rawJson.confidence: expected "high" or "medium", got ${JSON.stringify(conf)}`);
    return { ok: false, reasons };
  }

  let matchedSources = coerceStringArrayOrEmpty(meta.matchedSources);
  if (matchedSources.length === 0) {
    reasons.push('rawJson.matchedSources: empty after coercing to string[] (need at least one URL or title)');
    return { ok: false, reasons };
  }
  matchedSources = matchedSources.map((u) => clampText(u, 500)).slice(0, 12);

  const brandRaw = o.brand;
  let brand: string | undefined;
  if (brandRaw === null || brandRaw === undefined) {
    brand = undefined;
  } else if (typeof brandRaw === 'string') {
    brand = clampText(brandRaw, AI_BARCODE_BRAND_MAX) || undefined;
  } else {
    reasons.push(`brand: expected string | null, got ${typeof brandRaw}`);
    return { ok: false, reasons };
  }

  const imgPrimary = o.imageUrl;
  const imgLegacy = o.image_url;
  let imageUrl: string | undefined;
  if (imgPrimary === null || imgPrimary === undefined) {
    if (imgLegacy === null || imgLegacy === undefined) {
      imageUrl = undefined;
    } else if (typeof imgLegacy === 'string') {
      const t = imgLegacy.trim();
      if (!t) {
        imageUrl = undefined;
      } else if (!isValidHttpsProductImageUrl(t)) {
        reasons.push(`imageUrl (image_url): invalid https product URL ${JSON.stringify(t)}`);
        return { ok: false, reasons };
      } else {
        imageUrl = t;
      }
    } else {
      reasons.push(`image_url: expected string | null, got ${typeof imgLegacy}`);
      return { ok: false, reasons };
    }
  } else if (typeof imgPrimary === 'string') {
    const t = imgPrimary.trim();
    if (!t) {
      imageUrl = undefined;
    } else if (!isValidHttpsProductImageUrl(t)) {
      reasons.push(`imageUrl: invalid https product URL ${JSON.stringify(t)}`);
      return { ok: false, reasons };
    } else {
      imageUrl = t;
    }
  } else {
    reasons.push(`imageUrl: expected string | null, got ${typeof imgPrimary}`);
    return { ok: false, reasons };
  }

  const ingRaw = o.ingredientsText;
  const ingAlt = o.ingredients_text;
  let ingredientsText: string | undefined;
  if (typeof ingRaw === 'string' && ingRaw.trim()) {
    ingredientsText = clampText(ingRaw, AI_BARCODE_INGREDIENTS_MAX);
  } else if (typeof ingAlt === 'string' && ingAlt.trim()) {
    ingredientsText = clampText(ingAlt, AI_BARCODE_INGREDIENTS_MAX);
  } else if (ingRaw !== null && ingRaw !== undefined) {
    reasons.push(`ingredientsText: expected string or null, got ${typeof ingRaw}`);
    return { ok: false, reasons };
  } else if (ingAlt !== null && ingAlt !== undefined) {
    reasons.push(`ingredients_text: expected string or null, got ${typeof ingAlt}`);
    return { ok: false, reasons };
  }

  if (!Array.isArray(o.categories)) {
    reasons.push(`categories: expected string[], got ${o.categories === null ? 'null' : typeof o.categories}`);
    return { ok: false, reasons };
  }
  let categories = coerceStringArrayOrEmpty(o.categories).map((c) => clampText(c, AI_BARCODE_CATEGORY_ITEM_MAX));
  categories = categories.slice(0, AI_BARCODE_CATEGORY_MAX);

  const algRaw = o.allergensText;
  const algAlt = o.allergens_text;
  let allergensText: string | undefined;
  if (typeof algRaw === 'string' && algRaw.trim()) {
    allergensText = clampText(algRaw, AI_BARCODE_ALLERGENS_MAX);
  } else if (typeof algAlt === 'string' && algAlt.trim()) {
    allergensText = clampText(algAlt, AI_BARCODE_ALLERGENS_MAX);
  } else if (algRaw !== null && algRaw !== undefined) {
    reasons.push(`allergensText: expected string or null, got ${typeof algRaw}`);
    return { ok: false, reasons };
  } else if (algAlt !== null && algAlt !== undefined) {
    reasons.push(`allergens_text: expected string or null, got ${typeof algAlt}`);
    return { ok: false, reasons };
  }

  if (o.nutriments !== null && o.nutriments !== undefined && (typeof o.nutriments !== 'object' || Array.isArray(o.nutriments))) {
    reasons.push(`nutriments: expected object | null, got ${Array.isArray(o.nutriments) ? 'array' : typeof o.nutriments}`);
    return { ok: false, reasons };
  }
  const nutriments = pickNutriments(o.nutriments);

  const rawJson: Record<string, unknown> = {
    source: BARCODE_AI_FALLBACK_SOURCE,
    confidence: conf,
    matchedSources,
    product_name: productNameRaw,
    brands: brand,
    ingredients_text: ingredientsText,
    categories: categories.length > 0 ? categories.join(', ') : undefined,
    nutriments,
  };

  const product: NormalizedProduct = {
    barcode: code,
    productName: productNameRaw,
    brand,
    imageUrl,
    ingredientsText,
    categories: categories.length > 0 ? categories : undefined,
    allergensText,
    nutriments,
    rawJson,
  };

  return { ok: true, product };
}

/**
 * Strictly validates web-research barcode JSON into `NormalizedProduct`.
 * Returns null unless metadata, barcode alignment, and confidence pass.
 */
export function normalizeAiBarcodeLookupProduct(enforcedBarcode: string, loose: unknown): NormalizedProduct | null {
  const r = normalizeAiBarcodeLookupProductDetailed(enforcedBarcode, loose);
  return r.ok ? r.product : null;
}
