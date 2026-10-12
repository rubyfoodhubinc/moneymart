/**
 * MoneyMart mobile — app shell.
 *
 * Implements the blueprint §5.2 screen map:
 *   Onboarding (5 screens) → Main tabs (Home / Discovery / Sell / Profile)
 *   plus full-screen stack routes for the live room, lot detail and orders.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Alert, Linking, LogBox, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  DefaultTheme,
  NavigationContainer,
  createNavigationContainerRef,
  type LinkingOptions,
} from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts as useInterFonts,
} from '@expo-google-fonts/inter';
import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_700Bold,
  useFonts as useSpaceFonts,
} from '@expo-google-fonts/space-grotesk';

import { colors, fonts } from '@/theme';
import { api, getSocket } from '@/lib/api';
import { useSession } from '@/store/session';
import type { RootStackParamList } from '@/navigation';

import SplashScreen from '@/screens/SplashScreen';
import WelcomeCarouselScreen from '@/screens/WelcomeCarouselScreen';
import CountryCurrencyScreen from '@/screens/CountryCurrencyScreen';
import AuthScreen from '@/screens/AuthScreen';
import ProfileSetupScreen from '@/screens/ProfileSetupScreen';
import HomeScreen from '@/screens/HomeScreen';
import DiscoveryScreen from '@/screens/DiscoveryScreen';
import SellScreen from '@/screens/SellScreen';
import ProfileScreen from '@/screens/ProfileScreen';
import LiveScreen from '@/screens/LiveScreen';
import StreamScreen from '@/screens/StreamScreen';
import AuctionDetailScreen from '@/screens/AuctionDetailScreen';
import AutoBidScreen from '@/screens/AutoBidScreen';

// Experimental WebAssembly warnings from the Tailwind build tooling are not
// relevant to the app runtime.
LogBox.ignoreLogs(['Require cycle', 'WASI']);

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

/** Lets the socket and deep-link handlers navigate from outside the React tree. */
const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * Deep links (§7.3).
 *
 * The TV renders a QR encoding `moneymart://bid/<auctionId>?token=…&exp=…`.
 * Scanning it opens this app straight onto the lot that is on the block. The
 * path maps onto the existing AuctionDetail route, and the token is verified
 * server-side by `handleDeepLink` before the link is trusted.
 */
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['moneymart://', 'https://moneymart.app'],
  config: {
    screens: {
      Tabs: {
        screens: { Home: 'home', Discovery: 'discover', Sell: 'sell', Profile: 'account' },
      },
      Live: 'live',
      Stream: 'stream/:id',
      AuctionDetail: 'bid/:id',
    },
  },
};

/** A parsed TV handoff awaiting navigation, held until the app is onboarded. */
interface PendingHandoff {
  auctionId: string;
  token?: string;
  expiresAt?: number;
}

const navTheme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    background: colors.surface,
    card: colors.raised,
    text: colors.ink,
    border: colors.divider,
    primary: colors.gold,
  },
};

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: 'rgba(244,247,250,0.45)',
        tabBarStyle: {
          backgroundColor: 'rgba(9,18,29,0.97)',
          borderTopColor: 'rgba(255,255,255,0.08)',
          height: 62,
          paddingBottom: 6,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontFamily: fonts.bodySemibold, fontSize: 10.5, letterSpacing: 0.6 },
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarLabel: 'HOME' }} />
      <Tab.Screen name="Discovery" component={DiscoveryScreen} options={{ tabBarLabel: 'DISCOVER' }} />
      <Tab.Screen name="Sell" component={SellScreen} options={{ tabBarLabel: 'SELL' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarLabel: 'ACCOUNT' }} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [booted, setBooted] = useState(false);
  const [onboarded, setOnboarded] = useState(false);
  const bootstrap = useSession((state) => state.bootstrap);
  const userId = useSession((state) => state.user?.id);

  // Type roles per §2.3: Inter for UI/body, Space Grotesk for numerals/data.
  // Clash Display (the licensed display face) is substituted with Inter Bold on
  // device and swapped in when the brand font files are licensed for bundling.
  /** A parsed handoff waiting for the navigator to be ready. */
  const [pending, setPending] = useState<PendingHandoff | null>(null);

  const [interLoaded] = useInterFonts({
    [fonts.body]: Inter_400Regular,
    [fonts.bodyMedium]: Inter_500Medium,
    [fonts.bodySemibold]: Inter_600SemiBold,
    [fonts.bodyBold]: Inter_700Bold,
    [fonts.display]: Inter_700Bold,
    [fonts.displaySemibold]: Inter_600SemiBold,
  });
  const [spaceLoaded] = useSpaceFonts({
    [fonts.data]: SpaceGrotesk_700Bold,
    [fonts.dataMedium]: SpaceGrotesk_500Medium,
  });
  const fontsLoaded = interLoaded && spaceLoaded;

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Join the personal room so outbid alerts arrive anywhere in the app.
  useEffect(() => {
    if (userId) getSocket().emit('user:join', userId);
  }, [userId]);

  /**
   * Handle an incoming TV handoff link (§7.3 QR bridge).
   *
   * Runs before the navigator is ready on a cold start, so the parsed handoff is
   * parked in state and redeemed once onboarding finishes and the root stack is
   * mounted. The token is verified server-side: a forged or expired code opens
   * the lot view but is reported rather than silently trusted.
   */
  const handleDeepLink = useCallback((url: string | null) => {
    if (!url) return;

    /**
     * Parse without `new URL`.
     *
     * `new URL('moneymart://bid/x')` treats `bid` as the host and `/x` as the
     * path, so a standard parser cannot see the route. React Native hands over
     * the raw string, so the scheme, path and query are split explicitly.
     */
    const withoutScheme = url.includes('://') ? url.slice(url.indexOf('://') + 3) : url;
    const [rawPath, rawQuery = ''] = withoutScheme.split('?');
    const path = rawPath.replace(/^\/+/, '');
    const segments = path.split('/').filter(Boolean);

    // Accept `bid/<id>` for the custom scheme, and `/bid/<id>` for https links.
    const bidIndex = segments.indexOf('bid');
    const auctionId = bidIndex >= 0 ? segments[bidIndex + 1] : undefined;
    if (!auctionId) return;

    const params = new URLSearchParams(rawQuery);
    const token = params.get('token') ?? undefined;
    const exp = Number(params.get('exp'));

    setPending({
      auctionId: decodeURIComponent(auctionId),
      token,
      expiresAt: Number.isFinite(exp) && exp > 0 ? exp : undefined,
    });
  }, []);

  // Cold start: the link that launched the app, plus links received while running.
  useEffect(() => {
    void Linking.getInitialURL().then(handleDeepLink);
    const subscription = Linking.addEventListener('url', ({ url }) => handleDeepLink(url));
    return () => subscription.remove();
  }, [handleDeepLink]);

  // Redeem a parked handoff once the navigator can actually route.
  useEffect(() => {
    if (!pending || !navigationRef.isReady()) return;
    const link = pending;
    setPending(null);

    void (async () => {
      let verified = true;
      if (link.token) {
        if (link.expiresAt && Date.now() > link.expiresAt) {
          Alert.alert('This bid code has expired', 'Codes are valid for 15 minutes. Scan the TV again to get a fresh one.');
          verified = false;
        } else {
          try {
            const result = await api.verifyHandoff(link.auctionId, link.token);
            verified = Boolean(result?.ok);
          } catch {
            verified = false;
          }
        }
      }

      if (!verified) {
        Alert.alert('That bid code is not valid', 'It may have expired or the TV session has moved on. Scan the code on the TV again.');
      }

      navigationRef.navigate({ name: 'AuctionDetail', params: { id: link.auctionId } });
    })();
  }, [pending, booted, onboarded]);

  if (!fontsLoaded) {
    return <View style={styles.root} />;
  }

  if (!booted) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <SplashScreen onDone={() => setBooted(true)} />
      </SafeAreaProvider>
    );
  }

  if (!onboarded) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <GestureHandlerRootView style={styles.root}>
          <NavigationContainer theme={navTheme}>
            <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }}>
              <Stack.Screen name="Welcome" component={WelcomeCarouselScreen} />
              <Stack.Screen name="Country" component={CountryCurrencyScreen} />
              <Stack.Screen name="Auth" component={AuthScreen} />
              <Stack.Screen
                name="ProfileSetup"
                component={ProfileSetupScreen}
                initialParams={{ onFinish: () => setOnboarded(true) }}
              />
            </Stack.Navigator>
          </NavigationContainer>
        </GestureHandlerRootView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <GestureHandlerRootView style={styles.root}>
        <NavigationContainer ref={navigationRef} theme={navTheme} linking={linking}>
          <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }}>
            <Stack.Screen name="Tabs" component={MainTabs} />
            <Stack.Screen name="Live" component={LiveScreen} />
            <Stack.Screen name="Stream" component={StreamScreen} />
            <Stack.Screen name="AuctionDetail" component={AuctionDetailScreen} />
            <Stack.Screen
              name="AutoBid"
              component={AutoBidScreen}
              options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
});
