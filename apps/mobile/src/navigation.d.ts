/**
 * Global navigation types.
 *
 * Registering the param lists here (rather than annotating each navigator) is
 * what lets `navigationRef.navigate(...)` and `useNavigation()` be fully typed
 * anywhere in the app — including from the deep-link handler in App.tsx, which
 * navigates from outside the React tree.
 */
import type { NavigatorScreenParams } from '@react-navigation/native';

export type MainTabParamList = {
  Home: undefined;
  Discovery: undefined;
  Sell: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<MainTabParamList> | undefined;
  Live: undefined;
  Stream: { id: string };
  AuctionDetail: { id: string };
  AutoBid: { id: string };
  Welcome: undefined;
  Country: undefined;
  Auth: undefined;
  ProfileSetup: { onFinish?: () => void } | undefined;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
