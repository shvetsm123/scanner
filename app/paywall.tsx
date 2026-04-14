import { StatusBar } from 'expo-status-bar';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getPlan, getResultStyle, setPlan } from '../src/lib/storage';
import type { Plan } from '../src/types/preferences';

type UnlimitedCardDef = {
  id: 'unlimited';
  title: string;
  subtitle: string;
  features: string[];
};

const UNLIMITED_CARD: UnlimitedCardDef = {
  id: 'unlimited',
  title: 'Unlimited',
  subtitle: 'Full scans and saved favorites',
  features: ['Unlimited scans', 'Less or More info', 'Favorites'],
};

const COMING_SOON_FEATURES = ['Discussions', 'Community features', 'More tools coming soon'];

function parsePlanQueryParam(raw: string | string[] | undefined): Plan | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === 'unlimited') {
    return 'unlimited';
  }
  // Legacy deep link / old builds — same paid tier as Unlimited today
  if (v === 'insights') {
    return 'unlimited';
  }
  return null;
}

export default function PaywallScreen() {
  const params = useLocalSearchParams<{ plan?: string | string[] }>();
  const [currentPlan, setCurrentPlan] = useState<Plan>('free');
  const [selectedPaid, setSelectedPaid] = useState<Plan>('unlimited');

  const load = useCallback(async () => {
    const p = await getPlan();
    setCurrentPlan(p);
    const fromRoute = parsePlanQueryParam(params.plan);
    if (fromRoute === 'unlimited') {
      setSelectedPaid('unlimited');
    } else if (p === 'unlimited') {
      setSelectedPaid('unlimited');
    } else {
      setSelectedPaid('unlimited');
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
    console.warn('[planDebug][paywall] before setPlan', { selectedPaid, currentPlan });
    await setPlan(selectedPaid);
    const nextPlan = await getPlan();
    const nextStyle = await getResultStyle();
    console.warn('[planDebug][paywall] after setPlan', { nextPlan, nextStyle });
    router.back();
  };

  const continueDisabled = currentPlan === selectedPaid;

  const onComingSoonPress = useCallback(() => {
    Alert.alert('Coming soon', 'This plan is not available yet.');
  }, []);

  const unlimitedSelected = selectedPaid === 'unlimited';

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
          <Text style={{ fontSize: 16, color: '#6D6053', fontWeight: '600' }}>Back</Text>
        </Pressable>

        <Text style={{ fontSize: 30, lineHeight: 36, color: '#1F1A16', fontWeight: '700' }}>Choose your plan</Text>
        <Text style={{ marginTop: 10, fontSize: 16, lineHeight: 24, color: '#5F554A' }}>
          Mock checkout — plans are stored on this device only.
        </Text>

        {currentPlan !== 'free' ? (
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
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#3D5A40' }}>Current plan: Unlimited</Text>
            <Text style={{ marginTop: 6, fontSize: 13, color: '#5A6B5A', lineHeight: 18 }}>
              You have full access. You can review your selection below.
            </Text>
          </View>
        ) : null}

        <View style={{ marginTop: 24, gap: 14 }}>
          <Pressable
            onPress={() => setSelectedPaid('unlimited')}
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
                <Text style={{ fontSize: 22, fontWeight: '800', color: '#1F1A16' }}>{UNLIMITED_CARD.title}</Text>
                <Text style={{ marginTop: 6, fontSize: 15, lineHeight: 22, color: '#6D6053' }}>{UNLIMITED_CARD.subtitle}</Text>
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
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#3D5A40' }}>Current</Text>
                </View>
              ) : null}
            </View>
            <View style={{ marginTop: 16, gap: 8 }}>
              {UNLIMITED_CARD.features.map((f) => (
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
                <Text style={{ fontSize: 22, fontWeight: '800', color: '#8A7E70' }}>Coming soon</Text>
                <Text style={{ marginTop: 6, fontSize: 15, lineHeight: 22, color: '#9A8E82' }}>Not available yet</Text>
              </View>
              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 999,
                  backgroundColor: '#E8E2DC',
                }}
              >
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#7A6E61' }}>SOON</Text>
              </View>
            </View>
            <View style={{ marginTop: 16, gap: 8 }}>
              {COMING_SOON_FEATURES.map((f) => (
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
            {continueDisabled ? 'Current selection' : 'Continue'}
          </Text>
        </Pressable>

        <Pressable onPress={goBack} style={{ marginTop: 12, paddingVertical: 14, alignItems: 'center' }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: '#5F554A' }}>Maybe later</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
