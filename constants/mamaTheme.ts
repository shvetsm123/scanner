/**
 * Kidlens AI — calm premium palette (warm cream / soft sage / ink).
 * Use for screens, cards, and controls; keep scanner/camera UI dark where needed.
 */
export const M = {
  bgPage: '#F3EFE6',
  bgCard: '#FFFCF7',
  bgCardMuted: '#F8F4EC',
  bgChip: '#FAF6EF',
  bgChipSelected: '#EDE4D6',
  line: '#E6DDD2',
  lineStrong: '#D4C8BA',
  lineSage: '#C5D8CE',
  text: '#1E1A17',
  textBody: '#5A5249',
  textMuted: '#877A6E',
  textSoft: '#9A8E82',
  sage: '#5D7A6A',
  sageWash: '#E8F1EC',
  sageDeep: '#3D5A4C',
  ink: '#2C2824',
  inkButton: '#2C2824',
  cream: '#FFFCF7',
  white: '#FFFFFF',
  gold: '#C9A06E',
  overlay: 'rgba(30, 24, 18, 0.42)',
  shadowCard: {
    shadowColor: '#4A3828',
    shadowOpacity: 0.1,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
  shadowSoft: {
    shadowColor: '#5C4A38',
    shadowOpacity: 0.07,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  r12: 12 as const,
  r14: 14 as const,
  r16: 16 as const,
  r18: 18 as const,
  r20: 20 as const,
  r22: 22 as const,
  r24: 24 as const,
  r28: 28 as const,
} as const;

export const verdictColors = {
  good: { bg: '#E4F0E8', text: '#2D5A40' },
  sometimes: { bg: '#F8ECDD', text: '#7A5218' },
  avoid: { bg: '#F5E4E4', text: '#7A2E2E' },
  unknown: { bg: '#EBE8E4', text: '#5A5249' },
} as const;
