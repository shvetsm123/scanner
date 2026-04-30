import type { AppLanguage } from './deviceLanguage';
import type { AiResult } from '../types/ai';

/**
 * KidLens displays scan result text in English only.
 */
export function localizeResultLine(line: string, lang: AppLanguage): string {
  void lang;
  return line;
}

export function localizeAiResultStrings(ai: AiResult, lang: AppLanguage): AiResult {
  void lang;
  return ai;
}
