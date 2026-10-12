/**
 * MoneyMart web — REST client.
 * Thin, typed wrapper around the API gateway (§9.1). Every screen reads through
 * here so caching, error shapes and base-URL handling stay in one place.
 */
import type {
  AppNotification,
  EscrowRecord,
  EscrowSummary,
  PaymentIntent,
  AuctionWithRelations,
  Bid,
  ChatMessage,
  CostBreakdown,
  Order,
  Paginated,
  Payout,
  PublicProfile,
  StreamWithRelations,
  Subscription,
  User,
  PricePoint,
} from '@moneymart/types';

import { apiOrigin } from '@/lib/config';
import { authHeaders, clearToken } from '@/lib/token';

/**
 * API origin for the current session.
 *
 * Read per request rather than captured at module load, so a runtime override
 * (see lib/config.ts) takes effect without a rebuild. An empty value means the
 * gateway shares the page origin — the unified deployment.
 */
export function apiBase(): string {
  const origin = apiOrigin();
  return origin || (typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:4317');
}

/** @deprecated Prefer `apiBase()`; kept for display and diagnostics. */
export const API_URL: string = apiBase();

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      // Carries the session token when one is held. Spread after the caller's
      // headers would let a caller override auth, so it goes first and the
      // explicit headers win only for non-authorization keys.
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  /**
   * A 401 on a request that carried a token means the session is gone — expired,
   * revoked, or invalidated by a server restart. Clearing it here means the UI
   * falls back to signed-out immediately instead of retrying forever with a dead
   * credential.
   */
  if (response.status === 401 && authHeaders().authorization) {
    clearToken();
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

/* ── Response shapes ───────────────────────────────────────────────────── */

export interface AuctionListResponse extends Paginated<AuctionWithRelations> {}

export interface AuctionDetailResponse {
  auction: AuctionWithRelations;
  bids: Bid[];
  breakdown: CostBreakdown;
  minimumBid: number;
  increments: { minimum: number; mid: number; aggressive: number };
  priceHistory: PricePoint[];
  related: AuctionWithRelations[];
}

export interface StreamListResponse {
  items: StreamWithRelations[];
  total: number;
}

export interface StreamDetailResponse {
  stream: StreamWithRelations;
  chat: ChatMessage[];
  queue: AuctionWithRelations[];
}

export interface NotificationResponse {
  items: AppNotification[];
  unread: number;
  byCategory: Record<string, number>;
}

export interface OrdersResponse {
  buying: (Order & { auction: AuctionWithRelations | null; counterparty: PublicProfile })[];
  selling: (Order & { auction: AuctionWithRelations | null; counterparty: PublicProfile })[];
}

export interface WalletResponse {
  currency: string;
  available: number;
  pending: number;
  lifetimeGross: number;
  payouts: Payout[];
  transactions: {
    id: string;
    type: 'purchase' | 'sale';
    label: string;
    amount: number;
    currency: string;
    at: string;
  }[];
}

export interface EarningsResponse {
  series: PricePoint[];
  gmv: number;
  creatorShare: number;
  platformFee: number;
  itemsSold: number;
  avgSalePrice: number;
  newFollowers: number;
}

export interface SessionResponse {
  user: User | null;
  profile: PublicProfile;
}

export interface StorefrontRenderResponse {
  storefront: import('@moneymart/types').Storefront;
  profile: PublicProfile;
  stream: StreamWithRelations | null;
  lots: AuctionWithRelations[];
  sold: number;
}

export interface SellerProfileResponse {
  profile: PublicProfile;
  listings: AuctionWithRelations[];
  completedSales: number;
}

/* ── Query keys ────────────────────────────────────────────────────────── */

export const queryKeys = {
  session: ['session'] as const,
  auctions: (params?: Record<string, string | undefined>) => ['auctions', params ?? {}] as const,
  auction: (id: string) => ['auction', id] as const,
  streams: (status?: string) => ['streams', status ?? 'all'] as const,
  stream: (id: string) => ['stream', id] as const,
  notifications: (userId?: string) => ['notifications', userId ?? 'me'] as const,
  orders: (userId?: string) => ['orders', userId ?? 'me'] as const,
  wallet: (userId?: string) => ['wallet', userId ?? 'me'] as const,
  earnings: (userId?: string) => ['earnings', userId ?? 'me'] as const,
  market: (categoryId: string) => ['market', categoryId] as const,
  seller: (handle: string) => ['seller', handle] as const,
  users: ['users'] as const,
};

/* ── Endpoints ─────────────────────────────────────────────────────────── */

function qs(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const api = {
  health: () => request<{ ok: boolean; liveStreams: number; liveAuctions: number; uptimeSeconds: number }>('/api/health'),
  config: () =>
    request<{
      antiSnipe: { triggerWindowMs: number; extensionMs: number };
      itemTimer: { min: number; max: number; default: number };
      categories: { id: string; label: string; emoji: string }[];
    }>('/api/config'),

  session: () => request<SessionResponse>('/api/session'),

  /** Passwordless sign-in (§9.1 Auth Service). */
  requestCode: (identifier: string) =>
    request<{
      ok: boolean;
      challengeId: string;
      kind: 'email' | 'phone';
      destination: string;
      expiresInSeconds: number;
      delivery: { delivered: boolean; transport: string; detail?: string };
      /** Present only when development code exposure is enabled. */
      devCode?: string;
    }>('/api/auth/request', { method: 'POST', body: JSON.stringify({ identifier }) }),

  verifyCode: (identifier: string, code: string) =>
    request<{
      ok: boolean;
      token: string;
      expiresAt: string;
      user: User;
      profile: PublicProfile;
      needsProfile: boolean;
    }>('/api/auth/verify', { method: 'POST', body: JSON.stringify({ identifier, code }) }),

  authSession: () =>
    request<{ ok: boolean; user: User; profile: PublicProfile; session: { createdAt: string; expiresAt: string } }>(
      '/api/auth/session',
    ),

  signOut: () => request<{ ok: boolean; revoked: boolean }>('/api/auth/signout', { method: 'POST' }),
  switchUser: (userId: string) =>
    request<SessionResponse>('/api/session', { method: 'POST', body: JSON.stringify({ userId }) }),
  users: () => request<PublicProfile[]>('/api/users'),
  seller: (handle: string) => request<SellerProfileResponse>(`/api/users/${handle}`),

  auctions: (params: Record<string, string | number | undefined> = {}) =>
    request<AuctionListResponse>(`/api/auctions${qs(params)}`),
  auction: (id: string) => request<AuctionDetailResponse>(`/api/auctions/${id}`),
  auctionBids: (id: string) => request<{ bids: Bid[] }>(`/api/auctions/${id}/bids`),
  placeBid: (id: string, body: { amount: number; bidderId?: string }) =>
    request<{ ok: boolean; auction: AuctionWithRelations; bids: Bid[] }>(`/api/auctions/${id}/bids`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  setAutoBid: (id: string, body: { maxAmount: number; increment?: number; aggressive?: boolean; bidderId?: string }) =>
    request<{ ok: boolean; auction: AuctionWithRelations }>(`/api/auctions/${id}/auto-bid`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  cancelAutoBid: (id: string, bidderId?: string) =>
    request<{ ok: boolean }>(`/api/auctions/${id}/auto-bid/off`, { method: 'POST', body: JSON.stringify({ bidderId }) }),
  createListing: (body: Record<string, unknown>) =>
    request<{ auction: AuctionWithRelations }>('/api/auctions', { method: 'POST', body: JSON.stringify(body) }),

  streams: (status?: string) => request<StreamListResponse>(`/api/streams${qs({ status })}`),
  stream: (id: string) => request<StreamDetailResponse>(`/api/streams/${id}`),
  activateItem: (streamId: string, auctionId: string) =>
    request<{ ok: boolean; stream: StreamWithRelations; auction: AuctionWithRelations }>(
      `/api/streams/${streamId}/items/${auctionId}/activate`,
      { method: 'POST' },
    ),
  endStream: (id: string) => request<{ ok: boolean }>(`/api/streams/${id}/end`, { method: 'POST' }),

  notifications: (userId?: string) => request<NotificationResponse>(`/api/notifications${qs({ userId })}`),
  markRead: (body: { id?: string; userId?: string }) =>
    request<{ ok: boolean; items: AppNotification[] }>('/api/notifications/read', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  orders: (userId?: string) => request<OrdersResponse>(`/api/orders${qs({ userId })}`),
  order: (id: string) => request<{ order: Order; auction: AuctionWithRelations | null }>(`/api/orders/${id}`),
  updateOrder: (id: string, body: Record<string, unknown>) =>
    request<{ ok: boolean; order: Order }>(`/api/orders/${id}/status`, { method: 'POST', body: JSON.stringify(body) }),

  wallet: (userId?: string) => request<WalletResponse>(`/api/wallet${qs({ userId })}`),
  earnings: (userId?: string) => request<EarningsResponse>(`/api/me/earnings${qs({ userId })}`),
  /* Payments & escrow (§9.1) */
  escrow: (orderId: string) =>
    request<{
      escrow: EscrowRecord;
      summary: EscrowSummary;
      sellerNet: number;
      amountDue: number;
    }>(`/api/orders/${orderId}/escrow`),
  escrowLedger: () =>
    request<{
      totalHeld: number;
      byState: Record<string, number>;
      records: (EscrowRecord & { summary: EscrowSummary })[];
    }>('/api/escrow'),
  payOrder: (orderId: string, body: { providerId?: string; rail?: string } = {}) =>
    request<{ intent: PaymentIntent; escrow: EscrowRecord; summary: EscrowSummary }>(`/api/orders/${orderId}/pay`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  confirmReceipt: (orderId: string) =>
    request<{
      order: Order;
      escrow: EscrowRecord;
      summary: EscrowSummary;
      payoutAmount: number;
    }>(`/api/orders/${orderId}/confirm`, { method: 'POST', body: JSON.stringify({}) }),
  disputeOrder: (orderId: string, reason?: string) =>
    request<{ escrow: EscrowRecord; summary: EscrowSummary }>(`/api/orders/${orderId}/dispute`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  resolveDispute: (orderId: string, resolution: 'refund' | 'release') =>
    request<{ order: Order; escrow: EscrowRecord; summary: EscrowSummary }>(`/api/orders/${orderId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution }),
    }),
  /** Membership and the pricing effect it has (RevenueCat entitlement). */
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

  paymentProviders: () =>
    request<{
      providers: { id: string; label: string; configured: boolean; supports: { currencies: string[]; countries: string[] } }[];
      selected: Record<string, string>;
    }>('/api/payments/providers'),

  /* Studio — creator storefront documents */
  storefront: (handle: string) => request<StorefrontRenderResponse>(`/api/storefronts/${handle}`),
  storefronts: () => request<{ items: StorefrontRenderResponse[] }>('/api/storefronts'),
  saveStorefront: (storefront: import('@moneymart/types').Storefront) =>
    request<{ ok: boolean } & StorefrontRenderResponse>('/api/storefronts', {
      method: 'PUT',
      body: JSON.stringify({ storefront }),
    }),
  resetStorefront: (handle: string) =>
    request<{ ok: boolean } & StorefrontRenderResponse>(`/api/storefronts/${handle}/reset`, { method: 'POST' }),

  market: (categoryId: string) =>
    request<{ categoryId: string; label: string; points: PricePoint[] }>(`/api/market/${categoryId}`),
};

export default api;
