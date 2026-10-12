/**
 * Splash Screen — blueprint §5.2.
 * MoneyMart monogram on Deep Navy; a gold pulse ring expands from the logo
 * centre; "Bid. Stream. Win." fades in beneath. Auto-advances after 2 seconds.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Body, Display } from '@/components/ui';
import { MoneyMartMark } from '@/components/icons';
import { colors, fonts } from '@/theme';

export default function SplashScreen({ onDone }: { onDone: () => void }) {
  const logoScale = useRef(new Animated.Value(0.86)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const tagline = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(logoOpacity, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.spring(logoScale, { toValue: 1, friction: 6, tension: 70, useNativeDriver: true }),
      Animated.loop(
        Animated.timing(ring, { toValue: 1, duration: 1800, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ),
      Animated.timing(tagline, { toValue: 1, duration: 600, delay: 320, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(onDone, 2000);
    return () => clearTimeout(timer);
  }, [logoOpacity, logoScale, ring, tagline, onDone]);

  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.9] });
  const ringOpacity = ring.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] });

  return (
    <View style={styles.root}>
      <View style={styles.center}>
        <Animated.View style={[styles.ringWrap, { transform: [{ scale: ringScale }], opacity: ringOpacity }]}>
          <View style={styles.ring} />
        </Animated.View>

        <Animated.View style={{ opacity: logoOpacity, transform: [{ scale: logoScale }] }}>
          <MoneyMartMark size={82} />
        </Animated.View>
      </View>

      <Animated.View style={[styles.taglineWrap, { opacity: tagline }]}>
        <Display size={17} style={styles.wordmark}>
          MoneyMart
        </Display>
        <Body size={11} weight="bold" color={colors.gold} style={styles.tagline}>
          BID. STREAM. WIN.
        </Body>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  ringWrap: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  ring: { width: 150, height: 150, borderRadius: 75, borderWidth: 2, borderColor: colors.gold },
  taglineWrap: { position: 'absolute', bottom: 78, alignItems: 'center' },
  wordmark: { letterSpacing: 0.4 },
  tagline: { marginTop: 8, letterSpacing: 3.4, fontFamily: fonts.bodyBold },
});
