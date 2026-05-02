import { useEffect, useRef } from 'react';
import { Animated, Text, useWindowDimensions, View } from 'react-native';

import { getAppLanguage, t } from '../lib/i18n';

type ScannerFrameProps = {
  barcodeFound?: boolean;
};

export function ScannerFrame({ barcodeFound = false }: ScannerFrameProps) {
  const lang = getAppLanguage();
  const { height } = useWindowDimensions();
  const scanLine = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const frameHeight = height * 0.52;
  const accent = barcodeFound ? '#9FD8B4' : 'rgba(255, 255, 255, 0.9)';
  const glow = barcodeFound ? 'rgba(159, 216, 180, 0.28)' : 'rgba(255, 253, 248, 0.18)';

  useEffect(() => {
    const scanLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLine, {
          toValue: 1,
          duration: 1750,
          useNativeDriver: true,
        }),
        Animated.timing(scanLine, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    );
    scanLoop.start();
    pulseLoop.start();
    return () => {
      scanLoop.stop();
      pulseLoop.stop();
    };
  }, [pulse, scanLine]);

  const scanLineTranslate = scanLine.interpolate({
    inputRange: [0, 1],
    outputRange: [8, Math.max(8, frameHeight - 18)],
  });
  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.46, 1],
  });
  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.98, 1.04],
  });

  const cornerStyle = {
    position: 'absolute' as const,
    width: 42,
    height: 42,
    borderColor: accent,
    opacity: pulseOpacity,
    transform: [{ scale: pulseScale }],
  };

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: '30%',
          alignSelf: 'center',
          width: '76%',
          height: '52%',
          borderRadius: 18,
          borderWidth: 2,
          borderColor: barcodeFound ? 'rgba(159, 216, 180, 0.92)' : 'rgba(255, 255, 255, 0.62)',
          backgroundColor: barcodeFound ? 'rgba(159, 216, 180, 0.09)' : 'rgba(255, 255, 255, 0.06)',
          overflow: 'hidden',
        }}
      >
        <Animated.View
          style={{
            position: 'absolute',
            left: 12,
            right: 12,
            height: 2,
            borderRadius: 999,
            backgroundColor: barcodeFound ? '#9FD8B4' : 'rgba(255, 253, 248, 0.82)',
            opacity: barcodeFound ? 0.2 : 0.78,
            transform: [{ translateY: scanLineTranslate }],
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: 10,
            right: 10,
            top: 10,
            bottom: 10,
            borderRadius: 14,
            backgroundColor: glow,
            opacity: barcodeFound ? 1 : 0.32,
          }}
        />
        <Animated.View style={[cornerStyle, { top: 8, left: 8, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 16 }]} />
        <Animated.View style={[cornerStyle, { top: 8, right: 8, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 16 }]} />
        <Animated.View style={[cornerStyle, { bottom: 8, left: 8, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 16 }]} />
        <Animated.View style={[cornerStyle, { bottom: 8, right: 8, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 16 }]} />
        {barcodeFound ? (
          <View
            style={{
              position: 'absolute',
              alignSelf: 'center',
              top: '42%',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              borderRadius: 999,
              backgroundColor: 'rgba(255,253,248,0.94)',
              paddingHorizontal: 14,
              paddingVertical: 9,
            }}
          >
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: 999,
                backgroundColor: '#2F6F4B',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 13, lineHeight: 16, fontWeight: '900', color: '#FFFDF8' }}>✓</Text>
            </View>
            <Text style={{ fontSize: 14, lineHeight: 18, fontWeight: '800', color: '#245335' }}>Barcode found</Text>
          </View>
        ) : null}
      </View>
      <Text
        style={{
          position: 'absolute',
          bottom: 120,
          alignSelf: 'center',
          color: '#F8F6F2',
          fontSize: 13,
          fontWeight: '600',
          textShadowColor: 'rgba(0, 0, 0, 0.45)',
          textShadowRadius: 6,
          textShadowOffset: { width: 0, height: 1 },
        }}
      >
        {t('frame.pointBarcode', lang)}
      </Text>
    </View>
  );
}
