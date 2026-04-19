import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { StatusBar } from 'expo-status-bar';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  formatLocalDateToIso,
  parseBirthdateToLocalNoon,
  resolveChildAgeProfile,
} from '../src/lib/childAgeContext';
import { avoidLabel, getAppLanguage, t } from '../src/lib/i18n';
import {
  getAvoidPreferences,
  getChildAge,
  getChildBirthdate,
  pushSupabasePreferencesFromLocal,
  setAvoidPreferences,
  setChildAge,
  setChildBirthdate,
  waitUntilPreferencesSyncIdle,
} from '../src/lib/storage';
import { AVOID_PREFERENCE_OPTIONS, type AvoidPreference } from '../src/types/preferences';

function defaultDobDate(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 2);
  return d;
}

function minDobDate(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 16);
  return d;
}

export default function PreferencesScreen() {
  const lang = getAppLanguage();
  const [ready, setReady] = useState(false);
  const [dob, setDob] = useState(defaultDobDate);
  const [iosPickerOpen, setIosPickerOpen] = useState(false);
  const [avoidList, setAvoidList] = useState<AvoidPreference[]>([]);
  const [saving, setSaving] = useState(false);

  const profilePreview = useMemo(() => resolveChildAgeProfile(formatLocalDateToIso(dob), null), [dob]);

  const load = useCallback(async () => {
    const [storedBd, storedLegacy, avoids] = await Promise.all([getChildBirthdate(), getChildAge(), getAvoidPreferences()]);
    let next = defaultDobDate();
    if (storedBd) {
      const parsed = parseBirthdateToLocalNoon(storedBd);
      if (parsed) {
        next = parsed;
      }
    } else if (storedLegacy != null && Number.isFinite(storedLegacy)) {
      const d = new Date();
      d.setFullYear(d.getFullYear() - Math.min(16, Math.max(0, Math.round(storedLegacy))));
      next = d;
    }
    setDob(next);
    setAvoidList(avoids);
    console.warn('[planDebug][preferences] load', { storedBd: !!storedBd, storedLegacy, avoids });
    setReady(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const openPicker = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: dob,
        onChange: (_e, date) => {
          if (date) {
            setDob(date);
          }
        },
        mode: 'date',
        maximumDate: new Date(),
        minimumDate: minDobDate(),
      });
      return;
    }
    setIosPickerOpen(true);
  };

  const toggleAvoid = (id: AvoidPreference) => {
    setAvoidList((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const iso = formatLocalDateToIso(dob);
      const ref = new Date();
      const parsedIso = parseBirthdateToLocalNoon(iso);
      if (!parsedIso || parsedIso.getTime() > ref.getTime()) {
        return;
      }
      console.warn('[prefsDebug] onSave before', { iso, avoidList });
      await setChildBirthdate(iso);
      const p = resolveChildAgeProfile(iso, null, ref);
      await setChildAge(p.completedWholeYears);
      await setAvoidPreferences(avoidList);
      await pushSupabasePreferencesFromLocal();
      await waitUntilPreferencesSyncIdle();
      console.warn('[prefsDebug] onSave after pushSupabasePreferencesFromLocal', 'push completed');
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
          <Text style={{ fontSize: 16, color: '#6D6053', fontWeight: '600' }}>{t('common.back', lang)}</Text>
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
          <Text style={{ fontSize: 16, color: '#6D6053', fontWeight: '600' }}>{t('common.back', lang)}</Text>
        </Pressable>
        <Text style={{ fontSize: 28, lineHeight: 34, fontWeight: '700', color: '#1F1A16' }}>{t('prefs.title', lang)}</Text>
        <Text style={{ marginTop: 8, fontSize: 15, lineHeight: 22, color: '#6D6053' }}>
          {t('prefs.subtitle', lang)}
        </Text>

        <View style={{ marginTop: 28 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#1F1A16' }}>{t('prefs.childBirthdate', lang)}</Text>
          <Text style={{ marginTop: 6, fontSize: 14, lineHeight: 20, color: '#7A6E61' }}>{t('prefs.childBirthdateHelp', lang)}</Text>
          <Pressable
            onPress={openPicker}
            style={{
              marginTop: 14,
              backgroundColor: '#FFFDF8',
              borderRadius: 20,
              paddingVertical: 18,
              paddingHorizontal: 16,
              borderWidth: 1,
              borderColor: '#E8DFD4',
              shadowColor: '#9B8D7A',
              shadowOpacity: 0.08,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 4 },
              elevation: 2,
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#1F1A16' }}>{formatLocalDateToIso(dob)}</Text>
            <Text style={{ marginTop: 6, fontSize: 14, color: '#7A6E61' }}>{t('age.tapToChange', lang)}</Text>
            <Text style={{ marginTop: 10, fontSize: 14, color: '#5F554A', lineHeight: 20 }}>
              {t('prefs.childAgeNow', lang, { label: profilePreview.ageDisplayLabel })}
            </Text>
          </Pressable>
        </View>

        {iosPickerOpen && Platform.OS === 'ios' ? (
          <View
            style={{
              marginTop: 16,
              backgroundColor: '#FFFDF8',
              borderRadius: 16,
              paddingBottom: 8,
              borderWidth: 1,
              borderColor: '#E8DFD4',
            }}
          >
            <DateTimePicker
              value={dob}
              mode="date"
              display="spinner"
              themeVariant="light"
              onChange={(_e, date) => {
                if (date) {
                  setDob(date);
                }
              }}
              maximumDate={new Date()}
              minimumDate={minDobDate()}
            />
            <Pressable
              onPress={() => setIosPickerOpen(false)}
              style={{ alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 20 }}
            >
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#2C251F' }}>{t('age.datePickerDone', lang)}</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={{ marginTop: 32 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#1F1A16' }}>{t('prefs.avoidList', lang)}</Text>
          <Text style={{ marginTop: 6, fontSize: 14, lineHeight: 20, color: '#7A6E61' }}>{t('prefs.avoidHelp', lang)}</Text>
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
                  <Text style={{ fontSize: 14, fontWeight: '600', color: selected ? '#3D3429' : '#5F554A' }}>
                    {avoidLabel(item.id, lang)}
                  </Text>
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
          <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFDF9' }}>
            {saving ? t('prefs.saving', lang) : t('prefs.save', lang)}
          </Text>
        </Pressable>

        <Pressable onPress={onCancel} disabled={saving} style={{ marginTop: 16, paddingVertical: 12, alignItems: 'center' }}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: '#8A7E70' }}>{t('common.cancel', lang)}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
