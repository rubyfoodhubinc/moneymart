/**
 * MoneyMart mobile — data and realtime hooks.
 * Mirrors the web hook surface so both clients behave identically.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AuctionWithRelations, Bid, ChatMessage, ServerToClientEvents } from '@moneymart/types';
import { api, getSocket } from '@/lib/api';
import { useSession } from '@/store/session';

/* ── Generic async resource ────────────────────────────────────────────── */

export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = [], options: { pollMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setError(null);
      const result = await loader();
      setData(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!options.pollMs) return;
    const timer = setInterval(() => void reload(), options.pollMs);
    return () => clearInterval(timer);
  }, [options.pollMs, reload]);

  return { data, loading, error, reload };
}

/* ── Feeds ─────────────────────────────────────────────────────────────── */

export function useStreams(status?: string) {
  return useAsync(() => api.streams(status), [status], { pollMs: 15_000 });
}

export function useAuctions(params: Record<string, string | number | undefined> = {}) {
  const key = JSON.stringify(params);
  return useAsync(() => api.auctions(params), [key]);
}

export function useAuction(id?: string) {
  return useAsync(() => api.auction(id!), [id], { pollMs: id ? 10_000 : undefined });
}

export function useStream(id?: string) {
  return useAsync(() => api.stream(id!), [id]);
}

export function useNotifications() {
  return useAsync(() => api.notifications(), [], { pollMs: 20_000 });
}

export function useOrders() {
  const userId = useSession((state) => state.user?.id);
  return useAsync(() => api.orders(userId), [userId]);
}

export function useWallet() {
  const userId = useSession((state) => state.user?.id);
  return useAsync(() => api.wallet(userId), [userId]);
}

export function useEarnings() {
  const userId = useSession((state) => state.user?.id);
  return useAsync(() => api.earnings(userId), [userId]);
}

/* ── Live auction room ─────────────────────────────────────────────────── */

export function useAuctionRoom(
  auctionId?: string,
  seed?: { auction?: AuctionWithRelations | null; bids?: Bid[] },
) {
  const userId = useSession((state) => state.user?.id);
  const [auction, setAuction] = useState<AuctionWithRelations | null>(seed?.auction ?? null);
  const [bids, setBids] = useState<Bid[]>(seed?.bids ?? []);
  const [outbidNotice, setOutbidNotice] = useState<string | null>(null);
  const [rejectNotice, setRejectNotice] = useState<string | null>(null);
  const [won, setWon] = useState(false);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (seed?.auction) setAuction((current) => current ?? seed.auction!);
    if (seed?.bids?.length) setBids((current) => (current.length ? current : seed.bids!));
  }, [seed?.auction, seed?.bids]);

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
      setBids((current) => (current.some((b) => b.id === payload.bid.id) ? current : [payload.bid, ...current].slice(0, 60)));
    };
    const onExtended: ServerToClientEvents['auction:extended'] = (payload) => {
      setAuction((current) => (current && current.id === payload.auctionId ? { ...current, endTime: payload.endTime } : current));
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
      if (userId && payload.winnerId === userId) setWon(true);
    };
    const onNotification: ServerToClientEvents['notification'] = (payload) => {
      if (payload.category === 'bids') setOutbidNotice(payload.title);
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

    if (socket.connected) onConnect();

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
  }, [auctionId, userId]);

  const clearNotices = useCallback(() => {
    setOutbidNotice(null);
    setRejectNotice(null);
  }, []);

  return { auction, bids, outbidNotice, rejectNotice, won, connected, clearNotices };
}

/* ── Mutations ─────────────────────────────────────────────────────────── */

export function usePlaceBid(auctionId: string) {
  const userId = useSession((state) => state.user?.id);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const place = useCallback(
    async (amount: number) => {
      setPending(true);
      setError(null);
      try {
        return await api.placeBid(auctionId, { amount, bidderId: userId });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Bid rejected';
        setError(message);
        throw cause;
      } finally {
        setPending(false);
      }
    },
    [auctionId, userId],
  );

  return { place, pending, error, clearError: () => setError(null) };
}

export function useAutoBid(auctionId: string) {
  const userId = useSession((state) => state.user?.id);
  const [pending, setPending] = useState(false);

  const configure = useCallback(
    async (body: { maxAmount: number; increment?: number; aggressive?: boolean }) => {
      setPending(true);
      try {
        return await api.setAutoBid(auctionId, { ...body, bidderId: userId });
      } finally {
        setPending(false);
      }
    },
    [auctionId, userId],
  );

  return { configure, pending };
}

/* ── Stream room (viewers + chat) ──────────────────────────────────────── */

export function useStreamRoom(streamId?: string, seed?: { viewerCount?: number; messages?: ChatMessage[] }) {
  const [viewerCount, setViewerCount] = useState(seed?.viewerCount ?? 0);
  const [messages, setMessages] = useState<ChatMessage[]>(seed?.messages ?? []);
  const [pinned, setPinned] = useState<ChatMessage | null>(null);
  const [activeAuctionId, setActiveAuctionId] = useState<string | undefined>(undefined);
  /**
   * The ROOM's own connection, as distinct from the auction room's.
   *
   * The stream screen displayed `auctionRoom.connected` for its "Realtime /
   * Reconnecting" badge. A room between lots has no active auction, so that hook is
   * handed no id and never connects — leaving the badge permanently reading
   * "Reconnecting" on a room whose realtime connection was perfectly healthy. This
   * tracks the socket the room actually uses.
   */
  const [connected, setConnected] = useState(getSocket().connected);

  useEffect(() => {
    if (seed?.viewerCount !== undefined) setViewerCount(seed.viewerCount);
    if (seed?.messages?.length) {
      setMessages(seed.messages);
      setPinned(seed.messages.find((message) => message.isPinned) ?? null);
    }
  }, [seed?.viewerCount, seed?.messages]);

  useEffect(() => {
    if (!streamId) return;
    const socket = getSocket();

    const onConnect = () => socket.emit('stream:join', streamId);
    const onViewers: ServerToClientEvents['stream:viewers'] = (payload) => {
      if (payload.streamId === streamId) setViewerCount(payload.viewerCount);
    };
    const onMessage: ServerToClientEvents['chat:message'] = (payload) => {
      if (payload.streamId !== streamId) return;
      setMessages((current) => [...current, payload].slice(-200));
      if (payload.isPinned) setPinned(payload);
    };
    const onPin: ServerToClientEvents['chat:pin'] = (payload) => {
      if (payload.streamId === streamId) setPinned(payload.message);
    };
    const onItem: ServerToClientEvents['stream:item'] = (payload) => {
      if (payload.streamId === streamId) setActiveAuctionId(payload.auctionId);
    };

    const onConnected = () => {
      setConnected(true);
      onConnect();
    };
    const onDisconnected = () => setConnected(false);

    socket.on('connect', onConnected);
    socket.on('disconnect', onDisconnected);
    socket.on('stream:viewers', onViewers);
    socket.on('chat:message', onMessage);
    socket.on('chat:pin', onPin);
    socket.on('stream:item', onItem);

    if (socket.connected) onConnected();
    else setConnected(false);

    return () => {
      socket.emit('stream:leave', streamId);
      socket.off('connect', onConnected);
      socket.off('disconnect', onDisconnected);
      socket.off('stream:viewers', onViewers);
      socket.off('chat:message', onMessage);
      socket.off('chat:pin', onPin);
      socket.off('stream:item', onItem);
    };
  }, [streamId]);

  const send = useCallback(
    (user: { id: string; displayName: string } | null, body: string) => {
      if (!streamId || !user || !body.trim()) return;
      getSocket().emit('chat:send', {
        streamId,
        userId: user.id,
        displayName: user.displayName,
        body: body.trim(),
      });
    },
    [streamId],
  );

  return { viewerCount, messages, pinned, activeAuctionId, connected, send };
}

/** Watchlist held in memory for the session (server-side lists land in Phase 2). */
export function useWatchlist() {
  const [ids, setIds] = useState<string[]>([]);
  const toggle = useCallback((id: string) => {
    setIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  }, []);
  const has = useCallback((id: string) => ids.includes(id), [ids]);
  return useMemo(() => ({ ids, toggle, has, count: ids.length }), [ids, toggle, has]);
}
