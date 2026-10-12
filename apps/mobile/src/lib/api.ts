/**
 * MoneyMart mobile — API client and realtime socket (§9.1, §9.2).
 *
 * Same contract as the web client, so a bid placed on the phone and a bid placed
 * in the browser are indistinguishable to the Auction Engine.
 */
import { io, type Socket } from 'socket.io-client';
import Constants from 'expo-constants';
import type {
  AppNotification,
  AuctionWithRelations,
  Bid,
  ChatMessage,
  ClientToServerEvents,
  CostBreakdown,
  Order,
  Paginated,
  PricePoint,
  PublicProfile,
  ServerToClientEvents,
  Storefront,
  StreamWithRelations,
  Subscription,
  User,
} from '@moneymart/types';

/** The API host is injected by app.json `extra.apiUrl` so a device can point at
 *  a LAN address instead of localhost. */
export const API_URL: string =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? 'http://127.0.0.1:4317';

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * The session token, held in memory for the life of the process.
 *
 * Mobile has no equivalent of an httpOnly cookie, so the token is persisted in
 * AsyncStorage by the session store and handed here. Keeping the module free of a
 * store import avoids a cycle, for the same reason the web client does.
 */
let sessionToken: string | null = null;

export function setSessionToken(token: string | null): void {
  sessionToken = token;
}

export function getSessionToken(): string | null {
  return sessionToken;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const body = payload as { error?: string; reason?: string; message?: string; detail?: string } | null;
    throw new ApiError(
      body?.message ?? body?.detail ?? body?.error ?? body?.reason ?? `Request failed (${response.status})`,
      response.status,
      body?.reason ?? body?.error,
    );
  }
  return payload as T;
}

export interface AuctionDetailResponse {
  auction: AuctionWithRelations;
  bids: Bid[];
  breakdown: CostBreakdown;
  minimumBid: number;
  increments: { minimum: number; mid: number; aggressive: number };
  priceHistory: PricePoint[];
  related: AuctionWithRelations[];
}

export interface StreamDetailResponse {
  stream: StreamWithRelations;
  chat: ChatMessage[];
  queue: AuctionWithRelations[];
}

export interface OrdersResponse {
  buying: (Order & { auction: AuctionWithRelations | null; counterparty: PublicProfile })[];
  selling: (Order & { auction: AuctionWithRelations | null; counterparty: PublicProfile })[];
}

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const api = {
  session: () => request<{ user: User | null; profile: PublicProfile }>('/api/session'),

  /** Passwordless sign-in (§9.1). */
  requestCode: (identifier: string) =>
    request<{
      ok: boolean;
      kind: 'email' | 'phone';
      destination: string;
      expiresInSeconds: number;
      delivery: { delivered: boolean; transport: string; detail?: string };
      devCode?: string;
    }>('/api/auth/request', { method: 'POST', body: JSON.stringify({ identifier }) }),

  verifyCode: (identifier: string, code: string) =>
    request<{ ok: boolean; token: string; expiresAt: string; user: User; profile: PublicProfile }>(
      '/api/auth/verify',
      { method: 'POST', body: JSON.stringify({ identifier, code }) },
    ),

  authSession: () =>
    request<{ ok: boolean; user: User; profile: PublicProfile }>('/api/auth/session'),

  signOut: () => request<{ ok: boolean; revoked: boolean }>('/api/auth/signout', { method: 'POST' }),
  switchUser: (userId: string) =>
    request<{ user: User | null; profile: PublicProfile }>('/api/session', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }),
  users: () => request<PublicProfile[]>('/api/users'),

  auctions: (params: Record<string, string | number | undefined> = {}) =>
    request<Paginated<AuctionWithRelations>>(`/api/auctions${qs(params)}`),
  auction: (id: string) => request<AuctionDetailResponse>(`/api/auctions/${id}`),
  placeBid: (id: string, body: { amount: number; bidderId?: string }) =>
    request<{ ok: boolean; auction: AuctionWithRelations; bids: Bid[] }>(`/api/auctions/${id}/bids`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  setAutoBid: (id: string, body: { maxAmount: number; increment?: number; aggressive?: boolean; bidderId?: string }) =>
    request<{ ok: boolean }>(`/api/auctions/${id}/auto-bid`, { method: 'POST', body: JSON.stringify(body) }),
  createListing: (body: Record<string, unknown>) =>
    request<{ auction: AuctionWithRelations }>('/api/auctions', { method: 'POST', body: JSON.stringify(body) }),

  /** Membership and its pricing effect (RevenueCat entitlement). */
  subscription: () =>
    request<{
      subscription: Subscription;
      isPro: boolean;
      entitlements: Record<string, string>;
      revenueCatConfigured: boolean;
      pricing: {
        standardPremium: number;
        luxuryPremium: number;
        proStandardPremium: number;
        proLuxuryPremium: number;
      };
    }>('/api/subscription'),
  syncSubscription: () =>
    request<{ ok: boolean; subscription: Subscription; isPro: boolean }>('/api/subscription/sync', { method: 'POST' }),

  /**
   * Redeem a TV handoff token (§7.3).
   *
   * The TV renders a QR encoding `moneymart://bid/<auctionId>?token=…&exp=…`.
   * The app verifies the token server-side before treating the link as trusted,
   * so a forged or expired code cannot open someone else's lot.
   */
  verifyHandoff: (auctionId: string, token: string) =>
    request<{ ok: boolean; auction: AuctionWithRelations | null }>('/api/tv/handoff/verify', {
      method: 'POST',
      body: JSON.stringify({ auctionId, token }),
    }),

  streams: (status?: string) => request<{ items: StreamWithRelations[]; total: number }>(`/api/streams${qs({ status })}`),
  stream: (id: string) => request<StreamDetailResponse>(`/api/streams/${id}`),

  notifications: () => request<{ items: AppNotification[]; unread: number; byCategory: Record<string, number> }>(
    '/api/notifications',
  ),
  markRead: (body: { id?: string }) =>
    request<{ ok: boolean }>('/api/notifications/read', { method: 'POST', body: JSON.stringify(body) }),

  orders: (userId?: string) => request<OrdersResponse>(`/api/orders${qs({ userId })}`),
  wallet: (userId?: string) =>
    request<{
      currency: string;
      available: number;
      pending: number;
      lifetimeGross: number;
      transactions: { id: string; type: 'purchase' | 'sale'; label: string; amount: number; currency: string; at: string }[];
    }>(`/api/wallet${qs({ userId })}`),
  earnings: (userId?: string) =>
    request<{
      series: PricePoint[];
      gmv: number;
      creatorShare: number;
      platformFee: number;
      itemsSold: number;
      avgSalePrice: number;
      newFollowers: number;
    }>(`/api/me/earnings${qs({ userId })}`),
  market: (categoryId: string) =>
    request<{ categoryId: string; label: string; points: PricePoint[] }>(`/api/market/${categoryId}`),
  storefront: (handle: string) =>
    request<{ storefront: Storefront; profile: PublicProfile; lots: AuctionWithRelations[] }>(`/api/storefronts/${handle}`),
  saveStorefront: (storefront: Storefront) =>
    request<{ ok: boolean }>('/api/storefronts', { method: 'PUT', body: JSON.stringify({ storefront }) }),
};

/* ── Realtime ──────────────────────────────────────────────────────────── */

export type MoneyMartSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: MoneyMartSocket | null = null;

export function getSocket(): MoneyMartSocket {
  if (!socket) {
    socket = io(API_URL, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000,
      reconnectionAttempts: Infinity,
      timeout: 10_000,
      /**
       * The session token travels in the handshake; a WebSocket upgrade cannot
       * carry an Authorization header. Without it the server treats the socket as
       * anonymous and refuses every write, so bids would silently fail.
       */
      auth: { token: sessionToken ?? undefined },
    });
  }
  return socket;
}

/**
 * Re-handshake after a sign-in or sign-out.
 * An existing socket keeps its original authentication until it reconnects, so a
 * user who signs in mid-session would otherwise be refused every bid.
 */
export function refreshSocketAuth(): void {
  if (!socket) return;
  socket.auth = { token: sessionToken ?? undefined };
  socket.disconnect();
  socket.connect();
}

export default api;
