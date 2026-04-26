import type { CustomerInfo } from 'react-native-purchases';

/** Must match the entitlement identifier in the RevenueCat dashboard exactly. */
export const KIDLENS_UNLIMITED_ENTITLEMENT_ID = 'KidLens AI Unlimited' as const;

export function hasKidlensUnlimitedAccess(customerInfo: CustomerInfo | null | undefined): boolean {
  if (!customerInfo) {
    return false;
  }
  const info = customerInfo.entitlements.active[KIDLENS_UNLIMITED_ENTITLEMENT_ID];
  return info?.isActive === true;
}
