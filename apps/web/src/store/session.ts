/**
 * MoneyMart web — session store.
 *
 * Tracks the acting user so every surface (bid, wallet, orders) reads the same
 * identity. Sign-in is passwordless (§9.1): a one-time code is requested for an
 * email address or phone number, then exchanged for a session token.
 *
 * `status` is explicit rather than derived from `user === null`, because
 * "still finding out" and "definitely signed out" drive different UI: the first
 * must not flash a sign-in prompt at a returning user.
 */
import { create } from 'zustand';
import type { PublicProfile, User } from '@moneymart/types';
import { api } from '@/lib/api';
import { clearToken, getToken, setToken } from '@/lib/token';

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

/** A pending sign-in: a code has been requested and is awaiting entry. */
export interface PendingChallenge {
  identifier: string;
  kind: 'email' | 'phone';
  destination: string;
  expiresInSeconds: number;
  delivery: { delivered: boolean; transport: string; detail?: string };
  devCode?: string;
}

export interface SessionState {
  user: User | null;
  profile: PublicProfile | null;
  status: SessionStatus;
  /** Development-only identity list, for driving multi-user flows. */
  users: PublicProfile[];
  pending: PendingChallenge | null;
  busy: boolean;
  error: string | null;

  refresh: () => Promise<void>;
  requestCode: (identifier: string) => Promise<boolean>;
  verifyCode: (code: string) => Promise<boolean>;
  cancelChallenge: () => void;
  signOut: () => Promise<void>;
  /** Development-only: switch identity without a code. */
  switchUser: (userId: string) => Promise<void>;
  loadUsers: () => Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  user: null,
  profile: null,
  // Start in `loading` so the shell does not render a signed-out header before
  // the stored token has been checked.
  status: 'loading',
  users: [],
  pending: null,
  busy: false,
  error: null,

  refresh: async () => {
    // No token means definitively signed out — skip the request entirely.
    if (!getToken()) {
      set({ user: null, profile: null, status: 'anonymous', error: null });
      return;
    }
    try {
      const session = await api.authSession();
      set({ user: session.user, profile: session.profile, status: 'authenticated', error: null });
    } catch {
      // The request layer clears a token the server rejected, so falling back to
      // anonymous here is accurate rather than pessimistic.
      clearToken();
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
      setToken(result.token, result.expiresAt);
      set({
        busy: false,
        pending: null,
        user: result.user,
        profile: result.profile,
        status: 'authenticated',
      });
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
      // Revoking server-side can fail if the token already expired; local state
      // must be cleared either way or the user stays stuck signed in.
    }
    clearToken();
    set({ user: null, profile: null, status: 'anonymous', pending: null, error: null });
  },

  switchUser: async (userId: string) => {
    // Development helper relying on the demo header, which the API refuses in
    // production — so this is expected to fail there and reports that honestly.
    const session = await api.switchUser(userId);
    set({ user: session.user, profile: session.profile, status: 'authenticated' });
  },

  loadUsers: async () => {
    try {
      set({ users: await api.users() });
    } catch {
      set({ users: [] });
    }
  },
}));

export default useSession;
