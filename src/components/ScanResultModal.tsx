import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { ShareResultCard } from './ShareResultCard';
import { setAiResultReportDraft } from '../lib/aiResultReportDraft';
import { formatIngredientNameForLang, polishIngredientNote } from '../lib/ingredientDisplay';
import { avoidLabel, getAppLanguage, humanizePreferenceMatchLine, t } from '../lib/i18n';
import { localizeResultLine } from '../lib/localizeScanText';
import { shareScanResult } from '../lib/share/shareScanResult';
import { AVOID_PREFERENCE_IDS, type AvoidPreference, type Plan } from '../types/preferences';
import type { AppLanguage } from '../lib/deviceLanguage';
import type { RecentScan, Verdict } from '../types/scan';
import { M } from '../../constants/mamaTheme';
import { selectDistinctDisplayReasons } from '../lib/scanResultAntiRepeat';
type ResultTab = 'general' | 'ingredients';

function preferenceMatchDisplayLine(line: string, lang: AppLanguage): string {
  const t0 = line.trim();
  if ((AVOID_PREFERENCE_IDS as readonly string[]).includes(t0)) {
    return avoidLabel(t0 as AvoidPreference, lang);
  }
  return humanizePreferenceMatchLine(t0, lang);
}

type RowUi = { key: string; name: string; note: string };

const VERDICT_UI: Record<
  Verdict,
  { labelKey: 'verdict.good' | 'verdict.sometimes' | 'verdict.avoid' | 'verdict.unknown'; bg: string; border: string; text: string }
> = {
  good: { labelKey: 'verdict.good', bg: M.sageWash, border: M.lineSage, text: '#245335' },
  sometimes: { labelKey: 'verdict.sometimes', bg: '#F8ECDD', border: '#E3C18B', text: '#6B4310' },
  avoid: { labelKey: 'verdict.avoid', bg: '#FCEAEA', border: '#E1BDBD', text: '#6F2525' },
  unknown: { labelKey: 'verdict.unknown', bg: '#EBE8E4', border: '#D6D1CB', text: M.textBody },
};

function ResultCard({
  title,
  children,
  tone = 'neutral',
}: {
  title: string;
  children: ReactNode;
  tone?: 'neutral' | 'mint' | 'red' | 'yellow';
}) {
  const bg = tone === 'mint' ? M.sageWash : tone === 'red' ? '#FCEAEA' : tone === 'yellow' ? '#F8ECDD' : M.bgCardMuted;
  const border = tone === 'mint' ? M.lineSage : tone === 'red' ? '#E1BDBD' : tone === 'yellow' ? '#E3C18B' : M.line;
  return (
    <View
      style={{
        marginTop: 12,
        borderRadius: M.r18,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
        paddingVertical: 15,
        paddingHorizontal: 15,
      }}
    >
      <Text style={{ fontSize: 14, fontWeight: '800', color: M.text, letterSpacing: 0.1 }}>{title}</Text>
      <View style={{ marginTop: 9 }}>{children}</View>
    </View>
  );
}

function ProminentVerdictBadge({ verdict }: { verdict: Verdict }) {
  const lang = getAppLanguage();
  const config = VERDICT_UI[verdict];
  return (
    <View
      style={{
        paddingHorizontal: 13,
        paddingVertical: 8,
        borderRadius: 999,
        alignSelf: 'flex-start',
        backgroundColor: config.bg,
        borderWidth: 1,
        borderColor: config.border,
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: '900', color: config.text }}>{t(config.labelKey, lang)}</Text>
    </View>
  );
}

function IngredientSection({
  title,
  rows,
  accent,
  tone,
  helper,
  isFirst,
}: {
  title: string;
  rows: RowUi[];
  accent: string;
  tone: 'good' | 'neutral' | 'red';
  helper?: string;
  isFirst: boolean;
}) {
  if (rows.length === 0) {
    return null;
  }
  const bg = tone === 'good' ? M.sageWash : tone === 'red' ? '#FCEAEA' : M.bgCardMuted;
  const border = tone === 'good' ? M.lineSage : tone === 'red' ? '#E1BDBD' : M.line;
  return (
    <View
      style={{
        marginTop: isFirst ? 14 : 14,
        backgroundColor: bg,
        borderRadius: M.r18,
        paddingVertical: 15,
        paddingHorizontal: 15,
        borderWidth: 1,
        borderColor: border,
        ...(tone === 'red' ? { borderWidth: 1.5 } : {}),
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 }}>
        <View style={{ width: 4, height: 20, borderRadius: 999, backgroundColor: accent }} />
        <Text style={{ fontSize: 15, fontWeight: '800', color: M.text, letterSpacing: 0.2 }}>{title}</Text>
      </View>
      {helper ? (
        <Text style={{ marginBottom: 12, fontSize: 13, lineHeight: 18, color: M.textMuted, fontWeight: '600' }}>
          {helper}
        </Text>
      ) : null}
      <View style={{ gap: 16 }}>
        {rows.map((row) => (
          <View key={row.key}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: M.text, letterSpacing: 0.1 }}>{row.name}</Text>
            <Text style={{ marginTop: 6, fontSize: 13, lineHeight: 20, color: M.textBody }}>{row.note}</Text>
          </View>
        ))}
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
  const shareCardRef = useRef<View>(null);
  const [tab, setTab] = useState<ResultTab>('general');
  const [shareLoading, setShareLoading] = useState(false);

  useEffect(() => {
    setTab('general');
  }, [scan?.id]);

  useEffect(() => {
    if (!visible || !scan) {
      return;
    }
    console.warn('[prefs][ScanResultModal]', 'preferenceMatches received', {
      scanId: scan.id,
      preferenceMatches: scan.preferenceMatches ?? [],
    });
  }, [visible, scan]);

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

  const openReportScreen = () => {
    if (!scan) {
      return;
    }
    setAiResultReportDraft({
      scan,
      childAge,
      avoidPreferences,
      plan,
    });
    onClose();
    router.push('/report-result');
  };

  const handleSharePress = async () => {
    if (!scan || shareLoading) {
      return;
    }
    setShareLoading(true);
    try {
      await shareScanResult({ cardRef: shareCardRef, scan });
    } finally {
      setShareLoading(false);
    }
  };

  const tabBtn = (id: ResultTab, label: string) => (
    <Pressable
      key={id}
      onPress={() => setTab(id)}
      style={{
        flex: 1,
        paddingVertical: 11,
        borderRadius: M.r14,
        backgroundColor: tab === id ? M.white : 'transparent',
        ...(tab === id ? M.shadowSoft : {}),
      }}
    >
      <Text
        style={{
          textAlign: 'center',
          fontSize: 13,
          fontWeight: '700',
          color: tab === id ? M.text : M.textMuted,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <>
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
          backgroundColor: M.overlay,
          justifyContent: 'center',
          paddingHorizontal: 20,
        }}
      >
        <View
          style={{
            borderRadius: M.r24,
            backgroundColor: M.bgPage,
            maxHeight: '90%',
            overflow: 'hidden',
            ...M.shadowCard,
          }}
        >
          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: 22,
              paddingBottom: 24,
              paddingTop: 22,
            }}
            keyboardShouldPersistTaps="handled"
          >
            {isUnknownNotFound ? (
              <>
                <Text
                  style={{
                    fontSize: 26,
                    lineHeight: 32,
                    color: M.text,
                    fontWeight: '700',
                  }}
                >
                  {t('result.unknownProduct', lang)}
                </Text>
                <Text style={{ marginTop: 12, fontSize: 15, lineHeight: 22, color: M.textBody }}>
                  {t('result.unknownBarcode', lang)}
                </Text>
                <Text style={{ marginTop: 14, fontSize: 13, color: M.textMuted }}>
                  {t('result.barcodeLabel', lang)} {scan?.barcode ?? '-'}
                </Text>
              </>
            ) : (
              <>
                {reuseNotice ? (
                  <View
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                      borderRadius: 12,
                      backgroundColor: M.bgCardMuted,
                      borderWidth: 1,
                      borderColor: M.line,
                    }}
                  >
                    <Text style={{ fontSize: 12, color: M.textBody, fontWeight: '600', textAlign: 'center' }}>
                      {reuseNotice}
                    </Text>
                  </View>
                ) : null}
                <View
                  style={{
                    marginTop: 16,
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
                      color: M.text,
                      fontWeight: '700',
                    }}
                  >
                    {scan?.productName ?? t('common.product', lang)}
                  </Text>
                  {scan ? (
                    <View style={{ gap: 8 }}>
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
                          backgroundColor: plan === 'unlimited' && isFavorited ? '#FCEAEA' : M.bgChip,
                          borderWidth: 1,
                          borderColor: plan === 'unlimited' && isFavorited ? '#E1BDBD' : M.line,
                          opacity: favoriteDisabled ? 0.5 : 1,
                        }}
                      >
                        <Ionicons
                          name={plan === 'unlimited' && isFavorited ? 'heart' : 'heart-outline'}
                          size={22}
                          color={plan !== 'unlimited' ? '#B59B7A' : isFavorited ? '#B85C5C' : '#6D6053'}
                        />
                      </Pressable>
                      <Pressable
                        onPress={handleSharePress}
                        disabled={shareLoading}
                        accessibilityRole="button"
                        accessibilityLabel="Share result"
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={{
                          width: 42,
                          height: 42,
                          borderRadius: 14,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: M.bgChip,
                          borderWidth: 1,
                          borderColor: M.line,
                          opacity: shareLoading ? 0.65 : 1,
                        }}
                      >
                        {shareLoading ? (
                          <ActivityIndicator size="small" color={M.textMuted} />
                        ) : (
                          <Ionicons name="share-outline" size={21} color={M.textBody} />
                        )}
                      </Pressable>
                    </View>
                  ) : null}
                </View>
                {!!scan?.brand && (
                  <Text style={{ marginTop: 6, fontSize: 15, color: M.textMuted, fontWeight: '600' }}>{scan.brand}</Text>
                )}
                <Text style={{ marginTop: 8, fontSize: 13, color: M.textMuted }}>
                  {t('result.barcodeLabel', lang)} {scan?.barcode ?? '-'}
                </Text>

                <View
                  style={{
                    marginTop: 20,
                    flexDirection: 'row',
                    backgroundColor: M.bgChip,
                    borderRadius: M.r16,
                    padding: 4,
                    borderWidth: 1,
                    borderColor: M.line,
                  }}
                >
                  {tabBtn('general', t('result.tab.general', lang))}
                  {tabBtn('ingredients', t('result.tab.ingredients', lang))}
                </View>

                {tab === 'general' ? (
                  <>
                    <ResultCard title="Main verdict" tone={scan?.verdict === 'good' ? 'mint' : scan?.verdict === 'avoid' ? 'red' : scan?.verdict === 'sometimes' ? 'yellow' : 'neutral'}>
                      {scan ? <ProminentVerdictBadge verdict={scan.verdict} /> : null}
                      <Text style={{ marginTop: 11, fontSize: 15, lineHeight: 22, color: M.textBody }}>
                        {scan?.summary ? locLine(scan.summary) : ''}
                      </Text>
                    </ResultCard>

                    {showAvoidSection ? (
                      <ResultCard title={t('result.matchesAvoid', lang)} tone="yellow">
                        <View style={{ gap: 8 }}>
                        {preferenceLines.map((line, index) => (
                          <Text
                            key={`${line}-${index}`}
                            style={{ fontSize: 14, color: M.textBody, lineHeight: 20, fontWeight: '600' }}
                          >
                            • {locLine(preferenceMatchDisplayLine(line, lang))}
                          </Text>
                        ))}
                        </View>
                      </ResultCard>
                    ) : null}

                    {displayReasons.length > 0 ? (
                      <ResultCard title="Key reasons">
                        <View style={{ gap: 8 }}>
                          {displayReasons.map((reason, index) => (
                            <Text key={`${reason}-${index}`} style={{ fontSize: 14, color: M.textBody, lineHeight: 20 }}>
                              • {reason}
                            </Text>
                          ))}
                        </View>
                      </ResultCard>
                    ) : null}

                    {whyText ? (
                      <ResultCard title={t('result.whyMatters', lang)}>
                        <Text style={{ marginTop: 6, fontSize: 14, lineHeight: 21, color: M.textBody }}>{whyText}</Text>
                      </ResultCard>
                    ) : null}

                    {parentText ? (
                      <ResultCard title={t('result.parentTakeaway', lang)} tone="mint">
                        <Text style={{ marginTop: 6, fontSize: 14, lineHeight: 21, color: M.textBody }}>{parentText}</Text>
                      </ResultCard>
                    ) : null}
                  </>
                ) : (
                  <View style={{ marginTop: 14, paddingBottom: 6 }}>
                    {ingredientPack.kind === 'fallback' ? (
                      <Text style={{ marginTop: 12, fontSize: 14, lineHeight: 21, color: M.textBody }}>
                        {t('result.ingredients.failBreakdown', lang)}
                      </Text>
                    ) : (
                      <>
                        <IngredientSection
                          title={t('result.ingredients.red', lang)}
                          rows={ingredientPack.red}
                          accent="#8B3A3A"
                          tone="red"
                          helper="Things to watch out for"
                          isFirst
                        />
                        <IngredientSection
                          title={t('result.ingredients.good', lang)}
                          rows={ingredientPack.good}
                          accent="#2F6F4B"
                          tone="good"
                          isFirst={ingredientPack.red.length === 0}
                        />
                        <IngredientSection
                          title={t('result.ingredients.neutral', lang)}
                          rows={ingredientPack.neutral}
                          accent="#6B5C4A"
                          tone="neutral"
                          isFirst={ingredientPack.red.length === 0 && ingredientPack.good.length === 0}
                        />
                      </>
                    )}
                  </View>
                )}
              </>
            )}
            <View
              style={{
                marginTop: 18,
                alignItems: 'center',
              }}
            >
              <Pressable
                onPress={openReportScreen}
                disabled={!scan}
                accessibilityRole="button"
                style={{ opacity: scan ? 1 : 0.5 }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={{ fontSize: 12, fontWeight: '800', color: '#8B3A3A' }}>Report issue</Text>
              </Pressable>
              <Text style={{ marginTop: 7, fontSize: 11, lineHeight: 16, color: M.textMuted, textAlign: 'center' }}>
                AI may be wrong. Use this as guidance, not medical advice.
              </Text>
            </View>
          </ScrollView>
          <View
            style={{
              paddingHorizontal: 22,
              paddingTop: 12,
              paddingBottom: 16,
              borderTopWidth: 1,
              borderTopColor: M.line,
              backgroundColor: M.bgPage,
              flexDirection: 'row',
              gap: 10,
            }}
          >
            <Pressable
              onPress={onClose}
              style={{
                flex: 1,
                borderRadius: M.r16,
                backgroundColor: M.bgChipSelected,
                alignItems: 'center',
                paddingVertical: 14,
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: M.textBody }}>{t('common.close', lang)}</Text>
            </Pressable>
            <Pressable
              onPress={onScanAgain}
              style={{
                flex: 1,
                borderRadius: M.r16,
                backgroundColor: M.inkButton,
                alignItems: 'center',
                paddingVertical: 14,
                ...M.shadowSoft,
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: M.cream }}>{t('result.scanAgain', lang)}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
    {scan ? (
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: -10000,
          top: 0,
          width: 360,
          height: 450,
        }}
      >
        <ShareResultCard ref={shareCardRef} scan={scan} />
      </View>
    ) : null}
    </>
  );
}
