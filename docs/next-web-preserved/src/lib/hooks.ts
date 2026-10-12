'use client';

/**
 * MoneyMart web — realtime hooks (§9.2).
 * Bridges Socket.IO events into React state: live bid updates, outbid alerts,
 * anti-snipe extensions, viewer counts and chat.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuctionWithRelations, Bid, ChatMessage, ServerToClientEvents } from '@moneymart/types';
import { api, queryKeys } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { useSession } from '@/store/session';

/* ── Countdown ─────────────────────────────────────────────────────────── */

/** Live countdown driven by the server's authoritative end time. */
export function useCountdown(endTime: string | undefined, serverTime?: string) {
  const [now, setNow] = useState(() => Date.now());
  const offsetRef = useRef(0);

  // Trust the server clock to avoid client drift on a closing lot.
  useEffect(() => {
    if (!serverTime) return;
    offsetRef.current = Date.parse(serverTime) - Date.now();
  }, [serverTime]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() + offsetRef.current), 250);
    return () => window.clearInterval(timer);
  }, []);

  const remainingMs = endTime ? Math.max(0, Date.parse(endTime) - now) : 0;
  return {
    remainingMs,
    expired: remainingMs <= 0,
    /** §5.2: red when under one hour remains. */
    urgent: remainingMs > 0 && remainingMs < 3_600_000,
    critical: remainingMs > 0 && remainingMs < 10_000,
  };
}

/* ── Auctions ──────────────────────────────────────────────────────────── */

export function useAuctions(params: Record<string, string | number | undefined> = {}) {
  return useQuery({
    queryKey: queryKeys.auctions(params as Record<string, string | undefined>),
    queryFn: () => api.auctions(params),
  });
}

export function useAuctionDetail(id: string) {
  return useQuery({
    queryKey: queryKeys.auction(id),
    queryFn: () => api.auction(id),
    enabled: Boolean(id),
  });
}

export function useStreams(status?: string) {
  return useQuery({
    queryKey: queryKeys.streams(status),
    queryFn: () => api.streams(status),
    refetchInterval: 15_000,
  });
}

export function useStreamDetail(id: string) {
  return useQuery({
    queryKey: queryKeys.stream(id),
    queryFn: () => api.stream(id),
    enabled: Boolean(id),
  });
}

export function useNotifications() {
  const userId = useSession((state) => state.user?.id);
  return useQuery({
    queryKey: queryKeys.notifications(userId),
    queryFn: () => api.notifications(userId),
  });
}

export function useOrders() {
  const userId = useSession((state) => state.user?.id);
  return useQuery({ queryKey: queryKeys.orders(userId), queryFn: () => api.orders(userId) });
}

export function useWallet() {
  const userId = useSession((state) => state.user?.id);
  return useQuery({ queryKey: queryKeys.wallet(userId), queryFn: () => api.wallet(userId) });
}

export function useEarnings() {
  const userId = useSession((state) => state.user?.id);
  return useQuery({ queryKey: queryKeys.earnings(userId), queryFn: () => api.earnings(userId) });
}

/* ── Live auction room ─────────────────────────────────────────────────── */

export interface AuctionRoomState {
  auction: AuctionWithRelations | null;
  bids: Bid[];
  /** Set when the viewer's own position is beaten — drives the outbid toast. */
  outbidNotice: string | null;
  rejectNotice: string | null;
  lastBidAt: number;
  won: boolean;
  connected: boolean;
  clearNotices: () => void;
}

interface AuctionRoomOptions {
  seedAuction?: AuctionWithRelations | null;
  seedBids?: Bid[];
}

/** Join an auction room and mirror every server event into state. */
export function useAuctionRoom(auctionId: string | undefined, options: AuctionRoomOptions = {}): AuctionRoomState {
  const { seedAuction = null, seedBids = [] } = options;
  const queryClient = useQueryClient();
  const userId = useSession((state) => state.user?.id);

  const [auction, setAuction] = useState<AuctionWithRelations | null>(seedAuction);
  const [bids, setBids] = useState<Bid[]>(seedBids);
  const [outbidNotice, setOutbidNotice] = useState<string | null>(null);
  const [rejectNotice, setRejectNotice] = useState<string | null>(null);
  const [lastBidAt, setLastBidAt] = useState(0);
  const [won, setWon] = useState(false);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setAuction((current) => (seedAuction && !current ? seedAuction : current));
    if (seedBids.length) setBids((current) => (current.length ? current : seedBids));
  }, [seedAuction, seedBids]);

  useEffect(() => {
    if (!auctionId) return;
    const socket = getSocket();
    setConnected(socket.connected);

    const onConnect = () => {
      setConnected(true);
      socket.emit('auction:join', auctionId);
    };
    const onDisconnect = () => setConnected(false);

    const onSnapshot: ServerToClientEvents['auction:snapshot'] = (payload) => {
      setAuction(payload.auction);
      setBids(payload.bids);
    };

    const onBid: ServerToClientEvents['auction:bid'] = (payload) => {
      setAuction(payload.auction);
      setBids((current) => {
        if (current.some((bid) => bid.id === payload.bid.id)) return current;
        return [payload.bid, ...current].slice(0, 60);
      });
      setLastBidAt(Date.now());
      // Refresh aggregate lists that depend on live prices.
      queryClient.invalidateQueries({ queryKey: ['auctions'] });
    };

    const onExtended: ServerToClientEvents['auction:extended'] = (payload) => {
      setAuction((current) =>
        current && current.id === payload.auctionId ? { ...current, endTime: payload.endTime } : current,
      );
    };

    const onTick: ServerToClientEvents['auction:tick'] = (payload) => {
      if (payload.auctionId !== auctionId) return;
      setAuction((current) => (current ? { ...current, endTime: payload.endTime } : current));
    };

    const onRejected: ServerToClientEvents['auction:rejected'] = (payload) => {
      if (payload.auctionId !== auctionId) return;
      setRejectNotice(payload.message);
    };

    const onWon: ServerToClientEvents['auction:won'] = (payload) => {
      if (payload.auction.id !== auctionId) return;
      // The win payload carries the settled auction; re-read the detail endpoint
      // so the client also holds the full item, seller and breakdown projection.
      queryClient.invalidateQueries({ queryKey: queryKeys.auction(auctionId) });
      setBids((current) =>
        current.map((bid, index) =>
          index === 0 ? { ...bid, status: payload.winnerId === bid.bidderId ? 'winning' : 'outbid' } : bid,
        ),
      );
      if (userId && payload.winnerId === userId) setWon(true);
    };

    const onNotification: ServerToClientEvents['notification'] = (payload) => {
      if (payload.category === 'bids') setOutbidNotice(payload.title);
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('auction:snapshot', onSnapshot);
    socket.on('auction:bid', onBid);
    socket.on('auction:extended', onExtended);
    socket.on('auction:tick', onTick);
    socket.on('auction:rejected', onRejected);
    socket.on('auction:won', onWon);
    socket.on('notification', onNotification);

    if (socket.connected) {
      setConnected(true);
      socket.emit('auction:join', auctionId);
    }

    return () => {
      socket.emit('auction:leave', auctionId);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('auction:snapshot', onSnapshot);
      socket.off('auction:bid', onBid);
      socket.off('auction:extended', onExtended);
      socket.off('auction:tick', onTick);
      socket.off('auction:rejected', onRejected);
      socket.off('auction:won', onWon);
      socket.off('notification', onNotification);
    };
  }, [auctionId, queryClient, userId]);

  const clearNotices = useCallback(() => {
    setOutbidNotice(null);
    setRejectNotice(null);
  }, []);

  return { auction, bids, outbidNotice, rejectNotice, lastBidAt, won, connected, clearNotices };
}

/* ── Place bid mutation ────────────────────────────────────────────────── */

export function usePlaceBid(auctionId: string) {
  const userId = useSession((state) => state.user?.id);
  return useMutation({
    mutationFn: (amount: number) => api.placeBid(auctionId, { amount, bidderId: userId }),
  });
}

export function useAutoBid(auctionId: string) {
  const userId = useSession((state) => state.user?.id);
  return useMutation({
    mutationFn: (body: { maxAmount: number; increment?: number; aggressive?: boolean }) =>
      api.setAutoBid(auctionId, { ...body, bidderId: userId }),
  });
}

/* ── Stream room ───────────────────────────────────────────────────────── */

export interface StreamRoomState {
  viewerCount: number;
  messages: ChatMessage[];
  pinned: ChatMessage | null;
  activeAuctionId: string | undefined;
  ended: boolean;
  connected: boolean;
}

export function useStreamRoom(
  streamId: string | undefined,
  seed: { viewerCount?: number; messages?: ChatMessage[] } = {},
): StreamRoomState {
  const [viewerCount, setViewerCount] = useState(seed.viewerCount ?? 0);
  const [messages, setMessages] = useState<ChatMessage[]>(seed.messages ?? []);
  const [pinned, setPinned] = useState<ChatMessage | null>(
    () => (seed.messages ?? []).find((message) => message.isPinned) ?? null,
  );
  const [activeAuctionId, setActiveAuctionId] = useState<string | undefined>(undefined);
  const [ended, setEnded] = useState(false);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (seed.viewerCount !== undefined) setViewerCount(seed.viewerCount);
  }, [seed.viewerCount]);

  useEffect(() => {
    if (seed.messages?.length) setMessages(seed.messages);
  }, [seed.messages]);

  useEffect(() => {
    if (!streamId) return;
    const socket = getSocket();

    const onConnect = () => {
      setConnected(true);
      socket.emit('stream:join', streamId);
    };
    const onDisconnect = () => setConnected(false);
    const onViewers: ServerToClientEvents['stream:viewers'] = (payload) => {
      if (payload.streamId !== streamId) return;
      setViewerCount(payload.viewerCount);
    };
    const onMessage: ServerToClientEvents['chat:message'] = (payload) => {
      if (payload.streamId !== streamId) return;
      setMessages((current) => [...current, payload].slice(-200));
      if (payload.isPinned) setPinned(payload);
    };
    const onPin: ServerToClientEvents['chat:pin'] = (payload) => {
      if (payload.streamId !== streamId) return;
      setPinned(payload.message);
      setMessages((current) =>
        current.map((message) => ({ ...message, isPinned: message.id === payload.message?.id })),
      );
    };
    const onItem: ServerToClientEvents['stream:item'] = (payload) => {
      if (payload.streamId !== streamId) return;
      setActiveAuctionId(payload.auctionId);
    };
    const onEnded: ServerToClientEvents['stream:ended'] = (payload) => {
      if (payload.streamId === streamId) setEnded(true);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('stream:viewers', onViewers);
    socket.on('chat:message', onMessage);
    socket.on('chat:pin', onPin);
    socket.on('stream:item', onItem);
    socket.on('stream:ended', onEnded);

    if (socket.connected) {
      setConnected(true);
      socket.emit('stream:join', streamId);
    }

    return () => {
      socket.emit('stream:leave', streamId);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('stream:viewers', onViewers);
      socket.off('chat:message', onMessage);
      socket.off('chat:pin', onPin);
      socket.off('stream:item', onItem);
      socket.off('stream:ended', onEnded);
    };
  }, [streamId]);

  return { viewerCount, messages, pinned, activeAuctionId, ended, connected };
}

export function useSendChat(streamId: string) {
  const user = useSession((state) => state.user);
  return useCallback(
    (body: string) => {
      if (!user || !body.trim()) return;
      getSocket().emit('chat:send', {
        streamId,
        userId: user.id,
        displayName: user.displayName,
        body: body.trim(),
      });
    },
    [streamId, user],
  );
}

/** §9.2 keyboard shortcuts for power bidders on web. */
export function useBidShortcuts(handlers: { onBid?: () => void; onWatch?: () => void; onEscape?: () => void }) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      switch (event.key.toLowerCase()) {
        case 'b':
          handlers.onBid?.();
          break;
        case 'w':
          handlers.onWatch?.();
          break;
        case 'escape':
          handlers.onEscape?.();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [handlers]);
}

/** Watched lots, persisted locally (server-side watchlists land in Phase 2). */
export function useWatchlist() {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('mm:watchlist');
      if (raw) setIds(JSON.parse(raw) as string[]);
    } catch {
      setIds([]);
    }
  }, []);

  const toggle = useCallback((id: string) => {
    setIds((current) => {
      const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
      try {
        window.localStorage.setItem('mm:watchlist', JSON.stringify(next));
      } catch {
        /* storage unavailable — watchlist stays in memory */
      }
      return next;
    });
  }, []);

  const has = useCallback((id: string) => ids.includes(id), [ids]);

  return useMemo(() => ({ ids, toggle, has, count: ids.length }), [ids, toggle, has]);
}

/** Price placement on a 0–100 sparkline scale. */
export function useSparkPath(values: number[], width = 240, height = 56): string {
  return useMemo(() => {
    if (values.length < 2) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    return values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * width;
        const y = height - ((value - min) / span) * height;
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [values, width, height]);
}
