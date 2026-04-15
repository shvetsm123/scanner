import { StatusBar } from 'expo-status-bar';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getAppLanguage, t } from '../src/lib/i18n';
import { getPlan, getResultStyle, setPlan } from '../src/lib/storage';
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
  const params = useLocalSearchParams<{ plan?: string | string[] }>();
  const [currentPlan, setCurrentPlan] = useState<Plan>('free');
  const [selectedPlan, setSelectedPlan] = useState<Plan>('unlimited');

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

  const goBack = () => {
    router.back();
  };

  const onContinue = async () => {
    console.warn('[planDebug][paywall] before setPlan', { selectedPlan, currentPlan });
    await setPlan(selectedPlan);
    const nextPlan = await getPlan();
    const nextStyle = await getResultStyle();
    console.warn('[planDebug][paywall] after setPlan', { nextPlan, nextStyle });
    router.back();
  };

  const continueDisabled = currentPlan === selectedPlan;

  const onComingSoonPress = useCallback(() => {
    Alert.alert(t('alert.coming.title', lang), t('alert.coming.msg', lang));
  }, [lang]);

  const freeSelected = selectedPlan === 'free';
  const unlimitedSelected = selectedPlan === 'unlimited';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F6F1E8' }} edges={['top', 'left', 'right']}>
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
          <Text style={{ fontSize: 17, color: '#6D6053', fontWeight: '700', marginRight: 6 }}>←</Text>
          <Text style={{ fontSize: 16, color: '#6D6053', fontWeight: '600' }}>{t('common.back', lang)}</Text>
        </Pressable>

        <Text style={{ fontSize: 30, lineHeight: 36, color: '#1F1A16', fontWeight: '700' }}>{t('pay.title', lang)}</Text>
        <Text style={{ marginTop: 10, fontSize: 16, lineHeight: 24, color: '#5F554A' }}>{t('pay.subtitle', lang)}</Text>

        <View
          style={{
            marginTop: 20,
            paddingVertical: 14,
            paddingHorizontal: 16,
            borderRadius: 16,
            backgroundColor: '#E8EFE8',
            borderWidth: 1,
            borderColor: '#C5D4C5',
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: '700', color: '#3D5A40' }}>
            {t('pay.current', lang)}{' '}
            {currentPlan === 'free' ? t('pay.planFree', lang) : t('pay.planUnlimited', lang)}
          </Text>
          <Text style={{ marginTop: 6, fontSize: 13, color: '#5A6B5A', lineHeight: 18 }}>{t('pay.switchHint', lang)}</Text>
        </View>

        <View style={{ marginTop: 24, gap: 14 }}>
          <Pressable
            onPress={() => setSelectedPlan('free')}
            style={{
              backgroundColor: '#FFFDF8',
              borderRadius: 22,
              padding: 20,
              borderWidth: 2,
              borderColor: freeSelected ? '#C9A06E' : '#E8DFD4',
              shadowColor: '#9B8D7A',
              shadowOpacity: freeSelected ? 0.14 : 0.06,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 6 },
              elevation: freeSelected ? 4 : 1,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={{ fontSize: 22, fontWeight: '800', color: '#1F1A16' }}>{t('pay.free.title', lang)}</Text>
                <Text style={{ marginTop: 6, fontSize: 15, lineHeight: 22, color: '#6D6053' }}>{t('pay.free.sub', lang)}</Text>
              </View>
              {currentPlan === 'free' ? (
                <View
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 999,
                    backgroundColor: '#E8EFE8',
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#3D5A40' }}>{t('pay.badge.current', lang)}</Text>
                </View>
              ) : null}
            </View>
            <View style={{ marginTop: 16, gap: 8 }}>
              {freeFeatures.map((f) => (
                <Text key={f} style={{ fontSize: 15, lineHeight: 22, color: '#4F453B', fontWeight: '600' }}>
                  • {f}
                </Text>
              ))}
            </View>
          </Pressable>

          <Pressable
            onPress={() => setSelectedPlan('unlimited')}
            style={{
              backgroundColor: '#FFFDF8',
              borderRadius: 22,
              padding: 20,
              borderWidth: 2,
              borderColor: unlimitedSelected ? '#C9A06E' : '#E8DFD4',
              shadowColor: '#9B8D7A',
              shadowOpacity: unlimitedSelected ? 0.14 : 0.06,
              shadowRadius: 16,
              shadowOffset: { width: 0, height: 6 },
              elevation: unlimitedSelected ? 4 : 1,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={{ fontSize: 22, fontWeight: '800', color: '#1F1A16' }}>{t('pay.unlimited.title', lang)}</Text>
                <Text style={{ marginTop: 6, fontSize: 15, lineHeight: 22, color: '#6D6053' }}>
                  {t('pay.unlimited.sub', lang)}
                </Text>
              </View>
              {currentPlan === 'unlimited' ? (
                <View
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 5,
                    borderRadius: 999,
                    backgroundColor: '#E8EFE8',
                  }}
                >
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#3D5A40' }}>{t('pay.badge.current', lang)}</Text>
                </View>
              ) : null}
            </View>
            <View style={{ marginTop: 16, gap: 8 }}>
              {unlimitedFeatures.map((f) => (
                <Text key={f} style={{ fontSize: 15, lineHeight: 22, color: '#4F453B', fontWeight: '600' }}>
                  • {f}
                </Text>
              ))}
            </View>
          </Pressable>

          <Pressable
            onPress={onComingSoonPress}
            style={{
              backgroundColor: '#F3EEEA',
              borderRadius: 22,
              padding: 20,
              borderWidth: 1,
              borderColor: '#DED5CC',
              opacity: 0.92,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={{ fontSize: 22, fontWeight: '800', color: '#8A7E70' }}>{t('pay.coming.title', lang)}</Text>
                <Text style={{ marginTop: 6, fontSize: 15, lineHeight: 22, color: '#9A8E82' }}>{t('pay.coming.sub', lang)}</Text>
              </View>
              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 999,
                  backgroundColor: '#E8E2DC',
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#7A6E61' }}>{t('pay.coming.badge', lang)}</Text>
              </View>
            </View>
            <View style={{ marginTop: 16, gap: 8 }}>
              {comingFeatures.map((f) => (
                <Text key={f} style={{ fontSize: 15, lineHeight: 22, color: '#958676', fontWeight: '600' }}>
                  • {f}
                </Text>
              ))}
            </View>
          </Pressable>
        </View>

        <Pressable
          onPress={onContinue}
          disabled={continueDisabled}
          style={{
            marginTop: 28,
            backgroundColor: continueDisabled ? '#A89888' : '#2C251F',
            borderRadius: 16,
            paddingVertical: 16,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: '#FFFDF9', fontSize: 17, fontWeight: '700' }}>
            {continueDisabled ? t('pay.currentSelection', lang) : t('pay.continue', lang)}
          </Text>
        </Pressable>

        <Pressable onPress={goBack} style={{ marginTop: 12, paddingVertical: 14, alignItems: 'center' }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#5F554A' }}>{t('pay.maybeLater', lang)}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
