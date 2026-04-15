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
