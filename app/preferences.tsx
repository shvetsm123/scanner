import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  getAvoidPreferences,
  getChildAge,
  getPlan,
  getResultStyle,
  pushSupabasePreferencesFromLocal,
  setAvoidPreferences,
  setChildAge,
  setResultStyle,
} from '../src/lib/storage';
import {
  AVOID_PREFERENCE_OPTIONS,
  type AvoidPreference,
  type Plan,
  type ResultStyle,
} from '../src/types/preferences';

const MIN_AGE = 1;
const MAX_AGE = 16;
const DEFAULT_AGE = 4;

const RESULT_CARDS: { id: ResultStyle; title: string; body: string }[] = [
  { id: 'quick', title: 'Less info', body: 'Verdict, one-line summary, 3–5 fact bullets' },
  { id: 'advanced', title: 'More info', body: '5–8 bullets, nutrition, flags, full breakdown' },
];

export default function PreferencesScreen() {
  const [ready, setReady] = useState(false);
  const [age, setAge] = useState(DEFAULT_AGE);
  const [resultStyle, setResultStyleState] = useState<ResultStyle>('quick');
  const [avoidList, setAvoidList] = useState<AvoidPreference[]>([]);
  const [saving, setSaving] = useState(false);
  const [plan, setPlanUi] = useState<Plan>('free');

  const load = useCallback(async () => {
    const [storedAge, avoids] = await Promise.all([getChildAge(), getAvoidPreferences()]);
    const p = await getPlan();
    const style = await getResultStyle();
    if (storedAge !== null) {
      setAge(Math.min(MAX_AGE, Math.max(MIN_AGE, storedAge)));
    } else {
      setAge(DEFAULT_AGE);
    }
    setResultStyleState(style);
    setAvoidList(avoids);
    setPlanUi(p);
    console.warn('[planDebug][preferences] load', { plan: p, style, storedAge, avoids });
    setReady(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const bumpAge = (delta: number) => {
    setAge((a) => Math.min(MAX_AGE, Math.max(MIN_AGE, a + delta)));
  };

  const toggleAvoid = (id: AvoidPreference) => {
    setAvoidList((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const currentPlan = await getPlan();
      console.warn('[prefsDebug] onSave before', { age, avoidList, resultStyle, currentPlan });
      setPlanUi(currentPlan);
      await setChildAge(age);
      console.warn('[prefsDebug] onSave after setChildAge', { getChildAge: await getChildAge() });
      await setAvoidPreferences(avoidList);
      console.warn('[prefsDebug] onSave after setAvoidPreferences', {
        getAvoidPreferences: await getAvoidPreferences(),
      });
      const styleToSave: ResultStyle = currentPlan === 'free' ? 'quick' : resultStyle;
      await setResultStyle(styleToSave);
      const savedAge = await getChildAge();
      const savedAvoids = await getAvoidPreferences();
      const finalStyle = await getResultStyle();
      console.warn('[prefsDebug] onSave after setResultStyle', {
        savedAge,
        savedAvoids,
        finalStyle,
        styleToSave,
      });
      setResultStyleState(finalStyle);
      await pushSupabasePreferencesFromLocal();
      console.warn('[prefsDebug] onSave after pushSupabasePreferencesFromLocal', 'push completed');
      console.warn('[prefsDebug] onSave before router.back', {
        getChildAge: await getChildAge(),
        getAvoidPreferences: await getAvoidPreferences(),
        getResultStyle: await getResultStyle(),
      });
      router.back();
    } finally {
      setSaving(false);
    }
  };

  const onCancel = () => {
    router.back();
  };

  if (!ready) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: '#F6F1E8', paddingHorizontal: 20, paddingTop: 4 }}
        edges={['top', 'left', 'right']}
      >
        <StatusBar style="dark" />
        <Pressable
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            alignSelf: 'flex-start',
            paddingVertical: 8,
            paddingRight: 12,
            marginBottom: 24,
          }}
        >
          <Text style={{ fontSize: 17, color: '#6D6053', fontWeight: '700', marginRight: 6 }}>←</Text>
          <Text style={{ fontSize: 16, color: '#6D6053', fontWeight: '600' }}>Back</Text>
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="small" color="#8A7E70" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F6F1E8' }} edges={['top', 'left', 'right']}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 4,
          paddingBottom: 36,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          onPress={onCancel}
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
        <Text style={{ fontSize: 28, lineHeight: 34, fontWeight: '700', color: '#1F1A16' }}>Preferences</Text>
        <Text style={{ marginTop: 8, fontSize: 15, lineHeight: 22, color: '#6D6053' }}>
          Update how scans are tailored for your family
        </Text>

        <View style={{ marginTop: 28 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#1F1A16' }}>Child age</Text>
          <Text style={{ marginTop: 6, fontSize: 14, lineHeight: 20, color: '#7A6E61' }}>Used to adapt product checks</Text>
          <View
            style={{
              marginTop: 14,
              backgroundColor: '#FFFDF8',
              borderRadius: 20,
              paddingVertical: 18,
              paddingHorizontal: 16,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderWidth: 1,
              borderColor: '#E8DFD4',
              shadowColor: '#9B8D7A',
              shadowOpacity: 0.08,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 4 },
              elevation: 2,
            }}
          >
            <Pressable
              onPress={() => bumpAge(-1)}
              disabled={age <= MIN_AGE}
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                backgroundColor: age <= MIN_AGE ? '#EFE8DF' : '#EDE6DD',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 24, fontWeight: '700', color: age <= MIN_AGE ? '#C4B8A8' : '#2C251F' }}>−</Text>
            </Pressable>
            <Text style={{ fontSize: 32, fontWeight: '700', color: '#1F1A16' }}>{age}</Text>
            <Pressable
              onPress={() => bumpAge(1)}
              disabled={age >= MAX_AGE}
              style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                backgroundColor: age >= MAX_AGE ? '#EFE8DF' : '#EDE6DD',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 24, fontWeight: '700', color: age >= MAX_AGE ? '#C4B8A8' : '#2C251F' }}>+</Text>
            </Pressable>
          </View>
        </View>

        <View style={{ marginTop: 32 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#1F1A16' }}>Scan detail</Text>
          <Text style={{ marginTop: 6, fontSize: 14, lineHeight: 20, color: '#7A6E61' }}>
            {plan === 'free'
              ? 'Free uses Less info only · More info is included with Unlimited'
              : 'Unlimited: choose Less info or More info for each scan'}
          </Text>
          <View style={{ marginTop: 14, gap: 10 }}>
            {RESULT_CARDS.map((card) => {
              const selected = resultStyle === card.id;
              const advancedLocked = card.id === 'advanced' && plan !== 'unlimited';
              return (
                <Pressable
                  key={card.id}
                  onPress={() => {
                    console.warn('[planDebug][preferences] tap result style', {
                      tapped: card.id,
                      currentPlan: plan,
                      advancedLocked,
                      currentStyle: resultStyle,
                    });
                    if (advancedLocked) {
                      router.push({ pathname: '/paywall', params: { plan: 'unlimited' } });
                      return;
                    }
                    setResultStyleState(card.id);
                  }}
                  style={{
                    backgroundColor: advancedLocked ? '#FAF7F2' : '#FFFDF8',
                    borderRadius: 18,
                    paddingVertical: 16,
                    paddingHorizontal: 16,
                    borderWidth: 1,
                    borderColor: selected ? '#C9A06E' : advancedLocked ? '#E0D4C4' : '#E8DFD4',
                    shadowColor: '#9B8D7A',
                    shadowOpacity: selected ? 0.1 : 0.06,
                    shadowRadius: 12,
                    shadowOffset: { width: 0, height: 4 },
                    elevation: selected ? 3 : 1,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text
                      style={{
                        fontSize: 17,
                        fontWeight: '700',
                        color: advancedLocked ? '#7A6E61' : '#1F1A16',
                      }}
                    >
                      {card.title}
                    </Text>
                    {advancedLocked ? <Ionicons name="lock-closed-outline" size={20} color="#B59B7A" /> : null}
                  </View>
                  <Text style={{ marginTop: 6, fontSize: 14, lineHeight: 20, color: '#6D6053' }}>{card.body}</Text>
                  {advancedLocked ? (
                    <Text style={{ marginTop: 10, fontSize: 13, lineHeight: 18, color: '#9A8B7A', fontWeight: '600' }}>
                      Advanced info is included with Unlimited.
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={{ marginTop: 32 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#1F1A16' }}>Avoid list</Text>
          <Text style={{ marginTop: 6, fontSize: 14, lineHeight: 20, color: '#7A6E61' }}>Choose what matters for your family</Text>
          <View style={{ marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {AVOID_PREFERENCE_OPTIONS.map((item) => {
              const selected = avoidList.includes(item.id);
              return (
                <Pressable
                  key={item.id}
                  onPress={() => toggleAvoid(item.id)}
                  style={{
                    paddingVertical: 11,
                    paddingHorizontal: 14,
                    borderRadius: 999,
                    backgroundColor: selected ? '#F1E7D9' : '#FFFDF8',
                    borderWidth: 1,
                    borderColor: selected ? '#C9A06E' : '#E4D9CC',
                  }}
                >
                  <Text style={{ fontSize: 14, fontWeight: '600', color: selected ? '#3D3429' : '#5F554A' }}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Pressable
          onPress={onSave}
          disabled={saving}
          style={{
            marginTop: 36,
            borderRadius: 16,
            backgroundColor: saving ? '#4A4238' : '#2C251F',
            paddingVertical: 16,
            alignItems: 'center',
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFDF9' }}>{saving ? 'Saving…' : 'Save changes'}</Text>
        </Pressable>

        <Pressable onPress={onCancel} disabled={saving} style={{ marginTop: 16, paddingVertical: 12, alignItems: 'center' }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: '#8A7E70' }}>Cancel</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
