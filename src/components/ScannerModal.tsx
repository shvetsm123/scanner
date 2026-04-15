import { Ionicons } from '@expo/vector-icons';
import { CameraView } from 'expo-camera';
import type { PermissionResponse } from 'expo-modules-core';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getAppLanguage, t } from '../lib/i18n';
import { ScannerFrame } from './ScannerFrame';

const COMMON_PRODUCT_BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'itf14'];

type ScannerModalProps = {
  visible: boolean;
  /** Bumps when a new scanner session starts so CameraView remounts with a fresh barcode subscription. */
  cameraInstanceKey?: number;
  /** iOS: called after dismiss animation completes (Modal onDismiss). */
  onFullyDismissed?: () => void;
  onClose: () => void;
  onBarcodeScanned: (payload: { data: string }) => void;
  dailyLimitReached: boolean;
  onDailyLimitPress: () => void;
  cameraPermission: PermissionResponse | null;
  onRequestPermission: () => void;
};

export function ScannerModal({
  visible,
  cameraInstanceKey = 0,
  onFullyDismissed,
  onClose,
  onBarcodeScanned,
  dailyLimitReached,
  onDailyLimitPress,
  cameraPermission,
  onRequestPermission,
}: ScannerModalProps) {
  const lang = getAppLanguage();
  const granted = cameraPermission?.granted === true;
  const [torchOn, setTorchOn] = useState(false);

  useEffect(() => {
    if (!visible) {
      setTorchOn(false);
    }
  }, [visible]);

  const toggleTorch = useCallback(() => {
    setTorchOn((v) => !v);
  }, []);

  const canReadCodes = visible && granted && !dailyLimitReached;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'fullScreen' : undefined}
      statusBarTranslucent
      onRequestClose={onClose}
      {...(Platform.OS === 'ios' && onFullyDismissed ? { onDismiss: onFullyDismissed } : {})}
    >
      {visible ? (
        <SafeAreaView style={{ flex: 1, backgroundColor: '#1A1510' }} edges={['top', 'left', 'right']}>
          <View style={{ flex: 1 }}>
            <Pressable
              onPress={onClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              style={{
                position: 'absolute',
                top: 8,
                left: 12,
                zIndex: 20,
                width: 40,
                height: 40,
                borderRadius: 14,
                backgroundColor: 'rgba(255,253,248,0.14)',
                borderWidth: 1,
                borderColor: 'rgba(255,253,248,0.22)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="close" size={24} color="#FFFDF8" />
            </Pressable>

            {granted && !dailyLimitReached ? (
              <Pressable
                onPress={toggleTorch}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityRole="button"
                accessibilityLabel={torchOn ? t('scanner.a11y.torchOff', lang) : t('scanner.a11y.torchOn', lang)}
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 12,
                  zIndex: 20,
                  width: 40,
                  height: 40,
                  borderRadius: 14,
                  backgroundColor: torchOn ? 'rgba(255,253,248,0.28)' : 'rgba(255,253,248,0.14)',
                  borderWidth: 1,
                  borderColor: torchOn ? 'rgba(255,253,248,0.42)' : 'rgba(255,253,248,0.22)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons
                  name={torchOn ? 'flashlight' : 'flashlight-outline'}
                  size={22}
                  color={torchOn ? '#FFFDF8' : 'rgba(255,253,248,0.92)'}
                />
              </Pressable>
            ) : null}

            {cameraPermission === null ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
                <Text style={{ color: 'rgba(255,253,248,0.75)', fontSize: 15 }}>{t('scanner.loadingCamera', lang)}</Text>
              </View>
            ) : granted ? (
              <View style={{ flex: 1 }}>
                <CameraView
                  key={`scanner-cam-${cameraInstanceKey}`}
                  style={{ flex: 1 }}
                  facing="back"
                  enableTorch={torchOn}
                  barcodeScannerSettings={{ barcodeTypes: [...COMMON_PRODUCT_BARCODE_TYPES] as never }}
                  onBarcodeScanned={canReadCodes ? onBarcodeScanned : undefined}
                />
                <ScannerFrame />
                {dailyLimitReached ? (
                  <Pressable
                    onPress={onDailyLimitPress}
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: 0,
                      bottom: 0,
                      zIndex: 15,
                      backgroundColor: 'rgba(35, 28, 20, 0.72)',
                      alignItems: 'center',
                      justifyContent: 'center',
                      paddingHorizontal: 24,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 17,
                        fontWeight: '700',
                        color: '#FFFDF8',
                        textAlign: 'center',
                        lineHeight: 24,
                      }}
                    >
                      {t('scanner.dailyLimitTitle', lang)}
                    </Text>
                    <Text
                      style={{
                        marginTop: 10,
                        fontSize: 14,
                        color: 'rgba(255,253,248,0.88)',
                        textAlign: 'center',
                        lineHeight: 20,
                      }}
                    >
                      {t('scanner.dailyLimitBody', lang)}
                    </Text>
                    <View
                      style={{
                        marginTop: 16,
                        paddingVertical: 12,
                        paddingHorizontal: 22,
                        borderRadius: 14,
                        backgroundColor: '#FFFDF8',
                      }}
                    >
                      <Text style={{ fontSize: 14, fontWeight: '700', color: '#2C251F' }}>{t('scanner.viewPlans', lang)}</Text>
                    </View>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <View style={{ flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 20, color: '#FFFDF8', fontWeight: '700', textAlign: 'center' }}>
                  {t('scanner.cameraNeeded', lang)}
                </Text>
                <Text
                  style={{
                    marginTop: 10,
                    color: 'rgba(255,253,248,0.78)',
                    fontSize: 15,
                    textAlign: 'center',
                    lineHeight: 22,
                  }}
                >
                  {t('scanner.allowCamera', lang)}
                </Text>
                <Pressable
                  onPress={onRequestPermission}
                  style={{
                    marginTop: 18,
                    borderRadius: 14,
                    backgroundColor: '#FFFDF8',
                    paddingHorizontal: 22,
                    paddingVertical: 12,
                  }}
                >
                  <Text style={{ color: '#2C251F', fontSize: 15, fontWeight: '700' }}>{t('scanner.grantAccess', lang)}</Text>
                </Pressable>
              </View>
            )}
          </View>
        </SafeAreaView>
      ) : null}
    </Modal>
  );
}
