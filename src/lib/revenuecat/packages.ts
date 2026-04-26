import type { PurchasesOffering, PurchasesPackage } from 'react-native-purchases';
import Purchases from 'react-native-purchases';

/**
 * Standard RevenueCat package types for store products.
 * In the dashboard, attach App Store / Play products to packages named:
 * `$rc_lifetime`, `$rc_annual`, `$rc_monthly`, `$rc_weekly` (or custom + map here).
 */
export const KIDLENS_PACKAGE_TYPES = {
  lifetime: Purchases.PACKAGE_TYPE.LIFETIME,
  yearly: Purchases.PACKAGE_TYPE.ANNUAL,
  monthly: Purchases.PACKAGE_TYPE.MONTHLY,
  weekly: Purchases.PACKAGE_TYPE.WEEKLY,
} as const;

export type KidlensPackageKind = keyof typeof KIDLENS_PACKAGE_TYPES;

export function findPackageByKind(
  offering: PurchasesOffering | null | undefined,
  kind: KidlensPackageKind,
): PurchasesPackage | null {
  if (!offering?.availablePackages?.length) {
    return null;
  }
  const target = KIDLENS_PACKAGE_TYPES[kind];
  return offering.availablePackages.find((p) => p.packageType === target) ?? null;
}

export function listKidlensPackages(offering: PurchasesOffering | null | undefined): {
  kind: KidlensPackageKind;
  pkg: PurchasesPackage;
}[] {
  if (!offering?.availablePackages?.length) {
    return [];
  }
  const kinds = Object.keys(KIDLENS_PACKAGE_TYPES) as KidlensPackageKind[];
  const out: { kind: KidlensPackageKind; pkg: PurchasesPackage }[] = [];
  for (const kind of kinds) {
    const pkg = findPackageByKind(offering, kind);
    if (pkg) {
      out.push({ kind, pkg });
    }
  }
  return out;
}
