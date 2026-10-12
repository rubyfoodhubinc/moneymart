/**
 * MoneyMart web — session store.
 * Tracks the acting user so every surface (bid, wallet, orders) reads the same
 * identity. Production swaps the dev user switch for real JWT auth (§9.1).
 */
import { create } from 'zustand';
import type { PublicProfile, User } from '@moneymart/types';
import { api } from '@/lib/api';

export interface SessionState {
  user: User | null;
  profile: PublicProfile | null;
  users: PublicProfile[];
  loading: boolean;
  refresh: () => Promise<void>;
  switchUser: (userId: string) => Promise<void>;
  loadUsers: () => Promise<void>;
}

export const useSession = create<SessionState>((set) => ({
  user: null,
  profile: null,
  users: [],
  loading: true,

  refresh: async () => {
    set({ loading: true });
    try {
      const session = await api.session();
      set({ user: session.user, profile: session.profile, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  switchUser: async (userId: string) => {
    const session = await api.switchUser(userId);
    set({ user: session.user, profile: session.profile });
  },

  loadUsers: async () => {
    try {
      const users = await api.users();
      set({ users });
    } catch {
      set({ users: [] });
    }
  },
}));

export default useSession;
