import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { StatusBar } from 'expo-status-bar';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { M } from '../constants/mamaTheme';
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
        style={{ flex: 1, backgroundColor: M.bgPage, paddingHorizontal: 20, paddingTop: 4 }}
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
          <Text style={{ fontSize: 17, color: M.textMuted, fontWeight: '700', marginRight: 6 }}>←</Text>
          <Text style={{ fontSize: 16, color: M.textMuted, fontWeight: '600' }}>{t('common.back', lang)}</Text>
        </Pressable>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="small" color={M.textSoft} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: M.bgPage }} edges={['top', 'left', 'right']}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: 4,
          paddingBottom: 96,
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
          <Text style={{ fontSize: 17, color: M.textMuted, fontWeight: '700', marginRight: 6 }}>←</Text>
          <Text style={{ fontSize: 16, color: M.textMuted, fontWeight: '600' }}>{t('common.back', lang)}</Text>
        </Pressable>
        <Text style={{ fontSize: 30, lineHeight: 36, fontWeight: '700', color: M.text }}>Preferences</Text>
        <Text style={{ marginTop: 7, fontSize: 15, lineHeight: 21, color: M.textMuted }}>
          Personalize checks for your child
        </Text>

        <Pressable
          onPress={openPicker}
          style={{
            marginTop: 24,
            backgroundColor: M.bgCard,
            borderRadius: M.r20,
            paddingVertical: 18,
            paddingHorizontal: 18,
            borderWidth: 1,
            borderColor: M.line,
            ...M.shadowSoft,
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: '800', color: M.text }}>Child profile</Text>
          <View
            style={{
              marginTop: 14,
              backgroundColor: M.sageWash,
              borderRadius: M.r18,
              paddingVertical: 16,
              paddingHorizontal: 16,
              borderWidth: 1,
              borderColor: M.lineSage,
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: '800', color: M.textMuted }}>Date of birth</Text>
            <Text style={{ marginTop: 7, fontSize: 22, lineHeight: 28, fontWeight: '800', color: M.text }}>
              {formatLocalDateToIso(dob)}
            </Text>
            <Text style={{ marginTop: 6, fontSize: 15, color: M.textBody, lineHeight: 21, fontWeight: '700' }}>
              About {profilePreview.ageDisplayLabel} old
            </Text>
            <Text style={{ marginTop: 10, fontSize: 13, color: M.textMuted, lineHeight: 18 }}>
              Tap to edit
            </Text>
          </View>
          <Text style={{ marginTop: 12, fontSize: 13, color: M.textMuted, lineHeight: 19 }}>
            Used to tailor product safety analysis
          </Text>
        </Pressable>

        {iosPickerOpen && Platform.OS === 'ios' ? (
          <View
            style={{
              marginTop: 16,
              backgroundColor: M.bgCard,
              borderRadius: M.r16,
              paddingBottom: 8,
              borderWidth: 1,
              borderColor: M.line,
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
              <Text style={{ fontSize: 16, fontWeight: '700', color: M.ink }}>{t('age.datePickerDone', lang)}</Text>
            </Pressable>
          </View>
        ) : null}

        <View
          style={{
            marginTop: 18,
            backgroundColor: M.bgCard,
            borderRadius: M.r20,
            paddingVertical: 18,
            paddingHorizontal: 18,
            borderWidth: 1,
            borderColor: M.line,
            ...M.shadowSoft,
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: '800', color: M.text }}>Ingredients to avoid</Text>
          <Text style={{ marginTop: 7, fontSize: 14, lineHeight: 20, color: M.textMuted }}>
            Select what matters for your family
          </Text>
          <View style={{ marginTop: 18, flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 12 }}>
            {AVOID_PREFERENCE_OPTIONS.map((item) => {
              const selected = avoidList.includes(item.id);
              return (
                <Pressable
                  key={item.id}
                  onPress={() => toggleAvoid(item.id)}
                  style={{
                    minHeight: 44,
                    paddingVertical: 12,
                    paddingHorizontal: 15,
                    borderRadius: 999,
                    backgroundColor: selected ? '#FCEAEA' : M.bgChip,
                    borderWidth: 1,
                    borderColor: selected ? '#B65A5A' : M.line,
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 14, fontWeight: '700', color: selected ? '#7A2E2E' : M.textBody }}>
                    {selected ? '✕ ' : ''}
                    {avoidLabel(item.id, lang)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <Text style={{ marginTop: 18, fontSize: 13, lineHeight: 19, color: M.textMuted, textAlign: 'center' }}>
          You can update this anytime
        </Text>
      </ScrollView>
      <View
        style={{
          paddingHorizontal: 24,
          paddingTop: 12,
          paddingBottom: 18,
          backgroundColor: M.bgPage,
          borderTopWidth: 1,
          borderTopColor: M.line,
        }}
      >
        <Pressable
          onPress={onSave}
          disabled={saving}
          style={{
            borderRadius: M.r16,
            backgroundColor: saving ? M.textMuted : M.inkButton,
            paddingVertical: 16,
            alignItems: 'center',
            ...(!saving ? M.shadowSoft : {}),
          }}
        >
          <Text style={{ fontSize: 17, fontWeight: '700', color: M.cream }}>
            {saving ? t('prefs.saving', lang) : 'Save preferences'}
          </Text>
        </Pressable>

        <Pressable onPress={onCancel} disabled={saving} style={{ marginTop: 10, paddingVertical: 10, alignItems: 'center' }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: M.textSoft }}>{t('common.cancel', lang)}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
