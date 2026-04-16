import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { formatIngredientNameForLang, polishIngredientNote } from '../lib/ingredientDisplay';
import { getAppLanguage, humanizePreferenceMatchLine, t } from '../lib/i18n';
import { localizeResultLine } from '../lib/localizeScanText';
import type { AvoidPreference, Plan } from '../types/preferences';
import type { RecentScan } from '../types/scan';
import { selectDistinctDisplayReasons } from '../lib/scanResultAntiRepeat';
import { VerdictBadge } from './VerdictBadge';
type ResultTab = 'general' | 'ingredients';

type RowUi = { key: string; name: string; note: string };

function IngredientSection({
  title,
  rows,
  accent,
  isFirst,
}: {
  title: string;
  rows: RowUi[];
  accent: string;
  isFirst: boolean;
}) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <View style={{ marginTop: isFirst ? 14 : 24 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 }}>
        <View style={{ width: 3, height: 17, borderRadius: 2, backgroundColor: accent }} />
        <Text style={{ fontSize: 15, fontWeight: '800', color: '#2A241C', letterSpacing: 0.2 }}>{title}</Text>
      </View>
      <View
        style={{
          backgroundColor: '#F4EFE6',
          borderRadius: 16,
          paddingVertical: 15,
          paddingHorizontal: 14,
          borderWidth: 1,
          borderColor: '#E4D9CC',
          borderLeftWidth: 3,
          borderLeftColor: accent,
        }}
      >
        <View style={{ gap: 18 }}>
          {rows.map((row) => (
            <View key={row.key}>
              <Text style={{ fontSize: 16, fontWeight: '800', color: '#1F1A16', letterSpacing: 0.15 }}>{row.name}</Text>
              <Text style={{ marginTop: 7, fontSize: 13, lineHeight: 20, color: '#6A5F52' }}>{row.note}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

type ScanResultModalProps = {
  visible: boolean;
  scan: RecentScan | null;
  childAge?: number | null;
  plan: Plan;
  avoidPreferences: AvoidPreference[];
  isFavorited: boolean;
  favoriteLoading: boolean;
  onFavoritePress: () => void;
  onClose: () => void;
  onScanAgain: () => void;
  onOpenPaywall: () => void;
  reuseNotice?: string | null;
};

export function ScanResultModal({
  visible,
  scan,
  childAge = null,
  plan,
  avoidPreferences,
  isFavorited,
  favoriteLoading,
  onFavoritePress,
  onClose,
  onScanAgain,
  onOpenPaywall: _onOpenPaywall,
  reuseNotice,
}: ScanResultModalProps) {
  const lang = getAppLanguage();
  const [tab, setTab] = useState<ResultTab>('general');

  useEffect(() => {
    setTab('general');
  }, [scan?.id]);

  const preferenceLines = scan?.preferenceMatches?.filter(Boolean) ?? [];
  const showAvoidSection = preferenceLines.length > 0;
  const locLine = (s: string) => localizeResultLine(s, lang);
  const displayReasons = scan
    ? selectDistinctDisplayReasons({
        mode: 'advanced',
        summary: scan.summary ?? '',
        preferenceLines,
        avoidPreferenceIds: avoidPreferences,
        reasons: scan.reasons ?? [],
        nutritionLines: [],
      }).map(locLine)
    : [];

  const whyText = scan ? locLine(String(scan.whyThisMatters ?? scan.whyText ?? '').trim()) : '';
  const parentText = scan?.parentTakeaway ? locLine(scan.parentTakeaway) : '';

  const ingredientPack = useMemo(() => {
    if (!scan) {
      return { kind: 'fallback' as const };
    }
    if (!scan.ingredientPanel) {
      console.warn('[IngredientsPanel][render]', 'mode=fallback (no valid ingredientPanel on scan)');
      return { kind: 'fallback' as const };
    }
    const { good, neutral, redFlags } = scan.ingredientPanel;
    const toRows = (arr: { name: string; note: string }[], prefix: string): RowUi[] =>
      arr.map((e, i) => ({
        key: `${prefix}-${i}`,
        name: formatIngredientNameForLang(e.name, lang),
        note: polishIngredientNote(e.note, lang),
      }));
    console.warn('[IngredientsPanel][render]', 'mode=structured-ai');
    return {
      kind: 'structured' as const,
      good: toRows(good, 'g'),
      neutral: toRows(neutral, 'n'),
      red: toRows(redFlags, 'r'),
    };
  }, [scan, lang]);

  const favoriteDisabled = favoriteLoading || !scan;
  const isUnknownNotFound =
    scan != null &&
    scan.verdict === 'unknown' &&
    String(scan.productName ?? '').trim() === 'Unknown product';

  const tabBtn = (id: ResultTab, label: string) => (
    <Pressable
      key={id}
      onPress={() => setTab(id)}
      style={{
        flex: 1,
        paddingVertical: 10,
        borderRadius: 11,
        backgroundColor: tab === id ? '#FFFDF8' : 'transparent',
      }}
    >
      <Text
        style={{
          textAlign: 'center',
          fontSize: 13,
          fontWeight: '700',
          color: tab === id ? '#1F1A16' : '#7A6E61',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      {...(Platform.OS === 'ios' ? { presentationStyle: 'overFullScreen' as const } : {})}
      onRequestClose={onClose}
    >
      <View
        pointerEvents="box-none"
        style={{
          flex: 1,
          backgroundColor: 'rgba(23, 18, 12, 0.44)',
          justifyContent: 'center',
          paddingHorizontal: 20,
        }}
      >
        <View
          style={{
            borderRadius: 24,
            backgroundColor: '#FFFDF8',
            maxHeight: '88%',
            overflow: 'hidden',
            shadowColor: '#000',
            shadowOpacity: 0.15,
            shadowRadius: 22,
            shadowOffset: { width: 0, height: 10 },
            elevation: 5,
          }}
        >
          {scan?.imageUrl ? (
            <Image
              source={{ uri: scan.imageUrl }}
              style={{ width: '100%', height: 168, backgroundColor: '#F0E8DC' }}
              contentFit="contain"
            />
          ) : null}

          <ScrollView
            style={{ maxHeight: scan?.imageUrl ? undefined : '100%' }}
            contentContainerStyle={{ padding: 20, paddingBottom: 22 }}
            keyboardShouldPersistTaps="handled"
          >
            {isUnknownNotFound ? (
              <>
                <Text style={{ fontSize: 13, color: '#8C7B6A', fontWeight: '600' }}>{t('common.scanResult', lang)}</Text>
                <Text
                  style={{
                    marginTop: 14,
                    fontSize: 26,
                    lineHeight: 32,
                    color: '#1F1A16',
                    fontWeight: '700',
                  }}
                >
                  {t('result.unknownProduct', lang)}
                </Text>
                <Text style={{ marginTop: 12, fontSize: 15, lineHeight: 22, color: '#5D5246' }}>
                  {t('result.unknownBarcode', lang)}
                </Text>
                <Text style={{ marginTop: 14, fontSize: 13, color: '#817363' }}>
                  {t('result.barcodeLabel', lang)} {scan?.barcode ?? '-'}
                </Text>
                <View style={{ marginTop: 24, flexDirection: 'row', gap: 10 }}>
                  <Pressable
                    onPress={onClose}
                    style={{
                      flex: 1,
                      borderRadius: 14,
                      backgroundColor: '#EEE4D7',
                      alignItems: 'center',
                      paddingVertical: 13,
                    }}
                  >
                    <Text style={{ fontSize: 15, fontWeight: '700', color: '#5B4A38' }}>{t('common.close', lang)}</Text>
                  </Pressable>
                  <Pressable
                    onPress={onScanAgain}
                    style={{
                      flex: 1,
                      borderRadius: 14,
                      backgroundColor: '#2C251F',
                      alignItems: 'center',
                      paddingVertical: 13,
                    }}
                  >
                    <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFDF9' }}>{t('result.scanAgain', lang)}</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={{ fontSize: 13, color: '#8C7B6A', fontWeight: '600' }}>{t('common.scanResult', lang)}</Text>
                {reuseNotice ? (
                  <View
                    style={{
                      marginTop: 10,
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                      borderRadius: 12,
                      backgroundColor: '#F4EDE3',
                      borderWidth: 1,
                      borderColor: '#E4D9CC',
                    }}
                  >
                    <Text style={{ fontSize: 12, color: '#7A6B5E', fontWeight: '600', textAlign: 'center' }}>
                      {reuseNotice}
                    </Text>
                  </View>
                ) : null}
                <View
                  style={{
                    marginTop: 8,
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 14,
                  }}
                >
                  <Text
                    style={{
                      flex: 1,
                      fontSize: 25,
                      lineHeight: 30,
                      color: '#1F1A16',
                      fontWeight: '700',
                    }}
                  >
                    {scan?.productName ?? t('common.product', lang)}
                  </Text>
                  {scan ? (
                    <Pressable
                      onPress={onFavoritePress}
                      disabled={favoriteDisabled}
                      accessibilityRole="button"
                      accessibilityLabel={
                        plan === 'unlimited'
                          ? isFavorited
                            ? t('result.a11y.removeFav', lang)
                            : t('result.a11y.addFav', lang)
                          : t('result.a11y.favLocked', lang)
                      }
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: 14,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: plan === 'unlimited' && isFavorited ? '#F8EDED' : '#F5F0E8',
                        borderWidth: 1,
                        borderColor: plan === 'unlimited' && isFavorited ? '#E8C4C4' : '#E6DDD4',
                        opacity: favoriteDisabled ? 0.5 : 1,
                      }}
                    >
                      <Ionicons
                        name={plan === 'unlimited' && isFavorited ? 'heart' : 'heart-outline'}
                        size={22}
                        color={plan !== 'unlimited' ? '#B59B7A' : isFavorited ? '#B85C5C' : '#6D6053'}
                      />
                    </Pressable>
                  ) : null}
                </View>
                {!!scan?.brand && (
                  <Text style={{ marginTop: 6, fontSize: 15, color: '#6D6053', fontWeight: '600' }}>{scan.brand}</Text>
                )}
                <Text style={{ marginTop: 8, fontSize: 13, color: '#817363' }}>
                  {t('result.barcodeLabel', lang)} {scan?.barcode ?? '-'}
                </Text>

                <View
                  style={{
                    marginTop: 14,
                    flexDirection: 'row',
                    backgroundColor: '#EDE6DD',
                    borderRadius: 14,
                    padding: 3,
                    borderWidth: 1,
                    borderColor: '#E4D9CC',
                  }}
                >
                  {tabBtn('general', t('result.tab.general', lang))}
                  {tabBtn('ingredients', t('result.tab.ingredients', lang))}
                </View>

                {tab === 'general' ? (
                  <>
                    {scan ? (
                      <View style={{ marginTop: 12 }}>
                        <VerdictBadge verdict={scan.verdict} />
                      </View>
                    ) : null}

                    <Text style={{ marginTop: 10, fontSize: 15, lineHeight: 22, color: '#4F453B' }}>
                      {scan?.summary ? locLine(scan.summary) : ''}
                    </Text>

                    {showAvoidSection ? (
                      <View
                        style={{
                          marginTop: 10,
                          paddingVertical: 14,
                          paddingHorizontal: 14,
                          borderRadius: 14,
                          backgroundColor: '#F7EFE3',
                          borderWidth: 1,
                          borderColor: '#E2D0B8',
                          borderLeftWidth: 4,
                          borderLeftColor: '#C9A06E',
                          gap: 8,
                        }}
                      >
                        <Text style={{ fontSize: 14, fontWeight: '800', color: '#4A3828', letterSpacing: 0.2 }}>
                          {t('result.matchesAvoid', lang)}
                        </Text>
                        {preferenceLines.map((line, index) => (
                          <Text
                            key={`${line}-${index}`}
                            style={{ fontSize: 14, color: '#5C4A38', lineHeight: 20, fontWeight: '600' }}
                          >
                            • {locLine(humanizePreferenceMatchLine(line, lang))}
                          </Text>
                        ))}
                      </View>
                    ) : null}

                    <View style={{ marginTop: showAvoidSection ? 12 : 14, gap: 8 }}>
                      {displayReasons.map((reason, index) => (
                        <Text key={`${reason}-${index}`} style={{ fontSize: 14, color: '#5D5246', lineHeight: 20 }}>
                          • {reason}
                        </Text>
                      ))}
                    </View>

                    {whyText ? (
                      <View style={{ marginTop: 16 }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#6B5C4A' }}>{t('result.whyMatters', lang)}</Text>
                        <Text style={{ marginTop: 6, fontSize: 14, lineHeight: 21, color: '#5D5246' }}>{whyText}</Text>
                      </View>
                    ) : null}

                    {parentText ? (
                      <View style={{ marginTop: 16 }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#7D6B58' }}>{t('result.parentTakeaway', lang)}</Text>
                        <Text style={{ marginTop: 6, fontSize: 14, lineHeight: 21, color: '#5D5246' }}>{parentText}</Text>
                      </View>
                    ) : null}
                  </>
                ) : (
                  <View style={{ marginTop: 14, paddingBottom: 6 }}>
                    <Text style={{ fontSize: 16, fontWeight: '800', color: '#1F1A16', marginBottom: 2 }}>
                      {t('result.ingredients.heading', lang)}
                    </Text>
                    {ingredientPack.kind === 'fallback' ? (
                      <Text style={{ marginTop: 12, fontSize: 14, lineHeight: 21, color: '#5D5246' }}>
                        {t('result.ingredients.failBreakdown', lang)}
                      </Text>
                    ) : (
                      <>
                        <IngredientSection
                          title={t('result.ingredients.good', lang)}
                          rows={ingredientPack.good}
                          accent="#2F6F4B"
                          isFirst
                        />
                        <IngredientSection
                          title={t('result.ingredients.neutral', lang)}
                          rows={ingredientPack.neutral}
                          accent="#6B5C4A"
                          isFirst={ingredientPack.good.length === 0}
                        />
                        <IngredientSection
                          title={t('result.ingredients.red', lang)}
                          rows={ingredientPack.red}
                          accent="#8B3A3A"
                          isFirst={ingredientPack.good.length === 0 && ingredientPack.neutral.length === 0}
                        />
                      </>
                    )}
                    {ingredientPack.kind === 'structured' && scan?.allergensText?.trim() ? (
                      <View
                        style={{
                          marginTop: 16,
                          paddingTop: 14,
                          borderTopWidth: 1,
                          borderTopColor: '#E8DFD4',
                        }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#6B5C4A' }}>
                          {t('ing.footer.allergens', lang)}
                        </Text>
                        <Text style={{ marginTop: 6, fontSize: 13, lineHeight: 19, color: '#5D5246' }}>
                          {scan.allergensText.trim()}
                        </Text>
                      </View>
                    ) : null}
                    {ingredientPack.kind === 'structured' &&
                    scan?.rawJson &&
                    typeof scan.rawJson.traces === 'string' &&
                    scan.rawJson.traces.trim() ? (
                      <View style={{ marginTop: 12 }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#6B5C4A' }}>
                          {t('ing.footer.traces', lang)}
                        </Text>
                        <Text style={{ marginTop: 6, fontSize: 13, lineHeight: 19, color: '#5D5246' }}>
                          {String(scan.rawJson.traces).trim()}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                )}

                <View style={{ marginTop: 20, flexDirection: 'row', gap: 10 }}>
                  <Pressable
                    onPress={onClose}
                    style={{
                      flex: 1,
                      borderRadius: 14,
                      backgroundColor: '#EEE4D7',
                      alignItems: 'center',
                      paddingVertical: 13,
                    }}
                  >
                    <Text style={{ fontSize: 15, fontWeight: '700', color: '#5B4A38' }}>{t('common.close', lang)}</Text>
                  </Pressable>
                  <Pressable
                    onPress={onScanAgain}
                    style={{
                      flex: 1,
                      borderRadius: 14,
                      backgroundColor: '#2C251F',
                      alignItems: 'center',
                      paddingVertical: 13,
                    }}
                  >
                    <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFDF9' }}>{t('result.scanAgain', lang)}</Text>
                  </Pressable>
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
