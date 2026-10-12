/**
 * Welcome Carousel — blueprint §5.2 (3 slides) with a Skip button top-right and
 * page dots. Slides 1–3 carry the mandated copy:
 *   "Live Auctions — Bid in Real Time"
 *   "Creator Streams — Shop Live with the Creators You Love"
 *   "Win Big — Score Rare Finds at Unbeatable Prices"
 */
import { useRef, useState } from 'react';
import {
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Body, Button, Display, Pill } from '@/components/ui';
import { GavelIcon, LiveDot, MoneyMartMark, ShieldIcon, SparkIcon } from '@/components/icons';
import { colors, gradients, radii } from '@/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const SLIDES = [
  {
    eyebrow: 'Live Auctions',
    title: 'Bid in\nReal Time',
    body: 'Sub-second bidding over a live connection, with anti-snipe protection so the final ten seconds can never steal your lot.',
    icon: <GavelIcon size={30} color={colors.gold} />,
    accent: colors.gold,
  },
  {
    eyebrow: 'Creator Streams',
    title: 'Shop Live with\nthe Creators\nyou Love',
    body: 'Real creators, real rooms, real drops. Chat with the host, watch the price move, and win the piece you came for.',
    icon: <LiveDot size={26} />,
    accent: colors.green,
  },
  {
    eyebrow: 'Win Big',
    title: 'Score Rare Finds\nat Unbeatable\nPrices',
    body: 'Creator streams, traditional auction house sales and an MV Verified marketplace — all in one place, in your currency.',
    icon: <SparkIcon size={30} color={colors.gold} />,
    accent: colors.gold,
  },
];

export default function WelcomeCarouselScreen({ navigation }: { navigation: any }) {
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollView | null>(null);
  const [index, setIndex] = useState(0);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(event.nativeEvent.contentOffset.x / SCREEN_WIDTH));
  };

  const goNext = () => {
    if (index >= SLIDES.length - 1) {
      navigation.replace('Country');
      return;
    }
    scroll.current?.scrollTo({ x: (index + 1) * SCREEN_WIDTH, animated: true });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <MoneyMartMark size={30} />
        <Pressable onPress={() => navigation.replace('Country')} hitSlop={12}>
          <Body size={13.5} weight="semibold" color={colors.ink2}>
            Skip
          </Body>
        </Pressable>
      </View>

      <ScrollView
        ref={scroll}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
      >
        {SLIDES.map((slide) => (
          <View key={slide.eyebrow} style={styles.slide}>
            <View style={[styles.iconWrap, { borderColor: `${slide.accent}55`, backgroundColor: `${slide.accent}1F` }]}>
              {slide.icon}
            </View>

            <Body size={11.5} weight="bold" color={slide.accent} style={styles.eyebrow}>
              {slide.eyebrow.toUpperCase()}
            </Body>

            <Display size={38} style={styles.title}>
              {slide.title}
            </Display>

            <Body size={14.5} color={colors.ink2} style={styles.body}>
              {slide.body}
            </Body>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.dots}>
          {SLIDES.map((slide, dotIndex) => (
            <View
              key={slide.eyebrow}
              style={[
                styles.dot,
                dotIndex === index ? styles.dotActive : null,
              ]}
            />
          ))}
        </View>

        <Button
          label={index === SLIDES.length - 1 ? 'Get started' : 'Continue'}
          variant="gold"
          size="lg"
          full
          onPress={goNext}
        />
        <View style={styles.trustRow}>
          <Pill tone="green">
            <ShieldIcon size={11} color={colors.green} />
            <Body size={10.5} weight="semibold" color={colors.green}>
              Escrow protected
            </Body>
          </Pill>
          <Pill tone="gold">
            <LiveDot size={7} />
            <Body size={10.5} weight="semibold" color={colors.gold}>
              5 launch markets
            </Body>
          </Pill>
        </View>
      </View>

      <LinearGradient
        colors={['rgba(7,15,24,0)', 'rgba(7,15,24,0.9)']}
        style={styles.scrim}
        pointerEvents="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  slide: { width: SCREEN_WIDTH, paddingHorizontal: 26, justifyContent: 'center', paddingBottom: 40 },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: radii.lg ,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 26,
  },
  eyebrow: { letterSpacing: 2.4, marginBottom: 10 },
  title: { lineHeight: 42 },
  body: { marginTop: 18, lineHeight: 23 },
  footer: { paddingHorizontal: 22, gap: 12 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 6 },
  dot: { width: 8, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.22)' },
  dotActive: { width: 26, backgroundColor: colors.gold },
  trustRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 160 },
});
