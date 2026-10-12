/**
 * MoneyMart mobile — UI primitives.
 * The React Native projection of the web design system: same tokens, same
 * component names, same visual language (§2 Brand Identity).
 */
import { forwardRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, fonts, gradients, layout, radii } from '@/theme';
import { CheckIcon, LiveDot } from './icons';

/* ── Typography ────────────────────────────────────────────────────────── */

export function Display({
  children,
  size = 28,
  color = colors.ink,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[{ fontFamily: fonts.display, fontSize: size, lineHeight: size * 1.12, color }, style]}
    >
      {children}
    </Text>
  );
}

export function Body({
  children,
  size = 14,
  color = colors.ink2,
  weight = 'regular',
  style,
  numberOfLines,
}: {
  children: ReactNode;
  size?: number;
  color?: string;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const family =
    weight === 'bold' ? fonts.bodyBold : weight === 'semibold' ? fonts.bodySemibold : weight === 'medium' ? fonts.bodyMedium : fonts.body;
  return (
    <Text numberOfLines={numberOfLines} style={[{ fontFamily: family, fontSize: size, lineHeight: size * 1.45, color }, style]}>
      {children}
    </Text>
  );
}

/** Prices, timers and lot numbers — Space Grotesk only (§2.3). */
export function Data({
  children,
  size = 16,
  color = colors.gold,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[{ fontFamily: fonts.data, fontSize: size, color, fontVariant: ['tabular-nums'] }, style]}
    >
      {children}
    </Text>
  );
}

/* ── Button ────────────────────────────────────────────────────────────── */

export interface ButtonProps extends Omit<PressableProps, 'style'> {
  label: string;
  variant?: 'gold' | 'green' | 'navy' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
  full?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  variant = 'gold',
  size = 'md',
  loading = false,
  icon,
  full = false,
  disabled,
  style,
  ...props
}: ButtonProps) {
  const heights = { sm: 36, md: 44, lg: 54 } as const;
  const fontSizes = { sm: 13, md: 14, lg: 15 } as const;
  const isSolid = variant === 'gold' || variant === 'green';

  const containerStyle: StyleProp<ViewStyle> = [
    styles.button,
    {
      height: heights[size],
      paddingHorizontal: size === 'sm' ? 14 : 20,
      borderRadius: radii.md ,
      opacity: disabled ? 0.45 : 1,
    },
    full ? styles.full : null,
    variant === 'navy' ? styles.buttonNavy : null,
    variant === 'outline' ? styles.buttonOutline : null,
    variant === 'ghost' ? styles.buttonGhost : null,
    style,
  ];

  const textColor = isSolid ? colors.navy : variant === 'outline' ? colors.gold : colors.ink;

  const content = (
    <View style={styles.buttonInner}>
      {loading ? <ActivityIndicator size="small" color={textColor} /> : icon}
      <Body size={fontSizes[size]} weight="semibold" color={textColor}>
        {label}
      </Body>
    </View>
  );

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      style={({ pressed }) => [containerStyle, pressed ? styles.pressed : null]}
      {...props}
    >
      {isSolid ? (
        <LinearGradient
          colors={variant === 'gold' ? gradients.gold : gradients.live}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: radii.md }]}
        />
      ) : null}
      {content}
    </Pressable>
  );
}

/* ── Surfaces ──────────────────────────────────────────────────────────── */

export function Card({
  children,
  style,
  padded = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}) {
  return <View style={[styles.card, padded ? styles.cardPadded : null, style]}>{children}</View>;
}

export function GlassCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.glass, style]}>{children}</View>;
}

/* ── Badges ────────────────────────────────────────────────────────────── */

export function Pill({
  children,
  tone = 'neutral',
  style,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'gold' | 'green' | 'error';
  style?: StyleProp<ViewStyle>;
}) {
  const tones = {
    neutral: { borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.72)' },
    gold: { borderColor: colors.goldLine, backgroundColor: colors.goldSoft, color: colors.gold },
    green: { borderColor: 'rgba(0,212,161,0.4)', backgroundColor: colors.greenSoft, color: colors.green },
    error: { borderColor: 'rgba(229,62,62,0.42)', backgroundColor: 'rgba(229,62,62,0.14)', color: '#FF8080' },
  } as const;
  const theme = tones[tone];
  return (
    <View style={[styles.pill, { borderColor: theme.borderColor, backgroundColor: theme.backgroundColor }, style]}>
      {typeof children === 'string' ? (
        <Body size={11} weight="semibold" color={theme.color}>
          {children}
        </Body>
      ) : (
        children
      )}
    </View>
  );
}

export function LiveBadge({ viewers, label = 'Live' }: { viewers?: number; label?: string }) {
  return (
    <View style={styles.liveBadge}>
      <LiveDot size={7} />
      <Body size={10} weight="bold" color={colors.green} style={styles.uppercase}>
        {label}
        {viewers !== undefined ? ` ${viewers >= 1000 ? `${(viewers / 1000).toFixed(1)}K` : viewers}` : ''}
      </Body>
    </View>
  );
}

export function VerifiedBadge({ compact = false }: { compact?: boolean }) {
  return (
    <View style={styles.verified}>
      <CheckIcon size={10} color={colors.green} strokeWidth={3} />
      <Body size={9.5} weight="bold" color={colors.green} style={styles.uppercase}>
        {compact ? 'MV' : 'MV Verified'}
      </Body>
    </View>
  );
}

/* ── Avatar ────────────────────────────────────────────────────────────── */

export function Avatar({
  name,
  src,
  size = 40,
  isLive = false,
  isVerified = false,
}: {
  name: string;
  src?: string;
  size?: number;
  isLive?: boolean;
  isVerified?: boolean;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <View style={{ width: size, height: size }}>
      <View
        style={[
          styles.avatar,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor: isLive ? colors.green : colors.goldLine,
          },
        ]}
      >
        {src ? (
          <Image source={{ uri: src }} style={{ width: size, height: size, borderRadius: size / 2 }} />
        ) : (
          <Display size={size * 0.38}>{initials}</Display>
        )}
      </View>
      {isLive ? (
        <View
          style={[
            styles.avatarDot,
            { width: size * 0.3, height: size * 0.3, borderRadius: size * 0.15, backgroundColor: colors.green },
          ]}
        />
      ) : null}
      {isVerified && !isLive ? (
        <View
          style={[
            styles.avatarDot,
            styles.avatarDotVerified,
            { width: size * 0.34, height: size * 0.34, borderRadius: size * 0.17 },
          ]}
        >
          <CheckIcon size={size * 0.2} color={colors.navy} strokeWidth={3} />
        </View>
      ) : null}
    </View>
  );
}

/* ── Layout helpers ───────────────────────────────────────────────────── */

export function SectionHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.flex1}>
        {eyebrow ? (
          <Body size={11} weight="bold" color={colors.gold} style={styles.uppercase}>
            {eyebrow}
          </Body>
        ) : null}
        <Display size={21} style={styles.sectionTitle}>
          {title}
        </Display>
      </View>
      {action}
    </View>
  );
}

export function StatBlock({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'gold' | 'green';
}) {
  const color = tone === 'gold' ? colors.gold : tone === 'green' ? colors.green : colors.ink;
  return (
    <Card style={styles.statBlock}>
      <Body size={10.5} weight="semibold" color={colors.ink3} style={styles.uppercase}>
        {label}
      </Body>
      <Data size={22} color={color} style={styles.statValue}>
        {value}
      </Data>
      {hint ? (
        <Body size={11} color={colors.ink3} style={styles.statHint}>
          {hint}
        </Body>
      ) : null}
    </Card>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <Card style={styles.emptyState}>
      <Display size={17} style={styles.center}>
        {title}
      </Display>
      {body ? (
        <Body size={13} color={colors.ink3} style={[styles.center, styles.emptyBody]}>
          {body}
        </Body>
      ) : null}
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </Card>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

/** Non-dismissable disclosure — used for the buyer's premium (§5.2). */
export const Disclosure = forwardRef<View, { children: ReactNode }>(function Disclosure({ children }, ref) {
  return (
    <View ref={ref} style={styles.disclosure}>
      {children}
    </View>
  );
});

/* ── Styles ────────────────────────────────────────────────────────────── */

export const styles = StyleSheet.create({
  flex1: { flex: 1 },
  center: { textAlign: 'center' },
  uppercase: { letterSpacing: 1.4, textTransform: 'uppercase' },

  button: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttonNavy: { backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  buttonOutline: { borderWidth: 1, borderColor: colors.goldLine, backgroundColor: 'transparent' },
  buttonGhost: { backgroundColor: 'transparent' },
  full: { alignSelf: 'stretch' },
  pressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },

  card: {
    backgroundColor: colors.card,
    borderRadius: radii.lg ,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  cardPadded: { padding: 16 },
  glass: {
    backgroundColor: 'rgba(19,34,52,0.78)',
    borderRadius: radii.lg ,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radii.pill ,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radii.pill ,
    borderWidth: 1,
    borderColor: 'rgba(0,212,161,0.4)',
    backgroundColor: 'rgba(0,212,161,0.16)',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  verified: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radii.pill ,
    borderWidth: 1,
    borderColor: 'rgba(0,212,161,0.34)',
    backgroundColor: 'rgba(0,212,161,0.1)',
    paddingHorizontal: 7,
    paddingVertical: 3,
  },

  avatar: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, backgroundColor: colors.navy, overflow: 'hidden' },
  avatarDot: { position: 'absolute', right: -1, bottom: -1, borderWidth: 2, borderColor: colors.surface },
  avatarDotVerified: { backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },

  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, marginBottom: 14 },
  sectionTitle: { marginTop: 3 },

  statBlock: { flex: 1, minWidth: 140, padding: 14 },
  statValue: { marginTop: 8 },
  statHint: { marginTop: 6 },

  emptyState: { alignItems: 'center', padding: 28 },
  emptyBody: { marginTop: 8, maxWidth: 280 },
  emptyAction: { marginTop: 16 },

  divider: { height: 1, backgroundColor: colors.divider, width: '100%' },
  disclosure: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(245,166,35,0.07)',
    borderRadius: radii.md ,
    padding: 14,
  },
});

export { layout };
