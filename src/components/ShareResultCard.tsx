import { forwardRef } from 'react';
import { ImageBackground, StyleSheet, Text, View } from 'react-native';

import { M } from '../../constants/mamaTheme';
import type { RecentScan, Verdict } from '../types/scan';

const CARD_W = 360;
const CARD_H = 450;

const VERDICT_CARD_UI: Record<Verdict, { label: string; bg: string; border: string; text: string }> = {
  good: { label: 'Good', bg: M.sageWash, border: M.lineSage, text: '#245335' },
  sometimes: { label: 'Sometimes', bg: '#F8ECDD', border: '#E3C18B', text: '#6B4310' },
  avoid: { label: 'Avoid', bg: '#FCEAEA', border: '#E1BDBD', text: '#6F2525' },
  unknown: { label: 'Unknown', bg: '#EBE8E4', border: '#D6D1CB', text: M.textBody },
};

function cleanText(value: string | undefined | null, fallback = ''): string {
  const text = value?.trim();
  return text && text.length > 0 ? text : fallback;
}

export const ShareResultCard = forwardRef<View, { scan: RecentScan }>(function ShareResultCard({ scan }, ref) {
  const verdict = VERDICT_CARD_UI[scan.verdict];
  const productName = cleanText(scan.productName, 'Unknown product');
  const brand = cleanText(scan.brand, '');
  const summary = cleanText(scan.summary, 'AI product check result from KidLens AI.');

  return (
    <View
      ref={ref}
      collapsable={false}
      style={styles.root}
    >
      <ImageBackground
        source={require('../../assets/images/onboarding/onboarding-1-share.jpg')}
        resizeMode="cover"
        style={styles.background}
      >
        <View pointerEvents="none" style={styles.gradientTop} />
        <View pointerEvents="none" style={styles.gradientMiddle} />
        <View pointerEvents="none" style={styles.gradientBottom} />

        <View style={styles.content}>
          <View style={styles.resultCard}>
            <Text style={styles.productName} numberOfLines={3}>
              {productName}
            </Text>
            {brand ? (
              <Text style={styles.brand} numberOfLines={1}>
                {brand}
              </Text>
            ) : null}

            <View
              style={[
                styles.verdictBadge,
                {
                  backgroundColor: verdict.bg,
                  borderColor: verdict.border,
                },
              ]}
            >
              <Text style={[styles.verdictText, { color: verdict.text }]}>{verdict.label}</Text>
            </View>

            <Text style={styles.summary} numberOfLines={5}>
              {summary}
            </Text>
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Scanned with KidLens AI</Text>
          </View>
        </View>
      </ImageBackground>
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    width: CARD_W,
    height: CARD_H,
    backgroundColor: M.bgPage,
    overflow: 'hidden',
  },
  background: {
    flex: 1,
  },
  gradientTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: CARD_H * 0.6,
    backgroundColor: 'rgba(255, 252, 247, 0.84)',
  },
  gradientMiddle: {
    position: 'absolute',
    top: CARD_H * 0.26,
    left: 0,
    right: 0,
    height: CARD_H * 0.36,
    backgroundColor: 'rgba(255, 252, 247, 0.68)',
  },
  gradientBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: CARD_H * 0.56,
    backgroundColor: 'rgba(255, 252, 247, 0.96)',
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 52,
    paddingBottom: 34,
    justifyContent: 'center',
  },
  resultCard: {
    alignSelf: 'center',
    width: '88%',
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    paddingVertical: 22,
    paddingHorizontal: 20,
    shadowColor: '#4A3828',
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 7,
  },
  productName: {
    fontSize: 25,
    lineHeight: 29,
    fontWeight: '900',
    color: M.text,
    letterSpacing: -0.2,
  },
  brand: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '600',
    color: M.textBody,
  },
  verdictBadge: {
    marginTop: 14,
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 13,
  },
  verdictText: {
    fontSize: 13.5,
    lineHeight: 17,
    fontWeight: '900',
  },
  summary: {
    marginTop: 15,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '700',
    color: M.textBody,
  },
  footer: {
    marginTop: 18,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 13,
    lineHeight: 18,
    color: M.text,
    fontWeight: '900',
    textAlign: 'center',
  },
});
