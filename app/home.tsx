import { Ionicons } from '@expo/vector-icons';
import { useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { M } from '../constants/mamaTheme';
import {
  addFavorite,
  getFavorites,
  getOrCreateProductId,
  getSupabase,
  isFavorite,
  isSupabaseConfigured,
  removeFavorite,
} from '../src/api/supabase';
import { RecentScanCard } from '../src/components/RecentScanCard';
import { ScanResultModal } from '../src/components/ScanResultModal';
import { ScannerModal } from '../src/components/ScannerModal';
import type { ChildAgeProfile } from '../src/lib/childAgeContext';
import { serializeChildAgePreferenceForContext } from '../src/lib/childAgeContext';
import { showFavoritesUnlimitedUpsell } from '../src/lib/favoritesInsightsAlert';
import { getAppLanguage, t } from '../src/lib/i18n';
import { digitsOnlyFromBarcodeInput, isValidManualBarcodeDigits } from '../src/lib/manualBarcode';
import { buildRecentScanFromBarcode, createFallbackRecentScan } from '../src/lib/mockScanResult';
import { buildScanAnalysisContextKey, findRecentScanForReuse } from '../src/lib/scanAnalysisContext';
import {
  addRecentScan,
  canUseSuccessfulScanForPlan,
  ensureSupabaseProfileLocal,
  getAvoidPreferences,
  getCachedSupabaseProfileId,
  getChildAgeProfile,
  getDailySuccessfulScanState,
  getPlan,
  getRecentScans,
  incrementSuccessfulScanCountIfNeeded,
  removeRecentScanById,
  syncRemotePreferencesWithLocal,
  tryPersistSuccessfulScanToSupabase,
  waitUntilPreferencesSyncIdle,
} from '../src/lib/storage';
import { useRevenueCat } from '../src/providers/RevenueCatProvider';
import type { FavoriteListItem } from '../src/types/ai';
import type { AvoidPreference, Plan } from '../src/types/preferences';
import type { RecentScan } from '../src/types/scan';

function recentScanFromFavoriteItem(item: FavoriteListItem, recent: RecentScan[]): RecentScan {
  const lang = getAppLanguage();
  const hit = recent.find((s) => s.barcode.trim() === item.barcode.trim());
  if (hit) {
    return hit;
  }
  return {
    id: `favorite-${item.favoriteId}`,
    barcode: item.barcode,
    productName: item.productName,
    brand: item.brand ?? undefined,
    imageUrl: item.imageUrl ?? undefined,
    baseVerdict: 'unknown',
    verdict: 'unknown',
    summary: t('home.favorite.summary', lang),
    reasons: [
      t('home.favorite.r1', lang),
      t('home.favorite.r2', lang),
      t('home.favorite.r3', lang),
      t('home.favorite.r4', lang),
    ],
    scannedAt: new Date().toISOString(),
    nutritionSnapshot: [],
    ingredientFlags: [],
    ingredientBreakdown: [],
    allergyNotes: [],
    whyThisMatters: t('home.favorite.why', lang),
    parentTakeaway: t('home.favorite.parent', lang),
  };
}

function normalizedKeyPart(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

function favoriteKeyForScan(scan: RecentScan): string {
  const barcode = normalizedKeyPart(scan.barcode);
  if (barcode) {
    return `barcode:${barcode}`;
  }
  return `id:${scan.id}`;
}

function favoriteKeyForItem(item: FavoriteListItem): string {
  const barcode = normalizedKeyPart(item.barcode);
  if (barcode) {
    return `barcode:${barcode}`;
  }
  return `id:${item.productId || item.favoriteId}`;
}

function favoriteMatchesScan(item: FavoriteListItem, scan: RecentScan): boolean {
  return favoriteKeyForItem(item) === favoriteKeyForScan(scan);
}

function optimisticFavoriteFromScan(scan: RecentScan): FavoriteListItem {
  return {
    favoriteId: `optimistic-${scan.id}`,
    productId: scan.id,
    createdAt: new Date().toISOString(),
    barcode: scan.barcode,
    productName: scan.productName,
    brand: scan.brand ?? null,
    imageUrl: scan.imageUrl ?? null,
  };
}

function freeScanBadge(count: number): { label: string; bg: string; border: string; text: string } {
  const remaining = Math.max(0, 2 - Math.min(2, count));
  if (remaining >= 2) {
    return { label: '2 free scans left today', bg: M.sageWash, border: M.lineSage, text: M.sageDeep };
  }
  if (remaining === 1) {
    return { label: '1 free scan left today', bg: '#FFF4D8', border: '#E8C989', text: '#7A5218' };
  }
  return { label: 'No free scans left today', bg: '#FCEAEA', border: '#E8C7C7', text: '#7A2E2E' };
}

type DailyScanSnapshot = { dateKey: string; count: number };
type PendingLockedScanProductPreview = { barcode: string };

type PendingPostScanOutcome =
  | {
      kind: 'known';
      reuseBanner: string | null;
      nextScans: RecentScan[];
      modalScan: RecentScan;
      activeId: string;
      daily: DailyScanSnapshot | null;
      childAgeProfile: ChildAgeProfile;
      supabaseScan: RecentScan | null;
    }
  | { kind: 'unknown'; scan: RecentScan }
  | { kind: 'error'; title: string; message: string };

const POST_SCAN_RESULT_DELAY_MS = Platform.OS === 'ios' ? 80 : 0;
const SCAN_LOCKED_ANALYZING_DELAY_MS = 650;
const ANALYSIS_VISUAL_STEP_MIN_MS = 500;
const ANALYSIS_VISUAL_FINAL_MIN_MS = 400;
const ANALYSIS_VISUAL_REVEAL_MAX_MS = 2200;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type AnalysisVisualStepId = 'database' | 'details' | 'child' | 'ingredients';

const ANALYSIS_VISUAL_STEPS: { id: AnalysisVisualStepId; label: string }[] = [
  { id: 'database', label: 'Checking food database' },
  { id: 'details', label: 'Matching product details' },
  { id: 'child', label: 'Analyzing for your child' },
  { id: 'ingredients', label: 'Preparing ingredient breakdown' },
];

const ANALYSIS_VISUAL_FINAL_INDEX = ANALYSIS_VISUAL_STEPS.length - 1;

function deriveAnalysisVisualTargetIndex(progressKey: string | null, progressText: string): number {
  const signal = `${progressKey ?? ''} ${progressText}`.toLowerCase();
  if (signal.includes('ingredient') || signal.includes('almost_ready') || signal.includes('almost ready')) {
    return 3;
  }
  if (signal.includes('analyzing_child') || signal.includes('for your child') || signal.includes('your child')) {
    return 2;
  }
  if (
    signal.includes('product_found') ||
    signal.includes('no_match_db') ||
    signal.includes('web_sources') ||
    signal.includes('matching_details') ||
    signal.includes('product found') ||
    signal.includes('no match') ||
    signal.includes('trusted web') ||
    signal.includes('matching product')
  ) {
    return 1;
  }
  return 0;
}

function analysisOverlayTitle(progressTextOverride: string | null): string {
  const normalized = progressTextOverride?.trim().toLowerCase() ?? '';
  return normalized.startsWith('analyzing ingredients') ? 'Analyzing ingredients' : 'Analyzing product';
}

function ScanAnalysisOverlay({
  title,
  subtitle,
  visualStepIndex,
}: {
  title: string;
  subtitle: string;
  visualStepIndex: number;
}) {
  const entrance = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const activeIndex = Math.max(0, Math.min(visualStepIndex, ANALYSIS_VISUAL_FINAL_INDEX));

  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 720,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 720,
          useNativeDriver: true,
        }),
      ]),
    );
    pulseLoop.start();
    return () => {
      pulseLoop.stop();
    };
  }, [entrance, pulse]);

  const cardScale = entrance.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1],
  });
  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.42, 1],
  });
  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.86, 1.16],
  });

  return (
    <Animated.View
      style={{
        borderRadius: M.r24,
        backgroundColor: M.bgCard,
        paddingVertical: 24,
        paddingHorizontal: 20,
        width: '100%',
        maxWidth: 340,
        opacity: entrance,
        transform: [{ scale: cardScale }],
        ...M.shadowCard,
      }}
    >
      <View
        style={{
          alignSelf: 'center',
          width: 54,
          height: 54,
          borderRadius: 999,
          backgroundColor: M.sageWash,
          borderWidth: 1,
          borderColor: M.lineSage,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Animated.View
          style={{
            position: 'absolute',
            width: 28,
            height: 28,
            borderRadius: 999,
            backgroundColor: M.sageDeep,
            opacity: pulseOpacity,
            transform: [{ scale: pulseScale }],
          }}
        />
        <View
          style={{
            width: 12,
            height: 12,
            borderRadius: 999,
            backgroundColor: M.sageDeep,
          }}
        />
      </View>

      <Text style={{ marginTop: 16, fontSize: 20, lineHeight: 26, fontWeight: '800', color: M.text, textAlign: 'center' }}>
        {title}
      </Text>
      <Text style={{ marginTop: 7, fontSize: 14, lineHeight: 20, fontWeight: '600', color: M.textMuted, textAlign: 'center' }}>
        {subtitle}
      </Text>

      <View style={{ marginTop: 20, gap: 8 }}>
        {ANALYSIS_VISUAL_STEPS.map((step, index) => {
          const state = index < activeIndex ? 'completed' : index === activeIndex ? 'active' : 'upcoming';
          const isCompleted = state === 'completed';
          const isActive = state === 'active';
          return (
            <View
              key={step.id}
              style={{
                minHeight: 42,
                borderRadius: M.r14,
                paddingVertical: 10,
                paddingHorizontal: 12,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                backgroundColor: isActive ? M.sageWash : 'transparent',
                borderWidth: 1,
                borderColor: isActive ? M.lineSage : 'transparent',
              }}
            >
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isCompleted ? M.sageDeep : isActive ? M.bgCard : M.bgChip,
                  borderWidth: 1,
                  borderColor: isCompleted || isActive ? M.lineSage : M.line,
                }}
              >
                {isCompleted ? (
                  <Text style={{ fontSize: 13, lineHeight: 17, fontWeight: '900', color: M.cream }}>✓</Text>
                ) : isActive ? (
                  <Animated.View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      backgroundColor: M.sageDeep,
                      opacity: pulseOpacity,
                      transform: [{ scale: pulseScale }],
                    }}
                  />
                ) : (
                  <View style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: M.textSoft }} />
                )}
              </View>
              <Text
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 14,
                  lineHeight: 19,
                  fontWeight: isActive || isCompleted ? '800' : '600',
                  color: isActive || isCompleted ? M.text : M.textSoft,
                }}
              >
                {step.label}
              </Text>
            </View>
          );
        })}
      </View>
    </Animated.View>
  );
}

export default function HomeScreen() {
  const { gatedPlan, customerInfo } = useRevenueCat();
  const lang = getAppLanguage();
  const { width: windowWidth } = useWindowDimensions();
  const isNarrowAndroid = Platform.OS === 'android' && windowWidth < 380;
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [recentScans, setRecentScans] = useState<RecentScan[]>([]);
  const [resultModalVisible, setResultModalVisible] = useState(false);
  const [activeModalScanId, setActiveModalScanId] = useState<string | null>(null);
  const [modalScan, setModalScan] = useState<RecentScan | null>(null);
  const [favoritesList, setFavoritesList] = useState<FavoriteListItem[]>([]);
  const [modalProductId, setModalProductId] = useState<string | null>(null);
  const [modalFavorited, setModalFavorited] = useState(false);
  const [favoriteActionBusy, setFavoriteActionBusy] = useState(false);
  const [resultReuseBanner, setResultReuseBanner] = useState<string | null>(null);
  const [scannerModalVisible, setScannerModalVisible] = useState(false);
  const [scannerCameraKey, setScannerCameraKey] = useState(0);
  const [unknownResultVisible, setUnknownResultVisible] = useState(false);
  const [unknownScan, setUnknownScan] = useState<RecentScan | null>(null);
  const [manualBarcodeVisible, setManualBarcodeVisible] = useState(false);
  const [manualBarcodeValue, setManualBarcodeValue] = useState('');
  const [manualBarcodeError, setManualBarcodeError] = useState<string | null>(null);
  const [supportModalVisible, setSupportModalVisible] = useState(false);
  const [favoriteUpsellVisible, setFavoriteUpsellVisible] = useState(false);
  const [pendingDeleteScan, setPendingDeleteScan] = useState<RecentScan | null>(null);
  const [pendingLockedScanBarcode, setPendingLockedScanBarcode] = useState<string | null>(null);
  const [pendingLockedScanProductPreview, setPendingLockedScanProductPreview] =
    useState<PendingLockedScanProductPreview | null>(null);

  const activeResult = useMemo(() => {
    if (!activeModalScanId) {
      return null;
    }
    return recentScans.find((s) => s.id === activeModalScanId) ?? null;
  }, [activeModalScanId, recentScans]);

  const displayScan = useMemo(() => modalScan ?? activeResult, [modalScan, activeResult]);
  const [scanPipelineLoading, setScanPipelineLoading] = useState(false);
  /** i18n key from `scan.progress.*`; shown on the scan loading overlay. */
  const [scanProgressKey, setScanProgressKey] = useState<string | null>(null);
  const [scanProgressTextOverride, setScanProgressTextOverride] = useState<string | null>(null);
  const [analysisVisualStepIndex, setAnalysisVisualStepIndex] = useState(0);
  const [scanError, setScanError] = useState<{ title: string; message: string } | null>(null);
  const [plan, setPlan] = useState<Plan>('free');
  const effectivePlan = useMemo(() => gatedPlan(plan), [gatedPlan, plan]);
  const [dailyScanState, setDailyScanState] = useState({ dateKey: '', count: 0 });
  const [avoidPreferences, setAvoidPreferences] = useState<AvoidPreference[]>([]);
  const [childAge, setChildAge] = useState<number | null>(null);
  const isProcessingScanRef = useRef(false);
  const resultModalVisibleRef = useRef(false);
  const scanPipelineLoadingRef = useRef(false);
  const scanErrorVisibleRef = useRef(false);
  const unknownResultVisibleRef = useRef(false);
  const pendingPostScanOutcomeRef = useRef<PendingPostScanOutcome | null>(null);
  const expectingScannerDismissHandoffRef = useRef(false);
  const scannerDismissedForHandoffRef = useRef(false);
  const scannerModalVisibleRef = useRef(false);
  const analysisVisualStepIndexRef = useRef(0);
  const analysisVisualTargetIndexRef = useRef(0);
  const analysisVisualStepStartedAtRef = useRef(Date.now());
  const analysisVisualRevealStartedAtRef = useRef<number | null>(null);
  const analysisVisualProgressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analysisVisualRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleAnalysisVisualProgressRef = useRef<(() => void) | null>(null);
  const commitPendingPostScanOutcomeFnRef = useRef<(() => void) | null>(null);
  const pendingLockedScanBarcodeRef = useRef<string | null>(null);
  const pendingLockedScanProductPreviewRef = useRef<PendingLockedScanProductPreview | null>(null);
  const handleBarcodeScannedRef = useRef<
    ((payload: { data: string; skipLockedPaywall?: boolean }) => Promise<void>) | null
  >(null);
  /** After a manual barcode submit, "Scan again" should reopen the manual modal, not the camera. */
  const preferManualRescanRef = useRef(false);
  const hydrateLockRef = useRef(false);
  const hydrateAgainRef = useRef(false);
  resultModalVisibleRef.current = resultModalVisible;
  scanPipelineLoadingRef.current = scanPipelineLoading;
  scanErrorVisibleRef.current = scanError != null;
  unknownResultVisibleRef.current = unknownResultVisible;
  scannerModalVisibleRef.current = scannerModalVisible;
  pendingLockedScanBarcodeRef.current = pendingLockedScanBarcode;
  pendingLockedScanProductPreviewRef.current = pendingLockedScanProductPreview;

  const clearAnalysisVisualTimers = useCallback(() => {
    if (analysisVisualProgressTimerRef.current) {
      clearTimeout(analysisVisualProgressTimerRef.current);
      analysisVisualProgressTimerRef.current = null;
    }
    if (analysisVisualRevealTimerRef.current) {
      clearTimeout(analysisVisualRevealTimerRef.current);
      analysisVisualRevealTimerRef.current = null;
    }
    analysisVisualRevealStartedAtRef.current = null;
  }, []);

  const setAnalysisVisualStep = useCallback((nextIndex: number) => {
    const clamped = Math.max(0, Math.min(nextIndex, ANALYSIS_VISUAL_FINAL_INDEX));
    analysisVisualStepIndexRef.current = clamped;
    analysisVisualStepStartedAtRef.current = Date.now();
    setAnalysisVisualStepIndex(clamped);
  }, []);

  const scheduleAnalysisVisualProgress = useCallback(() => {
    if (analysisVisualProgressTimerRef.current) {
      clearTimeout(analysisVisualProgressTimerRef.current);
      analysisVisualProgressTimerRef.current = null;
    }
    if (!scanPipelineLoadingRef.current) {
      return;
    }

    const current = analysisVisualStepIndexRef.current;
    const target = analysisVisualTargetIndexRef.current;
    if (current >= target || current >= ANALYSIS_VISUAL_FINAL_INDEX) {
      return;
    }

    const elapsedOnStep = Date.now() - analysisVisualStepStartedAtRef.current;
    const delayMs = Math.max(0, ANALYSIS_VISUAL_STEP_MIN_MS - elapsedOnStep);
    analysisVisualProgressTimerRef.current = setTimeout(() => {
      analysisVisualProgressTimerRef.current = null;
      setAnalysisVisualStep(analysisVisualStepIndexRef.current + 1);
      scheduleAnalysisVisualProgressRef.current?.();
    }, delayMs);
  }, [setAnalysisVisualStep]);
  scheduleAnalysisVisualProgressRef.current = scheduleAnalysisVisualProgress;

  const isAnalysisVisualReadyForReveal = useCallback(() => {
    return (
      analysisVisualStepIndexRef.current >= ANALYSIS_VISUAL_FINAL_INDEX &&
      Date.now() - analysisVisualStepStartedAtRef.current >= ANALYSIS_VISUAL_FINAL_MIN_MS
    );
  }, []);

  const clearPostScanHandoff = useCallback(() => {
    clearAnalysisVisualTimers();
    pendingPostScanOutcomeRef.current = null;
    expectingScannerDismissHandoffRef.current = false;
    scannerDismissedForHandoffRef.current = false;
  }, [clearAnalysisVisualTimers]);

  const commitPendingPostScanOutcome = useCallback(() => {
    const p = pendingPostScanOutcomeRef.current;
    if (p) {
      if (p.kind === 'known' && scanPipelineLoadingRef.current && !isAnalysisVisualReadyForReveal()) {
        if (analysisVisualRevealStartedAtRef.current == null) {
          analysisVisualRevealStartedAtRef.current = Date.now();
        }
        analysisVisualTargetIndexRef.current = ANALYSIS_VISUAL_FINAL_INDEX;
        scheduleAnalysisVisualProgress();

        const revealWaitElapsed = Date.now() - analysisVisualRevealStartedAtRef.current;
        if (revealWaitElapsed < ANALYSIS_VISUAL_REVEAL_MAX_MS) {
          if (analysisVisualRevealTimerRef.current) {
            clearTimeout(analysisVisualRevealTimerRef.current);
          }
          const stepElapsed = Date.now() - analysisVisualStepStartedAtRef.current;
          const nextCheckDelay =
            analysisVisualStepIndexRef.current >= ANALYSIS_VISUAL_FINAL_INDEX
              ? Math.max(0, ANALYSIS_VISUAL_FINAL_MIN_MS - stepElapsed)
              : Math.max(0, ANALYSIS_VISUAL_STEP_MIN_MS - stepElapsed);
          analysisVisualRevealTimerRef.current = setTimeout(() => {
            analysisVisualRevealTimerRef.current = null;
            commitPendingPostScanOutcomeFnRef.current?.();
          }, Math.max(50, Math.min(250, nextCheckDelay)));
          return;
        }
      }

      analysisVisualRevealStartedAtRef.current = null;
      const snapshot = p;
      pendingPostScanOutcomeRef.current = null;
      expectingScannerDismissHandoffRef.current = false;

      const reveal = async () => {
        const freshPlan = await getPlan();
        setPlan(freshPlan);
        if (snapshot.kind === 'known') {
          setRecentScans(snapshot.nextScans);
          if (snapshot.daily) {
            setDailyScanState(snapshot.daily);
          }
          if (snapshot.supabaseScan) {
            void tryPersistSuccessfulScanToSupabase(snapshot.supabaseScan, snapshot.childAgeProfile);
          }
          setModalScan(snapshot.modalScan);
          setActiveModalScanId(snapshot.activeId);
          setResultReuseBanner(snapshot.reuseBanner);
          setResultModalVisible(true);
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn('[scanFlow] result modal visible with scan id', snapshot.modalScan.id);
          }
        } else if (snapshot.kind === 'unknown') {
          setUnknownScan(snapshot.scan);
          setUnknownResultVisible(true);
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn('[scanFlow] unknown visible');
          }
        } else {
          setResultModalVisible(false);
          setActiveModalScanId(null);
          setModalScan(null);
          setResultReuseBanner(null);
          setUnknownResultVisible(false);
          setUnknownScan(null);
          setScanError({ title: snapshot.title, message: snapshot.message });
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn('[scanFlow] error visible');
          }
        }
        setScanPipelineLoading(false);
        setScanProgressKey(null);
        setScanProgressTextOverride(null);
        scanPipelineLoadingRef.current = false;
        isProcessingScanRef.current = false;
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[scanFlow] loading hidden after visible state committed');
        }
      };

      if (POST_SCAN_RESULT_DELAY_MS > 0) {
        setTimeout(reveal, POST_SCAN_RESULT_DELAY_MS);
      } else {
        reveal();
      }
      return;
    }
    if (expectingScannerDismissHandoffRef.current) {
      expectingScannerDismissHandoffRef.current = false;
      const revealFallback = () => {
        setResultModalVisible(false);
        setActiveModalScanId(null);
        setModalScan(null);
        setResultReuseBanner(null);
        setUnknownResultVisible(false);
        setUnknownScan(null);
        setScanError({
          title: t('common.somethingWrong', getAppLanguage()),
          message: t('error.scanAgain', getAppLanguage()),
        });
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[scanFlow] error visible');
        }
        setScanPipelineLoading(false);
        setScanProgressKey(null);
        setScanProgressTextOverride(null);
        scanPipelineLoadingRef.current = false;
        isProcessingScanRef.current = false;
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[scanFlow] loading hidden after visible state committed');
        }
      };
      if (POST_SCAN_RESULT_DELAY_MS > 0) {
        setTimeout(revealFallback, POST_SCAN_RESULT_DELAY_MS);
      } else {
        revealFallback();
      }
    }
  }, [isAnalysisVisualReadyForReveal, scheduleAnalysisVisualProgress]);
  commitPendingPostScanOutcomeFnRef.current = commitPendingPostScanOutcome;

  useEffect(() => {
    if (!scanPipelineLoading) {
      clearAnalysisVisualTimers();
      analysisVisualTargetIndexRef.current = 0;
      analysisVisualStepIndexRef.current = 0;
      analysisVisualStepStartedAtRef.current = Date.now();
      setAnalysisVisualStepIndex(0);
      return;
    }

    analysisVisualTargetIndexRef.current = 0;
    setAnalysisVisualStep(0);
    scheduleAnalysisVisualProgress();
  }, [clearAnalysisVisualTimers, scanPipelineLoading, scheduleAnalysisVisualProgress, setAnalysisVisualStep]);

  useEffect(() => {
    if (!scanPipelineLoading) {
      return;
    }
    const progressText = scanProgressTextOverride ?? (scanProgressKey ? t(scanProgressKey, lang) : t('loading.checking', lang));
    const targetIndex = deriveAnalysisVisualTargetIndex(scanProgressKey, progressText);
    if (targetIndex > analysisVisualTargetIndexRef.current) {
      analysisVisualTargetIndexRef.current = targetIndex;
      scheduleAnalysisVisualProgress();
    }
  }, [lang, scanPipelineLoading, scanProgressKey, scanProgressTextOverride, scheduleAnalysisVisualProgress]);

  useEffect(() => {
    return () => {
      clearAnalysisVisualTimers();
    };
  }, [clearAnalysisVisualTimers]);

  const refreshFavoritesList = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setFavoritesList([]);
      return;
    }
    const profileId = await getCachedSupabaseProfileId();
    const client = getSupabase();
    if (!profileId || !client) {
      setFavoritesList([]);
      return;
    }
    const rows = await getFavorites(client, profileId, 5);
    const list: FavoriteListItem[] = rows
      .filter((r) => r.products && typeof r.products.barcode === 'string')
      .map((r) => ({
        favoriteId: r.id,
        productId: r.product_id,
        createdAt: r.created_at,
        barcode: r.products!.barcode,
        productName: (r.products!.product_name ?? 'Product').trim() || 'Product',
        brand: r.products!.brand ?? null,
        imageUrl: r.products!.image_url ?? null,
      }));
    setFavoritesList(list);
  }, []);

  const hydrate = useCallback(async () => {
    if (hydrateLockRef.current) {
      hydrateAgainRef.current = true;
      return;
    }
    hydrateLockRef.current = true;
    try {
      for (;;) {
        hydrateAgainRef.current = false;
        await waitUntilPreferencesSyncIdle();
        await syncRemotePreferencesWithLocal();
        const [scans, avoids, daily, profile] = await Promise.all([
          getRecentScans(),
          getAvoidPreferences(),
          getDailySuccessfulScanState(),
          getChildAgeProfile(),
        ]);
        const p = await getPlan();
        console.warn('[planDebug][home] hydrate', {
          plan: p,
          avoids,
          daily,
        });
        setRecentScans(scans);
        setPlan(p);
        setAvoidPreferences(avoids);
        setDailyScanState(daily);
        setChildAge(Number.isFinite(profile.completedWholeYears) ? profile.completedWholeYears : null);
        if (gatedPlan(p) === 'unlimited') {
          await refreshFavoritesList();
        } else {
          setFavoritesList([]);
        }
        if (!hydrateAgainRef.current) {
          break;
        }
      }
    } finally {
      hydrateLockRef.current = false;
    }
  }, [refreshFavoritesList, gatedPlan]);

  useFocusEffect(
    useCallback(() => {
      void hydrate();
    }, [hydrate]),
  );

  useEffect(() => {
    void getPlan().then(setPlan);
  }, [customerInfo]);

  useEffect(() => {
    if (scannerModalVisible) {
      scannerDismissedForHandoffRef.current = false;
      return;
    }
    scannerDismissedForHandoffRef.current = true;
    if (Platform.OS === 'ios') {
      return;
    }
    commitPendingPostScanOutcome();
  }, [scannerModalVisible, commitPendingPostScanOutcome]);

  useEffect(() => {
    if (!resultModalVisible || !displayScan) {
      setModalProductId(null);
      setModalFavorited(false);
      return;
    }
    const unknownPlaceholder =
      displayScan.verdict === 'unknown' && String(displayScan.productName ?? '').trim() === 'Unknown product';
    if (unknownPlaceholder && modalScan != null && activeModalScanId === null) {
      setModalProductId(null);
      setModalFavorited(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const client = getSupabase();
      const profileId = await getCachedSupabaseProfileId();
      if (!client || !profileId) {
        if (!cancelled) {
          setModalProductId(null);
          setModalFavorited(false);
        }
        return;
      }
      const pid = await getOrCreateProductId(client, displayScan);
      if (cancelled) {
        return;
      }
      setModalProductId(pid);
      if (effectivePlan === 'unlimited' && pid) {
        setModalFavorited(await isFavorite(client, profileId, pid));
      } else {
        setModalFavorited(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resultModalVisible, displayScan, effectivePlan, modalScan, activeModalScanId]);

  const onCloseModal = () => {
    clearPostScanHandoff();
    setScanPipelineLoading(false);
    setScanProgressKey(null);
    scanPipelineLoadingRef.current = false;
    setScanError(null);
    setUnknownResultVisible(false);
    setUnknownScan(null);
    isProcessingScanRef.current = false;
    setResultModalVisible(false);
    setActiveModalScanId(null);
    setModalScan(null);
    setResultReuseBanner(null);
    setScannerModalVisible(false);
    setModalProductId(null);
    setModalFavorited(false);
    setFavoriteActionBusy(false);
  };

  const onCloseUnknownModal = () => {
    clearPostScanHandoff();
    setUnknownResultVisible(false);
    setUnknownScan(null);
    setScanPipelineLoading(false);
    setScanProgressKey(null);
    setScanProgressTextOverride(null);
    scanPipelineLoadingRef.current = false;
    isProcessingScanRef.current = false;
    setScannerModalVisible(false);
  };

  const onUnknownTryAgain = () => {
    clearPostScanHandoff();
    setUnknownResultVisible(false);
    setUnknownScan(null);
    setScanPipelineLoading(false);
    setScanProgressKey(null);
    setScanProgressTextOverride(null);
    scanPipelineLoadingRef.current = false;
    isProcessingScanRef.current = false;
    setScannerCameraKey((k) => k + 1);
    setScannerModalVisible(true);
  };

  const dismissScanError = () => {
    clearPostScanHandoff();
    setScanError(null);
    setUnknownResultVisible(false);
    setUnknownScan(null);
    setScanPipelineLoading(false);
    setScanProgressKey(null);
    setScanProgressTextOverride(null);
    scanPipelineLoadingRef.current = false;
    isProcessingScanRef.current = false;
  };

  const onScanErrorTryAgain = () => {
    dismissScanError();
    setScannerCameraKey((k) => k + 1);
    setScannerModalVisible(true);
  };

  const navigatePaywall = (opts?: {
    preselect?: 'unlimited';
    closeResultModalFirst?: boolean;
    source?: 'scan_locked';
  }) => {
    if (opts?.closeResultModalFirst) {
      onCloseModal();
    }
    const push = () => {
      if (opts?.preselect === 'unlimited' || opts?.source) {
        router.push({
          pathname: '/paywall',
          params: {
            ...(opts.preselect === 'unlimited' ? { plan: opts.preselect } : {}),
            ...(opts.source ? { source: opts.source } : {}),
          },
        });
      } else {
        router.push('/paywall');
      }
    };
    if (opts?.closeResultModalFirst) {
      queueMicrotask(push);
    } else {
      push();
    }
  };

  const promptFavoritesUnlimitedUpsell = () => {
    showFavoritesUnlimitedUpsell(() => {
      navigatePaywall({
        preselect: 'unlimited',
        closeResultModalFirst: resultModalVisibleRef.current || unknownResultVisibleRef.current,
      });
    });
  };

  const closeScannerSession = useCallback(() => {
    clearPostScanHandoff();
    setScannerModalVisible(false);
    setScanPipelineLoading(false);
    setScanProgressKey(null);
    setScanProgressTextOverride(null);
    scanPipelineLoadingRef.current = false;
    isProcessingScanRef.current = false;
  }, [clearPostScanHandoff]);

  const openScanner = async () => {
    preferManualRescanRef.current = false;
    await waitUntilPreferencesSyncIdle();
    if (scanPipelineLoadingRef.current || isProcessingScanRef.current) {
      return;
    }
    if (cameraPermission && !cameraPermission.granted) {
      const res = await requestCameraPermission();
      if (!res.granted) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }
    }
    isProcessingScanRef.current = false;
    clearPostScanHandoff();
    setScanError(null);
    setUnknownResultVisible(false);
    setUnknownScan(null);
    setScanPipelineLoading(false);
    setScanProgressKey(null);
    setScanProgressTextOverride(null);
    scanPipelineLoadingRef.current = false;
    setScannerCameraKey((k) => k + 1);
    setScannerModalVisible(true);
  };

  const handleBarcodeScanned = async ({ data, skipLockedPaywall = false }: { data: string; skipLockedPaywall?: boolean }) => {
    const scanBlocked = () =>
      !data ||
      isProcessingScanRef.current ||
      resultModalVisibleRef.current ||
      scanPipelineLoadingRef.current ||
      scanErrorVisibleRef.current ||
      unknownResultVisibleRef.current ||
      expectingScannerDismissHandoffRef.current;

    if (scanBlocked()) {
      return;
    }

    await waitUntilPreferencesSyncIdle();

    if (scanBlocked()) {
      return;
    }

    isProcessingScanRef.current = true;
    setScanError(null);
    setScannerModalVisible(false);
    scanPipelineLoadingRef.current = true;
    setScanProgressKey('scan.progress.checking_db');
    setScanProgressTextOverride(null);
    setScanPipelineLoading(true);
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[scanFlow] loading overlay visible');
    }

    try {
      const [childAgeProfile, avoids, freshRecent, latestStoredPlan] = await Promise.all([
        getChildAgeProfile(),
        getAvoidPreferences(),
        getRecentScans(),
        getPlan(),
      ]);
      const latestEffectivePlan = gatedPlan(latestStoredPlan);
      setPlan(latestStoredPlan);
      const normBarcode = data.trim();
      const contextKey = buildScanAnalysisContextKey(
        normBarcode,
        serializeChildAgePreferenceForContext(childAgeProfile),
        avoids,
      );
      const reusable = findRecentScanForReuse(freshRecent, normBarcode, contextKey);

      if (reusable) {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        pendingPostScanOutcomeRef.current = {
          kind: 'known',
          reuseBanner: t('scan.reuseBanner', getAppLanguage()),
          nextScans: freshRecent,
          modalScan: reusable,
          activeId: reusable.id,
          daily: null,
          childAgeProfile,
          supabaseScan: null,
        };
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[scanFlow] pending outcome stored', { kind: 'known', route: 'reuse' });
        }
        expectingScannerDismissHandoffRef.current = true;
        if (scannerDismissedForHandoffRef.current) {
          queueMicrotask(() => {
            commitPendingPostScanOutcome();
          });
        }
        return;
      }

      const allowed = skipLockedPaywall || (await canUseSuccessfulScanForPlan(latestEffectivePlan));
      if (!allowed) {
        console.log('scan_blocked_paywall', { barcode: normBarcode });
        pendingPostScanOutcomeRef.current = null;
        expectingScannerDismissHandoffRef.current = false;
        scannerDismissedForHandoffRef.current = false;
        setPendingLockedScanBarcode(normBarcode);
        setPendingLockedScanProductPreview({ barcode: normBarcode });
        pendingLockedScanBarcodeRef.current = normBarcode;
        pendingLockedScanProductPreviewRef.current = { barcode: normBarcode };
        isProcessingScanRef.current = false;
        setScanProgressKey(null);
        setScanProgressTextOverride('Analyzing ingredients...');
        console.log('scan_locked_analyzing_shown');
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        await delay(SCAN_LOCKED_ANALYZING_DELAY_MS);
        navigatePaywall({ preselect: 'unlimited', source: 'scan_locked' });
        return;
      }

      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      const scanBuildOptions = {
        onProgress: setScanProgressKey,
        recentScansForProductReuse: freshRecent,
      } as const;

      let outcome: { scan: RecentScan; isSuccessfulProductScan: boolean };
      try {
        outcome = await buildRecentScanFromBarcode(data, scanBuildOptions);
      } catch {
        outcome = {
          scan: createFallbackRecentScan(data, (await getChildAgeProfile()).completedWholeYears),
          isSuccessfulProductScan: false,
        };
      }

      try {
        const { scan, isSuccessfulProductScan } = outcome;
        if (isSuccessfulProductScan) {
          const next = await addRecentScan(scan, 15000);
          const st = await incrementSuccessfulScanCountIfNeeded();
          pendingPostScanOutcomeRef.current = {
            kind: 'known',
            reuseBanner: null,
            nextScans: next,
            modalScan: scan,
            activeId: scan.id,
            daily: st,
            childAgeProfile,
            supabaseScan: scan,
          };
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn('[scanFlow] pending outcome stored', { kind: 'known', route: 'new' });
          }
        } else {
          pendingPostScanOutcomeRef.current = { kind: 'unknown', scan };
          if (typeof __DEV__ !== 'undefined' && __DEV__) {
            console.warn('[scanFlow] pending outcome stored', { kind: 'unknown' });
          }
        }
        expectingScannerDismissHandoffRef.current = true;
        if (scannerDismissedForHandoffRef.current) {
          queueMicrotask(() => {
            commitPendingPostScanOutcome();
          });
        }
      } catch (err) {
        console.warn('[home] scan save failed', err);
        pendingPostScanOutcomeRef.current = {
          kind: 'error',
          title: t('common.somethingWrong', getAppLanguage()),
          message: err instanceof Error ? err.message : t('error.saveScan', getAppLanguage()),
        };
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[scanFlow] pending outcome stored', { kind: 'error', reason: 'save_failed' });
        }
        expectingScannerDismissHandoffRef.current = true;
        if (scannerDismissedForHandoffRef.current) {
          queueMicrotask(() => {
            commitPendingPostScanOutcome();
          });
        }
      }
    } catch (err) {
      console.warn('[home] handleBarcodeScanned', err);
      pendingPostScanOutcomeRef.current = {
        kind: 'error',
        title: t('common.somethingWrong', getAppLanguage()),
        message: err instanceof Error ? err.message : t('error.generic', getAppLanguage()),
      };
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.warn('[scanFlow] pending outcome stored', { kind: 'error', reason: 'pipeline' });
      }
      expectingScannerDismissHandoffRef.current = true;
      if (scannerDismissedForHandoffRef.current) {
        queueMicrotask(() => {
          commitPendingPostScanOutcome();
        });
      }
    } finally {
      if (!expectingScannerDismissHandoffRef.current) {
        setScanPipelineLoading(false);
        setScanProgressKey(null);
        setScanProgressTextOverride(null);
        scanPipelineLoadingRef.current = false;
        isProcessingScanRef.current = false;
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[scanFlow] loading hidden');
        }
      } else if (pendingPostScanOutcomeRef.current) {
        queueMicrotask(() => {
          commitPendingPostScanOutcome();
        });
      }
    }
  };

  handleBarcodeScannedRef.current = handleBarcodeScanned;

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      const resumeLockedScanIfUnlocked = async () => {
        const barcode = pendingLockedScanBarcodeRef.current;
        if (!barcode) {
          return;
        }

        await waitUntilPreferencesSyncIdle();
        const storedPlan = await getPlan();
        const latestEffectivePlan = gatedPlan(storedPlan);
        setPlan(storedPlan);

        if (cancelled || (latestEffectivePlan !== 'unlimited' && storedPlan !== 'unlimited')) {
          return;
        }

        setPendingLockedScanBarcode(null);
        setPendingLockedScanProductPreview(null);
        pendingLockedScanBarcodeRef.current = null;
        pendingLockedScanProductPreviewRef.current = null;

        queueMicrotask(() => {
          void handleBarcodeScannedRef.current?.({ data: barcode, skipLockedPaywall: true });
        });
      };

      void resumeLockedScanIfUnlocked();

      return () => {
        cancelled = true;
      };
    }, [gatedPlan]),
  );

  const openManualBarcodeEntry = async () => {
    await waitUntilPreferencesSyncIdle();
    if (scanPipelineLoadingRef.current || isProcessingScanRef.current) {
      return;
    }
    setManualBarcodeError(null);
    setManualBarcodeValue('');
    setManualBarcodeVisible(true);
  };

  const closeManualBarcodeEntry = () => {
    setManualBarcodeVisible(false);
    setManualBarcodeError(null);
    Keyboard.dismiss();
  };

  const submitManualBarcode = async () => {
    const digits = digitsOnlyFromBarcodeInput(manualBarcodeValue);
    if (!isValidManualBarcodeDigits(digits)) {
      setManualBarcodeError(t('home.manualBarcodeInvalid', getAppLanguage()));
      return;
    }
    await waitUntilPreferencesSyncIdle();
    if (scanPipelineLoadingRef.current || isProcessingScanRef.current) {
      return;
    }
    setManualBarcodeError(null);
    setManualBarcodeVisible(false);
    Keyboard.dismiss();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    preferManualRescanRef.current = true;
    queueMicrotask(() => {
      void handleBarcodeScanned({ data: digits });
    });
  };

  const onScanAgain = () => {
    clearPostScanHandoff();
    setScanPipelineLoading(false);
    setScanProgressKey(null);
    setScanProgressTextOverride(null);
    scanPipelineLoadingRef.current = false;
    setScanError(null);
    setUnknownResultVisible(false);
    setUnknownScan(null);
    isProcessingScanRef.current = false;
    setResultModalVisible(false);
    setActiveModalScanId(null);
    setModalScan(null);
    setResultReuseBanner(null);
    setModalProductId(null);
    setModalFavorited(false);
    setFavoriteActionBusy(false);
    if (preferManualRescanRef.current) {
      void openManualBarcodeEntry();
      return;
    }
    setScannerCameraKey((k) => k + 1);
    setScannerModalVisible(true);
  };

  const openSavedScanById = async (scanId: string) => {
    clearPostScanHandoff();
    setScanError(null);
    setUnknownResultVisible(false);
    setUnknownScan(null);
    setScanPipelineLoading(false);
    setScanProgressKey(null);
    setScanProgressTextOverride(null);
    scanPipelineLoadingRef.current = false;
    setScannerModalVisible(false);
    setModalScan(null);
    const freshPlan = await getPlan();
    setPlan(freshPlan);
    setActiveModalScanId(scanId);
    setResultReuseBanner(null);
    setResultModalVisible(true);
  };

  const openFavoriteItem = async (item: FavoriteListItem) => {
    const scan = recentScanFromFavoriteItem(item, recentScans);
    clearPostScanHandoff();
    setScanError(null);
    setUnknownResultVisible(false);
    setUnknownScan(null);
    setScanPipelineLoading(false);
    setScanProgressKey(null);
    setScanProgressTextOverride(null);
    scanPipelineLoadingRef.current = false;
    setScannerModalVisible(false);
    setActiveModalScanId(null);
    const freshPlan = await getPlan();
    setPlan(freshPlan);
    setModalScan(scan);
    setResultReuseBanner(null);
    setResultModalVisible(true);
  };

  const saveScanToFavorites = async (scan: RecentScan, nextSaved: boolean): Promise<boolean> => {
    if (effectivePlan !== 'unlimited') {
      setFavoriteUpsellVisible(true);
      return false;
    }
    if (!isSupabaseConfigured()) {
      console.warn('[home] swipe favorite: Supabase not configured');
      return false;
    }
    const previousFavorites = favoritesList;
    const existingFavorite = previousFavorites.find((item) => favoriteMatchesScan(item, scan)) ?? null;
    setFavoritesList((current) => {
      const exists = current.some((item) => favoriteMatchesScan(item, scan));
      if (nextSaved) {
        return exists ? current : [optimisticFavoriteFromScan(scan), ...current].slice(0, 5);
      }
      return current.filter((item) => !favoriteMatchesScan(item, scan));
    });
    try {
      let profileId = await getCachedSupabaseProfileId();
      if (!profileId) {
        await ensureSupabaseProfileLocal();
        profileId = await getCachedSupabaseProfileId();
      }
      const client = getSupabase();
      if (!profileId || !client) {
        console.warn('[home] swipe favorite: missing profile or client');
        setFavoritesList(previousFavorites);
        return false;
      }
      const productId = existingFavorite?.productId ?? (await getOrCreateProductId(client, scan));
      if (!productId) {
        console.warn('[home] swipe favorite: could not resolve product_id');
        setFavoritesList(previousFavorites);
        return false;
      }

      if (nextSaved) {
        const favorited = await isFavorite(client, profileId, productId);
        if (!favorited) {
          const ok = await addFavorite(client, profileId, productId);
          if (!ok) {
            console.warn('[home] swipe favorite: add failed');
            setFavoritesList(previousFavorites);
            return false;
          }
        }
      } else {
        const ok = await removeFavorite(client, profileId, productId);
        if (!ok) {
          console.warn('[home] swipe favorite: remove failed');
          setFavoritesList(previousFavorites);
          return false;
        }
      }
      await refreshFavoritesList();
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return true;
    } catch (err) {
      console.warn('[home] saveScanToFavorites', err);
      setFavoritesList(previousFavorites);
      return false;
    }
  };

  const confirmDeleteRecentScan = async () => {
    if (!pendingDeleteScan) {
      return;
    }
    const scan = pendingDeleteScan;
    const scanId = pendingDeleteScan.id;
    const next = await removeRecentScanById(scanId);
    const previousFavorites = favoritesList;
    const matchingFavorite = previousFavorites.find((item) => favoriteMatchesScan(item, scan)) ?? null;
    setRecentScans(next);
    if (matchingFavorite) {
      setFavoritesList((current) => current.filter((item) => !favoriteMatchesScan(item, scan)));
    }
    if (activeModalScanId === scanId) {
      onCloseModal();
    }
    setPendingDeleteScan(null);
    if (matchingFavorite && isSupabaseConfigured()) {
      try {
        const profileId = await getCachedSupabaseProfileId();
        const client = getSupabase();
        if (profileId && client) {
          const ok = await removeFavorite(client, profileId, matchingFavorite.productId);
          if (!ok) {
            setFavoritesList(previousFavorites);
          } else {
            await refreshFavoritesList();
          }
        } else {
          setFavoritesList(previousFavorites);
        }
      } catch (err) {
        console.warn('[home] delete recent remove favorite', err);
        setFavoritesList(previousFavorites);
      }
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const onFavoriteControlPress = async () => {
    if (effectivePlan !== 'unlimited') {
      promptFavoritesUnlimitedUpsell();
      return;
    }
    if (!displayScan) {
      return;
    }
    if (!isSupabaseConfigured()) {
      console.warn('[home] favorite: Supabase not configured');
      return;
    }
    setFavoriteActionBusy(true);
    try {
      let profileId = await getCachedSupabaseProfileId();
      if (!profileId) {
        await ensureSupabaseProfileLocal();
        profileId = await getCachedSupabaseProfileId();
      }
      const client = getSupabase();
      if (!profileId || !client) {
        console.warn('[home] favorite: missing profile or client');
        return;
      }

      let productId = modalProductId;
      if (!productId) {
        productId = await getOrCreateProductId(client, displayScan);
      }
      if (!productId) {
        console.warn('[home] favorite: could not resolve product_id');
        return;
      }
      setModalProductId(productId);

      const favorited = await isFavorite(client, profileId, productId);
      if (favorited) {
        const ok = await removeFavorite(client, profileId, productId);
        if (!ok) {
          console.warn('[home] favorite: remove failed');
        }
      } else {
        const ok = await addFavorite(client, profileId, productId);
        if (!ok) {
          console.warn('[home] favorite: add failed');
        }
      }

      const after = await isFavorite(client, profileId, productId);
      setModalFavorited(after);
      await refreshFavoritesList();
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } finally {
      setFavoriteActionBusy(false);
    }
  };

  const scanForResultModal = resultModalVisible ? (modalScan ?? displayScan) : null;
  const scanBadge = freeScanBadge(dailyScanState.count);
  const scanProgressText = scanProgressTextOverride ?? (scanProgressKey ? t(scanProgressKey, lang) : t('loading.checking', lang));
  const scanAnalysisTitle = analysisOverlayTitle(scanProgressTextOverride);
  const scanAnalysisSubtitle = ANALYSIS_VISUAL_STEPS[analysisVisualStepIndex]?.label ?? scanProgressText;

  return (
    <SafeAreaView
      style={{ flex: 1, position: 'relative', backgroundColor: M.bgPage }}
      edges={['top', 'left', 'right']}
    >
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: isNarrowAndroid ? 16 : 20,
          paddingTop: 16,
          paddingBottom: 28,
          gap: 20,
        }}
      >
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
            <Pressable
              onPress={() => router.push('/preferences')}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={{
                width: 44,
                height: 44,
                borderRadius: M.r14,
                backgroundColor: M.bgCardMuted,
                borderWidth: 1,
                borderColor: M.line,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="options-outline" size={22} color={M.ink} />
            </Pressable>
            {effectivePlan === 'free' ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  flexWrap: 'wrap',
                  flexShrink: 1,
                  gap: 8,
                marginLeft: 0,
                maxWidth: Math.max(0, windowWidth - (isNarrowAndroid ? 86 : 96)),
                }}
              >
                <Pressable
                  onPress={() => navigatePaywall({ preselect: 'unlimited' })}
                  style={{
                    borderRadius: 999,
                    backgroundColor: scanBadge.bg,
                    borderWidth: 1,
                    borderColor: scanBadge.border,
                    paddingHorizontal: 11,
                    paddingVertical: 7,
                    maxWidth: isNarrowAndroid ? 152 : 190,
                  }}
                >
                  <Text style={{ fontSize: 12, lineHeight: 16, fontWeight: '800', color: scanBadge.text }}>
                    {scanBadge.label}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => navigatePaywall({ preselect: 'unlimited' })}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 7,
                    borderRadius: 999,
                    backgroundColor: M.inkButton,
                  }}
                >
                  <Text
                    style={{
                      fontSize: isNarrowAndroid ? 11 : 12,
                      lineHeight: 15,
                      fontWeight: '800',
                      color: M.cream,
                      textAlign: 'center',
                    }}
                  >
                    Go Unlimited
                  </Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => navigatePaywall()}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: M.bgChip,
                  borderWidth: 1,
                  borderColor: M.line,
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '700', color: M.textMuted, letterSpacing: 0.4 }}>
                  {t('common.unlimited', lang)}
                </Text>
              </Pressable>
            )}
          </View>
        </View>

        <View
          style={{
            borderRadius: M.r28,
            backgroundColor: M.bgCard,
            padding: 18,
            borderWidth: 1,
            borderColor: M.line,
            overflow: 'hidden',
            ...M.shadowCard,
          }}
        >
          <Text style={{ fontSize: 29, lineHeight: 34, fontWeight: '700', color: M.text }}>
            Scan a product
          </Text>
          <Text style={{ marginTop: 10, fontSize: 16, lineHeight: 23, color: M.textBody }}>
            {"Check if it's safe for your child in 2 seconds"}
          </Text>

          <Pressable
            onPress={openScanner}
            style={{
              marginTop: 18,
              borderRadius: M.r18,
              backgroundColor: M.inkButton,
              paddingVertical: 19,
              alignItems: 'center',
              ...M.shadowSoft,
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: '800', color: M.cream }}>Scan product</Text>
          </Pressable>

          <View style={{ marginTop: 16, alignItems: 'center' }}>
            <Text
              style={{
                fontSize: 12,
                fontWeight: '700',
                color: M.textSoft,
                letterSpacing: 2,
              }}
            >
              {t('home.or', lang)}
            </Text>
          </View>

          <Pressable
            onPress={openManualBarcodeEntry}
            disabled={scanPipelineLoading}
            accessibilityRole="button"
            accessibilityLabel={t('home.enterBarcodeManually', lang)}
            style={({ pressed }) => ({
              marginTop: 12,
              opacity: scanPipelineLoading ? 0.55 : pressed ? 0.92 : 1,
            })}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 13,
                paddingHorizontal: 16,
                borderRadius: M.r16,
                backgroundColor: 'rgba(255,252,247,0.82)',
                borderWidth: 1,
                borderColor: M.lineSage,
                gap: 12,
                ...M.shadowSoft,
              }}
            >
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 999,
                  backgroundColor: M.sageWash,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="barcode-outline" size={19} color={M.sageDeep} />
              </View>
              <Text style={{ flex: 1, minWidth: 0, fontSize: 15, lineHeight: 21, fontWeight: '600', color: M.textBody }}>
                {t('home.enterBarcodeManually', lang)}
              </Text>
              <Ionicons name="chevron-forward" size={20} color={M.textSoft} />
            </View>
          </Pressable>
        </View>

        <Pressable
          onPress={() => router.push('/share-video')}
          accessibilityRole="button"
          accessibilityLabel="Submit a KidLens video"
          style={({ pressed }) => ({
            borderRadius: M.r18,
            backgroundColor: M.bgCardMuted,
            borderWidth: 1,
            borderColor: M.line,
            paddingVertical: 14,
            paddingHorizontal: 15,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            opacity: pressed ? 0.72 : 1,
            ...M.shadowSoft,
          })}
        >
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 999,
              backgroundColor: M.bgChipSelected,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="videocam-outline" size={18} color={M.textMuted} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 15, lineHeight: 20, fontWeight: '800', color: M.text }}>
              Share your KidLens video
            </Text>
            <Text style={{ marginTop: 3, fontSize: 13, lineHeight: 18, fontWeight: '600', color: M.textMuted }}>
              Best videos get rewarded
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={M.textSoft} />
          </Pressable>

        <View style={{ gap: 12 }}>
          <Text style={{ fontSize: 21, fontWeight: '700', color: M.text }}>Recent scans</Text>

          {recentScans.length === 0 ? (
            <>
              {[0, 1, 2].map((item) => (
                <View
                  key={String(item)}
                  style={{
                    borderRadius: M.r18,
                    backgroundColor: M.bgCard,
                    padding: 16,
                    borderWidth: 1,
                    borderColor: M.line,
                  }}
                >
                  <View
                    style={{
                      height: 14,
                      width: '46%',
                      borderRadius: 8,
                      backgroundColor: M.bgCardMuted,
                    }}
                  />
                  <View
                    style={{
                      marginTop: 12,
                      height: 12,
                      width: '80%',
                      borderRadius: 8,
                      backgroundColor: M.bgChip,
                    }}
                  />
                </View>
              ))}
            </>
          ) : (
            recentScans.map((scan) => (
              <RecentScanCard
                key={scan.id}
                scan={scan}
                isSaved={favoritesList.some((item) => favoriteMatchesScan(item, scan))}
                onPress={openSavedScanById}
                onSave={saveScanToFavorites}
                onDelete={setPendingDeleteScan}
              />
            ))
          )}
        </View>

        <View style={{ gap: 10 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: M.text }}>{t('home.favorites', lang)}</Text>
          {effectivePlan === 'unlimited' ? (
            favoritesList.length === 0 ? (
              <Text style={{ fontSize: 14, color: M.textSoft, fontWeight: '600', fontStyle: 'italic' }}>
                {t('home.noFavorites', lang)}
              </Text>
            ) : (
              favoritesList.map((item) => (
                <Pressable
                  key={item.favoriteId}
                  onPress={() => openFavoriteItem(item)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    borderRadius: M.r16,
                    backgroundColor: M.bgCard,
                    paddingVertical: 12,
                    paddingHorizontal: 14,
                    borderWidth: 1,
                    borderColor: M.line,
                    ...M.shadowSoft,
                  }}
                >
                  <Ionicons name="heart" size={18} color="#B85C5C" />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: M.text }} numberOfLines={1}>
                      {item.productName}
                    </Text>
                    <Text style={{ marginTop: 4, fontSize: 12, color: M.textSoft }} numberOfLines={1}>
                      {item.barcode}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={M.lineStrong} />
                </Pressable>
              ))
            )
          ) : (
            <Pressable
              onPress={promptFavoritesUnlimitedUpsell}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                alignSelf: 'flex-start',
                paddingVertical: 8,
                paddingHorizontal: 12,
                borderRadius: M.r12,
                backgroundColor: M.bgChip,
                borderWidth: 1,
                borderColor: M.line,
              }}
            >
              <Ionicons name="lock-closed-outline" size={16} color={M.gold} />
              <Text style={{ flexShrink: 1, fontSize: 13, lineHeight: 18, fontWeight: '600', color: M.textSoft }}>
                {t('home.favoritesLocked', lang)}
              </Text>
            </Pressable>
          )}
        </View>

        <Pressable
          onPress={() => setSupportModalVisible(true)}
          style={{
            alignSelf: 'center',
            marginTop: 8,
            paddingVertical: 10,
            paddingHorizontal: 14,
          }}
        >
          <Text style={{ fontSize: 14, color: M.textSoft, fontWeight: '600' }}>Support</Text>
        </Pressable>
      </ScrollView>
      <Modal
        visible={supportModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSupportModalVisible(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: M.overlay,
            justifyContent: 'center',
            paddingHorizontal: 24,
          }}
        >
          <View
            style={{
              borderRadius: M.r24,
              backgroundColor: M.bgCard,
              padding: 22,
              width: '100%',
              maxWidth: 360,
              alignSelf: 'center',
              ...M.shadowCard,
            }}
          >
            <Text style={{ fontSize: 22, fontWeight: '700', color: M.text }}>Support</Text>
            <Text style={{ marginTop: 14, fontSize: 15, lineHeight: 22, color: M.textBody }}>Contact us at</Text>
            <Text
              style={{ marginTop: 10, fontSize: 17, fontWeight: '700', color: M.ink, letterSpacing: 0.2 }}
              selectable
            >
              kidlensai@gmail.com
            </Text>
            <Pressable
              onPress={() => setSupportModalVisible(false)}
              style={{
                marginTop: 22,
                borderRadius: M.r14,
                backgroundColor: M.inkButton,
                alignItems: 'center',
                paddingVertical: 14,
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '700', color: M.cream }}>{t('common.close', lang)}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        visible={favoriteUpsellVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setFavoriteUpsellVisible(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: M.overlay,
            justifyContent: 'center',
            paddingHorizontal: 24,
          }}
        >
          <View
            style={{
              borderRadius: M.r24,
              backgroundColor: M.bgCard,
              padding: 22,
              width: '100%',
              maxWidth: 360,
              alignSelf: 'center',
              ...M.shadowCard,
            }}
          >
            <Text style={{ fontSize: 22, lineHeight: 28, fontWeight: '800', color: M.text }}>Save products to favorites</Text>
            <Text style={{ marginTop: 12, fontSize: 15, lineHeight: 22, color: M.textBody }}>Available in Unlimited plan</Text>
            <Pressable
              onPress={() => {
                setFavoriteUpsellVisible(false);
                navigatePaywall({ preselect: 'unlimited' });
              }}
              style={{
                marginTop: 22,
                borderRadius: M.r14,
                backgroundColor: M.inkButton,
                alignItems: 'center',
                paddingVertical: 14,
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '800', color: M.cream }}>Unlock feature</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        visible={pendingDeleteScan != null}
        transparent
        animationType="fade"
        onRequestClose={() => setPendingDeleteScan(null)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: M.overlay,
            justifyContent: 'center',
            paddingHorizontal: 24,
          }}
        >
          <View
            style={{
              borderRadius: M.r24,
              backgroundColor: M.bgCard,
              padding: 22,
              width: '100%',
              maxWidth: 360,
              alignSelf: 'center',
              ...M.shadowCard,
            }}
          >
            <Text style={{ fontSize: 22, lineHeight: 28, fontWeight: '800', color: M.text }}>Delete this scan?</Text>
            <Text style={{ marginTop: 12, fontSize: 15, lineHeight: 22, color: M.textBody }}>This action cannot be undone</Text>
            <View style={{ marginTop: 22, flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={() => void confirmDeleteRecentScan()}
                style={{
                  flex: 1,
                  borderRadius: M.r14,
                  backgroundColor: '#7A2E2E',
                  alignItems: 'center',
                  paddingVertical: 13,
                }}
              >
                <Text style={{ fontSize: 15, fontWeight: '800', color: M.cream }}>Delete</Text>
              </Pressable>
              <Pressable
                onPress={() => setPendingDeleteScan(null)}
                style={{
                  flex: 1,
                  borderRadius: M.r14,
                  backgroundColor: M.bgChipSelected,
                  alignItems: 'center',
                  paddingVertical: 13,
                }}
              >
                <Text style={{ fontSize: 15, fontWeight: '800', color: M.textBody }}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      {scanError ? (
        <View
          pointerEvents="auto"
          style={[
            StyleSheet.absoluteFillObject,
            {
              zIndex: 88,
              backgroundColor: M.overlay,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 20,
            },
          ]}
        >
          <View
            style={{
              borderRadius: M.r24,
              backgroundColor: M.bgCard,
              padding: 22,
              width: '100%',
              maxWidth: 360,
              ...M.shadowCard,
            }}
          >
            <Text style={{ fontSize: 22, fontWeight: '700', color: M.text }}>{scanError.title}</Text>
            <Text style={{ marginTop: 12, fontSize: 15, lineHeight: 22, color: M.textBody }}>{scanError.message}</Text>
            <View style={{ marginTop: 22, flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={dismissScanError}
                style={{
                  flex: 1,
                  borderRadius: M.r14,
                  backgroundColor: M.bgChipSelected,
                  alignItems: 'center',
                  paddingVertical: 13,
                }}
              >
                <Text style={{ fontSize: 15, fontWeight: '700', color: M.textBody }}>{t('common.close', lang)}</Text>
              </Pressable>
              <Pressable
                onPress={onScanErrorTryAgain}
                style={{
                  flex: 1,
                  borderRadius: M.r14,
                  backgroundColor: M.inkButton,
                  alignItems: 'center',
                  paddingVertical: 13,
                }}
              >
                <Text style={{ fontSize: 15, fontWeight: '700', color: M.cream }}>{t('common.tryAgain', lang)}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
      {unknownResultVisible && unknownScan ? (
        <View
          pointerEvents="auto"
          style={[
            StyleSheet.absoluteFillObject,
            {
              zIndex: 92,
              backgroundColor: M.overlay,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 20,
            },
          ]}
        >
          <View
            style={{
              borderRadius: M.r24,
              backgroundColor: M.bgCard,
              padding: 22,
              width: '100%',
              maxWidth: 360,
              ...M.shadowCard,
            }}
          >
            <Text style={{ fontSize: 13, color: M.textMuted, fontWeight: '600' }}>{t('common.scanResult', lang)}</Text>
            <Text style={{ marginTop: 14, fontSize: 26, lineHeight: 32, color: M.text, fontWeight: '700' }}>
              {t('result.unknownProduct', lang)}
            </Text>
            <Text style={{ marginTop: 12, fontSize: 15, lineHeight: 22, color: M.textBody }}>
              {t('result.unknownBody', lang)}
            </Text>
            <Text style={{ marginTop: 14, fontSize: 13, color: M.textMuted }}>
              {t('result.barcodeLabel', lang)} {String(unknownScan.barcode ?? '').trim() || '-'}
            </Text>
            <View style={{ marginTop: 24, flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={onCloseUnknownModal}
                style={{
                  flex: 1,
                  borderRadius: M.r14,
                  backgroundColor: M.bgChipSelected,
                  alignItems: 'center',
                  paddingVertical: 13,
                }}
              >
                <Text style={{ fontSize: 15, fontWeight: '700', color: M.textBody }}>{t('common.close', lang)}</Text>
              </Pressable>
              <Pressable
                onPress={onUnknownTryAgain}
                style={{
                  flex: 1,
                  borderRadius: M.r14,
                  backgroundColor: M.inkButton,
                  alignItems: 'center',
                  paddingVertical: 13,
                }}
              >
                <Text style={{ fontSize: 15, fontWeight: '700', color: M.cream }}>{t('common.tryAgain', lang)}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
      <Modal
        visible={manualBarcodeVisible}
        transparent
        animationType="fade"
        onRequestClose={closeManualBarcodeEntry}
      >
        <View style={{ flex: 1 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.close', lang)}
            onPress={closeManualBarcodeEntry}
            style={[StyleSheet.absoluteFillObject, { backgroundColor: M.overlay }]}
          />
          <View
            pointerEvents="box-none"
            style={{
              flex: 1,
              justifyContent: 'center',
              paddingHorizontal: isNarrowAndroid ? 16 : 22,
            }}
          >
            <View
              style={{
                borderRadius: M.r22,
                backgroundColor: M.bgCard,
                padding: 20,
                width: '100%',
                maxWidth: 400,
                alignSelf: 'center',
                ...M.shadowCard,
              }}
            >
              <Text style={{ fontSize: 20, lineHeight: 26, fontWeight: '800', color: M.text }}>
                {t('home.manualBarcodeTitle', lang)}
              </Text>
              <Text style={{ marginTop: 8, fontSize: 14, lineHeight: 20, color: M.textMuted }}>{t('home.manualBarcodeHint', lang)}</Text>
              <TextInput
                value={manualBarcodeValue}
                onChangeText={(v) => {
                  setManualBarcodeError(null);
                  setManualBarcodeValue(digitsOnlyFromBarcodeInput(v).slice(0, 14));
                }}
                placeholder={t('home.manualBarcodePlaceholder', lang)}
                placeholderTextColor={M.textSoft}
                keyboardType="number-pad"
                autoCorrect={false}
                autoCapitalize="none"
                editable={!scanPipelineLoading}
                returnKeyType="done"
                onSubmitEditing={submitManualBarcode}
                style={{
                  marginTop: 14,
                  borderRadius: M.r14,
                  borderWidth: 1,
                  borderColor: manualBarcodeError ? '#C98A7A' : M.line,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  fontSize: 18,
                  lineHeight: 24,
                  fontWeight: '600',
                  color: M.text,
                  backgroundColor: M.bgChip,
                }}
              />
              {manualBarcodeError ? (
                <Text style={{ marginTop: 10, fontSize: 13, lineHeight: 18, color: '#9A4D3C', fontWeight: '600' }}>
                  {manualBarcodeError}
                </Text>
              ) : null}
              <View style={{ marginTop: 18, flexDirection: 'row', gap: 10 }}>
                <Pressable
                  onPress={closeManualBarcodeEntry}
                  style={{
                    flex: 1,
                    borderRadius: M.r14,
                    backgroundColor: M.bgChipSelected,
                    alignItems: 'center',
                    paddingVertical: 14,
                  }}
                >
                  <Text style={{ fontSize: 15, lineHeight: 20, fontWeight: '700', color: M.textBody, textAlign: 'center' }}>
                    {t('home.manualBarcodeCancel', lang)}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={submitManualBarcode}
                  disabled={scanPipelineLoading}
                  style={{
                    flex: 1,
                    borderRadius: M.r14,
                    backgroundColor: scanPipelineLoading ? M.textMuted : M.inkButton,
                    alignItems: 'center',
                    paddingVertical: 14,
                  }}
                >
                  <Text style={{ fontSize: 15, lineHeight: 20, fontWeight: '700', color: M.cream, textAlign: 'center' }}>
                    {t('home.manualBarcodeFind', lang)}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>
      <ScannerModal
        visible={scannerModalVisible}
        cameraInstanceKey={scannerCameraKey}
        onFullyDismissed={
          Platform.OS === 'ios'
            ? () => {
                if (typeof __DEV__ !== 'undefined' && __DEV__) {
                  console.warn('[scanFlow] scanner fully dismissed');
                }
                commitPendingPostScanOutcome();
              }
            : undefined
        }
        onClose={closeScannerSession}
        onBarcodeScanned={handleBarcodeScanned}
        dailyLimitReached={false}
        onDailyLimitPress={() => {
          closeScannerSession();
          navigatePaywall({ preselect: 'unlimited' });
        }}
        cameraPermission={cameraPermission}
        onRequestPermission={() => {
          void requestCameraPermission();
        }}
      />
      {scanPipelineLoading ? (
        <View
          pointerEvents="auto"
          style={[
            StyleSheet.absoluteFillObject,
            {
              zIndex: 100,
              backgroundColor: M.overlay,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 32,
            },
          ]}
        >
          <ScanAnalysisOverlay title={scanAnalysisTitle} subtitle={scanAnalysisSubtitle} visualStepIndex={analysisVisualStepIndex} />
        </View>
      ) : null}
      {resultModalVisible && scanForResultModal ? (
        <ScanResultModal
          visible
          key={scanForResultModal.id}
          scan={scanForResultModal}
          childAge={childAge}
          plan={effectivePlan}
          avoidPreferences={avoidPreferences}
          isFavorited={modalFavorited}
          favoriteLoading={favoriteActionBusy}
          onFavoritePress={onFavoriteControlPress}
          onClose={onCloseModal}
          onScanAgain={onScanAgain}
          onOpenPaywall={() => navigatePaywall({ preselect: 'unlimited', closeResultModalFirst: true })}
          reuseNotice={resultReuseBanner}
        />
      ) : null}
    </SafeAreaView>
  );
}
