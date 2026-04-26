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

  const freeFeatures = useMemo(
    () => [
      t('pay.feat.daily2', lang),
      t('pay.feat.less', lang),
      t('pay.feat.more', lang),
      t('pay.feat.ai', lang),
      t('pay.feat.products', lang),
    ],
    [lang],
  );
  const unlimitedFeatures = useMemo(() => [t('pay.feat.unlimScans', lang), t('pay.feat.favorites', lang)], [lang]);
  const comingFeatures = useMemo(
    () => [t('pay.coming.f1', lang), t('pay.coming.f2', lang), t('pay.coming.f3', lang)],
    [lang],
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

  const onComingSoonPress = useCallback(() => {
    Alert.alert(t('alert.coming.title', lang), t('alert.coming.msg', lang));
  }, [lang]);

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

  const freeSelected = selectedPlan === 'free';
  const unlimitedSelected = selectedPlan === 'unlimited';
  const showContinueSpinner =
    rcBusy && selectedPlan === 'unlimited' && !hasMamaScanUnlimited && isNativeStoreSupported;

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
          {isScanLockedSource ? '🔍 Barcode detected' : t('pay.title', lang)}
        </Text>
        <Text style={{ marginTop: 10, fontSize: 16, lineHeight: 24, color: M.textBody }}>
          {isScanLockedSource ? 'We found something. Unlock the full analysis now.' : t('pay.subtitle', lang)}
        </Text>

        {isScanLockedSource ? (
          <View
            style={{
              marginTop: 16,
              paddingVertical: 14,
              paddingHorizontal: 16,
              borderRadius: M.r16,
              backgroundColor: M.bgCard,
              borderWidth: 1,
              borderColor: M.gold,
              gap: 8,
              ...M.shadowSoft,
            }}
          >
            {['3-day free trial', '$9.99/month after', 'Cancel anytime'].map((line) => (
              <Text key={line} style={{ fontSize: 15, lineHeight: 22, color: M.textBody, fontWeight: '700' }}>
                • {line}
              </Text>
            ))}
          </View>
        ) : null}

        <View
          style={{
            marginTop: 20,
            paddingVertical: 14,
            paddingHorizontal: 16,
            borderRadius: M.r16,
            backgroundColor: M.sageWash,
            borderWidth: 1,
            borderColor: M.lineSage,
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: '700', color: M.sageDeep }}>
            {t('pay.current', lang)}{' '}
            {isEffectivelyUnlimited ? t('pay.planUnlimited', lang) : t('pay.planFree', lang)}
          </Text>
          <Text style={{ marginTop: 6, fontSize: 13, color: M.sage, lineHeight: 18 }}>{t('pay.switchHint', lang)}</Text>
        </View>

        <View style={{ marginTop: 24, gap: 14 }}>
          <Pressable
            onPress={() => setSelectedPlan('free')}
            style={{
              backgroundColor: M.bgCard,
              borderRadius: M.r22,
              padding: 20,
              borderWidth: 2,
              borderColor: freeSelected ? M.gold : M.line,
              ...(freeSelected ? M.shadowCard : { ...M.shadowSoft, shadowOpacity: 0.06, elevation: 1 }),
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={{ fontSize: 22, fontWeight: '800', color: M.text }}>{t('pay.free.title', lang)}</Text>
                <Text style={{ marginTop: 6, fontSize: 15, lineHeight: 22, color: M.textMuted }}>{t('pay.free.sub', lang)}</Text>
              </View>
              {isEffectivelyFree ? (
                <View
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 999,
                    backgroundColor: M.sageWash,
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: M.sageDeep }}>{t('pay.badge.current', lang)}</Text>
                </View>
              ) : null}
            </View>
            <View style={{ marginTop: 16, gap: 8 }}>
              {freeFeatures.map((f) => (
                <Text key={f} style={{ fontSize: 15, lineHeight: 22, color: M.textBody, fontWeight: '600' }}>
                  • {f}
                </Text>
              ))}
            </View>
          </Pressable>

          <Pressable
            onPress={() => setSelectedPlan('unlimited')}
            style={{
              backgroundColor: M.bgCard,
              borderRadius: M.r22,
              padding: 20,
              borderWidth: 2,
              borderColor: unlimitedSelected ? M.gold : M.line,
              ...(unlimitedSelected ? M.shadowCard : { ...M.shadowSoft, shadowOpacity: 0.06, elevation: 1 }),
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={{ fontSize: 22, fontWeight: '800', color: M.text }}>{t('pay.unlimited.title', lang)}</Text>
                <Text style={{ marginTop: 6, fontSize: 15, lineHeight: 22, color: M.textMuted }}>
                  {t('pay.unlimited.sub', lang)}
                </Text>
              </View>
              {isEffectivelyUnlimited ? (
                <View
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 999,
                    backgroundColor: M.sageWash,
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: M.sageDeep }}>{t('pay.badge.current', lang)}</Text>
                </View>
              ) : null}
            </View>
            <View style={{ marginTop: 16, gap: 8 }}>
              {unlimitedFeatures.map((f) => (
                <Text key={f} style={{ fontSize: 15, lineHeight: 22, color: M.textBody, fontWeight: '600' }}>
                  • {f}
                </Text>
              ))}
            </View>
          </Pressable>

          <Pressable
            onPress={onComingSoonPress}
            style={{
              backgroundColor: M.bgCardMuted,
              borderRadius: M.r22,
              padding: 20,
              borderWidth: 1,
              borderColor: M.line,
              opacity: 0.92,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={{ fontSize: 22, fontWeight: '800', color: M.textSoft }}>{t('pay.coming.title', lang)}</Text>
                <Text style={{ marginTop: 6, fontSize: 15, lineHeight: 22, color: M.textSoft }}>{t('pay.coming.sub', lang)}</Text>
              </View>
              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 999,
                  backgroundColor: M.bgChipSelected,
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: '700', color: M.textMuted }}>{t('pay.coming.badge', lang)}</Text>
              </View>
            </View>
            <View style={{ marginTop: 16, gap: 8 }}>
              {comingFeatures.map((f) => (
                <Text key={f} style={{ fontSize: 15, lineHeight: 22, color: M.textSoft, fontWeight: '600' }}>
                  • {f}
                </Text>
              ))}
            </View>
          </Pressable>
        </View>

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
            {continueDisabled ? t('pay.currentSelection', lang) : t('pay.continue', lang)}
          </Text>
        </Pressable>

        {lastError ? (
          <Text style={{ marginTop: 10, fontSize: 13, lineHeight: 18, color: '#A94442', textAlign: 'center' }}>{lastError}</Text>
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
