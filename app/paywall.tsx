import { StatusBar } from 'expo-status-bar';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { M } from '../constants/mamaTheme';
import { getAppLanguage, t } from '../src/lib/i18n';
import { KIDLENS_UNLIMITED_ENTITLEMENT_ID, hasKidlensUnlimitedAccess } from '../src/lib/revenuecat/entitlements';
import { isUserCancelledPurchaseError, purchasesErrorMessage } from '../src/lib/revenuecat/revenueCatService';
import { getChildAgeProfile, getPlan, setPlan } from '../src/lib/storage';
import { useRevenueCat } from '../src/providers/RevenueCatProvider';
import type { Plan } from '../src/types/preferences';

type BillingPlan = 'monthly' | 'yearly';

const billingPlanOptions: {
  type: BillingPlan;
  title: string;
  price: string;
  subtext: string;
  badge?: string;
}[] = [
  {
    type: 'yearly',
    title: 'Yearly',
    price: '$79.99/year',
    subtext: '$6.67/month · Save 33%',
    badge: 'BEST VALUE',
  },
  {
    type: 'monthly',
    title: 'Monthly',
    price: '$9.99/month',
    subtext: 'Flexible monthly access',
  },
];

function parsePlanQueryParam(raw: string | string[] | undefined): Plan | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === 'unlimited') {
    return 'unlimited';
  }
  if (v === 'free') {
    return 'free';
  }
  if (v === 'insights') {
    return 'unlimited';
  }
  return null;
}

function isMissingRevenueCatApiKeyMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('missing') && lower.includes('revenuecat') && lower.includes('api') && lower.includes('key');
}

function detectBillingPlan(productIdentifier: string | null | undefined): 'Monthly' | 'Yearly' | null {
  if (!productIdentifier) {
    return null;
  }
  const lower = productIdentifier.toLowerCase();
  if (lower.includes('yearly') || lower.includes('annual')) {
    return 'Yearly';
  }
  if (lower.includes('monthly') || lower.includes('month')) {
    return 'Monthly';
  }
  return null;
}

function formatSubscriptionDate(rawDate: string | null | undefined): string | null {
  if (!rawDate) {
    return null;
  }
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export default function PaywallScreen() {
  const lang = getAppLanguage();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const isNarrowAndroid = Platform.OS === 'android' && windowWidth < 380;
  const horizontalPadding = isNarrowAndroid ? 20 : 24;
  const params = useLocalSearchParams<{ plan?: string | string[]; source?: string | string[] }>();
  const source = Array.isArray(params.source) ? params.source[0] : params.source;
  const isScanLockedSource = source === 'scan_locked';
  const [currentPlan, setCurrentPlan] = useState<Plan>('free');
  const [selectedAppPlan, setSelectedAppPlan] = useState<Plan>('unlimited');
  const [selectedPlan, setSelectedPlan] = useState<BillingPlan>('yearly');
  const [childAgeYears, setChildAgeYears] = useState<number | null>(null);
  const [rcBusy, setRcBusy] = useState(false);
  const {
    isNativeStoreSupported,
    customerInfo,
    restorePurchases,
    purchasePackageByType,
    refreshCustomerInfo,
    lastError,
    hasKidlensUnlimited,
  } = useRevenueCat();

  const isEffectivelyUnlimited = hasKidlensUnlimited || currentPlan === 'unlimited';
  const isEffectivelyFree = !isEffectivelyUnlimited;

  const upgradeBenefits = useMemo(
    () => [
      { icon: '∞', label: 'Unlimited scans', bg: M.sageWash },
      { icon: '⚡', label: "Know if it's safe in seconds", bg: '#F3EADB' },
      { icon: '👀', label: 'No more reading tiny labels', bg: '#EFE7F6' },
      { icon: '👶', label: 'Make better choices for your child', bg: '#F8ECDD' },
    ],
    [],
  );
  const trialBillingLine = selectedPlan === 'yearly' ? 'Then $79.99/year' : 'Then $9.99/month';
  const upgradeOffer = useMemo(() => [trialBillingLine, 'Cancel anytime'], [trialBillingLine]);
  const scanLockedOffer = useMemo(() => [trialBillingLine, 'Cancel anytime'], [trialBillingLine]);
  const scanLockedPreview = useMemo(
    () => [
      '⚠️ High sugar level detected',
      '⚠️ Additives may need review',
    ],
    [],
  );

  const load = useCallback(async () => {
    const p = await getPlan();
    const ageProfile = await getChildAgeProfile();
    setCurrentPlan(p);
    setChildAgeYears(Number.isFinite(ageProfile.completedWholeYears) ? ageProfile.completedWholeYears : null);
    const fromRoute = parsePlanQueryParam(params.plan);
    if (fromRoute === 'unlimited') {
      setSelectedAppPlan('unlimited');
    } else if (fromRoute === 'free') {
      setSelectedAppPlan('free');
    } else if (p === 'unlimited') {
      setSelectedAppPlan('unlimited');
    } else {
      setSelectedAppPlan('unlimited');
    }
  }, [params.plan]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    if (isScanLockedSource) {
      console.log('paywall_opened_from_scan');
      console.log('scan_locked_paywall_rendered');
    }
  }, [isScanLockedSource]);

  const goBack = () => {
    router.back();
  };

  const continueDisabled =
    (selectedAppPlan === 'free' && currentPlan === 'free' && isEffectivelyFree) ||
    (selectedAppPlan === 'unlimited' && hasKidlensUnlimited && currentPlan === 'unlimited');

  const onContinue = async () => {
    if (selectedAppPlan === 'free') {
      await setPlan('free');
      void refreshCustomerInfo();
      router.back();
      return;
    }

    if (hasKidlensUnlimited) {
      await setPlan('unlimited');
      void refreshCustomerInfo();
      if (isScanLockedSource) {
        console.log('purchase_completed_from_scan');
      }
      router.back();
      return;
    }

    if (!isNativeStoreSupported) {
      Alert.alert(
        'Subscriptions',
        Platform.OS === 'web'
          ? 'In-app purchases are only available in the iOS and Android apps.'
          : 'Subscriptions are not available on this platform.',
      );
      return;
    }

    setRcBusy(true);
    try {
      const info = await purchasePackageByType(selectedPlan);
      await refreshCustomerInfo();
      if (hasKidlensUnlimitedAccess(info)) {
        if (isScanLockedSource) {
          console.log('purchase_completed_from_scan');
        }
        router.back();
      }
    } catch (e) {
      if (isUserCancelledPurchaseError(e)) {
        return;
      }
      Alert.alert('Subscription', purchasesErrorMessage(e));
    } finally {
      setRcBusy(false);
    }
  };

  const onRestorePurchases = useCallback(async () => {
    if (!isNativeStoreSupported) {
      return;
    }
    setRcBusy(true);
    try {
      const info = await restorePurchases();
      await load();
      if (isScanLockedSource && hasKidlensUnlimitedAccess(info)) {
        console.log('purchase_completed_from_scan');
        router.back();
        return;
      }
      Alert.alert('Restore', 'Purchases were restored if this account had any.');
    } catch (e) {
      Alert.alert('Restore failed', purchasesErrorMessage(e));
    } finally {
      setRcBusy(false);
    }
  }, [isNativeStoreSupported, restorePurchases, load, isScanLockedSource]);

  const showContinueSpinner =
    rcBusy && selectedAppPlan === 'unlimited' && !hasKidlensUnlimited && isNativeStoreSupported;
  const visibleLastError = lastError && !isMissingRevenueCatApiKeyMessage(lastError) ? lastError : null;
  const scanLockedHeroTitle =
    childAgeYears == null
      ? 'This product may not be ideal for your child'
      : `This product may not be ideal for a ${childAgeYears}-year-old`;
  const activeUnlimitedEntitlement = customerInfo?.entitlements.active[KIDLENS_UNLIMITED_ENTITLEMENT_ID] ?? null;
  const detectedCurrentPlan = detectBillingPlan(activeUnlimitedEntitlement?.productIdentifier);
  const subscriptionDate = formatSubscriptionDate(activeUnlimitedEntitlement?.expirationDate);
  const subscriptionDateLabel = activeUnlimitedEntitlement?.willRenew === false ? 'Expires on' : 'Renews on';

  useEffect(() => {
    if (lastError && isMissingRevenueCatApiKeyMessage(lastError)) {
      console.warn('[paywall] RevenueCat API key is missing; hiding setup warning from UI.');
    }
  }, [lastError]);

  if (hasKidlensUnlimited) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: M.bgPage }} edges={['top', 'left', 'right']}>
        <StatusBar style="dark" />
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: horizontalPadding,
            paddingTop: 12,
            paddingBottom: Math.max(32, insets.bottom + 20),
          }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={{ marginTop: 16, fontSize: 30, lineHeight: 36, color: M.text, fontWeight: '700' }}>
            Your subscription
          </Text>

          <View
            style={{
              marginTop: 18,
              paddingVertical: 18,
              paddingHorizontal: 18,
              borderRadius: M.r20,
              backgroundColor: M.sageWash,
              borderWidth: 1,
              borderColor: M.lineSage,
              ...M.shadowSoft,
            }}
          >
            <Text style={{ fontSize: 20, lineHeight: 27, color: M.text, fontWeight: '800' }}>Unlimited access</Text>
            <View style={{ marginTop: 16, gap: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 14 }}>
                <Text style={{ flex: 1, fontSize: 15, lineHeight: 21, color: M.textBody, fontWeight: '700' }}>Current plan</Text>
                <Text style={{ flexShrink: 1, fontSize: 15, lineHeight: 21, color: M.text, fontWeight: '800', textAlign: 'right' }}>
                  {detectedCurrentPlan ?? 'Active'}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 14 }}>
                <Text style={{ flex: 1, fontSize: 15, lineHeight: 21, color: M.textBody, fontWeight: '700' }}>
                  {subscriptionDate ? subscriptionDateLabel : 'Status'}
                </Text>
                <Text style={{ flexShrink: 1, fontSize: 15, lineHeight: 21, color: M.text, fontWeight: '800', textAlign: 'right' }}>
                  {subscriptionDate ?? 'Active'}
                </Text>
              </View>
            </View>
          </View>

          {isNativeStoreSupported ? (
            <>
              <Pressable
                onPress={() => router.push('/customer-center' as Href)}
                disabled={rcBusy}
                style={{
                  marginTop: 22,
                  backgroundColor: rcBusy ? M.textSoft : M.inkButton,
                  borderRadius: M.r16,
                  paddingVertical: 16,
                  alignItems: 'center',
                  ...(!rcBusy ? M.shadowSoft : {}),
                }}
              >
                <Text style={{ color: M.cream, fontSize: 17, fontWeight: '700' }}>Manage subscription</Text>
              </Pressable>

              <Pressable
                onPress={() => void onRestorePurchases()}
                disabled={rcBusy}
                style={{ marginTop: 14, paddingVertical: 12, alignItems: 'center' }}
              >
                <Text style={{ fontSize: 15, fontWeight: '700', color: M.textMuted }}>Restore purchases</Text>
              </Pressable>
            </>
          ) : null}

          <Pressable onPress={goBack} style={{ marginTop: 10, paddingVertical: 14, alignItems: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: M.textBody }}>Back</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: M.bgPage }} edges={['top', 'left', 'right']}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: horizontalPadding,
          paddingTop: 4,
          paddingBottom: Math.max(32, insets.bottom + 20),
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={goBack}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            alignSelf: 'flex-start',
            paddingVertical: 8,
            paddingRight: 12,
            marginBottom: 8,
          }}
        >
          <Text style={{ fontSize: 17, color: M.textMuted, fontWeight: '700', marginRight: 6 }}>←</Text>
          <Text style={{ fontSize: 16, color: M.textMuted, fontWeight: '600' }}>{t('common.back', lang)}</Text>
        </Pressable>

        <Text style={{ fontSize: isNarrowAndroid ? 27 : 30, lineHeight: isNarrowAndroid ? 33 : 36, color: M.text, fontWeight: '700' }}>
          {isScanLockedSource ? '🔍 Barcode detected' : 'Upgrade to Unlimited'}
        </Text>
        {isScanLockedSource ? (
          <Text style={{ marginTop: 8, fontSize: 16, lineHeight: 23, color: M.textBody, fontWeight: '700' }}>
            {"You've used your free scans for today"}
          </Text>
        ) : null}
        {isScanLockedSource ? (
          <>
            <View
              style={{
                marginTop: 14,
                paddingVertical: 16,
                paddingHorizontal: 18,
                borderRadius: M.r20,
                backgroundColor: '#FFF4D8',
                borderWidth: 1,
                borderColor: '#E8C989',
                ...M.shadowSoft,
              }}
            >
              <View
                style={{
                  alignSelf: 'flex-start',
                  borderRadius: 999,
                  backgroundColor: M.gold,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: '800', color: M.cream, letterSpacing: 0.4 }}>ANALYSIS READY</Text>
              </View>
              <Text style={{ marginTop: 12, fontSize: 20, lineHeight: 27, color: M.text, fontWeight: '800' }}>
                {scanLockedHeroTitle}
              </Text>
              <Text style={{ marginTop: 6, fontSize: 15, lineHeight: 22, color: M.textBody, fontWeight: '700' }}>
                Contains ingredients some parents try to avoid.
              </Text>
            </View>

            <View
              style={{
                marginTop: 12,
                paddingVertical: 16,
                paddingHorizontal: 18,
                borderRadius: M.r20,
                backgroundColor: '#FCEAEA',
                borderWidth: 1,
                borderColor: '#E8C7C7',
                ...M.shadowSoft,
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: '800', color: M.text }}>What we detected</Text>
              <View style={{ marginTop: 14, gap: 10 }}>
              {scanLockedPreview.map((line) => (
                <Text key={line} style={{ fontSize: 15, lineHeight: 22, color: M.text, fontWeight: '800' }}>
                  {line}
                </Text>
              ))}
              </View>
            </View>

            <View
              style={{
                marginTop: 12,
                paddingVertical: 16,
                paddingHorizontal: 18,
                borderRadius: M.r20,
                backgroundColor: M.sageWash,
                borderWidth: 1,
                borderColor: M.lineSage,
                ...M.shadowSoft,
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: '800', color: M.text }}>Unlock full analysis</Text>
              <Text style={{ marginTop: 10, fontSize: 15, lineHeight: 22, color: M.textBody, fontWeight: '700' }}>
                {"See if it's safe before you give it to your child"}
              </Text>

              <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: M.line }}>
                <View
                  style={{
                    alignSelf: 'flex-start',
                    borderRadius: 999,
                    backgroundColor: M.sageDeep,
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    marginBottom: 10,
                  }}
                >
                  <Text style={{ fontSize: 11, fontWeight: '800', color: M.cream, letterSpacing: 0.4 }}>3 DAYS FREE</Text>
                </View>
                <View style={{ gap: 8 }}>
                  <Text style={{ fontSize: 14, lineHeight: 20, color: M.textBody, fontWeight: '700' }}>{scanLockedOffer[0]}</Text>
                  <Text style={{ fontSize: 14, lineHeight: 20, color: M.textMuted, fontWeight: '700' }}>{scanLockedOffer[1]}</Text>
                </View>
              </View>
            </View>
          </>
        ) : (
          <>
            <Text style={{ marginTop: 10, fontSize: 16, lineHeight: 24, color: M.textBody }}>
              Scan without limits. Get instant ingredient analysis personalized for your child.
            </Text>
            <Text style={{ marginTop: 10, fontSize: 17, lineHeight: 24, color: M.sageDeep, fontWeight: '800' }}>
              Start with a 3-day free trial
            </Text>

            <View
              style={{
                marginTop: 22,
                paddingVertical: 16,
                paddingHorizontal: 18,
                borderRadius: M.r20,
                backgroundColor: M.bgCardMuted,
                borderWidth: 1,
                borderColor: M.line,
                ...M.shadowSoft,
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: '800', color: M.text }}>Everything you need</Text>
              <View style={{ marginTop: 16, gap: 12 }}>
                {upgradeBenefits.map((item) => (
                  <View key={item.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                    <View
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 999,
                        backgroundColor: item.bg,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Text style={{ fontSize: 16, fontWeight: '800', color: M.sageDeep }}>{item.icon}</Text>
                    </View>
                    <Text style={{ flex: 1, minWidth: 0, fontSize: 16, lineHeight: 23, color: M.textBody, fontWeight: '700' }}>
                      {item.label}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            <View
              style={{
                marginTop: 14,
                paddingVertical: 16,
                paddingHorizontal: 18,
                borderRadius: M.r20,
                backgroundColor: M.sageWash,
                borderWidth: 1,
                borderColor: M.lineSage,
                ...M.shadowSoft,
              }}
            >
              <View
                style={{
                  alignSelf: 'flex-start',
                  borderRadius: 999,
                  backgroundColor: M.sageDeep,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  marginBottom: 12,
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: '800', color: M.cream, letterSpacing: 0.4 }}>3 DAYS FREE</Text>
              </View>
              <Text style={{ fontSize: 16, fontWeight: '800', color: M.text }}>Start free today</Text>
              <View style={{ marginTop: 16, gap: 12 }}>
                <Text style={{ fontSize: 15, lineHeight: 22, color: M.sageDeep, fontWeight: '700' }}>{upgradeOffer[0]}</Text>
                <Text style={{ fontSize: 15, lineHeight: 22, color: M.textMuted, fontWeight: '700' }}>{upgradeOffer[1]}</Text>
              </View>
            </View>
          </>
        )}

        <View style={{ marginTop: 18, gap: 10 }}>
          <Text style={{ fontSize: 15, fontWeight: '800', color: M.text }}>Choose your plan</Text>
          <View style={{ gap: 8 }}>
            {billingPlanOptions.map((option) => {
              const isSelected = selectedPlan === option.type;
              return (
                <Pressable
                  key={option.type}
                  onPress={() => setSelectedPlan(option.type)}
                  disabled={rcBusy}
                  style={{
                    borderRadius: M.r16,
                    borderWidth: isSelected ? 2 : 1,
                    borderColor: isSelected ? M.sageDeep : M.line,
                    backgroundColor: isSelected ? M.sageWash : M.bgCard,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    ...(isSelected ? M.shadowSoft : {}),
                  }}
                >
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 999,
                      borderWidth: 2,
                      borderColor: isSelected ? M.sageDeep : M.lineStrong,
                      backgroundColor: isSelected ? M.sageDeep : M.bgCard,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {isSelected ? <Text style={{ fontSize: 13, color: M.cream, fontWeight: '900' }}>✓</Text> : null}
                  </View>

                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                      <Text style={{ fontSize: 16, lineHeight: 21, fontWeight: '800', color: M.text }}>{option.title}</Text>
                      {option.badge ? (
                        <View
                          style={{
                            borderRadius: 999,
                            backgroundColor: M.sageDeep,
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                          }}
                        >
                          <Text style={{ fontSize: 10, lineHeight: 14, fontWeight: '800', color: M.cream, letterSpacing: 0.35 }}>
                            {option.badge}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <Text style={{ marginTop: 4, fontSize: 13, lineHeight: 18, fontWeight: '700', color: M.textMuted }}>
                      {option.subtext}
                    </Text>
                  </View>

                  <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>
                    <Text style={{ fontSize: isNarrowAndroid ? 14 : 15, lineHeight: 20, fontWeight: '800', color: M.textBody, textAlign: 'right' }}>
                      {option.price}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Pressable
          onPress={() => void onContinue()}
          disabled={continueDisabled || rcBusy}
          style={{
            marginTop: 18,
            backgroundColor: continueDisabled || rcBusy ? M.textSoft : M.inkButton,
            borderRadius: M.r16,
            paddingVertical: 16,
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'center',
            gap: 10,
            ...(!continueDisabled && !rcBusy ? M.shadowSoft : {}),
          }}
        >
          {showContinueSpinner ? <ActivityIndicator color={M.cream} /> : null}
          <Text style={{ flexShrink: 1, color: M.cream, fontSize: 17, lineHeight: 22, fontWeight: '700', textAlign: 'center' }}>
            {showContinueSpinner ? 'Starting trial...' : 'Start Free Trial — No Charge Today'}
          </Text>
        </Pressable>

        {visibleLastError ? (
          <Text style={{ marginTop: 10, fontSize: 13, lineHeight: 18, color: '#A94442', textAlign: 'center' }}>{visibleLastError}</Text>
        ) : null}

        {isNativeStoreSupported ? (
          <Pressable
            onPress={() => void onRestorePurchases()}
            disabled={rcBusy}
            style={{ marginTop: 14, paddingVertical: 10, alignItems: 'center' }}
          >
            <Text style={{ fontSize: 14, fontWeight: '600', color: M.textMuted }}>Restore purchases</Text>
          </Pressable>
        ) : null}

        {hasKidlensUnlimited && isNativeStoreSupported ? (
          <Pressable
            onPress={() => router.push('/customer-center' as Href)}
            disabled={rcBusy}
            style={{ marginTop: 4, paddingVertical: 10, alignItems: 'center' }}
          >
            <Text style={{ fontSize: 14, fontWeight: '600', color: M.textMuted }}>Manage subscription</Text>
          </Pressable>
        ) : null}

        <Pressable onPress={goBack} style={{ marginTop: 12, paddingVertical: 14, alignItems: 'center' }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: M.textBody }}>{t('pay.maybeLater', lang)}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
