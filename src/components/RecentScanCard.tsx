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
  onSave: (scan: RecentScan) => void;
  onDelete: (scan: RecentScan) => void;
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

export function RecentScanCard({ scan, onPress, onSave, onDelete }: RecentScanCardProps) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const translateX = useRef(new Animated.Value(0)).current;
  const openOffsetRef = useRef(0);

  useEffect(() => {
    setThumbFailed(false);
  }, [scan.id, scan.imageUrl]);

  const animateTo = (value: number) => {
    openOffsetRef.current = value;
    Animated.spring(translateX, {
      toValue: value,
      useNativeDriver: true,
      friction: 8,
      tension: 80,
    }).start();
  };

  const close = () => animateTo(0);

  const triggerSave = () => {
    close();
    onSave(scan);
  };

  const triggerDelete = () => {
    close();
    onDelete(scan);
  };

  const handleGestureEvent = (event: PanGestureHandlerGestureEvent) => {
    const next = Math.max(-ACTION_WIDTH, Math.min(ACTION_WIDTH, openOffsetRef.current + event.nativeEvent.translationX));
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

  const baseStyle = (pressed: boolean) => ({
    borderRadius: M.r18,
    backgroundColor: tone.bg,
    padding: 16,
    borderWidth: 1,
    borderColor: tone.border,
    ...M.shadowSoft,
    opacity: pressed ? 0.92 : 1,
  });

  return (
    <View style={{ alignSelf: 'stretch', width: '100%', overflow: 'hidden', borderRadius: M.r18 }}>
      <View
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: ACTION_WIDTH,
          backgroundColor: '#DCEFE3',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        <Pressable onPress={triggerSave} style={{ alignItems: 'center', justifyContent: 'center', flex: 1, width: '100%' }}>
          <Ionicons name="heart" size={24} color="#2D7A4B" />
          <Text style={{ marginTop: 5, fontSize: 13, fontWeight: '800', color: '#2D7A4B' }}>Save</Text>
        </Pressable>
      </View>
      <View
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 0,
          width: ACTION_WIDTH,
          backgroundColor: '#F3D8D8',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Pressable onPress={triggerDelete} style={{ alignItems: 'center', justifyContent: 'center', flex: 1, width: '100%' }}>
          <Ionicons name="trash" size={24} color="#A33D3D" />
          <Text style={{ marginTop: 5, fontSize: 13, fontWeight: '800', color: '#A33D3D' }}>Delete</Text>
        </Pressable>
      </View>
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
