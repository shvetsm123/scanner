import { Alert } from 'react-native';

import { getAppLanguage, t } from './i18n';

export function showFavoritesUnlimitedUpsell(onViewPlans: () => void) {
  const lang = getAppLanguage();
  Alert.alert(t('favUpsell.title', lang), t('favUpsell.msg', lang), [
    { text: t('common.close', lang), style: 'cancel' },
    { text: t('scanner.viewPlans', lang), onPress: onViewPlans },
  ]);
}
