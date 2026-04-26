import type { RefObject } from 'react';
import { Alert, Platform, Share, type View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { captureRef } from 'react-native-view-shot';

import type { RecentScan } from '../../types/scan';

type ShareScanResultArgs = {
  cardRef: RefObject<View | null>;
  scan: RecentScan;
};

function verdictText(verdict: RecentScan['verdict']): string {
  if (verdict === 'good') {
    return 'good';
  }
  if (verdict === 'sometimes') {
    return 'sometimes';
  }
  if (verdict === 'avoid') {
    return 'avoid';
  }
  return 'unknown';
}

export function buildScanResultShareText(scan: RecentScan): string {
  const productName = scan.productName?.trim() || 'Unknown product';
  const brand = scan.brand?.trim() || '-';
  const barcode = scan.barcode?.trim() || '-';
  const summary = scan.summary?.trim() || '';
  const reasons = (scan.reasons ?? []).map((reason) => reason.trim()).filter(Boolean).slice(0, 3);
  const ingredientPanel = scan.ingredientPanel;
  const good = ingredientPanel?.good ?? [];
  const redFlags = ingredientPanel?.redFlags ?? [];
  const neutral = ingredientPanel?.neutral ?? [];
  const lines = [
    'KidLens AI product check',
    '',
    `Product: ${productName}`,
    `Brand: ${brand}`,
    `Barcode: ${barcode}`,
    '',
    `Verdict: ${verdictText(scan.verdict)}`,
    '',
    'Summary:',
    summary,
    '',
    'Key reasons:',
    ...reasons.map((reason) => `• ${reason}`),
    '',
    'Ingredient notes:',
    'Good:',
    ...good.map((item) => `• ${item.name}: ${item.note}`),
    '',
    'Watch out:',
    ...redFlags.map((item) => `• ${item.name}: ${item.note}`),
    '',
    'Neutral:',
    ...neutral.map((item) => `• ${item.name}: ${item.note}`),
    '',
    'AI note:',
    'AI may be wrong. Use as guidance, not medical advice.',
    '',
    'Download KidLens AI:',
    'iOS: Coming soon',
    'Android: Coming soon',
  ];

  return lines.join('\n');
}

async function shareImageThenCopyText(uri: string, message: string): Promise<void> {
  const sharing = await import('expo-sharing').catch(() => null);
  const canShareFile = sharing ? await sharing.isAvailableAsync() : false;

  if (sharing && canShareFile) {
    await sharing.shareAsync(uri, {
      mimeType: 'image/png',
      UTI: 'public.png',
      dialogTitle: 'KidLens AI product check',
    });
    await Clipboard.setStringAsync(message);
    Alert.alert('Image shared. Result text copied to clipboard.');
    return;
  }

  await Share.share({ message });
}

export async function shareScanResult({ cardRef, scan }: ShareScanResultArgs): Promise<void> {
  const message = buildScanResultShareText(scan);
  const target = cardRef.current;

  if (!target) {
    await Share.share({ message });
    return;
  }

  try {
    const uri = await captureRef(target, {
      format: 'png',
      quality: 1,
      result: 'tmpfile',
      width: 1080,
      height: 1350,
    });

    if (Platform.OS === 'ios') {
      await Share.share({ message, url: uri });
      return;
    }

    await shareImageThenCopyText(uri, message);
    return;
  } catch (err) {
    console.warn('[shareScanResult] image share failed', err);
  }

  await Share.share({ message });
}
