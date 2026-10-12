/**
 * MoneyMart web — REST client.
 * Thin, typed wrapper around the API gateway (§9.1). Every screen reads through
 * here so caching, error shapes and base-URL handling stay in one place.
 */
import type {
  AppNotification,
  AuctionWithRelations,
  Bid,
  ChatMessage,
  CostBreakdown,
  Order,
  Paginated,
  Payout,
  PublicProfile,
  StreamWithRelations,
  User,
  PricePoint,
} from '@moneymart/types';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4317';

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
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
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
  market: (categoryId: string) =>
    request<{ categoryId: string; label: string; points: PricePoint[] }>(`/api/market/${categoryId}`),
};

export default api;
