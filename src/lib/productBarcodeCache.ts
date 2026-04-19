import type { NormalizedProduct } from '../api/openFoodFacts';

const MAX_ENTRIES = 80;
const cache = new Map<string, NormalizedProduct>();

function cacheKey(barcode: string): string {
  const digits = barcode.replace(/\D/g, '');
  return digits || barcode.trim();
}

export function getCachedNormalizedProduct(barcode: string): NormalizedProduct | undefined {
  return cache.get(cacheKey(barcode));
}

export function setCachedNormalizedProduct(barcode: string, product: NormalizedProduct): void {
  const k = cacheKey(barcode);
  if (cache.size >= MAX_ENTRIES && !cache.has(k)) {
    const first = cache.keys().next().value;
    if (first) {
      cache.delete(first);
    }
  }
  cache.set(k, product);
}
