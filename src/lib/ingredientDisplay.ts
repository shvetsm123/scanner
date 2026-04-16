import type { AppLanguage } from './deviceLanguage';
import { t } from './i18n';
import { localizeResultLine } from './localizeScanText';

/** Sentence-style capitalization (first character only; rest lowercased for consistency). */
export function formatIngredientNameForDisplay(name: string): string {
  const raw = name.trim().replace(/\s+/g, ' ');
  if (!raw) {
    return raw;
  }
  const lower = raw.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

const NOTE_MAX = 200;

/**
 * Localizes nutrient-style fragments, resolves i18n keys, trims length for a tighter on-screen read.
 */
export function polishIngredientNote(note: string, lang: AppLanguage): string {
  let s = note.trim().replace(/\s+/g, ' ');
  s = localizeResultLine(s, lang);
  if (/^ing\.[a-z0-9_.]+$/i.test(s)) {
    const u = t(s, lang);
    s = u === s || /^ing\./i.test(u) ? t('ing.note.fallback', lang) : u;
  }
  if (s.length <= NOTE_MAX) {
    return s;
  }
  const cut = s.slice(0, NOTE_MAX);
  const lastSentence = cut.lastIndexOf('. ');
  const lastComma = cut.lastIndexOf(', ');
  const at = Math.max(lastSentence, lastComma);
  if (at > NOTE_MAX * 0.42) {
    return `${cut.slice(0, at + 1).trim()}…`;
  }
  return `${cut.trim()}…`;
}

/** Ingredient names come from the model in target language — only light casing; avoid injecting other languages. */
export function formatIngredientNameForLang(name: string, lang: AppLanguage): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (lang === 'en') {
    return formatIngredientNameForDisplay(localizeResultLine(trimmed, lang));
  }
  return formatIngredientNameForDisplay(trimmed);
}
