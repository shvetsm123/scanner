import { Text, View } from 'react-native';

import { getAppLanguage, t } from '../lib/i18n';
import type { Verdict } from '../types/scan';

const VERDICT_STYLES: Record<Verdict, { key: 'verdict.good' | 'verdict.sometimes' | 'verdict.avoid' | 'verdict.unknown'; backgroundColor: string; color: string }> = {
  good: {
    key: 'verdict.good',
    backgroundColor: '#E6F4EA',
    color: '#2E6C45',
  },
  sometimes: {
    key: 'verdict.sometimes',
    backgroundColor: '#FCECD9',
    color: '#8A5A18',
  },
  avoid: {
    key: 'verdict.avoid',
    backgroundColor: '#F8E1E1',
    color: '#8A2D2D',
  },
  unknown: {
    key: 'verdict.unknown',
    backgroundColor: '#ECECEC',
    color: '#5D5D5D',
  },
};

type VerdictBadgeProps = {
  verdict: Verdict;
};

export function VerdictBadge({ verdict }: VerdictBadgeProps) {
  const lang = getAppLanguage();
  const config = VERDICT_STYLES[verdict];

  return (
    <View
      style={{
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        alignSelf: 'flex-start',
        backgroundColor: config.backgroundColor,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: '700', color: config.color }}>{t(config.key, lang)}</Text>
    </View>
  );
}
