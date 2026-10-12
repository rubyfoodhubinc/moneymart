/**
 * MoneyMart in-memory domain store.
 *
 * Mirrors the blueprint §9.1 service topology (Auction Engine, Stream Service,
 * Payments, Notifications, Search) with a single process so the platform is
 * fully runnable with zero external infrastructure. Every repository method is
 * shaped like the eventual DB call, so swapping in MongoDB/Redis later is a
 * driver change and not a rewrite.
 */
import type {
  AppNotification,
  EscrowRecord,
  Storefront,
  Auction,
  AutoBid,
  Bid,
  ChatMessage,
  Item,
  Order,
  Payout,
  Stream,
  Subscription,
  User,
} from '@moneymart/types';

let seq = 1000;
export function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function iso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

export const db = {
  users: new Map<string, User>(),
  items: new Map<string, Item>(),
  auctions: new Map<string, Auction>(),
  bids: new Map<string, Bid[]>(),
  autoBids: new Map<string, AutoBid>(),
  streams: new Map<string, Stream>(),
  chat: new Map<string, ChatMessage[]>(),
  orders: new Map<string, Order>(),
  payouts: new Map<string, Payout>(),
  notifications: new Map<string, AppNotification[]>(),
  /** §4.3 price history — completed sales per category. */
  priceHistory: new Map<string, { label: string; value: number }[]>(),
  /** Creator storefront documents (Studio / no-code builder). */
  storefronts: new Map<string, Storefront>(),
  /** Escrow ledger, one record per order (§9.1 Payments Service). */
  escrow: new Map<string, EscrowRecord>(),
  /** Membership entitlements, one per user, mirroring RevenueCat. */
  subscriptions: new Map<string, Subscription>(),
  /** Active session identity, dev-only auth stand-in. */
  session: { userId: '' },
};

/* ── Users ─────────────────────────────────────────────── */
export const users = {
  all: () => [...db.users.values()],
  get: (id: string) => db.users.get(id),
  findByHandle: (handle: string) =>
    [...db.users.values()].find((u) => u.handle.toLowerCase() === handle.toLowerCase()),
  upsert: (user: User) => {
    db.users.set(user.id, user);
    return user;
  },
  /**
   * Provision a minimal account.
   *
   * A RevenueCat webhook is often the FIRST contact the platform has with a
   * buyer — the store confirms a purchase before the app has ever called us — so
   * the entitlement cannot be stored against a user that does not exist. Real
   * auth providers provision on first login for the same reason. The account is
   * created unverified with a generated handle and no privileges, and the app
   * completes it on first signed-in launch.
   */
  ensure: (id: string, hint?: { email?: string; countryCode?: string }): User => {
    const existing = db.users.get(id);
    if (existing) return existing;
    const suffix = id.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toLowerCase() || 'member';
    const created: User = {
      id,
      email: hint?.email ?? `${suffix}@moneymart.demo`,
      displayName: suffix.toUpperCase(),
      handle: `mm_${suffix}`,
      countryCode: hint?.countryCode ?? 'US',
      currencyCode: 'USD',
      role: 'buyer',
      verificationStatus: 'unverified',
      kycLevel: 0,
      rating: 0,
      totalSales: 0,
      followersCount: 0,
      followingCount: 0,
      responseTimeMinutes: 0,
      isPro: false,
      createdAt: iso(),
    };
    db.users.set(id, created);
    return created;
  },
  require: (id: string): User => {
    const user = db.users.get(id);
    if (!user) throw new Error(`user_not_found:${id}`);
    return user;
  },
};

/* ── Items ─────────────────────────────────────────────── */
export const items = {
  all: () => [...db.items.values()],
  get: (id: string) => db.items.get(id),
  bySeller: (sellerId: string) => [...db.items.values()].filter((i) => i.sellerId === sellerId),
  create: (item: Item) => {
    db.items.set(item.id, item);
    return item;
  },
};

/* ── Auctions ──────────────────────────────────────────── */
export const auctions = {
  all: () => [...db.auctions.values()],
  get: (id: string) => db.auctions.get(id),
  bySeller: (sellerId: string) => [...db.auctions.values()].filter((a) => a.sellerId === sellerId),
  byStream: (streamId: string) => [...db.auctions.values()].filter((a) => a.streamId === streamId),
  byItem: (itemId: string) => [...db.auctions.values()].find((a) => a.itemId === itemId),
  create: (auction: Auction) => {
    db.auctions.set(auction.id, auction);
    if (!db.bids.has(auction.id)) db.bids.set(auction.id, []);
    return auction;
  },
  save: (auction: Auction) => {
    db.auctions.set(auction.id, auction);
    return auction;
  },
  bids: (auctionId: string) => db.bids.get(auctionId) ?? [],
  addBid: (auctionId: string, bid: Bid) => {
    const list = db.bids.get(auctionId) ?? [];
    // §9.2 Redis LPUSH semantics — newest first, atomic single-writer ordering.
    list.unshift(bid);
    db.bids.set(auctionId, list);
    return bid;
  },
  /** Live = active window. Streams can also force-live before their clock starts. */
  isLive: (auction: Auction) =>
    auction.status === 'live' ||
    (auction.status === 'scheduled' &&
      Date.parse(auction.startTime) <= Date.now() &&
      Date.parse(auction.endTime) > Date.now()),
  active: () => [...db.auctions.values()].filter((a) => auctions.isLive(a)),
  endingSoon: (withinMinutes = 60) =>
    [...db.auctions.values()]
      .filter((a) => {
        const remaining = Date.parse(a.endTime) - Date.now();
        return (a.status === 'live' || a.status === 'scheduled') && remaining > 0 && remaining <= withinMinutes * 60_000;
      })
      .sort((a, b) => Date.parse(a.endTime) - Date.parse(b.endTime)),
  completed: () => [...db.auctions.values()].filter((a) => a.status === 'sold'),
};

/* ── Auto-bids ─────────────────────────────────────────── */
export const autoBids = {
  key: (auctionId: string, bidderId: string) => `${auctionId}::${bidderId}`,
  get: (auctionId: string, bidderId: string) => db.autoBids.get(autoBids.key(auctionId, bidderId)),
  forAuction: (auctionId: string) =>
    [...db.autoBids.values()].filter((a) => a.auctionId === auctionId && a.active),
  set: (auto: AutoBid) => {
    db.autoBids.set(autoBids.key(auto.auctionId, auto.bidderId), auto);
    return auto;
  },
  off: (auctionId: string, bidderId: string) => {
    const existing = db.autoBids.get(autoBids.key(auctionId, bidderId));
    if (existing) {
      existing.active = false;
      db.autoBids.set(autoBids.key(auctionId, bidderId), existing);
    }
    return existing;
  },
};

/* ── Streams ───────────────────────────────────────────── */
export const streams = {
  all: () => [...db.streams.values()],
  get: (id: string) => db.streams.get(id),
  byCreator: (creatorId: string) => [...db.streams.values()].filter((s) => s.creatorId === creatorId),
  live: () => [...db.streams.values()].filter((s) => s.status === 'live'),
  scheduled: () => [...db.streams.values()].filter((s) => s.status === 'scheduled'),
  create: (stream: Stream) => {
    db.streams.set(stream.id, stream);
    return stream;
  },
  save: (stream: Stream) => {
    db.streams.set(stream.id, stream);
    return stream;
  },
};

/* ── Chat ──────────────────────────────────────────────── */
export const chat = {
  get: (streamId: string) => db.chat.get(streamId) ?? [],
  addChat: (message: ChatMessage) => {
    const list = db.chat.get(message.streamId) ?? [];
    list.push(message);
    if (list.length > 220) list.splice(0, list.length - 220);
    db.chat.set(message.streamId, list);
    return message;
  },
  pin: (streamId: string, messageId: string | null) => {
    const list = db.chat.get(streamId) ?? [];
    list.forEach((message) => {
      message.isPinned = message.id === messageId;
    });
    return list;
  },
};

/* ── Orders & payouts ──────────────────────────────────── */
export const orders = {
  all: () => [...db.orders.values()],
  get: (id: string) => db.orders.get(id),
  buying: (userId: string) => [...db.orders.values()].filter((o) => o.buyerId === userId),
  selling: (userId: string) => [...db.orders.values()].filter((o) => o.sellerId === userId),
  create: (order: Order) => {
    db.orders.set(order.id, order);
    return order;
  },
  save: (order: Order) => {
    db.orders.set(order.id, order);
    return order;
  },
};

export const payouts = {
  all: () => [...db.payouts.values()],
  bySeller: (sellerId: string) => [...db.payouts.values()].filter((p) => p.sellerId === sellerId),
  create: (payout: Payout) => {
    db.payouts.set(payout.id, payout);
    return payout;
  },
};

/* ── Notifications ─────────────────────────────────────── */
export const notifications = {
  forUser: (userId: string) => db.notifications.get(userId) ?? [],
  create: (notification: AppNotification) => {
    const list = db.notifications.get(notification.userId) ?? [];
    list.unshift(notification);
    if (list.length > 120) list.splice(120);
    db.notifications.set(notification.userId, list);
    return notification;
  },
  markAllRead: (userId: string) => {
    const list = db.notifications.get(userId) ?? [];
    list.forEach((n) => {
      n.read = true;
    });
    db.notifications.set(userId, list);
    return list;
  },
  markRead: (userId: string, id: string) => {
    const list = db.notifications.get(userId) ?? [];
    const found = list.find((n) => n.id === id);
    if (found) found.read = true;
    db.notifications.set(userId, list);
    return found;
  },
};

/* ── Price history ─────────────────────────────────────── */
export const priceHistory = {
  get: (categoryId: string) => db.priceHistory.get(categoryId) ?? [],
  set: (categoryId: string, points: { label: string; value: number }[]) => {
    db.priceHistory.set(categoryId, points);
    return points;
  },
};

/* ── Escrow ledger (§9.1 Payments Service) ─────────────── */
export const orderEscrow = {
  all: () => [...db.escrow.values()],
  get: (orderId: string) => db.escrow.get(orderId),
  save: (record: EscrowRecord) => {
    db.escrow.set(record.orderId, record);
    return record;
  },
  byState: (state: EscrowRecord['state']) =>
    [...db.escrow.values()].filter((record) => record.state === state),
  /** Total buyer money currently held on behalf of sellers. */
  totalHeld: () =>
    [...db.escrow.values()]
      .filter((record) => record.state === 'in_escrow' || record.state === 'releasing')
      .reduce((sum, record) => sum + (record.heldAmount - record.releasedAmount - record.refundedAmount), 0),
};

/* ── Subscriptions (RevenueCat entitlements) ───────────── */

export const subscriptions = {
  all: () => [...db.subscriptions.values()],
  get: (userId: string) => db.subscriptions.get(userId),
  save: (subscription: Subscription) => {
    db.subscriptions.set(subscription.userId, subscription);
    return subscription;
  },
  remove: (userId: string) => db.subscriptions.delete(userId),
  /** Memberships that are currently usable, grace period included. */
  active: () =>
    [...db.subscriptions.values()].filter(
      (subscription) => subscription.isActive || subscription.status === 'grace_period',
    ),
};

/* ── Storefronts (Studio) ──────────────────────────────── */
export const storefronts = {
  all: () => [...db.storefronts.values()],
  get: (handle: string) => db.storefronts.get(handle),
  save: (storefront: Storefront) => {
    db.storefronts.set(storefront.handle, storefront);
    return storefront;
  },
  remove: (handle: string) => db.storefronts.delete(handle),
};

export const store = {
  db,
  nextId,
  iso,
  users,
  items,
  auctions,
  autoBids,
  streams,
  orders,
  payouts,
  notifications,
  priceHistory,
  storefronts,
  orderEscrow,
  subscriptions,
};

export default store;
