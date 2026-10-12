/**
 * MoneyMart mobile — session store.
 *
 * Persists the session TOKEN to AsyncStorage so the app reopens signed in,
 * mirroring the web store. Android and iOS have no httpOnly cookie equivalent,
 * so the token is stored by the app and handed to the API client; the client is
 * the only thing that reads it, which keeps the credential out of UI code.
 *
 * The previous version persisted a user id and replayed it against the dev
 * session endpoint. That was an unauthenticated identity assertion, and the API
 * refuses it in production — so a shipped app would have failed to sign in at
 * all. It is replaced by the real passwordless flow.
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PublicProfile, User } from '@moneymart/types';
import { api, getSocket, setSessionToken } from '@/lib/api';

const TOKEN_KEY = 'mm:token';
const EXPIRY_KEY = 'mm:tokenExpiry';

export interface PendingChallenge {
  identifier: string;
  kind: 'email' | 'phone';
  destination: string;
  expiresInSeconds: number;
  delivery: { delivered: boolean; transport: string; detail?: string };
  devCode?: string;
}

interface SessionState {
  user: User | null;
  profile: PublicProfile | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  users: PublicProfile[];
  pending: PendingChallenge | null;
  busy: boolean;
  error: string | null;
  hydrated: boolean;

  refresh: () => Promise<void>;
  requestCode: (identifier: string) => Promise<boolean>;
  verifyCode: (code: string) => Promise<boolean>;
  cancelChallenge: () => void;
  signOut: () => Promise<void>;
  /** Development-only: switch identity without a code. */
  switchUser: (userId: string) => Promise<void>;
  loadUsers: () => Promise<void>;
  bootstrap: () => Promise<void>;
}

async function persistToken(token: string, expiresAt?: string): Promise<void> {
  setSessionToken(token);
  try {
    await AsyncStorage.setItem(TOKEN_KEY, token);
    if (expiresAt) await AsyncStorage.setItem(EXPIRY_KEY, expiresAt);
  } catch {
    // Storage can fail on a full device; the session still works this launch.
  }
}

async function clearPersistedToken(): Promise<void> {
  setSessionToken(null);
  try {
    await AsyncStorage.removeItem(TOKEN_KEY);
    await AsyncStorage.removeItem(EXPIRY_KEY);
  } catch {
    /* nothing to clear */
  }
}

export const useSession = create<SessionState>((set, get) => ({
  user: null,
  profile: null,
  status: 'loading',
  users: [],
  pending: null,
  busy: false,
  error: null,
  hydrated: false,

  refresh: async () => {
    try {
      const session = await api.authSession();
      set({ user: session.user, profile: session.profile, status: 'authenticated' });
      getSocket().emit('user:join', session.user.id);
    } catch {
      // No token, or the server rejected it: definitively signed out.
      await clearPersistedToken();
      set({ user: null, profile: null, status: 'anonymous' });
    }
  },

  requestCode: async (identifier: string) => {
    set({ busy: true, error: null });
    try {
      const result = await api.requestCode(identifier);
      set({
        busy: false,
        pending: {
          identifier,
          kind: result.kind,
          destination: result.destination,
          expiresInSeconds: result.expiresInSeconds,
          delivery: result.delivery,
          devCode: result.devCode,
        },
      });
      return true;
    } catch (cause) {
      set({
        busy: false,
        error: cause instanceof Error ? cause.message : 'Could not send a code to that address.',
      });
      return false;
    }
  },

  verifyCode: async (code: string) => {
    const pending = get().pending;
    if (!pending) {
      set({ error: 'Request a code first.' });
      return false;
    }
    set({ busy: true, error: null });
    try {
      const result = await api.verifyCode(pending.identifier, code);
      await persistToken(result.token, result.expiresAt);
      set({
        busy: false,
        pending: null,
        user: result.user,
        profile: result.profile,
        status: 'authenticated',
      });
      getSocket().emit('user:join', result.user.id);
      return true;
    } catch (cause) {
      set({
        busy: false,
        error: cause instanceof Error ? cause.message : 'That code was not accepted.',
      });
      return false;
    }
  },

  cancelChallenge: () => set({ pending: null, error: null }),

  signOut: async () => {
    try {
      await api.signOut();
    } catch {
      // Revoking can fail if the token already expired; local state must clear
      // either way or the user stays stuck signed in.
    }
    await clearPersistedToken();
    set({ user: null, profile: null, status: 'anonymous', pending: null, error: null });
  },

  switchUser: async (userId: string) => {
    // Development helper relying on the demo header, which the API refuses in
    // production, so this is expected to fail there.
    const session = await api.switchUser(userId);
    set({ user: session.user, profile: session.profile, status: 'authenticated' });
    if (session.user) getSocket().emit('user:join', session.user.id);
  },

  loadUsers: async () => {
    try {
      set({ users: await api.users() });
    } catch {
      set({ users: [] });
    }
  },

  bootstrap: async () => {
    /**
     * Restore the token FIRST, then resolve it.
     *
     * Order matters: `refresh` asks the server who the token belongs to, so the
     * token must already be in the API client or the request goes out anonymous
     * and the app concludes the user is signed out on every launch.
     */
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const expiry = await AsyncStorage.getItem(EXPIRY_KEY);
      if (token && (!expiry || Date.now() < Date.parse(expiry))) {
        setSessionToken(token);
      } else if (token) {
        await clearPersistedToken();
      }
    } catch {
      /* storage unavailable — start signed out */
    }

    await Promise.all([get().refresh(), get().loadUsers()]);
    set({ hydrated: true });
  },
}));

export default useSession;
