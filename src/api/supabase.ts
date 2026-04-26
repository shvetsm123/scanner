import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { ChildAgeProfile } from '../lib/childAgeContext';
import type { RecentScan } from '../types/scan';
import { BARCODE_AI_FALLBACK_SOURCE } from './openFoodFacts';

const url = typeof process.env.EXPO_PUBLIC_SUPABASE_URL === 'string' ? process.env.EXPO_PUBLIC_SUPABASE_URL.trim() : '';
const anonKey =
  typeof process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY === 'string' ? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY.trim() : '';

export function isSupabaseConfigured(): boolean {
  return url.length > 0 && anonKey.length > 0;
}

let clientSingleton: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    return null;
  }
  if (!clientSingleton) {
    clientSingleton = createClient(url, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return clientSingleton;
}

export type DbProfileRow = {
  id: string;
  device_id: string;
};

export type DbPreferencesRow = {
  id?: string;
  profile_id: string;
  child_age: number | null;
  child_birthdate?: string | null;
  result_style: string | null;
  avoid_preferences: unknown;
  updated_at?: string | null;
};

export async function fetchProfileIdByDeviceId(client: SupabaseClient, deviceId: string): Promise<string | null> {
  const { data, error } = await client.from('profiles').select('id').eq('device_id', deviceId).maybeSingle();
  if (error || !data || typeof (data as { id?: unknown }).id !== 'string') {
    return null;
  }
  return (data as { id: string }).id;
}

export async function insertProfileForDevice(client: SupabaseClient, deviceId: string): Promise<string | null> {
  const { data, error } = await client.from('profiles').insert({ device_id: deviceId }).select('id').single();
  if (!error && data && typeof (data as { id?: unknown }).id === 'string') {
    return (data as { id: string }).id;
  }
  return fetchProfileIdByDeviceId(client, deviceId);
}

export async function ensureProfileId(client: SupabaseClient, deviceId: string): Promise<string | null> {
  const existing = await fetchProfileIdByDeviceId(client, deviceId);
  if (existing) {
    return existing;
  }
  return insertProfileForDevice(client, deviceId);
}

export async function fetchPreferencesForProfile(
  client: SupabaseClient,
  profileId: string,
): Promise<DbPreferencesRow | null> {
  const { data, error } = await client
    .from('preferences')
    .select('id,profile_id,child_age,child_birthdate,result_style,avoid_preferences,updated_at')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (error || !data) {
    return null;
  }
  return data as DbPreferencesRow;
}

export function preferencesRowHasValues(row: DbPreferencesRow): boolean {
  if (typeof row.child_birthdate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.child_birthdate.trim())) {
    return true;
  }
  if (row.child_age != null && Number.isFinite(Number(row.child_age))) {
    return true;
  }
  const rs = row.result_style;
  if (rs === 'quick' || rs === 'advanced' || rs === 'balanced' || rs === 'detailed') {
    return true;
  }
  return Array.isArray(row.avoid_preferences) && row.avoid_preferences.length > 0;
}

export async function upsertPreferencesForProfile(
  client: SupabaseClient,
  payload: {
    profile_id: string;
    child_age: number | null;
    child_birthdate: string | null;
    result_style: string;
    avoid_preferences: string[];
  },
): Promise<void> {
  await client.from('preferences').upsert(
    {
      profile_id: payload.profile_id,
      child_age: payload.child_age,
      child_birthdate: payload.child_birthdate,
      result_style: payload.result_style,
      avoid_preferences: payload.avoid_preferences,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'profile_id' },
  );
}

export function normalizeProductBarcode(raw: unknown): string | null {
  if (raw == null) {
    return null;
  }
  const s = typeof raw === 'string' ? raw.trim() : String(raw).trim();
  return s.length > 0 ? s : null;
}

type ProductWriteOptions = { includeNutriments: boolean; includeRawJson: boolean };

/** Upsert payload: no `created_at` so conflict updates do not overwrite it; DB default applies on insert. */
function buildProductUpsertPayload(
  barcode: string,
  scan: RecentScan,
  opts: ProductWriteOptions,
): Record<string, unknown> {
  const now = new Date().toISOString();
  const raw = scan.rawJson;
  const isAiBarcodeRow =
    raw != null &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    (raw as Record<string, unknown>)['source'] === BARCODE_AI_FALLBACK_SOURCE;
  const hasOff = scan.rawJson != null && !isAiBarcodeRow;
  const payload: Record<string, unknown> = {
    barcode,
    product_name: (scan.productName ?? 'Unknown product').trim() || 'Unknown product',
    brand: scan.brand ?? null,
    image_url: scan.imageUrl ?? null,
    ingredients_text: scan.ingredientsText ?? null,
    categories: scan.categories ?? null,
    allergens: scan.allergensText ?? null,
    source: hasOff ? 'open_food_facts' : 'scanner',
    updated_at: now,
  };
  if (opts.includeNutriments && scan.nutriments != null && typeof scan.nutriments === 'object') {
    payload.nutriments = scan.nutriments;
  }
  if (opts.includeRawJson && scan.rawJson != null) {
    payload.raw_json = scan.rawJson;
  }
  return payload;
}

async function tryUpsertProductRow(
  client: SupabaseClient,
  barcode: string,
  payload: Record<string, unknown>,
): Promise<string | null> {
  console.warn('[Supabase] products upsert payload keys=', Object.keys(payload), 'barcode=', barcode);
  try {
    const { data, error } = await client
      .from('products')
      .upsert(payload, { onConflict: 'barcode' })
      .select('id')
      .maybeSingle();

    if (data && typeof (data as { id?: unknown }).id === 'string') {
      console.warn('[Supabase] products upsert returned product_id=', (data as { id: string }).id);
      return (data as { id: string }).id;
    }

    if (error) {
      const code = (error as { code?: string }).code;
      console.warn('[Supabase] products upsert error', { barcode, message: error.message, code });
      if (code === '23505') {
        const sel = await fetchProductIdByBarcode(client, barcode);
        if (sel) {
          console.warn('[Supabase] products duplicate key fallback select product_id=', sel);
        }
        return sel;
      }
    }
  } catch (err) {
    console.warn('[Supabase] products upsert exception', barcode, err);
  }

  const sel = await fetchProductIdByBarcode(client, barcode);
  if (sel) {
    console.warn('[Supabase] products upsert empty response fallback select product_id=', sel);
  }
  return sel;
}

/** Upserts `products` by `barcode` when lookup missed; only uses real table columns. */
export async function upsertProductByBarcode(client: SupabaseClient, scan: RecentScan): Promise<string | null> {
  const barcode = normalizeProductBarcode(scan.barcode);
  if (!barcode) {
    console.warn('[Supabase] upsertProductByBarcode: invalid barcode', scan?.barcode);
    return null;
  }
  console.warn('[Supabase] upsertProductByBarcode: upsert path barcode=', barcode);

  const tiers: ProductWriteOptions[] = [
    { includeNutriments: true, includeRawJson: true },
    { includeNutriments: true, includeRawJson: false },
    { includeNutriments: false, includeRawJson: true },
    { includeNutriments: false, includeRawJson: false },
  ];

  for (const opts of tiers) {
    const payload = buildProductUpsertPayload(barcode, scan, opts);
    const id = await tryUpsertProductRow(client, barcode, payload);
    if (id) {
      return id;
    }
  }

  const now = new Date().toISOString();
  const minimal: Record<string, unknown> = {
    barcode,
    product_name: (scan.productName ?? 'Unknown product').trim() || 'Unknown product',
    source: 'scanner',
    updated_at: now,
  };
  const fallbackId = await tryUpsertProductRow(client, barcode, minimal);
  if (fallbackId) {
    return fallbackId;
  }

  const last = await fetchProductIdByBarcode(client, barcode);
  if (last) {
    console.warn('[Supabase] upsertProductByBarcode: final fetch product_id=', last);
  }
  return last;
}

const productIdInflight = new Map<string, Promise<string | null>>();

async function resolveProductIdOnce(
  client: SupabaseClient,
  scan: RecentScan,
  barcode: string,
): Promise<string | null> {
  console.warn('[Supabase] getOrCreateProductId: lookup barcode=', barcode);
  const existingId = await fetchProductIdByBarcode(client, barcode);
  if (existingId) {
    console.warn('[Supabase] getOrCreateProductId: product existed product_id=', existingId);
    console.warn('[Supabase] getOrCreateProductId: final resolved product_id=', existingId);
    return existingId;
  }

  const createdId = await upsertProductByBarcode(client, scan);
  if (createdId) {
    console.warn('[Supabase] getOrCreateProductId: final resolved product_id=', createdId);
    return createdId;
  }

  const raced = await fetchProductIdByBarcode(client, barcode);
  if (raced) {
    console.warn('[Supabase] getOrCreateProductId: duplicate fallback select product_id=', raced);
    console.warn('[Supabase] getOrCreateProductId: final resolved product_id=', raced);
    return raced;
  }

  console.warn('[Supabase] getOrCreateProductId: unresolved barcode=', barcode);
  return null;
}

export async function upsertProductResultForScan(
  client: SupabaseClient,
  productId: string,
  ageBand: string,
  scan: RecentScan,
): Promise<string | null> {
  try {
    const payload = {
      product_id: productId,
      age_band: ageBand,
      verdict: scan.verdict,
      summary: scan.summary,
      reasons: scan.reasons,
      why_text: scan.whyThisMatters ?? scan.whyText ?? '',
      ingredient_breakdown: scan.ingredientBreakdown ?? [],
      allergy_notes: scan.allergyNotes ?? [],
      parent_takeaway: scan.parentTakeaway ?? '',
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await client
      .from('product_results')
      .upsert(payload, { onConflict: 'product_id,age_band' })
      .select('id')
      .single();
    if (!error && data && typeof (data as { id?: unknown }).id === 'string') {
      return (data as { id: string }).id;
    }
    const { data: found } = await client
      .from('product_results')
      .select('id')
      .eq('product_id', productId)
      .eq('age_band', ageBand)
      .maybeSingle();
    return found && typeof found.id === 'string' ? found.id : null;
  } catch (err) {
    console.warn('[Supabase] upsertProductResultForScan', err);
    return null;
  }
}

export async function insertScanHistory(
  client: SupabaseClient,
  payload: {
    profile_id: string;
    product_id: string;
    product_result_id: string | null;
    verdict: string;
    summary: string;
    reasons: string[];
    preference_matches: string[];
    why_text: string | null;
    ingredient_breakdown: string[];
    allergy_notes: string[];
    parent_takeaway: string | null;
    scanned_at: string;
  },
): Promise<void> {
  if (!payload.product_id || typeof payload.product_id !== 'string') {
    console.warn('[Supabase] insertScanHistory skipped: invalid product_id');
    return;
  }
  try {
    const { error } = await client.from('scan_history').insert(payload);
    if (error) {
      console.warn('[Supabase] insertScanHistory', error);
    }
  } catch (err) {
    console.warn('[Supabase] insertScanHistory', err);
  }
}

export type AiResultReportPayload = {
  profile_id: string | null;
  device_id: string | null;
  barcode: string | null;
  product_name: string | null;
  brand: string | null;
  reason: string;
  note: string | null;
  result: unknown;
  preferences: unknown;
};

export async function submitAiResultReport(
  client: SupabaseClient,
  payload: AiResultReportPayload,
): Promise<void> {
  const { error } = await client.from('ai_result_reports').insert({
    profile_id: payload.profile_id,
    device_id: payload.device_id,
    barcode: payload.barcode,
    product_name: payload.product_name,
    brand: payload.brand,
    reason: payload.reason,
    note: payload.note,
    result: payload.result,
    preferences: payload.preferences,
  });
  if (error) {
    throw error;
  }
}

export async function persistSuccessfulScanHistory(
  client: SupabaseClient,
  profileId: string,
  scan: RecentScan,
  childAgeProfile: ChildAgeProfile,
): Promise<void> {
  try {
    const ageBand = childAgeProfile.ageBucket;
    const productId = await getOrCreateProductId(client, scan);
    if (!productId) {
      console.warn('[Supabase] persistSuccessfulScanHistory: no product_id, skipping scan_history');
      return;
    }
    let productResultId: string | null = null;
    productResultId = await upsertProductResultForScan(client, productId, ageBand, scan);
    await insertScanHistory(client, {
      profile_id: profileId,
      product_id: productId,
      product_result_id: productResultId,
      verdict: scan.verdict,
      summary: scan.summary,
      reasons: scan.reasons,
      preference_matches: scan.preferenceMatches ?? [],
      why_text: scan.whyThisMatters ?? scan.whyText ?? null,
      ingredient_breakdown: scan.ingredientBreakdown ?? [],
      allergy_notes: scan.allergyNotes ?? [],
      parent_takeaway: scan.parentTakeaway ?? null,
      scanned_at: scan.scannedAt,
    });
  } catch (err) {
    console.warn('[Supabase] persistSuccessfulScanHistory', err);
  }
}

export type DbFavoriteJoinedRow = {
  id: string;
  profile_id: string;
  product_id: string;
  created_at: string;
  products: {
    barcode: string;
    product_name: string;
    brand: string | null;
    image_url: string | null;
  } | null;
};

export async function fetchProductIdByBarcode(client: SupabaseClient, barcode: string): Promise<string | null> {
  try {
    const b = normalizeProductBarcode(barcode);
    if (!b) {
      return null;
    }
    const { data, error } = await client.from('products').select('id').eq('barcode', b).maybeSingle();
    if (error || !data || typeof (data as { id?: unknown }).id !== 'string') {
      return null;
    }
    return (data as { id: string }).id;
  } catch (err) {
    console.warn('[Supabase] fetchProductIdByBarcode', err);
    return null;
  }
}

/** Resolves `public.products.id` by normalized barcode; upserts when missing. Concurrent calls share one promise per barcode. */
export async function getOrCreateProductId(client: SupabaseClient, scan: RecentScan): Promise<string | null> {
  const barcode = normalizeProductBarcode(scan.barcode);
  if (!barcode) {
    console.warn('[Supabase] getOrCreateProductId: invalid barcode', scan?.barcode);
    return null;
  }

  const inflight = productIdInflight.get(barcode);
  if (inflight) {
    console.warn('[Supabase] getOrCreateProductId: reusing in-flight promise barcode=', barcode);
    return inflight;
  }

  const promise = resolveProductIdOnce(client, scan, barcode).finally(() => {
    productIdInflight.delete(barcode);
  });
  productIdInflight.set(barcode, promise);
  return promise;
}

export async function getFavorites(
  client: SupabaseClient,
  profileId: string,
  limit = 5,
): Promise<DbFavoriteJoinedRow[]> {
  try {
    const { data, error } = await client
      .from('favorites')
      .select('id, profile_id, product_id, created_at, products(barcode, product_name, brand, image_url)')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !Array.isArray(data)) {
      return [];
    }
    return data as unknown as DbFavoriteJoinedRow[];
  } catch (err) {
    console.warn('[Supabase] getFavorites', err);
    return [];
  }
}

export async function isFavorite(client: SupabaseClient, profileId: string, productId: string): Promise<boolean> {
  try {
    const { data, error } = await client
      .from('favorites')
      .select('id')
      .eq('profile_id', profileId)
      .eq('product_id', productId)
      .maybeSingle();
    return !error && !!data;
  } catch (err) {
    console.warn('[Supabase] isFavorite', err);
    return false;
  }
}

export async function addFavorite(client: SupabaseClient, profileId: string, productId: string): Promise<boolean> {
  try {
    const { error } = await client.from('favorites').insert({ profile_id: profileId, product_id: productId });
    if (error) {
      console.warn('[Supabase] addFavorite', error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Supabase] addFavorite', err);
    return false;
  }
}

export async function removeFavorite(client: SupabaseClient, profileId: string, productId: string): Promise<boolean> {
  try {
    const { error } = await client.from('favorites').delete().eq('profile_id', profileId).eq('product_id', productId);
    if (error) {
      console.warn('[Supabase] removeFavorite', error);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[Supabase] removeFavorite', err);
    return false;
  }
}

/** Returns whether the product is favorited after the operation. */
export async function toggleFavorite(
  client: SupabaseClient,
  profileId: string,
  productId: string,
): Promise<boolean> {
  const was = await isFavorite(client, profileId, productId);
  if (was) {
    await removeFavorite(client, profileId, productId);
    return false;
  }
  const ok = await addFavorite(client, profileId, productId);
  return ok;
}
