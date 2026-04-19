import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

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
};

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

export function RecentScanCard({ scan, onPress }: RecentScanCardProps) {
  const [thumbFailed, setThumbFailed] = useState(false);

  useEffect(() => {
    setThumbFailed(false);
  }, [scan.id, scan.imageUrl]);

  const showThumb = hasProductImageUrl(scan.imageUrl) && !thumbFailed;

  const baseStyle = (pressed: boolean) => ({
    borderRadius: M.r18,
    backgroundColor: M.bgCard,
    padding: 16,
    ...M.shadowSoft,
    opacity: pressed ? 0.92 : 1,
  });

  if (!showThumb) {
    return (
      <Pressable
        onPress={() => onPress(scan.id)}
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        style={({ pressed }) => ({
          ...baseStyle(pressed),
          flexDirection: 'column',
          alignSelf: 'stretch',
          width: '100%',
        })}
      >
        <RecentScanCardBody scan={scan} />
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => onPress(scan.id)}
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      style={({ pressed }) => ({
        ...baseStyle(pressed),
        flexDirection: 'row',
        alignSelf: 'stretch',
        width: '100%',
        gap: 14,
      })}
    >
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
      <View style={{ flex: 1, minWidth: 0 }}>
        <RecentScanCardBody scan={scan} />
      </View>
    </Pressable>
  );
}
