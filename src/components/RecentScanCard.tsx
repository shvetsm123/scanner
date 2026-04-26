import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import {
  PanGestureHandler,
  State,
  type PanGestureHandlerGestureEvent,
  type PanGestureHandlerStateChangeEvent,
} from 'react-native-gesture-handler';

import { M } from '../../constants/mamaTheme';
import type { RecentScan } from '../types/scan';
import { VerdictBadge } from './VerdictBadge';

function hasProductImageUrl(value: unknown): boolean {
  if (value == null) {
    return false;
  }
  const s = String(value).trim();
  if (!s) {
    return false;
  }
  const lower = s.toLowerCase();
  if (lower === 'null' || lower === 'undefined') {
    return false;
  }
  return /^https?:\/\//i.test(s);
}

type RecentScanCardProps = {
  scan: RecentScan;
  onPress: (scanId: string) => void;
  onSave: (scan: RecentScan, nextSaved: boolean) => void | boolean | Promise<boolean>;
  onDelete: (scan: RecentScan) => void;
  isSaved?: boolean;
};

function cardToneForVerdict(verdict: RecentScan['verdict']): { bg: string; border: string } {
  if (verdict === 'good') {
    return { bg: '#EAF4EE', border: '#CDE2D5' };
  }
  if (verdict === 'sometimes') {
    return { bg: '#FFF4D8', border: '#E8C989' };
  }
  if (verdict === 'avoid') {
    return { bg: '#FCEAEA', border: '#E8C7C7' };
  }
  return { bg: M.bgCard, border: M.line };
}

const ACTION_WIDTH = 90;
const ACTION_THRESHOLD = ACTION_WIDTH / 2;
const VELOCITY_THRESHOLD = 700;
const ACTION_FADE_START = 20;
const CARD_RADIUS = M.r18;

function RecentScanCardBody({ scan }: { scan: RecentScan }) {
  return (
    <View style={{ width: '100%' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ flexShrink: 1, fontSize: 16, fontWeight: '700', color: M.text }} numberOfLines={1}>
          {scan.productName}
        </Text>
        <VerdictBadge verdict={scan.verdict} />
      </View>
      {!!scan.brand && (
        <Text style={{ marginTop: 6, fontSize: 13, color: M.textMuted }} numberOfLines={1}>
          {scan.brand}
        </Text>
      )}
      <Text style={{ marginTop: 10, fontSize: 14, lineHeight: 20, color: M.textBody }} numberOfLines={2}>
        {scan.summary}
      </Text>
      <Text style={{ marginTop: 10, fontSize: 12, color: M.textSoft }}>Barcode: {scan.barcode}</Text>
    </View>
  );
}

export function RecentScanCard({ scan, onPress, onSave, onDelete, isSaved = false }: RecentScanCardProps) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const [openAction, setOpenAction] = useState<'save' | 'delete' | null>(null);
  const [optimisticSaved, setOptimisticSaved] = useState(isSaved);
  const translateX = useRef(new Animated.Value(0)).current;
  const openOffsetRef = useRef(0);

  useEffect(() => {
    setThumbFailed(false);
    setOpenAction(null);
    openOffsetRef.current = 0;
    translateX.setValue(0);
  }, [scan.id, scan.imageUrl, translateX]);

  useEffect(() => {
    setOptimisticSaved(isSaved);
  }, [isSaved, scan.id]);

  const animateTo = (value: number) => {
    openOffsetRef.current = value;
    setOpenAction(value > 0 ? 'save' : value < 0 ? 'delete' : null);
    Animated.spring(translateX, {
      toValue: value,
      useNativeDriver: true,
      friction: 8,
      tension: 80,
    }).start();
  };

  const close = () => animateTo(0);

  const triggerSave = async () => {
    const previousSaved = saved;
    const nextSaved = !saved;
    setOptimisticSaved(nextSaved);
    close();
    const ok = await onSave(scan, nextSaved);
    if (ok === false) {
      setOptimisticSaved(previousSaved);
    }
  };

  const triggerDelete = () => {
    close();
    onDelete(scan);
  };

  const handleGestureEvent = (event: PanGestureHandlerGestureEvent) => {
    const start = openOffsetRef.current;
    const raw = start + event.nativeEvent.translationX;
    const min = start > 0 ? 0 : -ACTION_WIDTH;
    const max = start < 0 ? 0 : ACTION_WIDTH;
    const next = Math.max(min, Math.min(max, raw));
    translateX.setValue(next);
  };

  const handleGestureStateChange = (event: PanGestureHandlerStateChangeEvent) => {
    const { state, oldState, translationX, velocityX } = event.nativeEvent;
    const finished =
      state === State.END ||
      state === State.CANCELLED ||
      state === State.FAILED ||
      oldState === State.ACTIVE;

    if (!finished) {
      return;
    }

    const total = openOffsetRef.current + translationX;
    if (openOffsetRef.current > 0) {
      if (translationX > ACTION_THRESHOLD || velocityX > VELOCITY_THRESHOLD) {
        triggerSave();
        return;
      }
      if (translationX < 0 || velocityX < -VELOCITY_THRESHOLD) {
        close();
        return;
      }
      animateTo(ACTION_WIDTH);
      return;
    }
    if (openOffsetRef.current < 0) {
      if (translationX < -ACTION_THRESHOLD || velocityX < -VELOCITY_THRESHOLD) {
        triggerDelete();
        return;
      }
      if (translationX > 0 || velocityX > VELOCITY_THRESHOLD) {
        close();
        return;
      }
      animateTo(-ACTION_WIDTH);
      return;
    }

    if (total > ACTION_THRESHOLD || velocityX > VELOCITY_THRESHOLD) {
      animateTo(ACTION_WIDTH);
      return;
    }
    if (total < -ACTION_THRESHOLD || velocityX < -VELOCITY_THRESHOLD) {
      animateTo(-ACTION_WIDTH);
      return;
    }
    close();
  };

  const showThumb = hasProductImageUrl(scan.imageUrl) && !thumbFailed;
  const tone = cardToneForVerdict(scan.verdict);
  const saveOpacity = translateX.interpolate({
    inputRange: [0, ACTION_FADE_START, ACTION_WIDTH],
    outputRange: [0, 0, 1],
    extrapolate: 'clamp',
  });
  const deleteOpacity = translateX.interpolate({
    inputRange: [-ACTION_WIDTH, -ACTION_FADE_START, 0],
    outputRange: [1, 0, 0],
    extrapolate: 'clamp',
  });

  const baseStyle = (pressed: boolean) => ({
    borderRadius: CARD_RADIUS,
    backgroundColor: tone.bg,
    padding: 16,
    borderWidth: 1,
    borderColor: tone.border,
    ...M.shadowSoft,
    opacity: pressed ? 0.92 : 1,
  });
  const saved = optimisticSaved;
  const saveBg = saved ? '#CBE6D5' : '#DCEFE3';
  const saveText = saved ? 'Saved' : 'Save';
  const saveIcon = saved ? 'heart' : 'heart-outline';

  return (
    <View
      style={{
        alignSelf: 'stretch',
        width: '100%',
        overflow: 'hidden',
        borderRadius: CARD_RADIUS,
        backgroundColor: M.bgCard,
      }}
    >
      <Animated.View
        pointerEvents={openAction === 'save' ? 'auto' : 'none'}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: ACTION_WIDTH + CARD_RADIUS,
          backgroundColor: saveBg,
          borderTopLeftRadius: CARD_RADIUS,
          borderBottomLeftRadius: CARD_RADIUS,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: saveOpacity,
        }}
      >
        <Pressable
          onPress={triggerSave}
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            width: ACTION_WIDTH,
            paddingLeft: 2,
          }}
        >
          <Ionicons name={saveIcon} size={24} color="#2D7A4B" />
          <Text style={{ marginTop: 7, fontSize: 13, fontWeight: '800', color: '#2D7A4B' }}>{saveText}</Text>
        </Pressable>
      </Animated.View>
      <Animated.View
        pointerEvents={openAction === 'delete' ? 'auto' : 'none'}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 0,
          width: ACTION_WIDTH + CARD_RADIUS,
          backgroundColor: '#F3D8D8',
          borderTopRightRadius: CARD_RADIUS,
          borderBottomRightRadius: CARD_RADIUS,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: deleteOpacity,
        }}
      >
        <Pressable
          onPress={triggerDelete}
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            width: ACTION_WIDTH,
            paddingRight: 2,
          }}
        >
          <Ionicons name="trash" size={24} color="#A33D3D" />
          <Text style={{ marginTop: 7, fontSize: 13, fontWeight: '800', color: '#A33D3D' }}>Delete</Text>
        </Pressable>
      </Animated.View>
      <PanGestureHandler
        activeOffsetX={[-10, 10]}
        failOffsetY={[-8, 8]}
        onGestureEvent={handleGestureEvent}
        onHandlerStateChange={handleGestureStateChange}
      >
        <Animated.View style={{ transform: [{ translateX }] }}>
          <Pressable
            onPress={() => {
              if (openOffsetRef.current !== 0) {
                close();
                return;
              }
              onPress(scan.id);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            style={({ pressed }) => ({
              ...baseStyle(pressed),
              flexDirection: showThumb ? 'row' : 'column',
              alignSelf: 'stretch',
              width: '100%',
              gap: showThumb ? 14 : undefined,
            })}
          >
            {showThumb ? (
              <Image
                source={{ uri: String(scan.imageUrl).trim() }}
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 12,
                }}
                contentFit="cover"
                onError={() => setThumbFailed(true)}
              />
            ) : null}
            <View style={{ flex: 1, minWidth: 0 }}>
              <RecentScanCardBody scan={scan} />
            </View>
          </Pressable>
        </Animated.View>
      </PanGestureHandler>
    </View>
  );
}
