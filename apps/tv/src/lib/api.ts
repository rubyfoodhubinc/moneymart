/**
 * MoneyMart TV — API client.
 * Same gateway contract as web and mobile; the TV is a first-class client, not a
 * reduced one (only full account management is deferred to mobile/web per §7.3).
 */
import type {
  AuctionWithRelations,
  Bid,
  ChatMessage,
  PublicProfile,
  StreamWithRelations,
} from '@moneymart/types';

/**
 * API origin. Empty in production builds, which resolves to the page origin —
 * the TV bundle is served by the same host as the gateway.
 */
export const API_URL: string =
  import.meta.env.VITE_API_URL ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:4317');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error((payload as { message?: string; error?: string } | null)?.message ?? `Request failed (${response.status})`);
  }
  return payload as T;
}

export interface TvSession {
  user: { id: string; displayName: string; handle: string; currencyCode: string; isPro: boolean } | null;
  profile: PublicProfile;
}

export interface TvStreamDetail {
  stream: StreamWithRelations;
  chat: ChatMessage[];
  queue: AuctionWithRelations[];
}

export interface TvAuctionDetail {
  auction: AuctionWithRelations;
  bids: Bid[];
  minimumBid: number;
  breakdown: { total: number; buyersPremiumRate: number; buyersPremium: number; currency: string };
}

export interface TvHandoff {
  token: string;
  expiresInSeconds: number;
  deepLink: string;
  webFallback: string;
  auctionId: string;
  expiresAt: string;
  /** Server-rendered QR matrix as an SVG data URI — no client QR library needed. */
  qr: string;
}

export const api = {
  session: () => request<TvSession>('/api/session'),
  streams: () => request<{ items: StreamWithRelations[]; total: number }>('/api/streams'),
  stream: (id: string) => request<TvStreamDetail>(`/api/streams/${id}`),
  auctions: (params: Record<string, string | number | undefined> = {}) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== '') search.set(key, String(value));
    });
    const query = search.toString();
    return request<{ items: AuctionWithRelations[]; total: number }>(`/api/auctions${query ? `?${query}` : ''}`);
  },
  auction: (id: string) => request<TvAuctionDetail>(`/api/auctions/${id}`),
  placeBid: (id: string, body: { amount: number; bidderId?: string }) =>
    request<{ ok: boolean; auction: AuctionWithRelations }>(`/api/auctions/${id}/bids`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  /** §7.3 QR bridge: a time-limited, single-lot bidding handoff to the phone. */
  handoff: (auctionId: string) =>
    request<TvHandoff>(`/api/tv/handoff/${auctionId}`, { method: 'POST' }),
  /** §7.4 IPTV: XMLTV-format electronic programme guide. */
  epg: () => request<string>('/api/tv/epg.xml'),
  users: () => request<PublicProfile[]>('/api/users'),
  switchUser: (userId: string) =>
    request<TvSession>('/api/session', { method: 'POST', body: JSON.stringify({ userId }) }),
};

export default api;
