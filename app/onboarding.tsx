import { StatusBar } from 'expo-status-bar';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { avoidLabel, getAppLanguage, t } from '../src/lib/i18n';
import { setAvoidPreferences, setOnboardingCompleted, setResultStyle, syncRemotePreferencesWithLocal } from '../src/lib/storage';
import { AVOID_PREFERENCE_IDS, type AvoidPreference } from '../src/types/preferences';

const totalSteps = 3;

export default function OnboardingScreen() {
  const lang = getAppLanguage();
  const [step, setStep] = useState(0);
  const [avoidPreferences, setAvoidPreferencesState] = useState<AvoidPreference[]>([]);
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const isFirstStepMount = useRef(true);

  const introSlides = [
    {
      title: t('onboard.slide1.title', lang),
      subtitle: t('onboard.slide1.sub', lang),
    },
    {
      title: t('onboard.slide2.title', lang),
      subtitle: t('onboard.slide2.sub', lang),
    },
  ];

  const isIntroStep = step < introSlides.length;
  const isAvoidStep = step === introSlides.length;
  const slide = isIntroStep ? introSlides[step] : null;

  useEffect(() => {
    if (isFirstStepMount.current) {
      isFirstStepMount.current = false;
      return;
    }
    contentOpacity.setValue(0);
    Animated.timing(contentOpacity, {
      toValue: 1,
      duration: 240,
      useNativeDriver: true,
    }).start();
  }, [step, contentOpacity]);

  const finishOnboarding = async () => {
    await setResultStyle('quick');
    await setAvoidPreferences(avoidPreferences);
    await setOnboardingCompleted(true);
    await syncRemotePreferencesWithLocal();
    router.replace('/age');
  };

  const onNext = async () => {
    if (step >= totalSteps - 1) {
      await finishOnboarding();
      return;
    }
    setStep((current) => current + 1);
  };

  const onBack = () => {
    if (step > 0) {
      setStep((current) => current - 1);
    }
  };

  const onSkipTop = async () => {
    await setResultStyle('quick');
    await setAvoidPreferences([]);
    await setOnboardingCompleted(true);
    await syncRemotePreferencesWithLocal();
    router.replace('/age');
  };

  const toggleAvoidPreference = (id: AvoidPreference) => {
    setAvoidPreferencesState((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const isFinalStep = step === totalSteps - 1;
  const showSkip = step < introSlides.length;

  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: '#F6F1E8',
        paddingHorizontal: 24,
        paddingTop: 8,
        paddingBottom: 20,
      }}
      edges={['top', 'left', 'right']}
    >
      <StatusBar style="dark" />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: 44,
          marginBottom: 8,
        }}
      >
        {step > 0 ? (
          <Pressable
            onPress={onBack}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingRight: 12 }}
          >
            <Text style={{ fontSize: 17, color: '#6D6053', fontWeight: '700', marginRight: 6 }}>←</Text>
            <Text style={{ fontSize: 16, color: '#6D6053', fontWeight: '600' }}>{t('common.back', lang)}</Text>
          </Pressable>
        ) : (
          <View style={{ width: 72 }} />
        )}
        {showSkip ? (
          <Pressable onPress={onSkipTop} hitSlop={8}>
            <Text style={{ fontSize: 16, color: '#8A7E70', fontWeight: '600' }}>{t('common.skip', lang)}</Text>
          </Pressable>
        ) : (
          <View style={{ width: 72 }} />
        )}
      </View>

      <Animated.View style={{ flex: 1, opacity: contentOpacity, justifyContent: 'center' }}>
        {isIntroStep && slide ? (
          <View
            style={{
              backgroundColor: '#FFFDF8',
              borderRadius: 28,
              padding: 28,
              shadowColor: '#9B8D7A',
              shadowOpacity: 0.12,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 8 },
              elevation: 3,
            }}
          >
            <Text style={{ fontSize: 34, lineHeight: 42, color: '#1F1A16', fontWeight: '700' }}>
              {slide.title}
            </Text>
            <Text
              style={{
                marginTop: 16,
                fontSize: 17,
                lineHeight: 25,
                color: '#5F554A',
              }}
            >
              {slide.subtitle}
            </Text>
          </View>
        ) : null}

        {isAvoidStep ? (
          <View
            style={{
              backgroundColor: '#FFFDF8',
              borderRadius: 28,
              padding: 22,
              shadowColor: '#9B8D7A',
              shadowOpacity: 0.12,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 8 },
              elevation: 3,
            }}
          >
            <Text style={{ fontSize: 30, lineHeight: 37, color: '#1F1A16', fontWeight: '700' }}>
              {t('onboard.avoid.title', lang)}
            </Text>
            <Text style={{ marginTop: 10, fontSize: 16, lineHeight: 23, color: '#5F554A' }}>
              {t('onboard.avoid.sub', lang)}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
              {AVOID_PREFERENCE_IDS.map((id) => {
                const selected = avoidPreferences.includes(id);
                return (
                  <Pressable
                    key={id}
                    onPress={() => toggleAvoidPreference(id)}
                    style={{
                      paddingVertical: 10,
                      paddingHorizontal: 13,
                      borderRadius: 999,
                      backgroundColor: selected ? '#EEE2D4' : '#FAF6EF',
                      borderWidth: 1,
                      borderColor: selected ? '#D8C3AA' : '#E7DDCF',
                    }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: '600', color: '#3A3128' }}>{avoidLabel(id, lang)}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable onPress={() => setAvoidPreferencesState([])} style={{ marginTop: 16, alignSelf: 'flex-start' }}>
              <Text style={{ fontSize: 14, color: '#8A7E70', fontWeight: '600' }}>{t('onboard.avoid.skip', lang)}</Text>
            </Pressable>
          </View>
        ) : null}
      </Animated.View>

      <View style={{ alignItems: 'center', paddingTop: 8 }}>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 28 }}>
          {Array.from({ length: totalSteps }).map((_, index) => (
            <View
              key={String(index)}
              style={{
                width: index === step ? 20 : 8,
                height: 8,
                borderRadius: 999,
                backgroundColor: index === step ? '#2C251F' : '#D8CCBD',
              }}
            />
          ))}
        </View>

        <Pressable
          onPress={onNext}
          style={{
            width: '100%',
            backgroundColor: '#2C251F',
            borderRadius: 16,
            paddingVertical: 16,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: '#FFFDF9', fontSize: 17, fontWeight: '700' }}>
            {isFinalStep ? t('common.continue', lang) : t('common.next', lang)}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
