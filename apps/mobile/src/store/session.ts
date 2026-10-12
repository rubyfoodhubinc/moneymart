/**
 * MoneyMart mobile — session store.
 * Persists the acting user id to AsyncStorage so the app reopens as the same
 * identity, mirroring the web session store.
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PublicProfile, User } from '@moneymart/types';
import { api, getSocket } from '@/lib/api';

const STORAGE_KEY = 'mm:userId';

interface SessionState {
  user: User | null;
  profile: PublicProfile | null;
  users: PublicProfile[];
  loading: boolean;
  hydrated: boolean;
  refresh: () => Promise<void>;
  switchUser: (userId: string) => Promise<void>;
  loadUsers: () => Promise<void>;
  bootstrap: () => Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  user: null,
  profile: null,
  users: [],
  loading: true,
  hydrated: false,

  refresh: async () => {
    try {
      const session = await api.session();
      set({ user: session.user, profile: session.profile, loading: false });
      if (session.user) getSocket().emit('user:join', session.user.id);
    } catch {
      set({ loading: false });
    }
  },

  switchUser: async (userId: string) => {
    const session = await api.switchUser(userId);
    set({ user: session.user, profile: session.profile });
    try {
      await AsyncStorage.setItem(STORAGE_KEY, userId);
    } catch {
      /* storage unavailable — the switch still applies for this session */
    }
    getSocket().emit('user:join', userId);
  },

  loadUsers: async () => {
    try {
      set({ users: await api.users() });
    } catch {
      set({ users: [] });
    }
  },

  bootstrap: async () => {
    await Promise.all([get().refresh(), get().loadUsers()]);
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) await get().switchUser(stored);
    } catch {
      /* first launch — keep the server's default identity */
    }
    set({ hydrated: true });
  },
}));

export default useSession;
