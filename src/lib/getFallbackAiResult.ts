import type { AiResult } from '../types/ai';
import type { AppLanguage } from './deviceLanguage';
import type { ResultStyle } from '../types/preferences';
import type { Verdict } from '../types/scan';
import { t } from './i18n';

export function getFallbackAiResult(
  ruleBasedBaseVerdict: Verdict = 'unknown',
  resultStyle: ResultStyle = 'quick',
  lang: AppLanguage,
): AiResult {
  const advanced = resultStyle === 'advanced';
  return {
    baseVerdict: ruleBasedBaseVerdict,
    verdict: ruleBasedBaseVerdict,
    summary: t('fb.summary', lang),
    reasons: advanced
      ? [
          t('fb.a.r1', lang),
          t('fb.a.r2', lang),
          t('fb.a.r3', lang),
          t('fb.a.r4', lang),
          t('fb.a.r5', lang),
        ]
      : [t('fb.q.r1', lang), t('fb.q.r2', lang), t('fb.q.r3', lang)],
    preferenceMatches: [],
    nutritionSnapshot: [],
    ingredientFlags: advanced ? [t('fb.if1', lang), t('fb.if2', lang), t('fb.if3', lang)] : [],
    guidanceContext: [],
    ingredientBreakdown: advanced
      ? [t('fb.br1', lang), t('fb.br2', lang), t('fb.br3', lang)]
      : [t('fb.br1', lang), t('fb.br2', lang)],
    allergyNotes: [],
    parentTakeaway: t('fb.parent', lang),
  };
}
