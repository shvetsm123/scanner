import type { AppLanguage } from './deviceLanguage';
import type { AiResult } from '../types/ai';
import { t } from './i18n';

/**
 * Leading English nutrient labels (longest match first) → i18n key for localized label before ":".
 */
const NUTRIENT_PREFIX_KEYS: Array<{ re: RegExp; key: string }> = [
  { re: /^Saturated fat:\s*/i, key: 'nut.prefix.saturatedFat' },
  { re: /^Trans fat:\s*/i, key: 'nut.prefix.transFat' },
  { re: /^Total sugars?:\s*/i, key: 'nut.prefix.totalSugar' },
  { re: /^Carbohydrates:\s*/i, key: 'nut.prefix.carbohydrates' },
  { re: /^Cholesterol:\s*/i, key: 'nut.prefix.cholesterol' },
  { re: /^Sugars:\s*/i, key: 'nut.prefix.sugars' },
  { re: /^Sugar:\s*/i, key: 'nut.prefix.sugar' },
  { re: /^Sodium:\s*/i, key: 'nut.prefix.sodium' },
  { re: /^Salt:\s*/i, key: 'nut.prefix.salt' },
  { re: /^Protein:\s*/i, key: 'nut.prefix.protein' },
  { re: /^Fibre:\s*/i, key: 'nut.prefix.fiber' },
  { re: /^Fiber:\s*/i, key: 'nut.prefix.fiber' },
  { re: /^Energy:\s*/i, key: 'nut.prefix.energy' },
  { re: /^Fat:\s*/i, key: 'nut.prefix.fat' },
];

/**
 * Normalizes known English nutrient labels and per-100 g/ml suffixes for display when app language ≠ English.
 * Idempotent for already-localized lines in many cases.
 */
export function localizeResultLine(line: string, lang: AppLanguage): string {
  if (lang === 'en') {
    return line;
  }
  let s = line.trim();
  for (const { re, key } of NUTRIENT_PREFIX_KEYS) {
    if (re.test(s)) {
      s = s.replace(re, `${t(key, lang)}: `);
      break;
    }
  }
  s = s.replace(/\s*\/\s*100\s*g\b/gi, t('nut.suffix.per100g', lang));
  s = s.replace(/\s*\/\s*100\s*ml\b/gi, t('nut.suffix.per100ml', lang));
  s = s.replace(/\bper\s+100\s*g\b/gi, t('nut.phrase.per100g', lang));
  s = s.replace(/\bper\s+100\s*ml\b/gi, t('nut.phrase.per100ml', lang));
  return s;
}

export function localizeAiResultStrings(ai: AiResult, lang: AppLanguage): AiResult {
  if (lang === 'en') {
    return ai;
  }
  const loc = (x: string) => localizeResultLine(x, lang);
  return {
    ...ai,
    summary: loc(ai.summary),
    reasons: ai.reasons.map(loc),
    preferenceMatches: ai.preferenceMatches.map(loc),
    nutritionSnapshot: ai.nutritionSnapshot.map(loc),
    ingredientFlags: ai.ingredientFlags.map(loc),
    ingredientBreakdown: ai.ingredientBreakdown.map(loc),
    allergyNotes: ai.allergyNotes.map(loc),
    parentTakeaway: loc(ai.parentTakeaway),
    guidanceContext: ai.guidanceContext.map(loc),
  };
}
