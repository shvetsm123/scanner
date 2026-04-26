import { StatusBar } from 'expo-status-bar';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PAYWALL_RESULT } from 'react-native-purchases-ui';

import { M } from '../constants/mamaTheme';
import { getAppLanguage, t } from '../src/lib/i18n';
import { hasMamaScanUnlimitedAccess } from '../src/lib/revenuecat/entitlements';
import { purchasesErrorMessage } from '../src/lib/revenuecat/revenueCatService';
import { getPlan, setPlan } from '../src/lib/storage';
import { useRevenueCat } from '../src/providers/RevenueCatProvider';
import type { Plan } from '../src/types/preferences';

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

export default function PaywallScreen() {
  const lang = getAppLanguage();
  const params = useLocalSearchParams<{ plan?: string | string[]; source?: string | string[] }>();
  const source = Array.isArray(params.source) ? params.source[0] : params.source;
  const isScanLockedSource = source === 'scan_locked';
  const [currentPlan, setCurrentPlan] = useState<Plan>('free');
  const [selectedPlan, setSelectedPlan] = useState<Plan>('unlimited');
  const [rcBusy, setRcBusy] = useState(false);
  const {
    isNativeStoreSupported,
    presentPaywall,
    restorePurchases,
    refreshCustomerInfo,
    lastError,
    hasMamaScanUnlimited,
  } = useRevenueCat();

  const isEffectivelyUnlimited = hasMamaScanUnlimited || currentPlan === 'unlimited';
  const isEffectivelyFree = !isEffectivelyUnlimited;

  const upgradeBenefits = useMemo(
    () => [
      'Unlimited scans',
      'Full ingredient analysis',
      'Kid-safe recommendations',
      'Personalized by age',
      'Save favorite products',
    ],
    [],
  );
  const upgradeOffer = useMemo(() => ['3-day free trial', 'Then $9.99/month', 'Cancel anytime'], []);
  const scanLockedBenefits = useMemo(
    () => ['Sugar safety level', 'Hidden additives explained', 'Is it safe for your child?', 'Personalized by age'],
    [],
  );
  const scanLockedOffer = useMemo(() => ['3-day free trial', 'Then $9.99/month', 'Cancel anytime'], []);
  const scanLockedPreview = useMemo(
    () => [
      '⚠️ High sugar level detected',
      '⚠️ Contains additives some parents avoid',
      "Unlock full analysis to see if it's safe for your child",
    ],
    [],
  );

  const load = useCallback(async () => {
    const p = await getPlan();
    setCurrentPlan(p);
    const fromRoute = parsePlanQueryParam(params.plan);
    if (fromRoute === 'unlimited') {
      setSelectedPlan('unlimited');
    } else if (fromRoute === 'free') {
      setSelectedPlan('free');
    } else if (p === 'unlimited') {
      setSelectedPlan('unlimited');
    } else {
      setSelectedPlan('unlimited');
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
    (selectedPlan === 'free' && currentPlan === 'free' && isEffectivelyFree) ||
    (selectedPlan === 'unlimited' && hasMamaScanUnlimited && currentPlan === 'unlimited');

  const onContinue = async () => {
    if (selectedPlan === 'free') {
      await setPlan('free');
      void refreshCustomerInfo();
      router.back();
      return;
    }

    if (hasMamaScanUnlimited) {
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
      const result = await presentPaywall();
      await refreshCustomerInfo();
      if (result === PAYWALL_RESULT.PURCHASED || result === PAYWALL_RESULT.RESTORED) {
        if (isScanLockedSource) {
          console.log('purchase_completed_from_scan');
        }
        router.back();
      }
    } catch (e) {
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
      if (isScanLockedSource && hasMamaScanUnlimitedAccess(info)) {
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
    rcBusy && selectedPlan === 'unlimited' && !hasMamaScanUnlimited && isNativeStoreSupported;
  const visibleLastError = lastError && !isMissingRevenueCatApiKeyMessage(lastError) ? lastError : null;

  useEffect(() => {
    if (lastError && isMissingRevenueCatApiKeyMessage(lastError)) {
      console.warn('[paywall] RevenueCat API key is missing; hiding setup warning from UI.');
    }
  }, [lastError]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: M.bgPage }} edges={['top', 'left', 'right']}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: 4,
          paddingBottom: 32,
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

        <Text style={{ fontSize: 30, lineHeight: 36, color: M.text, fontWeight: '700' }}>
          {isScanLockedSource ? '🔍 Barcode detected' : 'Upgrade to Unlimited'}
        </Text>
        {isScanLockedSource ? (
          <>
            <Text style={{ marginTop: 14, fontSize: 20, lineHeight: 28, color: M.text, fontWeight: '800' }}>
              ⚠️ This product may not be ideal for toddlers
            </Text>
            <Text style={{ marginTop: 6, fontSize: 15, lineHeight: 22, color: M.textMuted, fontWeight: '700' }}>
              Contains ingredients some parents try to avoid
            </Text>
            <Text style={{ marginTop: 10, fontSize: 16, lineHeight: 24, color: M.textBody }}>
              {"You've used your free scans for today. Unlock the full analysis to see what matters for your child."}
            </Text>

            <View
              style={{
                marginTop: 22,
                padding: 20,
                borderRadius: M.r22,
                backgroundColor: M.bgCard,
                borderWidth: 1,
                borderColor: M.gold,
                ...M.shadowCard,
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '800', color: M.textMuted }}>{"What you'll unlock:"}</Text>
              <View style={{ marginTop: 14, gap: 9 }}>
                {scanLockedBenefits.map((line) => (
                  <Text key={line} style={{ fontSize: 16, lineHeight: 23, color: M.textBody, fontWeight: '700' }}>
                    • {line}
                  </Text>
                ))}
              </View>

              <View style={{ marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: M.line, gap: 8 }}>
                {scanLockedOffer.map((line) => (
                  <Text key={line} style={{ fontSize: 16, lineHeight: 23, color: M.text, fontWeight: '800' }}>
                    • {line}
                  </Text>
                ))}
              </View>
            </View>

            <View
              style={{
                marginTop: 16,
                padding: 16,
                borderRadius: M.r16,
                backgroundColor: M.sageWash,
                borderWidth: 1,
                borderColor: M.lineSage,
                gap: 8,
              }}
            >
              {scanLockedPreview.map((line) => (
                <Text key={line} style={{ fontSize: 15, lineHeight: 22, color: M.text, fontWeight: '800' }}>
                  {line}
                </Text>
              ))}
            </View>
          </>
        ) : (
          <>
            <Text style={{ marginTop: 10, fontSize: 16, lineHeight: 24, color: M.textBody }}>
              Scan without limits. Get instant ingredient analysis personalized for your child.
            </Text>

            <View
              style={{
                marginTop: 22,
                padding: 20,
                borderRadius: M.r22,
                backgroundColor: M.bgCard,
                borderWidth: 1,
                borderColor: M.gold,
                ...M.shadowCard,
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '800', color: M.textMuted }}>Unlimited includes</Text>
              <View style={{ marginTop: 14, gap: 9 }}>
                {upgradeBenefits.map((line) => (
                  <Text key={line} style={{ fontSize: 16, lineHeight: 23, color: M.textBody, fontWeight: '700' }}>
                    • {line}
                  </Text>
                ))}
              </View>

              <View style={{ marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: M.line, gap: 8 }}>
                {upgradeOffer.map((line) => (
                  <Text key={line} style={{ fontSize: 16, lineHeight: 23, color: M.text, fontWeight: '800' }}>
                    • {line}
                  </Text>
                ))}
              </View>
            </View>
          </>
        )}

        {isScanLockedSource ? (
          <Text style={{ marginTop: 20, fontSize: 13, lineHeight: 18, color: M.textMuted, textAlign: 'center', fontWeight: '700' }}>
            Trusted by thousands of parents
          </Text>
        ) : null}

        {isScanLockedSource ? (
          <Text style={{ marginTop: 8, fontSize: 14, lineHeight: 20, color: M.textBody, textAlign: 'center', fontWeight: '700' }}>
            Start your free trial to see the full result
          </Text>
        ) : null}

        <Pressable
          onPress={() => void onContinue()}
          disabled={continueDisabled || rcBusy}
          style={{
            marginTop: 28,
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
          <Text style={{ color: M.cream, fontSize: 17, fontWeight: '700' }}>
            {continueDisabled ? t('pay.currentSelection', lang) : 'Start Free Trial'}
          </Text>
        </Pressable>

        {isScanLockedSource ? (
          <Text style={{ marginTop: 8, fontSize: 13, lineHeight: 18, color: M.textMuted, textAlign: 'center', fontWeight: '700' }}>
            No charge today
          </Text>
        ) : null}

        {!isScanLockedSource ? (
          <Text style={{ marginTop: 8, fontSize: 13, lineHeight: 18, color: M.textMuted, textAlign: 'center', fontWeight: '700' }}>
            No charge today
          </Text>
        ) : null}

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

        {hasMamaScanUnlimited && isNativeStoreSupported ? (
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
