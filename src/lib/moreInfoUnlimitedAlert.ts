import { Alert } from 'react-native';

const TITLE = 'More info is part of Unlimited';
const MESSAGE =
  'Get Advanced info with Unlimited: 5–8 key facts, nutrition snapshot, ingredient flags, and a fuller breakdown.';

export function showMoreInfoUnlimitedUpsell(onViewPlans: () => void): void {
  Alert.alert(TITLE, MESSAGE, [
    { text: 'Close', style: 'cancel' },
    { text: 'View plans', onPress: onViewPlans },
  ]);
}
