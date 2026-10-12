/**
 * MoneyMart mobile — theme.
 *
 * React Native has no CSS custom properties, so this module is the mobile
 * projection of @moneymart/tokens. Values are imported from the shared package
 * and never re-typed by hand, which keeps the phone pixel-consistent with web
 * and TV (§2 Brand Identity).
 */
import { brand, fontFamily, gradient, motion, palette, radius, shadow, space, surface, text } from '@moneymart/tokens';

export const colors = {
  ...palette,
  ...brand,
  surface: surface.base,
  raised: surface.raised,
  card: surface.card,
  glass: surface.glass,
  border: surface.border,
  borderStrong: surface.borderStrong,
  divider: surface.divider,
  scrim: surface.scrim,
  ink: text.primary,
  ink2: text.secondary,
  ink3: text.tertiary,
  inverse: text.inverse,
} as const;

/**
 * Font families. On device these map to Inter / Space Grotesk once loaded via
 * expo-font; the fallbacks keep text legible before the fonts land.
 */
export const fonts = {
  display: 'ClashDisplay-Bold',
  displaySemibold: 'ClashDisplay-Semibold',
  body: 'Inter-Regular',
  bodyMedium: 'Inter-Medium',
  bodySemibold: 'Inter-SemiBold',
  bodyBold: 'Inter-Bold',
  data: 'SpaceGrotesk-Bold',
  dataMedium: 'SpaceGrotesk-Medium',
} as const;

/** Fallback stacks for platforms where the custom faces are not yet loaded. */
export const fontFallback = fontFamily;

export const spacing = space;
export const shadows = shadow;
export const easing = motion;

/** Convert a rem-based design token ("0.75rem") to React Native pixels. */
export function px(value: string): number {
  const numeric = Number.parseFloat(value);
  if (Number.isNaN(numeric)) return 0;
  return value.includes('rem') ? Math.round(numeric * 16) : numeric;
}

/**
 * Radii as numbers. React Native takes numeric border radii, while the shared
 * token package stores CSS-style strings — this is the single conversion point.
 */
export const radii = {
  xs: px(radius.xs),
  sm: px(radius.sm),
  md: px(radius.md),
  lg: px(radius.lg),
  xl: px(radius.xl),
  '2xl': px(radius['2xl']),
  pill: 999,
  circle: 999,
} as const;

/** Spacing as numbers, for gap/padding arithmetic in RN styles. */
export const spacingPx = {
  s1: px(space[1]),
  s2: px(space[2]),
  s3: px(space[3]),
  s4: px(space[4]),
  s5: px(space[5]),
  s6: px(space[6]),
  s8: px(space[8]),
  s10: px(space[10]),
  s12: px(space[12]),
} as const;

export type SpacingKey = keyof typeof spacing;

/** Build a padded style without repeating the same object shape everywhere. */
export function gap(value: SpacingKey) {
  return { gap: Number.parseFloat(spacing[value]) * 16 };
}

export const layout = {
  screenPadding: 16,
  headerHeight: 56,
  tabBarHeight: 62,
  cardGap: 12,
} as const;

/** Linear gradient stops, re-exported for expo-linear-gradient. */
export const gradients = {
  gold: ['#F5A623', '#FFC85C', '#D98A0F'] as const,
  live: ['#00D4A1', '#F5A623'] as const,
  navy: ['#0D1B2A', '#070F18'] as const,
  heroScrim: ['rgba(7,15,24,0)', 'rgba(7,15,24,0.65)', '#070F18'] as const,
  sheen: ['rgba(255,255,255,0.07)', 'rgba(255,255,255,0)'] as const,
};

export const cssGradient = gradient;

export const theme = {
  colors,
  fonts,
  spacing,
  radii,
  shadows,
  easing,
  layout,
  gradients,
} as const;

export default theme;
