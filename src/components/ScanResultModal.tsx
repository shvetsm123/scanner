import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { getAppLanguage, humanizePreferenceMatchLine, t } from '../lib/i18n';
import { localizeResultLine } from '../lib/localizeScanText';
import type { AvoidPreference, Plan, ResultStyle } from '../types/preferences';
import type { RecentScan } from '../types/scan';
import { selectDistinctDisplayReasons } from '../lib/scanResultAntiRepeat';
import { resolvedGuidanceContextLines } from '../lib/officialGuidanceContext';
import { resolveUiResultStyle, resolvedNutritionSnapshotLinesForMode } from '../lib/resultStyleHelpers';
import { VerdictBadge } from './VerdictBadge';

type ScanResultModalProps = {
  visible: boolean;
  scan: RecentScan | null;
  resultStyle: ResultStyle;
  plan: Plan;
  avoidPreferences: AvoidPreference[];
  isFavorited: boolean;
  favoriteLoading: boolean;
  onFavoritePress: () => void;
  onClose: () => void;
  onScanAgain: () => void;
  onOpenPaywall: () => void;
  onSelectInfoLevel?: (level: ResultStyle) => void;
  reuseNotice?: string | null;
};

export function ScanResultModal({
  visible,
  scan,
  resultStyle,
  plan,
  avoidPreferences,
  isFavorited,
  favoriteLoading,
  onFavoritePress,
  onClose,
  onScanAgain,
  onOpenPaywall: _onOpenPaywall,
  onSelectInfoLevel,
  reuseNotice,
}: ScanResultModalProps) {
  const lang = getAppLanguage();
  const mode: ResultStyle = resolveUiResultStyle(plan, resultStyle);
  console.warn('[planDebug][resultModal] render', {
    plan,
    resultStyleProp: resultStyle,
    effectiveMode: mode,
    scanId: scan?.id,
    verdict: scan?.verdict,
  });
  const preferenceLines = scan?.preferenceMatches?.filter(Boolean) ?? [];
  const showAvoidSection = avoidPreferences.length > 0 && preferenceLines.length > 0;
  const nutritionLines = scan
    ? resolvedNutritionSnapshotLinesForMode(mode, scan.nutritionSnapshot, scan.nutriments, lang)
    : [];
  const flagLines = scan?.ingredientFlags?.filter((p) => typeof p === 'string' && p.trim()) ?? [];
  const locLine = (s: string) => localizeResultLine(s, lang);
  const displayReasons = scan
    ? selectDistinctDisplayReasons({
        mode,
        summary: scan.summary ?? '',
        preferenceLines,
        avoidPreferenceIds: avoidPreferences,
        reasons: scan.reasons ?? [],
        nutritionLines,
      }).map(locLine)
    : [];
  const guidanceLines = scan ? resolvedGuidanceContextLines(mode, scan, lang).map(locLine) : [];
  const ingredientParagraphs = (
    scan?.ingredientBreakdown?.filter((p) => typeof p === 'string' && p.trim()) ?? []
  )
    .slice(0, 4)
    .map(locLine);
  const allergyLines = (scan?.allergyNotes?.filter((p) => typeof p === 'string' && p.trim()) ?? []).map(locLine);
  const favoriteDisabled = favoriteLoading || !scan;
  const isUnknownNotFound =
    scan != null &&
    scan.verdict === 'unknown' &&
    String(scan.productName ?? '').trim() === 'Unknown product';

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
                    <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFDF9' }}>{t('common.tryAgain', lang)}</Text>
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

                {scan ? (
                  <View style={{ marginTop: 12 }}>
                    <VerdictBadge verdict={scan.verdict} />
                  </View>
                ) : null}

                <Text style={{ marginTop: 10, fontSize: 15, lineHeight: 22, color: '#4F453B' }}>
                  {scan?.summary ? locLine(scan.summary) : ''}
                </Text>

                {scan ? (
                  <View
                    style={{
                      marginTop: 12,
                      alignSelf: 'stretch',
                      flexDirection: 'row',
                      backgroundColor: '#EDE6DD',
                      borderRadius: 14,
                      padding: 3,
                      borderWidth: 1,
                      borderColor: '#E4D9CC',
                    }}
                  >
                    <Pressable
                      onPress={() => {
                        if (resultStyle !== 'quick') {
                          onSelectInfoLevel?.('quick');
                        }
                      }}
                      style={{
                        flex: 1,
                        paddingVertical: 9,
                        borderRadius: 11,
                        backgroundColor: mode === 'quick' ? '#FFFDF8' : 'transparent',
                      }}
                    >
                      <Text
                        style={{
                          textAlign: 'center',
                          fontSize: 13,
                          fontWeight: '700',
                          color: mode === 'quick' ? '#1F1A16' : '#7A6E61',
                        }}
                      >
                        {t('result.lessInfo', lang)}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        if (resultStyle !== 'advanced') {
                          onSelectInfoLevel?.('advanced');
                        }
                      }}
                      style={{
                        flex: 1,
                        paddingVertical: 9,
                        borderRadius: 11,
                        backgroundColor: mode === 'advanced' ? '#FFFDF8' : 'transparent',
                      }}
                    >
                      <Text
                        style={{
                          textAlign: 'center',
                          fontSize: 13,
                          fontWeight: '700',
                          color: mode === 'advanced' ? '#1F1A16' : '#7A6E61',
                        }}
                      >
                        {t('result.moreInfo', lang)}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}

                {showAvoidSection ? (
                  <View
                    style={{
                      marginTop: 12,
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

            <View style={{ marginTop: 14, gap: 8 }}>
              {displayReasons.map((reason, index) => (
                <Text key={`${reason}-${index}`} style={{ fontSize: 14, color: '#5D5246', lineHeight: 20 }}>
                  • {reason}
                </Text>
              ))}
            </View>

            {mode === 'advanced' && guidanceLines.length > 0 ? (
              <View style={{ marginTop: 16 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#6B5C4A' }}>{t('result.officialGuidance', lang)}</Text>
                <View style={{ marginTop: 8, gap: 8 }}>
                  {guidanceLines.map((line, index) => (
                    <Text key={`${line}-${index}`} style={{ fontSize: 14, color: '#5D5246', lineHeight: 20 }}>
                      • {line}
                    </Text>
                  ))}
                </View>
              </View>
            ) : null}

            {mode === 'advanced' && nutritionLines.length > 0 ? (
              <View style={{ marginTop: 18 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#6B5C4A' }}>{t('result.nutrition', lang)}</Text>
                <View style={{ marginTop: 10, gap: 8 }}>
                  {nutritionLines.map((line, index) => (
                    <Text key={`${line}-${index}`} style={{ fontSize: 14, color: '#5D5246', lineHeight: 20 }}>
                      • {line}
                    </Text>
                  ))}
                </View>
              </View>
            ) : null}

            {mode === 'advanced' && flagLines.length > 0 ? (
              <View style={{ marginTop: 18 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#6B5C4A' }}>{t('result.ingredientFlags', lang)}</Text>
                <View style={{ marginTop: 10, gap: 8 }}>
                  {flagLines.map((line, index) => (
                    <Text key={`${line}-${index}`} style={{ fontSize: 14, color: '#5D5246', lineHeight: 20 }}>
                      • {locLine(line)}
                    </Text>
                  ))}
                </View>
              </View>
            ) : null}

            {mode === 'advanced' && ingredientParagraphs.length > 0 ? (
              <View
                style={{
                  marginTop: 18,
                  paddingTop: 16,
                  borderTopWidth: 1,
                  borderTopColor: '#E8DFD4',
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#6B5C4A' }}>{t('result.ingredientBreakdown', lang)}</Text>
                <View style={{ marginTop: 10, gap: 14 }}>
                  {ingredientParagraphs.map((para, index) => (
                    <Text
                      key={`${index}-${para.slice(0, 24)}`}
                      style={{ fontSize: 15, lineHeight: 23, color: '#4F453B' }}
                    >
                      {para}
                    </Text>
                  ))}
                </View>
              </View>
            ) : null}

            {mode === 'advanced' && allergyLines.length > 0 ? (
              <View style={{ marginTop: 18 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#7D6B58' }}>{t('result.allergyNotes', lang)}</Text>
                <Text style={{ marginTop: 8, fontSize: 14, lineHeight: 22, color: '#5D5246' }}>
                  {allergyLines.join(' ')}
                </Text>
              </View>
            ) : null}

            {mode === 'advanced' && scan?.parentTakeaway ? (
              <View style={{ marginTop: 16 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#7D6B58' }}>{t('result.parentTakeaway', lang)}</Text>
                <Text style={{ marginTop: 6, fontSize: 14, lineHeight: 21, color: '#5D5246' }}>{locLine(scan.parentTakeaway)}</Text>
              </View>
            ) : null}

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
