import * as Localization from 'expo-localization';
import { Platform } from 'react-native';

export const SUPPORTED_APP_LANGUAGES = ['en', 'ru', 'uk', 'de', 'fr', 'es', 'it', 'pl', 'pt', 'nl'] as const;
export type AppLanguage = (typeof SUPPORTED_APP_LANGUAGES)[number];

let cached: AppLanguage | null = null;

function readPrimaryLanguageCode(): string {
  try {
    const locales = Localization.getLocales();
    const first = locales?.[0];
    if (first && typeof first.languageCode === 'string' && first.languageCode.length > 0) {
      return first.languageCode;
    }
  } catch {
    // ignore
  }
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
    return navigator.language.split('-')[0] ?? 'en';
  }
  return 'en';
}

export function getDeviceAppLanguage(): AppLanguage {
  const base = readPrimaryLanguageCode().toLowerCase().split('-')[0];
  if ((SUPPORTED_APP_LANGUAGES as readonly string[]).includes(base)) {
    return base as AppLanguage;
  }
  return 'en';
}

/** Cached device language for the current app session. */
export function getAppLanguage(): AppLanguage {
  if (!cached) {
    cached = getDeviceAppLanguage();
  }
  return cached;
}
