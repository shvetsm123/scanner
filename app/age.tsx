import { StatusBar } from 'expo-status-bar';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getAppLanguage, t } from '../src/lib/i18n';
import { getChildAge, pushSupabasePreferencesFromLocal, setChildAge } from '../src/lib/storage';

const MIN_AGE = 1;
const MAX_AGE = 16;
const DEFAULT_AGE = 4;

export default function AgeScreen() {
  const lang = getAppLanguage();
  const { edit } = useLocalSearchParams<{ edit?: string | string[] }>();
  const editFlag = Array.isArray(edit) ? edit[0] : edit;
  const isEdit = editFlag === '1' || editFlag === 'true';

  const [age, setAge] = useState(DEFAULT_AGE);

  useEffect(() => {
    let active = true;
    (async () => {
      const stored = await getChildAge();
      if (active && stored !== null) {
        setAge(Math.min(MAX_AGE, Math.max(MIN_AGE, stored)));
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const onSubmit = async () => {
    await setChildAge(age);
    await pushSupabasePreferencesFromLocal();
    if (isEdit) {
      router.back();
    } else {
      router.replace('/home');
    }
  };

  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: '#F6F1E8',
        paddingHorizontal: 24,
        paddingVertical: 24,
        justifyContent: 'space-between',
      }}
      edges={['top', 'left', 'right']}
    >
      <StatusBar style="dark" />
      <View>
        {isEdit ? (
          <Pressable
            onPress={() => router.back()}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginBottom: 20,
              alignSelf: 'flex-start',
              paddingVertical: 8,
              paddingRight: 12,
            }}
          >
            <Text style={{ fontSize: 17, color: '#6D6053', fontWeight: '700', marginRight: 6 }}>←</Text>
            <Text style={{ fontSize: 16, color: '#6D6053', fontWeight: '600' }}>{t('common.back', lang)}</Text>
          </Pressable>
        ) : null}
        <Text style={{ fontSize: 34, lineHeight: 42, color: '#1F1A16', fontWeight: '700' }}>{t('age.title', lang)}</Text>
        <Text style={{ marginTop: 12, fontSize: 17, lineHeight: 25, color: '#5F554A' }}>{t('age.subtitle', lang)}</Text>
      </View>

      <View
        style={{
          backgroundColor: '#FFFDF8',
          borderRadius: 24,
          paddingHorizontal: 20,
          paddingVertical: 24,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          shadowColor: '#9B8D7A',
          shadowOpacity: 0.12,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
          elevation: 3,
        }}
      >
        <Pressable
          onPress={() => setAge((current) => Math.max(MIN_AGE, current - 1))}
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#EFE4D8',
          }}
        >
          <Text style={{ fontSize: 30, color: '#2D261F' }}>−</Text>
        </Pressable>

        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontSize: 42, fontWeight: '700', color: '#1F1A16' }}>{age}</Text>
          <Text style={{ marginTop: 4, color: '#7B6F61', fontSize: 13 }}>{t('age.yearsOld', lang)}</Text>
        </View>

        <Pressable
          onPress={() => setAge((current) => Math.min(MAX_AGE, current + 1))}
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#EFE4D8',
          }}
        >
          <Text style={{ fontSize: 30, color: '#2D261F' }}>+</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={onSubmit}
        style={{
          width: '100%',
          backgroundColor: '#2C251F',
          borderRadius: 16,
          paddingVertical: 16,
          alignItems: 'center',
        }}
      >
        <Text style={{ color: '#FFFDF9', fontSize: 17, fontWeight: '700' }}>
          {isEdit ? t('common.save', lang) : t('common.continue', lang)}
        </Text>
      </Pressable>
    </SafeAreaView>
  );
}
