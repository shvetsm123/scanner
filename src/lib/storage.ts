import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  ensureProfileId,
  fetchPreferencesForProfile,
  getSupabase,
  isSupabaseConfigured,
  persistSuccessfulScanHistory,
  preferencesRowHasValues,
  type DbPreferencesRow,
  upsertPreferencesForProfile,
} from '../api/supabase';
import { parseStoredRecentScan } from './parseStoredRecentScan';
import { DEVICE_ID_STORAGE_KEY, getOrCreateDeviceId } from './device';
import { isValidIsoDateOnly, resolveChildAgeProfile, type ChildAgeProfile } from './childAgeContext';
import { AVOID_PREFERENCE_IDS, type AvoidPreference, type Plan, type ResultStyle } from '../types/preferences';
import type { RecentScan } from '../types/scan';

const ONBOARDING_COMPLETED_KEY = 'onboardingCompleted';
const CHILD_AGE_KEY = 'childAge';
const CHILD_BIRTHDATE_KEY = 'childBirthdate';
const IS_PREMIUM_KEY = 'isPremium';
const PLAN_KEY = 'plan_v1';
const DAILY_SUCCESSFUL_SCANS_KEY = 'dailySuccessfulScans_v1';
const RESULT_STYLE_KEY = 'resultStyle';
const AVOID_PREFERENCES_KEY = 'avoidPreferences';
const RECENT_SCANS_KEY_V4 = 'recentScans_v4';
const RECENT_SCANS_KEY_V3 = 'recentScans_v3';
const LEGACY_RECENT_SCANS_KEYS = ['recentScans'];
const RECENT_SCANS_LEGACY_CLEARED_KEY = 'recentScansLegacyCleared_v3';
const SUPABASE_PROFILE_ID_KEY = 'supabaseProfileId_v1';
const PREF_REMOTE_PULL_SUPPRESS_UNTIL_MS_KEY = 'prefRemotePullSuppressUntil_ms';

export const MAX_RECENT_SCANS = 20;

/** Tracks in-flight remote preference push/pull so scans can wait for a settled profile. */
let preferencesSyncDepth = 0;
let preferencesSyncIdleResolver: (() => void) | null = null;
let preferencesSyncIdlePromise: Promise<void> | null = null;

function beginPreferencesSync(): void {
  preferencesSyncDepth += 1;
  if (!preferencesSyncIdlePromise) {
    preferencesSyncIdlePromise = new Promise<void>((resolve) => {
      preferencesSyncIdleResolver = resolve;
    });
  }
}

function endPreferencesSync(): void {
  preferencesSyncDepth = Math.max(0, preferencesSyncDepth - 1);
  if (preferencesSyncDepth === 0) {
    preferencesSyncIdleResolver?.();
    preferencesSyncIdleResolver = null;
    preferencesSyncIdlePromise = null;
  }
}

async function withPreferencesSyncLock(fn: () => Promise<void>): Promise<void> {
  beginPreferencesSync();
  try {
    await fn();
  } finally {
    endPreferencesSync();
  }
}

/** Resolves when no `syncRemotePreferencesWithLocal` / `pushSupabasePreferencesFromLocal` is running. */
export async function waitUntilPreferencesSyncIdle(): Promise<void> {
  const p = preferencesSyncIdlePromise;
  if (p) {
    try {
      await p;
    } catch {
      /* ignore */
    }
  }
}

/** Maps stored plan tokens to the current two-tier model (Free | Unlimited). */
function canonicalizeStoredPlanToken(raw: string | null): Plan | null {
  if (raw == null) {
    return null;
  }
  const t = raw.trim().toLowerCase();
  if (t === '' || t === 'free' || t === 'false' || t === '0') {
    return 'free';
  }
  if (t === 'unlimited') {
    return 'unlimited';
  }
  if (t === 'insights' || t === 'insight' || t === 'paid' || t === 'premium' || t === 'pro' || t === 'true' || t === '1') {
    return 'unlimited';
  }
  return null;
}

function parseAvoidFromRemote(raw: unknown): AvoidPreference[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(
    (item): item is AvoidPreference => typeof item === 'string' && AVOID_PREFERENCE_IDS.includes(item as AvoidPreference),
  );
}

function normalizeStoredResultStyleToken(raw: string | null): ResultStyle | null {
  if (raw == null) {
    return null;
  }
  const t = raw.trim().toLowerCase();
  if (t === 'quick' || t === 'advanced') {
    return t as ResultStyle;
  }
  if (t === 'balanced') {
    return 'quick';
  }
  if (t === 'detailed') {
    return 'advanced';
  }
  return null;
}

async function readRawResultStyleString(): Promise<string | null> {
  const value = await AsyncStorage.getItem(RESULT_STYLE_KEY);
  const normalized = normalizeStoredResultStyleToken(value);
  if (normalized) {
    const rawKey = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (rawKey !== normalized) {
      await AsyncStorage.setItem(RESULT_STYLE_KEY, normalized);
    }
    return normalized;
  }
  return null;
}

async function readLocalPreferencePayloadForRemote(): Promise<{
  child_age: number | null;
  child_birthdate: string | null;
  result_style: string;
  avoid_preferences: AvoidPreference[];
}> {
  const [bdRaw, result_style, avoid_preferences] = await Promise.all([
    AsyncStorage.getItem(CHILD_BIRTHDATE_KEY),
    readRawResultStyleString(),
    getAvoidPreferences(),
  ]);
  const child_birthdate = bdRaw && isValidIsoDateOnly(bdRaw) ? bdRaw.trim() : null;
  const legacyRaw = await AsyncStorage.getItem(CHILD_AGE_KEY);
  let legacyAge: number | null = null;
  if (legacyRaw) {
    const n = Number(legacyRaw);
    if (Number.isFinite(n)) {
      legacyAge = Math.round(n);
    }
  }
  const child_age =
    child_birthdate != null ? resolveChildAgeProfile(child_birthdate, null).completedWholeYears : legacyAge;
  return {
    child_age,
    child_birthdate,
    result_style: result_style ?? 'quick',
    avoid_preferences,
  };
}

function mapRemoteResultStyleToken(raw: unknown): ResultStyle | null {
  if (typeof raw !== 'string') {
    return null;
  }
  return normalizeStoredResultStyleToken(raw);
}

async function applyRemotePreferencesRowToLocal(row: DbPreferencesRow): Promise<void> {
  console.warn('[prefsDebug][storage] applyRemotePreferencesRowToLocal', {
    child_age: row.child_age,
    child_birthdate: row.child_birthdate,
    result_style: row.result_style,
    avoid_preferences: row.avoid_preferences,
    updated_at: row.updated_at,
  });
  const remoteBd = typeof row.child_birthdate === 'string' && isValidIsoDateOnly(row.child_birthdate) ? row.child_birthdate.trim() : null;
  if (remoteBd) {
    await setChildBirthdate(remoteBd);
    const p = resolveChildAgeProfile(remoteBd, null);
    await setChildAge(p.completedWholeYears);
  } else if (row.child_age != null && Number.isFinite(Number(row.child_age))) {
    await setChildAge(Math.round(Number(row.child_age)));
  }
  const mappedStyle = mapRemoteResultStyleToken(row.result_style);
  if (mappedStyle) {
    await setResultStyle(mappedStyle);
  }
  if (Array.isArray(row.avoid_preferences) && row.avoid_preferences.length > 0) {
    await setAvoidPreferences(parseAvoidFromRemote(row.avoid_preferences));
  }
}

export async function ensureSupabaseProfileLocal(): Promise<void> {
  if (!isSupabaseConfigured()) {
    return;
  }
  const client = getSupabase();
  if (!client) {
    return;
  }
  try {
    const deviceId = await getOrCreateDeviceId();
    const profileId = await ensureProfileId(client, deviceId);
    if (profileId) {
      await AsyncStorage.setItem(SUPABASE_PROFILE_ID_KEY, profileId);
    }
  } catch {
    /* local-first */
  }
}

export async function syncRemotePreferencesWithLocal(): Promise<void> {
  if (!isSupabaseConfigured()) {
    return;
  }
  const onboarded = await getOnboardingCompleted();
  if (!onboarded) {
    return;
  }
  const client = getSupabase();
  if (!client) {
    return;
  }
  await withPreferencesSyncLock(async () => {
  try {
    const deviceId = await getOrCreateDeviceId();
    let profileId = await AsyncStorage.getItem(SUPABASE_PROFILE_ID_KEY);
    if (!profileId) {
      const resolved = await ensureProfileId(client, deviceId);
      if (!resolved) {
        return;
      }
      profileId = resolved;
      await AsyncStorage.setItem(SUPABASE_PROFILE_ID_KEY, profileId);
    }
    const suppressRaw = await AsyncStorage.getItem(PREF_REMOTE_PULL_SUPPRESS_UNTIL_MS_KEY);
    const suppressUntil = suppressRaw != null ? Number(suppressRaw) : 0;
    const suppressActive = Number.isFinite(suppressUntil) && Date.now() < suppressUntil;
    if (!suppressActive && suppressRaw != null) {
      await AsyncStorage.removeItem(PREF_REMOTE_PULL_SUPPRESS_UNTIL_MS_KEY);
    }

    const remote = await fetchPreferencesForProfile(client, profileId);
    console.warn('[prefsDebug][storage] syncRemotePreferencesWithLocal fetched', {
      hasRemote: !!remote,
      remoteHasValues: remote ? preferencesRowHasValues(remote) : false,
      suppressActive,
      remotePreview: remote
        ? {
            child_age: remote.child_age,
            child_birthdate: remote.child_birthdate,
            result_style: remote.result_style,
            avoidLen: Array.isArray(remote.avoid_preferences) ? remote.avoid_preferences.length : -1,
            updated_at: remote.updated_at,
          }
        : null,
    });
    if (remote && preferencesRowHasValues(remote)) {
      if (suppressActive) {
        console.warn('[prefsDebug][storage] syncRemotePreferencesWithLocal skip applyRemote (post-push window)', {
          until: suppressUntil,
        });
        return;
      }
      await applyRemotePreferencesRowToLocal(remote);
    } else {
      const local = await readLocalPreferencePayloadForRemote();
      console.warn('[prefsDebug][storage] syncRemotePreferencesWithLocal upsert local->remote', local);
      await upsertPreferencesForProfile(client, {
        profile_id: profileId,
        child_age: local.child_age,
        child_birthdate: local.child_birthdate,
        result_style: local.result_style,
        avoid_preferences: local.avoid_preferences,
      });
    }
  } catch {
    /* local-first */
  }
  });
}

export async function pushSupabasePreferencesFromLocal(): Promise<void> {
  if (!isSupabaseConfigured()) {
    return;
  }
  const onboarded = await getOnboardingCompleted();
  if (!onboarded) {
    return;
  }
  const client = getSupabase();
  if (!client) {
    return;
  }
  await withPreferencesSyncLock(async () => {
  try {
    const deviceId = await getOrCreateDeviceId();
    let profileId = await AsyncStorage.getItem(SUPABASE_PROFILE_ID_KEY);
    if (!profileId) {
      const resolved = await ensureProfileId(client, deviceId);
      if (!resolved) {
        return;
      }
      profileId = resolved;
      await AsyncStorage.setItem(SUPABASE_PROFILE_ID_KEY, profileId);
    }
    const local = await readLocalPreferencePayloadForRemote();
    console.warn('[prefsDebug][storage] pushSupabasePreferencesFromLocal payload', local);
    await upsertPreferencesForProfile(client, {
      profile_id: profileId,
      child_age: local.child_age,
      child_birthdate: local.child_birthdate,
      result_style: local.result_style,
      avoid_preferences: local.avoid_preferences,
    });
    const suppressRemoteApplyUntilMs = Date.now() + 10_000;
    await AsyncStorage.setItem(PREF_REMOTE_PULL_SUPPRESS_UNTIL_MS_KEY, String(suppressRemoteApplyUntilMs));
    console.warn('[prefsDebug][storage] pushSupabasePreferencesFromLocal completed', {
      suppressRemoteApplyUntilMs,
    });
  } catch {
    /* local-first */
  }
  });
}

async function clearLegacyRecentScansKeys(): Promise<void> {
  const done = await AsyncStorage.getItem(RECENT_SCANS_LEGACY_CLEARED_KEY);
  if (done === '1') {
    return;
  }
  await AsyncStorage.multiRemove(LEGACY_RECENT_SCANS_KEYS);
  await AsyncStorage.setItem(RECENT_SCANS_LEGACY_CLEARED_KEY, '1');
}

export const getOnboardingCompleted = async (): Promise<boolean> => {
  const value = await AsyncStorage.getItem(ONBOARDING_COMPLETED_KEY);
  return value === 'true';
};

export const setOnboardingCompleted = async (value: boolean): Promise<void> => {
  await AsyncStorage.setItem(ONBOARDING_COMPLETED_KEY, value ? 'true' : 'false');
};

export const getChildBirthdate = async (): Promise<string | null> => {
  const value = await AsyncStorage.getItem(CHILD_BIRTHDATE_KEY);
  if (!value || !isValidIsoDateOnly(value)) {
    return null;
  }
  return value.trim();
};

export const setChildBirthdate = async (isoDate: string | null): Promise<void> => {
  if (isoDate == null || isoDate.trim() === '') {
    await AsyncStorage.removeItem(CHILD_BIRTHDATE_KEY);
    return;
  }
  await AsyncStorage.setItem(CHILD_BIRTHDATE_KEY, isoDate.trim());
};

/** Resolved profile (birthdate-first, else legacy integer age, else default for analysis). */
export const getChildAgeProfile = async (ref = new Date()): Promise<ChildAgeProfile> => {
  const [bd, legacyRaw] = await Promise.all([getChildBirthdate(), AsyncStorage.getItem(CHILD_AGE_KEY)]);
  let legacy: number | null = null;
  if (legacyRaw) {
    const n = Number(legacyRaw);
    if (Number.isFinite(n)) {
      legacy = Math.round(n);
    }
  }
  return resolveChildAgeProfile(bd, legacy, ref);
};

export async function hasChildAgePreferenceConfigured(): Promise<boolean> {
  const bd = await getChildBirthdate();
  if (bd) {
    return true;
  }
  const value = await AsyncStorage.getItem(CHILD_AGE_KEY);
  if (!value) {
    return false;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed);
}

export const getChildAge = async (): Promise<number | null> => {
  const bd = await getChildBirthdate();
  if (bd) {
    const p = resolveChildAgeProfile(bd, null);
    console.warn('[prefsDebug][storage] getChildAge from birthdate', { birthdate: bd, completedWholeYears: p.completedWholeYears });
    return p.completedWholeYears;
  }
  const value = await AsyncStorage.getItem(CHILD_AGE_KEY);
  if (!value) {
    console.warn('[prefsDebug][storage] getChildAge read', { raw: value, parsed: null });
    return null;
  }
  const parsed = Number(value);
  const out = Number.isFinite(parsed) ? parsed : null;
  console.warn('[prefsDebug][storage] getChildAge read', { raw: value, parsed: out });
  return out;
};

export const setChildAge = async (age: number): Promise<void> => {
  console.warn('[prefsDebug][storage] setChildAge write', { age });
  await AsyncStorage.setItem(CHILD_AGE_KEY, String(age));
};

export const getIsPremium = async (): Promise<boolean> => {
  const value = await AsyncStorage.getItem(IS_PREMIUM_KEY);
  return value === 'true';
};

export const setIsPremium = async (value: boolean): Promise<void> => {
  await AsyncStorage.setItem(IS_PREMIUM_KEY, value ? 'true' : 'false');
};

function localCalendarDateKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function syncStoredResultStyleToPlan(_plan: Plan): Promise<void> {
  const rs = await AsyncStorage.getItem(RESULT_STYLE_KEY);
  const n = normalizeStoredResultStyleToken(rs);
  if (n === 'quick' || n === 'advanced') {
    if (rs !== n) {
      await AsyncStorage.setItem(RESULT_STYLE_KEY, n);
    }
    return;
  }
  await AsyncStorage.setItem(RESULT_STYLE_KEY, 'quick');
}

export const getPlan = async (): Promise<Plan> => {
  const raw = await AsyncStorage.getItem(PLAN_KEY);
  console.warn('[planDebug][storage] getPlan raw', raw);
  const fromToken = canonicalizeStoredPlanToken(raw);
  if (fromToken) {
    const rawTrim = raw?.trim() ?? '';
    const rawLower = rawTrim.toLowerCase();
    if (rawTrim !== fromToken) {
      const legacyPaid =
        rawLower === 'insights' ||
        rawLower === 'insight' ||
        rawLower === 'paid' ||
        rawLower === 'premium' ||
        rawLower === 'pro' ||
        rawLower === 'true' ||
        rawLower === '1';
      console.warn('[planDebug][storage] getPlan normalized plan key', {
        rawPlan: rawTrim,
        canonicalPlan: fromToken,
        legacyPaidToken: legacyPaid,
      });
      await AsyncStorage.setItem(PLAN_KEY, fromToken);
    }
    const rsBeforeSync = await AsyncStorage.getItem(RESULT_STYLE_KEY);
    await syncStoredResultStyleToPlan(fromToken);
    const rsAfterSync = await AsyncStorage.getItem(RESULT_STYLE_KEY);
    console.warn('[planDebug][storage] getPlan result', {
      normalizedPlan: fromToken,
      rawResultStyleBeforeSync: rsBeforeSync,
      rawResultStyleAfterSync: rsAfterSync,
    });
    return fromToken;
  }
  const legacy = await AsyncStorage.getItem(IS_PREMIUM_KEY);
  if (legacy === 'true') {
    console.warn('[planDebug][storage] getPlan migrated isPremium -> unlimited + advanced', {
      isPremium: legacy,
    });
    await AsyncStorage.multiSet([
      [PLAN_KEY, 'unlimited'],
      [RESULT_STYLE_KEY, 'advanced'],
    ]);
    return 'unlimited';
  }
  if (raw?.trim()) {
    console.warn('[planDebug][storage] getPlan unknown plan token -> free + quick', { rawPlan: raw.trim() });
    await AsyncStorage.setItem(PLAN_KEY, 'free');
  }
  await AsyncStorage.setItem(RESULT_STYLE_KEY, 'quick');
  console.warn('[planDebug][storage] getPlan result', { normalizedPlan: 'free', forcedResultStyle: 'quick' });
  return 'free';
};

export const setPlan = async (plan: Plan): Promise<void> => {
  console.warn('[planDebug][storage] setPlan input', plan);
  if (plan === 'free') {
    const cur = normalizeStoredResultStyleToken(await AsyncStorage.getItem(RESULT_STYLE_KEY)) ?? 'quick';
    await AsyncStorage.multiSet([
      [PLAN_KEY, plan],
      [RESULT_STYLE_KEY, cur],
    ]);
    console.warn('[planDebug][storage] setPlan wrote', { plan, resultStyle: cur });
    return;
  }
  const prevRaw = await AsyncStorage.getItem(PLAN_KEY);
  const prev = canonicalizeStoredPlanToken(prevRaw);
  let nextStyle: ResultStyle = 'advanced';
  if (prev === 'unlimited') {
    const cur = normalizeStoredResultStyleToken(await AsyncStorage.getItem(RESULT_STYLE_KEY));
    nextStyle = cur === 'quick' ? 'quick' : 'advanced';
  }
  await AsyncStorage.multiSet([
    [PLAN_KEY, plan],
    [RESULT_STYLE_KEY, nextStyle],
  ]);
  console.warn('[planDebug][storage] setPlan wrote', { plan, resultStyle: nextStyle, preservedFromUnlimited: prev === 'unlimited' });
};

export type DailySuccessfulScanState = {
  dateKey: string;
  count: number;
};

export const getDailySuccessfulScanState = async (): Promise<DailySuccessfulScanState> => {
  const today = localCalendarDateKey();
  const raw = await AsyncStorage.getItem(DAILY_SUCCESSFUL_SCANS_KEY);
  if (!raw) {
    return { dateKey: today, count: 0 };
  }
  try {
    const o = JSON.parse(raw) as { dateKey?: string; date?: string; count?: unknown };
    const key = typeof o.dateKey === 'string' ? o.dateKey : typeof o.date === 'string' ? o.date : null;
    if (key !== today) {
      return { dateKey: today, count: 0 };
    }
    const c = typeof o.count === 'number' && Number.isFinite(o.count) ? Math.max(0, Math.floor(o.count)) : 0;
    return { dateKey: today, count: c };
  } catch {
    return { dateKey: today, count: 0 };
  }
};

export const incrementSuccessfulScanCountIfNeeded = async (): Promise<DailySuccessfulScanState> => {
  const today = localCalendarDateKey();
  const raw = await AsyncStorage.getItem(DAILY_SUCCESSFUL_SCANS_KEY);
  let nextCount = 1;
  if (raw) {
    try {
      const o = JSON.parse(raw) as { dateKey?: string; date?: string; count?: unknown };
      const key = typeof o.dateKey === 'string' ? o.dateKey : typeof o.date === 'string' ? o.date : '';
      const prev =
        typeof o.count === 'number' && Number.isFinite(o.count) ? Math.max(0, Math.floor(o.count)) : 0;
      nextCount = key === today ? prev + 1 : 1;
    } catch {
      nextCount = 1;
    }
  }
  const next: DailySuccessfulScanState = { dateKey: today, count: nextCount };
  await AsyncStorage.setItem(DAILY_SUCCESSFUL_SCANS_KEY, JSON.stringify(next));
  return next;
};

export const canUseSuccessfulScanForPlan = async (plan: Plan): Promise<boolean> => {
  if (plan !== 'free') {
    return true;
  }
  const { count } = await getDailySuccessfulScanState();
  return count < 2;
};

export const canUseSuccessfulScan = async (): Promise<boolean> => {
  const plan = await getPlan();
  return canUseSuccessfulScanForPlan(plan);
};

export const getResultStyle = async (): Promise<ResultStyle> => {
  const plan = await getPlan();
  const rawStyleBeforeReadRaw = await AsyncStorage.getItem(RESULT_STYLE_KEY);
  console.warn('[planDebug][storage] getResultStyle after getPlan', { plan, rawResultStyle: rawStyleBeforeReadRaw });
  await readRawResultStyleString();
  const rawStyleAfterReadRaw = await AsyncStorage.getItem(RESULT_STYLE_KEY);
  if (rawStyleAfterReadRaw !== rawStyleBeforeReadRaw) {
    console.warn('[planDebug][storage] getResultStyle readRawResultStyleString changed storage', {
      before: rawStyleBeforeReadRaw,
      after: rawStyleAfterReadRaw,
    });
  }
  const beforeLower = typeof rawStyleBeforeReadRaw === 'string' ? rawStyleBeforeReadRaw.trim().toLowerCase() : '';
  if (beforeLower === 'balanced' || beforeLower === 'detailed') {
    console.warn('[planDebug][storage] getResultStyle migrated legacy result_style token', {
      from: beforeLower,
      to: normalizeStoredResultStyleToken(rawStyleAfterReadRaw),
    });
  }
  await syncStoredResultStyleToPlan(plan);
  const rawStyleAfterSync = await AsyncStorage.getItem(RESULT_STYLE_KEY);
  const normalizedStyle: ResultStyle = normalizeStoredResultStyleToken(rawStyleAfterSync) ?? 'quick';
  console.warn('[planDebug][storage] getResultStyle normalized', {
    normalizedStyle,
    rawResultStyleAfterSync: rawStyleAfterSync,
  });
  return normalizedStyle;
};

export const setResultStyle = async (value: ResultStyle): Promise<void> => {
  const plan = await getPlan();
  const rawBefore = await AsyncStorage.getItem(RESULT_STYLE_KEY);
  console.warn('[planDebug][storage] setResultStyle input', { style: value, plan, rawResultStyleBefore: rawBefore });
  const next = value === 'advanced' ? 'advanced' : 'quick';
  await AsyncStorage.setItem(RESULT_STYLE_KEY, next);
  console.warn('[planDebug][storage] setResultStyle wrote', { finalStyle: next, plan });
};

export const getAvoidPreferences = async (): Promise<AvoidPreference[]> => {
  const value = await AsyncStorage.getItem(AVOID_PREFERENCES_KEY);
  if (value == null || value === '' || value === 'null' || value === 'undefined') {
    console.warn('[prefsDebug][storage] getAvoidPreferences read', { raw: value, parsed: [] });
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      console.warn('[prefsDebug][storage] getAvoidPreferences read', { raw: value, parsed: [] });
      return [];
    }
    if (parsed.length === 0) {
      console.warn('[prefsDebug][storage] getAvoidPreferences read', { raw: value, parsed: [] });
      return [];
    }
    const out = parsed.filter(
      (item): item is AvoidPreference => typeof item === 'string' && AVOID_PREFERENCE_IDS.includes(item as AvoidPreference),
    );
    console.warn('[prefsDebug][storage] getAvoidPreferences read', { raw: value, parsed: out });
    return out;
  } catch {
    console.warn('[prefsDebug][storage] getAvoidPreferences read parse error', { raw: value });
    return [];
  }
};

export const setAvoidPreferences = async (value: AvoidPreference[]): Promise<void> => {
  console.warn('[prefsDebug][storage] setAvoidPreferences write', { value });
  await AsyncStorage.setItem(AVOID_PREFERENCES_KEY, JSON.stringify(value));
};

export const getRecentScans = async (): Promise<RecentScan[]> => {
  await clearLegacyRecentScansKeys();
  const v4 = await AsyncStorage.getItem(RECENT_SCANS_KEY_V4);
  if (v4) {
    try {
      const parsed = JSON.parse(v4) as unknown[];
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.map(parseStoredRecentScan).filter((s): s is RecentScan => s !== null);
    } catch {
      return [];
    }
  }

  const v3 = await AsyncStorage.getItem(RECENT_SCANS_KEY_V3);
  if (!v3) {
    return [];
  }
  try {
    const parsed = JSON.parse(v3) as unknown[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    const migrated = parsed.map(parseStoredRecentScan).filter((s): s is RecentScan => s !== null);
    await AsyncStorage.setItem(RECENT_SCANS_KEY_V4, JSON.stringify(migrated));
    await AsyncStorage.removeItem(RECENT_SCANS_KEY_V3);
    return migrated;
  } catch {
    return [];
  }
};

export const addRecentScan = async (scan: RecentScan, replaceUnknownDuplicateWithinMs?: number): Promise<RecentScan[]> => {
  const current = await getRecentScans();
  let tail = current;
  const top = current[0];
  if (
    replaceUnknownDuplicateWithinMs &&
    top &&
    top.barcode.trim() === scan.barcode.trim() &&
    top.productName === 'Unknown product' &&
    top.verdict === 'unknown'
  ) {
    const ageMs = Date.now() - new Date(top.scannedAt).getTime();
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < replaceUnknownDuplicateWithinMs) {
      tail = current.slice(1);
    }
  }
  const next = [scan, ...tail].slice(0, MAX_RECENT_SCANS);
  await AsyncStorage.setItem(RECENT_SCANS_KEY_V4, JSON.stringify(next));
  return next;
};

export const removeRecentScanById = async (scanId: string): Promise<RecentScan[]> => {
  const current = await getRecentScans();
  const next = current.filter((scan) => scan.id !== scanId);
  await AsyncStorage.setItem(RECENT_SCANS_KEY_V4, JSON.stringify(next));
  return next;
};

export async function getCachedSupabaseProfileId(): Promise<string | null> {
  const id = await AsyncStorage.getItem(SUPABASE_PROFILE_ID_KEY);
  const trimmed = id?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export async function tryPersistSuccessfulScanToSupabase(scan: RecentScan, childAgeProfile: ChildAgeProfile): Promise<void> {
  if (!isSupabaseConfigured()) {
    return;
  }
  const profileId = await getCachedSupabaseProfileId();
  if (!profileId) {
    return;
  }
  const client = getSupabase();
  if (!client) {
    return;
  }
  try {
    await persistSuccessfulScanHistory(client, profileId, scan, childAgeProfile);
  } catch (err) {
    console.warn('[storage] tryPersistSuccessfulScanToSupabase', err);
  }
}

const DEV_RESET_KEYS = [
  ONBOARDING_COMPLETED_KEY,
  CHILD_AGE_KEY,
  CHILD_BIRTHDATE_KEY,
  IS_PREMIUM_KEY,
  PLAN_KEY,
  DAILY_SUCCESSFUL_SCANS_KEY,
  RESULT_STYLE_KEY,
  AVOID_PREFERENCES_KEY,
  PREF_REMOTE_PULL_SUPPRESS_UNTIL_MS_KEY,
  SUPABASE_PROFILE_ID_KEY,
  DEVICE_ID_STORAGE_KEY,
  'recentScans',
  RECENT_SCANS_KEY_V3,
  RECENT_SCANS_KEY_V4,
  RECENT_SCANS_LEGACY_CLEARED_KEY,
  'compareSelection_v1',
];

export const resetAppDataForDev = async (): Promise<void> => {
  await AsyncStorage.multiRemove(DEV_RESET_KEYS);
};
