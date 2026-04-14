import { Alert } from 'react-native';

const TITLE = 'Favorites are part of Unlimited';
const MESSAGE = 'Save products you want to come back to with the Unlimited plan.';

export function showFavoritesUnlimitedUpsell(onViewPlans: () => void) {
  Alert.alert(TITLE, MESSAGE, [
    { text: 'Close', style: 'cancel' },
    { text: 'View plans', onPress: onViewPlans },
  ]);
}
