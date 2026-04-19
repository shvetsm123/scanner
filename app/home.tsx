import { Ionicons } from '@expo/vector-icons';
import { useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RecentScanCard } from '../src/components/RecentScanCard';
import { ScanResultModal } from '../src/components/ScanResultModal';
import { ScannerModal } from '../src/components/ScannerModal';
import { getAppLanguage, t } from '../src/lib/i18n';
import { digitsOnlyFromBarcodeInput, isValidManualBarcodeDigits } from '../src/lib/manualBarcode';
import { buildRecentScanFromBarcode, createFallbackRecentScan } from '../src/lib/mockScanResult';
import { showFavoritesUnlimitedUpsell } from '../src/lib/favoritesInsightsAlert';
import type { ChildAgeProfile } from '../src/lib/childAgeContext';
import { serializeChildAgePreferenceForContext } from '../src/lib/childAgeContext';
import { buildScanAnalysisContextKey, findRecentScanForReuse } from '../src/lib/scanAnalysisContext';
import {
  addRecentScan,
  canUseSuccessfulScan,
  getAvoidPreferences,
  ensureSupabaseProfileLocal,
  getCachedSupabaseProfileId,
  getChildAgeProfile,
  getDailySuccessfulScanState,
  getPlan,
  getRecentScans,
  incrementSuccessfulScanCountIfNeeded,
  resetAppDataForDev,
  syncRemotePreferencesWithLocal,
  tryPersistSuccessfulScanToSupabase,
  waitUntilPreferencesSyncIdle,
} from '../src/lib/storage';
import {
  addFavorite,
  getFavorites,
  getOrCreateProductId,
  getSupabase,
  isFavorite,
  isSupabaseConfigured,
  removeFavorite,
} from '../src/api/supabase';
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

function freeDailyScanUsageLabel(successCount: number, lang: ReturnType<typeof getAppLanguage>): string {
  const c = Math.min(2, Math.max(0, successCount));
  if (c === 0) {
    return t('home.scansLeft0', lang);
  }
  if (c === 1) {
    return t('home.scansLeft1', lang);
  }
  return t('home.scansLeft2', lang);
}

type DailyScanSnapshot = { dateKey: string; count: number };

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

export default function HomeScreen() {
  const lang = getAppLanguage();
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

  const activeResult = useMemo(() => {
    if (!activeModalScanId) {
      return null;
    }
    return recentScans.find((s) => s.id === activeModalScanId) ?? null;
  }, [activeModalScanId, recentScans]);

  const displayScan = useMemo(() => modalScan ?? activeResult, [modalScan, activeResult]);
  const [scanPipelineLoading, setScanPipelineLoading] = useState(false);
  const [scanError, setScanError] = useState<{ title: string; message: string } | null>(null);
  const [plan, setPlan] = useState<Plan>('free');
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
  const hydrateLockRef = useRef(false);
  const hydrateAgainRef = useRef(false);
  resultModalVisibleRef.current = resultModalVisible;
  scanPipelineLoadingRef.current = scanPipelineLoading;
  scanErrorVisibleRef.current = scanError != null;
  unknownResultVisibleRef.current = unknownResultVisible;
  scannerModalVisibleRef.current = scannerModalVisible;

  const dailyLimitReached = plan === 'free' && dailyScanState.count >= 2;

  const clearPostScanHandoff = useCallback(() => {
    pendingPostScanOutcomeRef.current = null;
    expectingScannerDismissHandoffRef.current = false;
    scannerDismissedForHandoffRef.current = false;
  }, []);

  const commitPendingPostScanOutcome = useCallback(() => {
    const p = pendingPostScanOutcomeRef.current;
    if (p) {
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
  }, []);

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
        if (p === 'unlimited') {
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
  }, [refreshFavoritesList]);

  useFocusEffect(
    useCallback(() => {
      void hydrate();
    }, [hydrate]),
  );

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
      if (plan === 'unlimited' && pid) {
        setModalFavorited(await isFavorite(client, profileId, pid));
      } else {
        setModalFavorited(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resultModalVisible, displayScan, plan, modalScan, activeModalScanId]);

  const onCloseModal = () => {
    clearPostScanHandoff();
    setScanPipelineLoading(false);
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
    scanPipelineLoadingRef.current = false;
    isProcessingScanRef.current = false;
    setScannerModalVisible(false);
  };

  const onUnknownTryAgain = () => {
    clearPostScanHandoff();
    setUnknownResultVisible(false);
    setUnknownScan(null);
    setScanPipelineLoading(false);
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
    scanPipelineLoadingRef.current = false;
    isProcessingScanRef.current = false;
  };

  const onScanErrorTryAgain = () => {
    dismissScanError();
    setScannerCameraKey((k) => k + 1);
    setScannerModalVisible(true);
  };

  const navigatePaywall = (opts?: { preselect?: 'unlimited'; closeResultModalFirst?: boolean }) => {
    if (opts?.closeResultModalFirst) {
      onCloseModal();
    }
    const push = () => {
      if (opts?.preselect === 'unlimited') {
        router.push({ pathname: '/paywall', params: { plan: opts.preselect } });
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
    scanPipelineLoadingRef.current = false;
    isProcessingScanRef.current = false;
  }, [clearPostScanHandoff]);

  const openScanner = async () => {
    if (dailyLimitReached) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      navigatePaywall({ preselect: 'unlimited' });
      return;
    }
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
    scanPipelineLoadingRef.current = false;
    setScannerCameraKey((k) => k + 1);
    setScannerModalVisible(true);
  };

  const handleBarcodeScanned = async ({ data }: { data: string }) => {
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
    setScanPipelineLoading(true);
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn('[scanFlow] loading overlay visible');
    }

    try {
      const [childAgeProfile, avoids, freshRecent] = await Promise.all([
        getChildAgeProfile(),
        getAvoidPreferences(),
        getRecentScans(),
      ]);
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

      const allowed = await canUseSuccessfulScan();
      if (!allowed) {
        pendingPostScanOutcomeRef.current = null;
        expectingScannerDismissHandoffRef.current = false;
        scannerDismissedForHandoffRef.current = false;
        isProcessingScanRef.current = false;
        setScanPipelineLoading(false);
        scanPipelineLoadingRef.current = false;
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.warn('[scanFlow] loading hidden');
        }
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        navigatePaywall({ preselect: 'unlimited' });
        return;
      }

      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      let outcome: { scan: RecentScan; isSuccessfulProductScan: boolean };
      try {
        outcome = await buildRecentScanFromBarcode(data);
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

  const openManualBarcodeEntry = async () => {
    if (dailyLimitReached) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      navigatePaywall({ preselect: 'unlimited' });
      return;
    }
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
    queueMicrotask(() => {
      void handleBarcodeScanned({ data: digits });
    });
  };

  const onScanAgain = () => {
    clearPostScanHandoff();
    setScanPipelineLoading(false);
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
    setScannerCameraKey((k) => k + 1);
    setScannerModalVisible(true);
  };

  const openSavedScanById = async (scanId: string) => {
    clearPostScanHandoff();
    setScanError(null);
    setUnknownResultVisible(false);
    setUnknownScan(null);
    setScanPipelineLoading(false);
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
    scanPipelineLoadingRef.current = false;
    setScannerModalVisible(false);
    setActiveModalScanId(null);
    const freshPlan = await getPlan();
    setPlan(freshPlan);
    setModalScan(scan);
    setResultReuseBanner(null);
    setResultModalVisible(true);
  };

  const onFavoriteControlPress = async () => {
    if (plan !== 'unlimited') {
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

  return (
    <SafeAreaView
      style={{ flex: 1, position: 'relative', backgroundColor: '#F6F1E8' }}
      edges={['top', 'left', 'right']}
    >
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: 28,
          gap: 20,
        }}
      >
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable
              onPress={() => router.push('/preferences')}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={{
                width: 44,
                height: 44,
                borderRadius: 14,
                backgroundColor: '#EDE6DD',
                borderWidth: 1,
                borderColor: '#E0D6CA',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="options-outline" size={22} color="#231C15" />
            </Pressable>
            {plan === 'free' ? (
              <Pressable
                onPress={() => navigatePaywall()}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: '#EBDDCB',
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#5B4A38' }}>{t('common.upgrade', lang)}</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => navigatePaywall()}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: '#EDE8E2',
                  borderWidth: 1,
                  borderColor: '#D9D0C6',
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#6B6158', letterSpacing: 0.4 }}>
                  {t('common.unlimited', lang)}
                </Text>
              </Pressable>
            )}
          </View>
          {plan === 'free' ? (
            <Text
              style={{
                fontSize: 13,
                color: '#9A8E82',
                fontWeight: '600',
                textAlign: 'right',
                letterSpacing: 0.2,
              }}
            >
              {freeDailyScanUsageLabel(dailyScanState.count, lang)}
            </Text>
          ) : null}
        </View>

        <View
          style={{
            borderRadius: 28,
            backgroundColor: '#FFFDF8',
            padding: 22,
            shadowColor: '#9B8D7A',
            shadowOpacity: 0.12,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 10 },
            elevation: 4,
          }}
        >
          <Text style={{ fontSize: 29, lineHeight: 34, fontWeight: '700', color: '#1F1A16' }}>
            {t('home.scanTitle', lang)}
          </Text>
          <Text style={{ marginTop: 10, fontSize: 16, lineHeight: 23, color: '#5F554A' }}>
            {t('home.scanSubtitle', lang)}
          </Text>

          <View
            style={{
              marginTop: 18,
              borderRadius: 20,
              height: 160,
              backgroundColor: '#EEE3D6',
              borderWidth: 1,
              borderColor: '#E2D6C7',
              overflow: 'hidden',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="barcode-outline" size={52} color="#C4B8A8" />
          </View>

          <Pressable
            onPress={openScanner}
            style={{
              marginTop: 16,
              borderRadius: 16,
              backgroundColor: '#2C251F',
              paddingVertical: 16,
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#FFFDF9' }}>{t('home.scanProduct', lang)}</Text>
          </Pressable>
          <Pressable
            onPress={openManualBarcodeEntry}
            disabled={scanPipelineLoading}
            style={{ marginTop: 14, paddingVertical: 10, alignItems: 'center' }}
          >
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#5B4A38', textDecorationLine: 'underline' }}>
              {t('home.enterBarcodeManually', lang)}
            </Text>
          </Pressable>
        </View>

        <View style={{ gap: 12 }}>
          <Text style={{ fontSize: 21, fontWeight: '700', color: '#1F1A16' }}>{t('home.recentScans', lang)}</Text>

          {recentScans.length === 0 ? (
            <>
              {[0, 1, 2].map((item) => (
                <View
                  key={String(item)}
                  style={{
                    borderRadius: 18,
                    backgroundColor: '#FFFDF8',
                    padding: 16,
                    borderWidth: 1,
                    borderColor: '#EEE4D7',
                  }}
                >
                  <View
                    style={{
                      height: 14,
                      width: '46%',
                      borderRadius: 8,
                      backgroundColor: '#EFE6D9',
                    }}
                  />
                  <View
                    style={{
                      marginTop: 12,
                      height: 12,
                      width: '80%',
                      borderRadius: 8,
                      backgroundColor: '#F3ECDF',
                    }}
                  />
                </View>
              ))}
            </>
          ) : (
            recentScans.map((scan) => <RecentScanCard key={scan.id} scan={scan} onPress={openSavedScanById} />)
          )}
        </View>

        <View style={{ gap: 10 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#1F1A16' }}>{t('home.favorites', lang)}</Text>
          {plan === 'unlimited' ? (
            favoritesList.length === 0 ? (
              <Text style={{ fontSize: 14, color: '#9A8E82', fontWeight: '600', fontStyle: 'italic' }}>
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
                    borderRadius: 16,
                    backgroundColor: '#FFFDF8',
                    paddingVertical: 12,
                    paddingHorizontal: 14,
                    borderWidth: 1,
                    borderColor: '#E8DFD4',
                  }}
                >
                  <Ionicons name="heart" size={18} color="#B85C5C" />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: '#1F1A16' }} numberOfLines={1}>
                      {item.productName}
                    </Text>
                    <Text style={{ marginTop: 4, fontSize: 12, color: '#958676' }} numberOfLines={1}>
                      {item.barcode}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#C4B8A8" />
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
                borderRadius: 12,
                backgroundColor: '#FAF7F2',
                borderWidth: 1,
                borderColor: '#E4D9CC',
              }}
            >
              <Ionicons name="lock-closed-outline" size={16} color="#B59B7A" />
              <Text style={{ fontSize: 13, fontWeight: '600', color: '#8A7E70' }}>{t('home.favoritesLocked', lang)}</Text>
            </Pressable>
          )}
        </View>

        {typeof __DEV__ !== 'undefined' && __DEV__ ? (
          <Pressable
            onPress={async () => {
              clearPostScanHandoff();
              setScanPipelineLoading(false);
              scanPipelineLoadingRef.current = false;
              setScanError(null);
              setUnknownResultVisible(false);
              setUnknownScan(null);
              setResultModalVisible(false);
              setActiveModalScanId(null);
              setModalScan(null);
              setResultReuseBanner(null);
              setScannerModalVisible(false);
              isProcessingScanRef.current = false;
              await resetAppDataForDev();
              router.replace('/onboarding');
            }}
            style={{
              alignSelf: 'center',
              marginTop: 8,
              paddingVertical: 8,
              paddingHorizontal: 12,
            }}
          >
            <Text style={{ fontSize: 12, color: '#A89888', fontWeight: '600' }}>{t('home.resetDev', lang)}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
      {scanError ? (
        <View
          pointerEvents="auto"
          style={[
            StyleSheet.absoluteFillObject,
            {
              zIndex: 88,
              backgroundColor: 'rgba(23, 18, 12, 0.44)',
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 20,
            },
          ]}
        >
          <View
            style={{
              borderRadius: 24,
              backgroundColor: '#FFFDF8',
              padding: 22,
              width: '100%',
              maxWidth: 360,
            }}
          >
            <Text style={{ fontSize: 22, fontWeight: '700', color: '#1F1A16' }}>{scanError.title}</Text>
            <Text style={{ marginTop: 12, fontSize: 15, lineHeight: 22, color: '#5D5246' }}>{scanError.message}</Text>
            <View style={{ marginTop: 22, flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={dismissScanError}
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
                onPress={onScanErrorTryAgain}
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
              backgroundColor: 'rgba(23, 18, 12, 0.44)',
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 20,
            },
          ]}
        >
          <View
            style={{
              borderRadius: 24,
              backgroundColor: '#FFFDF8',
              padding: 22,
              width: '100%',
              maxWidth: 360,
            }}
          >
            <Text style={{ fontSize: 13, color: '#8C7B6A', fontWeight: '600' }}>{t('common.scanResult', lang)}</Text>
            <Text style={{ marginTop: 14, fontSize: 26, lineHeight: 32, color: '#1F1A16', fontWeight: '700' }}>
              {t('result.unknownProduct', lang)}
            </Text>
            <Text style={{ marginTop: 12, fontSize: 15, lineHeight: 22, color: '#5D5246' }}>
              {t('result.unknownBody', lang)}
            </Text>
            <Text style={{ marginTop: 14, fontSize: 13, color: '#817363' }}>
              {t('result.barcodeLabel', lang)} {String(unknownScan.barcode ?? '').trim() || '-'}
            </Text>
            <View style={{ marginTop: 24, flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={onCloseUnknownModal}
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
                onPress={onUnknownTryAgain}
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
            style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(23, 18, 12, 0.44)' }]}
          />
          <View
            pointerEvents="box-none"
            style={{
              flex: 1,
              justifyContent: 'center',
              paddingHorizontal: 22,
            }}
          >
            <View
              style={{
                borderRadius: 22,
                backgroundColor: '#FFFDF8',
                padding: 20,
                width: '100%',
                maxWidth: 400,
                alignSelf: 'center',
              }}
            >
              <Text style={{ fontSize: 20, fontWeight: '800', color: '#1F1A16' }}>{t('home.manualBarcodeTitle', lang)}</Text>
              <Text style={{ marginTop: 8, fontSize: 14, lineHeight: 20, color: '#6D6053' }}>{t('home.manualBarcodeHint', lang)}</Text>
              <TextInput
                value={manualBarcodeValue}
                onChangeText={(v) => {
                  setManualBarcodeError(null);
                  setManualBarcodeValue(digitsOnlyFromBarcodeInput(v).slice(0, 14));
                }}
                placeholder={t('home.manualBarcodePlaceholder', lang)}
                placeholderTextColor="#B5A896"
                keyboardType="number-pad"
                autoCorrect={false}
                autoCapitalize="none"
                editable={!scanPipelineLoading}
                returnKeyType="done"
                onSubmitEditing={submitManualBarcode}
                style={{
                  marginTop: 14,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: manualBarcodeError ? '#C98A7A' : '#E4D9CC',
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  fontSize: 18,
                  fontWeight: '600',
                  color: '#1F1A16',
                  backgroundColor: '#FAF6EF',
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
                    borderRadius: 14,
                    backgroundColor: '#EEE4D7',
                    alignItems: 'center',
                    paddingVertical: 14,
                  }}
                >
                  <Text style={{ fontSize: 15, fontWeight: '700', color: '#5B4A38' }}>{t('home.manualBarcodeCancel', lang)}</Text>
                </Pressable>
                <Pressable
                  onPress={submitManualBarcode}
                  disabled={scanPipelineLoading}
                  style={{
                    flex: 1,
                    borderRadius: 14,
                    backgroundColor: scanPipelineLoading ? '#4A4238' : '#2C251F',
                    alignItems: 'center',
                    paddingVertical: 14,
                  }}
                >
                  <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFDF9' }}>{t('home.manualBarcodeFind', lang)}</Text>
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
        dailyLimitReached={dailyLimitReached}
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
              backgroundColor: 'rgba(23, 18, 12, 0.45)',
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 32,
            },
          ]}
        >
          <View
            style={{
              borderRadius: 20,
              backgroundColor: '#FFFDF8',
              paddingVertical: 28,
              paddingHorizontal: 32,
              alignItems: 'center',
              width: '100%',
              maxWidth: 320,
              shadowColor: '#000',
              shadowOpacity: 0.12,
              shadowRadius: 20,
              shadowOffset: { width: 0, height: 8 },
              elevation: 4,
            }}
          >
            <ActivityIndicator size="large" color="#2C251F" />
            <Text style={{ marginTop: 16, fontSize: 17, fontWeight: '700', color: '#1F1A16', textAlign: 'center' }}>
              {t('loading.checking', lang)}
            </Text>
            <Text style={{ marginTop: 8, fontSize: 14, color: '#6D6053', textAlign: 'center', lineHeight: 20 }}>
              {t('loading.wait', lang)}
            </Text>
          </View>
        </View>
      ) : null}
      {resultModalVisible && scanForResultModal ? (
        <ScanResultModal
          visible
          key={scanForResultModal.id}
          scan={scanForResultModal}
          childAge={childAge}
          plan={plan}
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
