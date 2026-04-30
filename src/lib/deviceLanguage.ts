export const SUPPORTED_APP_LANGUAGES = ['en', 'ru', 'uk', 'de', 'fr', 'es', 'it', 'pl', 'pt', 'nl'] as const;
export type AppLanguage = (typeof SUPPORTED_APP_LANGUAGES)[number];

export function getDeviceAppLanguage(): AppLanguage {
  // KidLens is English-only; do not read the device/browser locale.
  return 'en';
}

export function getAppLanguage(): AppLanguage {
  return 'en';
}
