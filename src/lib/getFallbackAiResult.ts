import type { AiResult } from '../types/ai';
import type { AppLanguage } from './deviceLanguage';
import type { ResultStyle } from '../types/preferences';
import type { Verdict } from '../types/scan';
import { t } from './i18n';

export function getFallbackAiResult(
  ruleBasedBaseVerdict: Verdict = 'unknown',
  _resultStyle: ResultStyle = 'quick',
  lang: AppLanguage,
): AiResult {
  return {
    baseVerdict: ruleBasedBaseVerdict,
    verdict: ruleBasedBaseVerdict,
    summary: t('fb.summary', lang),
    reasons: [
      t('fb.a.r1', lang),
      t('fb.a.r2', lang),
      t('fb.a.r3', lang),
      t('fb.a.r4', lang),
      t('fb.a.r5', lang),
    ],
    preferenceMatches: [],
    nutritionSnapshot: [],
    ingredientFlags: [t('fb.if1', lang), t('fb.if2', lang), t('fb.if3', lang)],
    guidanceContext: [],
    ingredientBreakdown: [],
    allergyNotes: [],
    whyThisMatters: t('fb.why', lang),
    parentTakeaway: t('fb.parent', lang),
  };
}
