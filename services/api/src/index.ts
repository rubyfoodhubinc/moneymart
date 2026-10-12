/**
 * MoneyMart API gateway — blueprint §9.1 Services Overview.
 *
 * Exposes the REST surface every client consumes and wires the Auction Engine
 * to Socket.IO (the "Auction Engine broadcast" role). All services run in-process
 * for local operation; each router maps 1:1 to a production microservice.
 */
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { Server as SocketServer } from 'socket.io';
import type {
  AuctionWithRelations,
  ClientToServerEvents,
  Item,
  PublicProfile,
  ServerToClientEvents,
  Storefront,
  User,
} from '@moneymart/types';
import { categories } from '@moneymart/tokens';
import { ANTI_SNIPE, ITEM_TIMER, categoryLabel } from './lib/labels.js';
import { engine, type EngineEvent } from './engine/auctionEngine.js';
import { money } from './engine/money.js';
import { escrow, EscrowError } from './engine/escrow.js';
import { providerRegistry } from './engine/payments.js';
import { qrToSvgDataUri } from './lib/qr.js';
import { mountStaticHost } from './lib/staticHost.js';
import { subscriptionsService, ENTITLEMENTS } from './engine/subscriptions.js';
import { resolveStreamPlayback } from './engine/playback.js';
import {
  auctions,
  chat,
  items,
  notifications,
  orders,
  payouts,
  priceHistory,
  streams,
  users,
  store,
  storefronts,
} from './store.js';
import { seed, reseed } from './seed.js';

const PORT = Number(process.env.PORT ?? 4317);
const app = express();

/**
 * Behind a managed platform the TLS connection ends at the edge and requests
 * arrive over plain HTTP carrying X-Forwarded-Proto. Trusting the first proxy
 * hop makes req.protocol and req.ip reflect the real client, which the HSTS
 * decision and rate limiting depend on.
 */
app.set('trust proxy', 1);

/**
 * Transport. When certificate paths are supplied the gateway serves HTTPS, so a
 * single origin covers the SPA, the REST API and the WebSocket upgrade — which
 * is also what browsers require before they will grant camera access or honour
 * secure deep links.
 */
const tlsCertPath = process.env.MM_TLS_CERT;
const tlsKeyPath = process.env.MM_TLS_KEY;
const tlsEnabled = Boolean(tlsCertPath && tlsKeyPath);

const http = tlsEnabled
  ? createSecureServer(
      { cert: readFileSync(tlsCertPath!), key: readFileSync(tlsKeyPath!) },
      app,
    )
  : createServer(app);

/**
 * Cross-origin policy.
 *
 * The unified deployment is same-origin and never exercises this. It exists for
 * the split deployment — the web app on Vercel calling the gateway on Railway —
 * where the browser sends an Origin the gateway must actively allow.
 *
 * `origin: true` reflects whatever Origin arrives, and combined with credentials
 * that lets any site issue authenticated requests. So the allowlist is explicit:
 * MM_ALLOWED_ORIGINS (comma-separated), plus the platform's own domain, plus
 * localhost in development. Same-origin and origin-less requests (native apps,
 * server-to-server, health probes) are always permitted.
 */
const allowedOrigins = new Set(
  [
    ...(process.env.MM_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    'https://www.moneymart.app',
    'https://moneymart.app',
    'https://moneymart.vercel.app',
    ...(process.env.RAILWAY_PUBLIC_DOMAIN ? [`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`] : []),
    ...(process.env.NODE_ENV === 'production'
      ? []
      : ['http://127.0.0.1:3000', 'http://localhost:3000', 'http://127.0.0.1:3100', 'http://127.0.0.1:3200']),
  ].map((value) => value.replace(/\/$/, '')),
);

function corsOrigin(
  origin: string | undefined,
  callback: (error: Error | null, allow?: boolean | string) => void,
): void {
  // Native clients, curl and the health probe send no Origin.
  if (!origin) {
    callback(null, true);
    return;
  }
  const normalised = origin.replace(/\/$/, '');
  if (allowedOrigins.has(normalised)) {
    callback(null, normalised);
    return;
  }
  // Vercel preview deployments use per-build hostnames.
  if (/\.vercel\.app$/.test(normalised) && process.env.MM_ALLOW_VERCEL_PREVIEWS !== 'false') {
    callback(null, normalised);
    return;
  }
  callback(new Error(`origin_not_allowed:${normalised}`), false);
}

app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '2mb' }));

const io = new SocketServer<ClientToServerEvents, ServerToClientEvents>(http, {
  cors: { origin: corsOrigin, credentials: true },
  path: '/socket.io',
});

/* ── View helpers ──────────────────────────────────────────────────────── */

function publicProfile(userId: string): PublicProfile {
  const user = users.get(userId);
  const live = streams.live().some((s) => s.creatorId === userId);
  if (!user) {
    return {
      id: userId,
      displayName: 'Unknown seller',
      handle: 'unknown',
      countryCode: 'US',
      rating: 0,
      totalSales: 0,
      followersCount: 0,
      isVerified: false,
      isLive: live,
      responseTimeMinutes: 0,
    };
  }
  return {
    id: user.id,
    displayName: user.displayName,
    handle: user.handle,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    countryCode: user.countryCode,
    rating: user.rating,
    totalSales: user.totalSales,
    followersCount: user.followersCount,
    isVerified: user.verificationStatus === 'verified',
    isLive: live,
    responseTimeMinutes: user.responseTimeMinutes,
  };
}

function expandAuction(auctionId: string): AuctionWithRelations | null {
  const auction = auctions.get(auctionId);
  if (!auction) return null;
  const item = items.get(auction.itemId);
  if (!item) return null;
  return {
    ...auction,
    item,
    seller: publicProfile(auction.sellerId),
    isLive: auctions.isLive(auction),
    reserveMet: !auction.reservePrice || auction.currentBid >= auction.reservePrice,
  };
}

function expandStream(streamId: string) {
  const stream = streams.get(streamId);
  if (!stream) return null;
  return {
    ...stream,
    creator: publicProfile(stream.creatorId),
    activeAuction: stream.activeAuctionId ? (expandAuction(stream.activeAuctionId) ?? undefined) : undefined,
    queuedCount: stream.itemQueue.length,
    /**
     * Resolved here so every client (web, TV, mobile) agrees on what is playing
     * and whether it is a real broadcast. An unresolvable stored URL becomes a
     * labelled demo rather than a dead player.
     */
    playback: resolveStreamPlayback({
      streamId: stream.id,
      status: stream.status,
      storedUrl: stream.hlsUrl,
      fallbackUrl: process.env.MM_DEMO_HLS_URL,
    }),
  };
}

/** §9.2 optimistic UI: clients show the user's bid immediately, confirmed by socket. */
function broadcast(events: EngineEvent[]): void {
  events.forEach((event) => {
    switch (event.type) {
      case 'bid': {
        const payload = { auction: expandAuction(event.auction.id)!, bid: event.bid, extended: event.extended, extensionMs: event.extensionMs };
        io.to(`auction:${event.auction.id}`).emit('auction:bid', payload);
        io.emit('auction:tick', { auctionId: event.auction.id, endTime: event.auction.endTime, serverTime: store.iso() });
        break;
      }
      case 'extended': {
        io.to(`auction:${event.auctionId}`).emit('auction:extended', {
          auctionId: event.auctionId,
          endTime: event.endTime,
          extensionMs: event.extensionMs,
        });
        break;
      }
      case 'rejected': {
        io.emit('auction:rejected', event.payload);
        break;
      }
      case 'outbid': {
        const notification = notifications.create({
          id: store.nextId('ntf'),
          userId: event.userId,
          category: 'bids',
          title: 'You were outbid',
          body: `${event.auction.title} is now ${money.formatMoney(event.amount, event.auction.currency)}.`,
          href: `/auctions/${event.auction.id}`,
          read: false,
          createdAt: store.iso(),
        });
        io.to(`user:${event.userId}`).emit('notification', notification);
        break;
      }
      case 'won': {
        io.to(`auction:${event.payload.auction.id}`).emit('auction:won', event.payload);
        event.viewerIds.forEach((userId) => {
          const notification = notifications.forUser(userId)[0];
          if (notification) io.to(`user:${userId}`).emit('notification', notification);
        });
        const streamId = event.payload.auction.streamId;
        if (streamId) {
          const stream = streams.get(streamId);
          if (stream) io.to(`stream:${streamId}`).emit('stream:item', { streamId, auctionId: stream.activeAuctionId, nextInQueue: stream.itemQueue.length });
        }
        break;
      }
      default:
        break;
    }
  });
}

/**
 * Resolve the acting user. Production replaces this with verified JWT claims
 * (§9.1 Auth Service); in dev the `x-mm-user` header or an explicit body field
 * selects the actor, which makes multi-user realtime flows testable.
 */
/**
 * Resolve the acting identity.
 *
 * `x-mm-user` stands in for a real session token until auth lands. A header is
 * only honoured when it names a real user — an unknown identity must never be
 * quietly downgraded to the session default, because that would serve one
 * user's wallet, orders and pricing to a caller who merely claimed a different
 * id. `identityGuard` rejects such requests before they reach a handler; this
 * fallback exists only for requests that carry no header at all.
 */
function actorId(req: Request, explicit?: string): string {
  if (explicit && users.get(explicit)) return explicit;
  const header = req.header('x-mm-user');
  if (header && users.get(header)) return header;
  return store.db.session.userId;
}

/**
 * Reject requests that assert an identity which does not exist.
 *
 * Applied globally rather than per route: authorisation must fail closed, and a
 * per-route check is a standing invitation to forget one.
 */
app.use((req: Request, res: Response, next: NextFunction) => {
  const header = req.header('x-mm-user');
  if (header && !users.get(header)) {
    res.status(401).json({ error: 'unknown_identity', detail: `No user matches x-mm-user: ${header}` });
    return;
  }
  next();
});

/* ── REST: health ──────────────────────────────────────────────────────── */

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'moneymart-api',
    version: '2.0.0',
    uptimeSeconds: Math.round(process.uptime()),
    liveStreams: streams.live().length,
    liveAuctions: auctions.active().length,
    time: store.iso(),
  });
});

app.get('/api/config', (_req, res) => {
  res.json({
    antiSnipe: ANTI_SNIPE,
    itemTimer: ITEM_TIMER,
    categories: categories.map((category) => ({
      id: category.id,
      label: category.label,
      emoji: category.emoji,
    })),
  });
});

/* ── REST: session / users ─────────────────────────────────────────────── */

app.get('/api/session', (_req, res) => {
  const user = users.get(store.db.session.userId);
  res.json({ user, profile: publicProfile(store.db.session.userId) });
});

app.post('/api/session', (req, res) => {
  const { userId } = req.body as { userId?: string };
  if (userId && users.get(userId)) {
    store.db.session.userId = userId;
  }
  res.json({ user: users.get(store.db.session.userId), profile: publicProfile(store.db.session.userId) });
});

app.get('/api/users', (_req, res) => {
  res.json(users.all().map((u: User) => publicProfile(u.id)));
});

app.get('/api/users/:handle', (req, res) => {
  const user = users.findByHandle(req.params.handle);
  if (!user) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({
    profile: publicProfile(user.id),
    listings: auctions
      .bySeller(user.id)
      .map((a) => expandAuction(a.id))
      .filter(Boolean),
    completedSales: auctions.completed().filter((a) => a.sellerId === user.id).length,
  });
});

/* ── REST: auctions & search ───────────────────────────────────────────── */

app.get('/api/auctions', (req, res) => {
  const { type, category, status, q, sort, limit } = req.query as Record<string, string | undefined>;
  let list = auctions.all().map((a) => expandAuction(a.id)).filter((a): a is AuctionWithRelations => Boolean(a));

  if (type) list = list.filter((a) => a.auctionType === type);
  if (category) list = list.filter((a) => a.item.categoryId === category);
  if (status === 'live') list = list.filter((a) => a.isLive);
  if (status === 'scheduled') list = list.filter((a) => a.status === 'scheduled');
  if (status === 'sold') list = list.filter((a) => a.status === 'sold');
  if (status === 'ending') {
    list = list.filter((a) => {
      const remaining = Date.parse(a.endTime) - Date.now();
      return remaining > 0 && remaining <= 60 * 60_000;
    });
  }
  if (q) {
    const needle = q.toLowerCase();
    list = list.filter(
      (a) =>
        a.title.toLowerCase().includes(needle) ||
        a.item.description.toLowerCase().includes(needle) ||
        a.seller.displayName.toLowerCase().includes(needle) ||
        a.item.categoryId.includes(needle),
    );
  }

  switch (sort) {
    case 'ending':
      list.sort((a, b) => Date.parse(a.endTime) - Date.parse(b.endTime));
      break;
    case 'price':
      list.sort((a, b) => b.currentBid - a.currentBid);
      break;
    case 'bids':
      list.sort((a, b) => b.bidCount - a.bidCount);
      break;
    case 'watchers':
      list.sort((a, b) => b.watchers - a.watchers);
      break;
    default:
      list.sort((a, b) => {
        if (a.featured !== b.featured) return a.featured ? -1 : 1;
        return Date.parse(a.endTime) - Date.parse(b.endTime);
      });
  }

  const take = limit ? Number(limit) : list.length;
  res.json({
    items: list.slice(0, take),
    total: list.length,
    page: 1,
    pageSize: take,
    hasMore: list.length > take,
  });
});

app.get('/api/auctions/:id', (req, res) => {
  const auction = expandAuction(req.params.id);
  if (!auction) {
    res.status(404).json({ error: 'auction_not_found' });
    return;
  }
  const history = auctions.bids(req.params.id);
  const related = auctions
    .all()
    .filter((a) => a.id !== auction.id && items.get(a.itemId)?.categoryId === auction.item.categoryId)
    .slice(0, 6)
    .map((a) => expandAuction(a.id))
    .filter(Boolean);

  res.json({
    auction,
    bids: history.slice(0, 40),
    breakdown: money.costBreakdown({
      hammerPrice: auction.currentBid || auction.startingPrice,
      currency: auction.currency,
      categoryId: auction.item.categoryId,
      // The listing's disclosed standard rate; costBreakdown applies the
      // viewer's membership discount through the same resolver settlement uses,
      // so the quote cannot differ from the charge.
      buyersPremiumRate: auction.buyersPremiumRate,
      isPro: subscriptionsService.isProUser(actorId(req)),
      buyerCountry: users.get(actorId(req))?.countryCode ?? 'US',
      sellerCountry: users.get(auction.sellerId)?.countryCode ?? 'US',
    }),
    minimumBid: money.minimumNextBid(auction.startingPrice, auction.currentBid, auction.bidCount),
    increments: money.autoBidIncrements(auction.currentBid || auction.startingPrice),
    priceHistory: priceHistory.get(auction.item.categoryId),
    related,
  });
});

app.get('/api/auctions/:id/bids', (req, res) => {
  res.json({ bids: auctions.bids(req.params.id).slice(0, 60) });
});

app.post('/api/auctions/:id/bids', (req, res) => {
  const { amount, bidderId, bidderHandle } = req.body as { amount: number; bidderId?: string; bidderHandle?: string };
  const actor = actorId(req, bidderId);
  const events = engine.placeBid({
    auctionId: req.params.id,
    bidderId: actor,
    bidderHandle: bidderHandle ?? users.get(actor)?.handle ?? 'bidder',
    amount,
  });
  broadcast(events);
  const rejection = events.find((e) => e.type === 'rejected');
  if (rejection && rejection.type === 'rejected') {
    res.status(409).json(rejection.payload);
    return;
  }
  res.json({ ok: true, auction: expandAuction(req.params.id), bids: auctions.bids(req.params.id).slice(0, 40) });
});

app.post('/api/auctions/:id/auto-bid', (req, res) => {
  const { maxAmount, increment, aggressive, bidderId } = req.body as {
    maxAmount: number;
    increment?: number;
    aggressive?: boolean;
    bidderId?: string;
  };
  const actor = actorId(req, bidderId);
  const auction = auctions.get(req.params.id);
  if (!auction) {
    res.status(404).json({ error: 'auction_not_found' });
    return;
  }
  const events = engine.setAutoBid({
    auctionId: req.params.id,
    bidderId: actor,
    bidderHandle: users.get(actor)?.handle ?? 'auto',
    maxAmount,
    increment: increment ?? money.minimumIncrement(auction.currentBid || auction.startingPrice),
    aggressive: Boolean(aggressive),
  });
  broadcast(events);
  res.json({ ok: true, auction: expandAuction(req.params.id) });
});

app.post('/api/auctions/:id/auto-bid/off', (req, res) => {
  const actor = actorId(req, (req.body as { bidderId?: string }).bidderId);
  engine.cancelAutoBid(req.params.id, actor);
  res.json({ ok: true });
});

/** §5.2 Selling Flow — create a listing. */
app.post('/api/auctions', (req, res) => {
  const body = req.body as {
    title: string;
    description: string;
    categoryId: string;
    condition: Item['condition'];
    auctionType: AuctionWithRelations['auctionType'];
    startingPrice: number;
    reservePrice?: number;
    buyItNowPrice?: number;
    durationDays: number;
    sellerId?: string;
    images?: string[];
  };

  if (!body.title || !body.startingPrice) {
    res.status(400).json({ error: 'title_and_starting_price_required' });
    return;
  }

  const sellerId = actorId(req, body.sellerId);
  const seller = users.require(sellerId);
  const now = Date.now();
  const itemId = store.nextId('itm');
  const auctionId = store.nextId('auc');
  const endMs = now + Math.max(1, body.durationDays || 7) * 86_400_000;

  const item: Item = {
    id: itemId,
    sellerId,
    title: body.title,
    description: body.description ?? '',
    categoryId: body.categoryId ?? 'collectibles',
    condition: body.condition ?? 'good',
    images: body.images?.length ? body.images : [],
    authenticityStatus: 'pending',
    isVerified: false,
    createdAt: store.iso(),
    updatedAt: store.iso(),
  };
  items.create(item);

  const auction = auctions.create({
    id: auctionId,
    itemId,
    sellerId,
    auctionType: body.auctionType ?? 'buy_now',
    title: body.title,
    startingPrice: body.startingPrice,
    reservePrice: body.reservePrice,
    currentBid: 0,
    bidCount: 0,
    buyItNowPrice: body.buyItNowPrice,
    startTime: store.iso(),
    endTime: new Date(endMs).toISOString(),
    status: body.auctionType === 'traditional' ? 'scheduled' : 'live',
    buyersPremiumRate: money.buyersPremiumRate(body.categoryId, false),
    currency: seller.currencyCode,
    watchers: 0,
  });

  const expanded = expandAuction(auction.id)!;
  io.emit('auction:created', { auction: expanded });
  res.status(201).json({ auction: expanded, item });
});

/* ── REST: streams ─────────────────────────────────────────────────────── */

app.get('/api/streams', (req, res) => {
  const { status } = req.query as { status?: string };
  let list = streams.all().map((s) => expandStream(s.id)).filter(Boolean);
  if (status) list = list.filter((s) => s!.status === status);
  list.sort((a, b) => b!.viewerCount - a!.viewerCount);
  res.json({ items: list, total: list.length });
});

app.get('/api/streams/:id', (req, res) => {
  const stream = expandStream(req.params.id);
  if (!stream) {
    res.status(404).json({ error: 'stream_not_found' });
    return;
  }
  res.json({
    stream,
    chat: chat.get(req.params.id),
    queue: stream.itemQueue
      .map((id) => expandAuction(id))
      .filter((a): a is AuctionWithRelations => Boolean(a)),
  });
});

app.post('/api/streams/:id/items/:auctionId/activate', (req, res) => {
  const stream = streams.get(req.params.id);
  const auction = auctions.get(req.params.auctionId);
  if (!stream || !auction) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  stream.activeAuctionId = auction.id;
  stream.status = 'live';
  stream.actualStartTime = stream.actualStartTime ?? store.iso();
  streams.save(stream);
  auction.status = 'live';
  auction.startTime = store.iso();
  auction.endTime = new Date(Date.now() + ITEM_TIMER.default * 1000).toISOString();
  auctions.save(auction);
  io.to(`stream:${stream.id}`).emit('stream:item', {
    streamId: stream.id,
    auctionId: auction.id,
    nextInQueue: stream.itemQueue.length,
  });
  res.json({ ok: true, stream: expandStream(stream.id), auction: expandAuction(auction.id) });
});

app.post('/api/streams/:id/end', (req, res) => {
  const stream = streams.get(req.params.id);
  if (!stream) {
    res.status(404).json({ error: 'stream_not_found' });
    return;
  }
  stream.status = 'ended';
  stream.endTime = store.iso();
  stream.activeAuctionId = undefined;
  streams.save(stream);
  io.to(`stream:${stream.id}`).emit('stream:ended', { streamId: stream.id, totalGMV: stream.totalGMV });
  res.json({ ok: true, stream: expandStream(stream.id) });
});

/* ── REST: notifications / orders / wallet ─────────────────────────────── */

app.get('/api/notifications', (req, res) => {
  const userId = actorId(req, req.query.userId as string | undefined);
  const list = notifications.forUser(userId);
  res.json({
    items: list,
    unread: list.filter((n) => !n.read).length,
    byCategory: {
      bids: list.filter((n) => n.category === 'bids').length,
      streams: list.filter((n) => n.category === 'streams').length,
      orders: list.filter((n) => n.category === 'orders').length,
      system: list.filter((n) => n.category === 'system').length,
    },
  });
});

app.post('/api/notifications/read', (req, res) => {
  const { id, userId } = req.body as { id?: string; userId?: string };
  const actor = actorId(req, userId);
  if (id) notifications.markRead(actor, id);
  else notifications.markAllRead(actor);
  res.json({ ok: true, items: notifications.forUser(actor) });
});

app.get('/api/orders', (req, res) => {
  const userId = actorId(req, req.query.userId as string | undefined);
  const withAuctions = (list: ReturnType<typeof orders.buying>) =>
    list.map((order) => ({
      ...order,
      auction: expandAuction(order.auctionId),
      counterparty: publicProfile(order.buyerId === userId ? order.sellerId : order.buyerId),
    }));
  res.json({
    buying: withAuctions(orders.buying(userId)),
    selling: withAuctions(orders.selling(userId)),
  });
});

app.get('/api/orders/:id', (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) {
    res.status(404).json({ error: 'order_not_found' });
    return;
  }
  res.json({
    order,
    auction: expandAuction(order.auctionId),
    buyer: publicProfile(order.buyerId),
    seller: publicProfile(order.sellerId),
  });
});

app.post('/api/orders/:id/status', (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) {
    res.status(404).json({ error: 'order_not_found' });
    return;
  }
  const { orderStatus, trackingNumber, courierName } = req.body as {
    orderStatus?: typeof order.orderStatus;
    trackingNumber?: string;
    courierName?: string;
  };
  if (orderStatus) order.orderStatus = orderStatus;
  if (trackingNumber) order.trackingNumber = trackingNumber;
  if (courierName) order.courierName = courierName;
  orders.save(order);
  res.json({ ok: true, order });
});

/* ── REST: subscriptions & entitlements (RevenueCat) ─────────────────────
   Membership is a recurring entitlement on the user, distinct from an order
   payment: it changes what the buyer PAYS (Pro premium 10%/15% vs 15%/20%)
   rather than settling a single purchase.
   ────────────────────────────────────────────────────────────────────────*/

/** The signed-in user's membership, plus the pricing effect it has. */
app.get('/api/subscription', async (req, res) => {
  const userId = actorId(req);
  const user = users.get(userId);
  if (!user) {
    res.status(404).json({ error: 'user_not_found' });
    return;
  }
  const subscription = subscriptionsService.get(userId);
  res.json({
    subscription,
    isPro: subscriptionsService.isProUser(userId),
    entitlements: ENTITLEMENTS,
    revenueCatConfigured: Boolean(process.env.REVENUECAT_SECRET_KEY),
    /** What the membership is worth, so the client can show the saving. */
    pricing: {
      standardPremium: 15,
      luxuryPremium: 20,
      proStandardPremium: 10,
      proLuxuryPremium: 15,
    },
  });
});

/** Ask RevenueCat to reconcile, for when a webhook was missed. */
app.post('/api/subscription/sync', async (req, res) => {
  const userId = actorId(req);
  try {
    const subscription = await subscriptionsService.syncFromRevenueCat(userId);
    res.json({ ok: true, subscription, isPro: subscriptionsService.isProUser(userId) });
  } catch (error) {
    res.status(502).json({
      error: 'revenuecat_unreachable',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * RevenueCat webhook.
 *
 * RevenueCat supports a shared-secret authorization header; when
 * REVENUECAT_WEBHOOK_SECRET is set it is required, so an unauthenticated caller
 * cannot mint themselves a membership.
 */
app.post('/api/webhooks/revenuecat', (req, res) => {
  const expected = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (expected) {
    const provided = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (provided !== expected) {
      res.status(401).json({ error: 'invalid_webhook_signature' });
      return;
    }
  }

  const event = (req.body?.event ?? req.body) as Record<string, unknown>;
  if (!event || typeof event !== 'object') {
    res.status(400).json({ error: 'malformed_event' });
    return;
  }

  // Sandbox events must not grant real entitlements in production.
  if (!subscriptionsService.shouldApplyEvent(event)) {
    res.json({ ok: true, applied: false, reason: 'sandbox_event_ignored' });
    return;
  }

  const subscription = subscriptionsService.applyWebhookEvent(event);
  if (!subscription) {
    res.json({ ok: true, applied: false, reason: 'no_app_user_id' });
    return;
  }

  notifications.create({
    id: store.nextId('ntf'),
    userId: subscription.userId,
    category: 'system',
    title: subscription.isActive ? 'Membership active' : 'Membership ended',
    body: subscription.isActive
      ? `Your ${subscription.tier} membership is active — Pro pricing applies to your bids.`
      : 'Your membership is no longer active, so standard buyer\u2019s premium applies.',
    href: '/account',
    read: false,
    createdAt: store.iso(),
  });

  res.json({ ok: true, applied: true, subscription });
});

/**
 * Dev-only entitlement grant.
 *
 * Present so the Pro pricing path is exercisable without store credentials.
 * Refused outright in production, because it would otherwise be a free
 * membership endpoint.
 */
app.post('/api/dev/subscription', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(403).json({ error: 'dev_controls_disabled' });
    return;
  }
  const { userId, tier = 'pro', days = 30 } = req.body as {
    userId?: string;
    tier?: 'free' | 'pro' | 'elite';
    days?: number;
  };
  const target = userId ?? actorId(req);
  if (!users.get(target)) {
    res.status(404).json({ error: 'user_not_found' });
    return;
  }
  const subscription = subscriptionsService.grant(target, tier, Number(days) || 30);
  res.json({ ok: true, subscription, isPro: subscriptionsService.isProUser(target) });
});

/* ── REST: TV / IPTV (§7.3 QR bridge, §7.4 EPG + HbbTV) ──────────────────
   The TV is a first-class client. Bidding from a remote is deliberately routed
   to the phone via a signed deep link, because entering an amount with a D-pad
   is hostile — the QR bridge is the product decision, not a workaround.
   ────────────────────────────────────────────────────────────────────────*/

/** Time-limited handoff tokens: auctionId → { token, expiresAt }. */
const tvHandoffs = new Map<string, { token: string; expiresAt: number }>();
const HANDOFF_TTL_MS = 15 * 60 * 1000; // §7.4: stream URLs are signed for 15 minutes

/** Validate a handoff token — used by the mobile app when it opens the deep link. */
app.post('/api/tv/handoff/verify', (req, res) => {
  const { auctionId, token } = req.body as { auctionId?: string; token?: string };
  const record = auctionId ? tvHandoffs.get(auctionId) : undefined;
  if (!record || !token || record.token !== token) {
    res.status(401).json({ error: 'invalid_handoff_token' });
    return;
  }
  if (Date.now() > record.expiresAt) {
    tvHandoffs.delete(auctionId!);
    res.status(410).json({ error: 'handoff_token_expired' });
    return;
  }
  const auction = auctions.get(auctionId!);
  res.json({ ok: true, auction: auction ? expandAuction(auction.id) : null });
});

app.post('/api/tv/handoff/:auctionId', (req, res) => {
  const auction = auctions.get(req.params.auctionId);
  if (!auction) {
    res.status(404).json({ error: 'auction_not_found' });
    return;
  }

  const token = store.nextId('tv').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const expiresAt = Date.now() + HANDOFF_TTL_MS;
  tvHandoffs.set(auction.id, { token, expiresAt });

  // The deep link opens the lot pre-authenticated inside the mobile app; the
  // same URL doubles as a web fallback when the app is not installed.
  const deepLink = `moneymart://bid/${auction.id}?token=${token}&exp=${expiresAt}`;
  const webFallback = `/auctions/${auction.id}?tv=${token}`;

  res.json({
    token,
    auctionId: auction.id,
    expiresInSeconds: Math.floor(HANDOFF_TTL_MS / 1000),
    expiresAt: new Date(expiresAt).toISOString(),
    deepLink,
    webFallback,
    /** Scannable matrix rendered server-side — the TV needs no QR library. */
    qr: qrToSvgDataUri(deepLink, { scale: 6, margin: 3 }),
    auction: expandAuction(auction.id),
    minimumBid: money.minimumNextBid(auction.startingPrice, auction.currentBid, auction.bidCount),
  });
});

/**
 * XMLTV electronic programme guide (§7.4).
 * Scheduled and live auction events are published as channels + programmes so
 * MAG, Formuler and IPTV Smarters middleware can render them in their own grid.
 */
app.get('/api/tv/epg.xml', (_req, res) => {
  const escape = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const stamp = (date: Date) =>
    `${date.toISOString().replace(/[-:]/g, '').split('.')[0]} +0000`;

  const events = [...streams.all()].sort(
    (a, b) => Date.parse(a.scheduledStartTime) - Date.parse(b.scheduledStartTime),
  );

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE tv SYSTEM "xmltv.dtd">',
    '<tv generator-info-name="MoneyMart" source-info-name="MoneyMart Auction Platform">',
  ];

  // One channel per creator/stream.
  for (const stream of events) {
    const creator = users.get(stream.creatorId);
    lines.push(`  <channel id="${escape(stream.id)}">`);
    lines.push(`    <display-name>${escape(creator?.displayName ?? 'MoneyMart')} — ${escape(stream.title)}</display-name>`);
    lines.push(`    <icon src="${escape(stream.posterUrl)}"/>`);
    lines.push('  </channel>');
  }

  // One programme per event, 2 hours by default, using the stream's own window.
  for (const stream of events) {
    const start = new Date(stream.scheduledStartTime);
    const end = stream.endTime
      ? new Date(stream.endTime)
      : new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const active = auctions.get(stream.activeAuctionId ?? '');
    const category = stream.category;

    lines.push(`  <programme start="${stamp(start)}" stop="${stamp(end)}" channel="${escape(stream.id)}">`);
    lines.push(`    <title lang="en">${escape(stream.title)}</title>`);
    lines.push(
      `    <desc lang="en">${escape(
        active
          ? `Live now: ${active.title}. ${active.bidCount} bids at ${money.formatMoney(active.currentBid, active.currency)}.`
          : `${stream.itemQueue.length} lots from ${escape(stream.category)}. Scan to bid from your phone.`,
      )}</desc>`,
    );
    lines.push(`    <category lang="en">${escape(category)}</category>`);
    lines.push(`    <icon src="${escape(stream.posterUrl)}"/>`);
    lines.push(`    <live/>`);
    lines.push('  </programme>');
  }

  lines.push('</tv>');

  res.type('application/xml').send(lines.join('\n'));
});

/* ── REST: payments & escrow (§9.1 Payments Service) ─────────────────────
   The buyer pays into escrow; funds reach the seller only when the buyer
   confirms receipt. Every transition is validated by the escrow state machine.
   ────────────────────────────────────────────────────────────────────────*/

/** Which rails are usable here, and which one a currency would select. */
app.get('/api/payments/providers', (_req, res) => {
  res.json({
    providers: providerRegistry.all().map((provider) => ({
      id: provider.id,
      label: provider.label,
      configured: provider.isConfigured(),
      supports: provider.supports,
    })),
    selected: {
      USD: providerRegistry.selectFor('USD', 'US').id,
      NGN: providerRegistry.selectFor('NGN', 'NG').id,
      GBP: providerRegistry.selectFor('GBP', 'GB').id,
      CAD: providerRegistry.selectFor('CAD', 'CA').id,
    },
  });
});

/** Escrow ledger overview — used by the wallet and admin surfaces. */
app.get('/api/escrow', (_req, res) => {
  const records = store.orderEscrow.all();
  res.json({
    totalHeld: money.round2(store.orderEscrow.totalHeld()),
    byState: records.reduce<Record<string, number>>((accumulator, record) => {
      accumulator[record.state] = (accumulator[record.state] ?? 0) + 1;
      return accumulator;
    }, {}),
    records: records
      .map((record) => ({ ...record, summary: escrow.summarise(record) }))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
  });
});

app.get('/api/orders/:id/escrow', (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) {
    res.status(404).json({ error: 'order_not_found' });
    return;
  }
  const record = escrow.get(order.id);
  if (!record) {
    res.status(404).json({ error: 'escrow_not_found' });
    return;
  }
  const categoryId = auctions.get(order.auctionId)
    ? items.get(auctions.get(order.auctionId)!.itemId)?.categoryId
    : undefined;
  res.json({
    escrow: record,
    summary: escrow.summarise(record),
    sellerNet: escrow.sellerNetFor(order, categoryId),
    amountDue: order.totalAmount,
  });
});

/** Buyer pays the invoice; funds move into escrow on provider confirmation. */
app.post('/api/orders/:id/pay', async (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) {
    res.status(404).json({ error: 'order_not_found' });
    return;
  }
  const actor = actorId(req);
  const categoryId = auctions.get(order.auctionId)
    ? items.get(auctions.get(order.auctionId)!.itemId)?.categoryId
    : undefined;

  try {
    const result = await escrow.pay({
      order,
      actorId: actor,
      categoryId,
      providerId: (req.body as { providerId?: string })?.providerId as never,
      rail: (req.body as { rail?: string })?.rail,
      // Test hook for the decline path: only honoured outside production.
      chargeAmountOverride:
        process.env.NODE_ENV === 'production'
          ? undefined
          : (req.body as { chargeAmountOverride?: number })?.chargeAmountOverride,
    });
    if (result.escrow.state === 'in_escrow') {
      orders.save({ ...order, paymentStatus: 'paid', orderStatus: 'processing' });
    } else if (result.escrow.state === 'failed') {
      orders.save({ ...order, paymentStatus: 'failed' });
    }
    broadcast([]);
    io.to(`user:${order.buyerId}`).emit('notification', notifications.create({
      id: store.nextId('ntf'),
      userId: order.buyerId,
      category: 'orders',
      title: result.escrow.state === 'in_escrow' ? 'Payment held in escrow' : 'Payment failed',
      body: result.escrow.state === 'in_escrow'
        ? `${money.formatMoney(result.escrow.heldAmount, order.currency)} is held until you confirm delivery.`
        : `Your payment was declined (${result.intent.failureReason ?? 'unknown'}). The order is still reserved for you.`,
      href: `/orders/${order.id}`,
      read: false,
      createdAt: store.iso(),
    }));
    res.json({
      intent: result.intent,
      escrow: result.escrow,
      summary: escrow.summarise(result.escrow),
    });
  } catch (error) {
    if (error instanceof EscrowError) {
      res.status(error.status).json({ error: error.code, message: error.message });
      return;
    }
    throw error;
  }
});

/** Buyer confirms receipt — the only path that releases funds to the seller. */
app.post('/api/orders/:id/confirm', (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) {
    res.status(404).json({ error: 'order_not_found' });
    return;
  }
  const categoryId = auctions.get(order.auctionId)
    ? items.get(auctions.get(order.auctionId)!.itemId)?.categoryId
    : undefined;
  try {
    const result = escrow.confirmReceipt({ order, actorId: actorId(req), categoryId });
    escrow.assertLedgerBalanced(result.escrow);
    orders.save(result.order);
    notifications.create({
      id: store.nextId('ntf'),
      userId: order.sellerId,
      category: 'orders',
      title: 'Funds released',
      body: `${money.formatMoney(result.payoutAmount, order.currency)} is on its way for ${auctionTitleFor(order.auctionId)}.`,
      href: '/account/wallet',
      read: false,
      createdAt: store.iso(),
    });
    res.json({
      order: result.order,
      escrow: result.escrow,
      summary: escrow.summarise(result.escrow),
      payoutAmount: result.payoutAmount,
    });
  } catch (error) {
    if (error instanceof EscrowError) {
      res.status(error.status).json({ error: error.code, message: error.message });
      return;
    }
    throw error;
  }
});

/** Buyer raises a dispute — funds stay held and release is blocked. */
app.post('/api/orders/:id/dispute', (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) {
    res.status(404).json({ error: 'order_not_found' });
    return;
  }
  try {
    const record = escrow.openDispute({
      order,
      actorId: actorId(req),
      reason: (req.body as { reason?: string })?.reason,
    });
    orders.save({ ...order, orderStatus: 'disputed' });
    res.json({ escrow: record, summary: escrow.summarise(record) });
  } catch (error) {
    if (error instanceof EscrowError) {
      res.status(error.status).json({ error: error.code, message: error.message });
      return;
    }
    throw error;
  }
});

/** Admin resolution of a disputed escrow. */
app.post('/api/orders/:id/resolve', (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) {
    res.status(404).json({ error: 'order_not_found' });
    return;
  }
  const resolution = (req.body as { resolution?: 'refund' | 'release' })?.resolution;
  if (resolution !== 'refund' && resolution !== 'release') {
    res.status(400).json({ error: 'resolution_required', message: "resolution must be 'refund' or 'release'" });
    return;
  }
  const actor = actorId(req);
  if (users.get(actor)?.role !== 'admin') {
    res.status(403).json({ error: 'admin_required' });
    return;
  }
  const categoryId = auctions.get(order.auctionId)
    ? items.get(auctions.get(order.auctionId)!.itemId)?.categoryId
    : undefined;
  try {
    const result = escrow.resolveDispute({ order, actorId: actor, resolution, categoryId });
    escrow.assertLedgerBalanced(result.escrow);
    orders.save(result.order);
    res.json({
      order: result.order,
      escrow: result.escrow,
      summary: escrow.summarise(result.escrow),
    });
  } catch (error) {
    if (error instanceof EscrowError) {
      res.status(error.status).json({ error: error.code, message: error.message });
      return;
    }
    throw error;
  }
});

app.get('/api/wallet', (req, res) => {
  const userId = actorId(req, req.query.userId as string | undefined);
  const selling = orders.selling(userId);
  const buying = orders.buying(userId);
  const spent = buying.reduce((sum, o) => sum + o.totalAmount, 0);
  const soldGross = selling.reduce((sum, o) => sum + o.hammerPrice, 0);
  const fees = selling.reduce((sum, o) => sum + o.hammerPrice * 0.1, 0);
  res.json({
    currency: users.get(userId)?.currencyCode ?? 'USD',
    available: money.round2(soldGross - fees - spent * 0.15),
    pending: money.round2(selling.filter((o) => o.orderStatus !== 'complete').reduce((s, o) => s + o.hammerPrice * 0.9, 0)),
    lifetimeGross: money.round2(soldGross + buying.length * 120),
    payouts: payouts.bySeller(userId),
    transactions: [
      ...buying.map((o) => ({
        id: o.id,
        type: 'purchase' as const,
        label: `Purchase ${o.id}`,
        amount: -o.totalAmount,
        currency: o.currency,
        at: o.createdAt,
      })),
      ...selling.map((o) => ({
        id: `${o.id}-sale`,
        type: 'sale' as const,
        label: `Sale ${o.id}`,
        amount: money.round2(o.hammerPrice * 0.9),
        currency: o.currency,
        at: o.createdAt,
      })),
    ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
  });
});

app.get('/api/me/earnings', (req, res) => {
  const userId = actorId(req, req.query.userId as string | undefined);
  const selling = orders.selling(userId);
  const days = 30;
  const series = Array.from({ length: days }, (_, index) => {
    const date = new Date(Date.now() - (days - 1 - index) * 86_400_000);
    const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const base = 120 + Math.round(Math.sin(index / 2.4) * 90 + (index % 7) * 24);
    const spike = index % 9 === 0 ? 480 : 0;
    return { label, value: base + spike };
  });
  const gmv = selling.reduce((sum, o) => sum + o.hammerPrice, 0) || 18420;
  const split = money.creatorSplit(gmv);
  res.json({
    series,
    gmv,
    creatorShare: split.creator,
    platformFee: split.platform,
    itemsSold: selling.length || 14,
    avgSalePrice: money.round2(gmv / (selling.length || 14)),
    newFollowers: 214,
  });
});

/* ── REST: price history & market data ─────────────────────────────────── */

app.get('/api/market/:categoryId', (req, res) => {
  res.json({
    categoryId: req.params.categoryId,
    label: categoryLabel(req.params.categoryId),
    points: priceHistory.get(req.params.categoryId),
  });
});

/* ── REST: Studio storefronts (no-code creator shop builder) ─────────────
   A storefront is a document: theme + ordered blocks. The API stores it and
   serves a denormalised render payload (creator profile, live stream, lots)
   so every surface can draw the shop without extra round-trips.
   ────────────────────────────────────────────────────────────────────────*/

function auctionTitleFor(auctionId: string): string {
  return auctions.get(auctionId)?.title ?? 'your sale';
}

function storefrontSeed(userId: string): Storefront {
  const user = users.get(userId);
  const handle = user?.handle ?? 'creator';
  const displayName = user?.displayName ?? 'Creator';
  return {
    id: `store_${handle}`,
    ownerId: userId,
    handle,
    name: `${displayName.split(' ')[0]}’s Shop`,
    tagline: 'Bid. Stream. Win.',
    logoText: displayName
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join(''),
    theme: {
      accent: '#F5A623',
      surface: 'navy' as const,
      radius: 'soft' as const,
      density: 'comfortable' as const,
      showTagline: true,
    },
    blocks: [
      {
        id: 'blk_hero',
        kind: 'hero' as const,
        copy: {
          title: `${displayName} — live auction room`,
          subtitle: user?.bio ?? 'Live drops, authenticated in-stream and shipped worldwide.',
          ctaLabel: 'Watch the stream',
          ctaHref: '/live',
        },
        options: { tone: 'gold' as const },
        visible: true,
      },
      {
        id: 'blk_live',
        kind: 'liveNow' as const,
        copy: { title: 'Live right now', ctaLabel: 'Join the room' },
        visible: true,
      },
      {
        id: 'blk_lots',
        kind: 'featuredLots' as const,
        copy: { title: 'On the block', subtitle: 'Bidding closes soon' },
        options: { columns: 4, limit: 8 },
        visible: true,
      },
      {
        id: 'blk_about',
        kind: 'about' as const,
        copy: { title: 'About me', body: user?.bio ?? '' },
        visible: true,
      },
    ],
    published: true,
    updatedAt: store.iso(),
  };
}

/** Denormalised payload every renderer consumes. */
function renderStorefront(storefront: ReturnType<typeof storefrontSeed>) {
  const profile = publicProfile(storefront.ownerId);
  const live = streams.live().find((stream) => stream.creatorId === storefront.ownerId);
  return {
    storefront,
    profile,
    stream: live ? expandStream(live.id) : null,
    lots: auctions
      .bySeller(storefront.ownerId)
      .map((auction) => expandAuction(auction.id))
      .filter(Boolean),
    sold: auctions.completed().filter((auction) => auction.sellerId === storefront.ownerId).length,
  };
}

app.get('/api/storefronts', (_req, res) => {
  res.json({ items: store.storefronts.all().map(renderStorefront) });
});

app.get('/api/storefronts/:handle', (req, res) => {
  const handle = req.params.handle;
  const owner = users.findByHandle(handle);
  const existing = store.storefronts.get(handle);
  if (!existing && !owner) {
    res.status(404).json({ error: 'storefront_not_found' });
    return;
  }
  const storefront = existing ?? storefrontSeed(owner!.id);
  res.json(renderStorefront(storefront));
});

/** Studio save — creates or updates the caller's storefront document. */
app.put('/api/storefronts', (req, res) => {
  const body = req.body as { storefront?: Record<string, unknown>; handle?: string };
  const handle = body.handle ?? users.get(actorId(req))?.handle;
  if (!handle) {
    res.status(400).json({ error: 'handle_required' });
    return;
  }
  const owner = users.findByHandle(handle);
  if (!owner) {
    res.status(404).json({ error: 'owner_not_found' });
    return;
  }
  const incoming = (body.storefront ?? {}) as Record<string, unknown>;
  const base = store.storefronts.get(handle) ?? storefrontSeed(owner.id);
  const saved = store.storefronts.save({
    ...base,
    ...(incoming as object),
    id: base.id,
    ownerId: owner.id,
    handle,
    updatedAt: store.iso(),
  });
  res.json({ ok: true, ...renderStorefront(saved) });
});

/** Dev convenience: rebuild a creator's storefront from the seeded defaults. */
app.post('/api/storefronts/:handle/reset', (req, res) => {
  const owner = users.findByHandle(req.params.handle);
  if (!owner) {
    res.status(404).json({ error: 'owner_not_found' });
    return;
  }
  store.storefronts.remove(owner.handle);
  const fresh = storefrontSeed(owner.id);
  store.storefronts.save(fresh);
  res.json({ ok: true, ...renderStorefront(fresh) });
});

/* ── REST: dev controls ─────────────────────────────────────────────────
   Lets the demo, QA and the anti-snipe proof move an auction clock so
   closing-window behaviour is verifiable end to end. Disabled in production.
   ────────────────────────────────────────────────────────────────────────*/
app.post('/api/dev/clock', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(403).json({ error: 'dev_controls_disabled' });
    return;
  }
  const { auctionId, secondsFromNow, status } = req.body as {
    auctionId: string;
    secondsFromNow: number;
    status?: AuctionWithRelations['status'];
  };
  const auction = auctions.get(auctionId);
  if (!auction) {
    res.status(404).json({ error: 'auction_not_found' });
    return;
  }
  auction.endTime = new Date(Date.now() + secondsFromNow * 1000).toISOString();
  auction.status = status ?? 'live';
  auctions.save(auction);
  res.json({ ok: true, auction: expandAuction(auctionId) });
});

/** Rebuild the demo world so every demo/QA run starts from a known-good state. */
app.post('/api/dev/reset', (_req, res) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(403).json({ error: 'dev_controls_disabled' });
    return;
  }
  reseed();
  res.json({
    ok: true,
    users: users.all().length,
    auctions: auctions.all().length,
    streams: streams.all().length,
    liveAuctions: auctions.active().length,
  });
});

/* ── Socket.IO realtime layer ──────────────────────────────────────────── */

io.on('connection', (socket) => {
  socket.on('auction:join', (auctionId: string) => {
    socket.join(`auction:${auctionId}`);
    const auction = expandAuction(auctionId);
    if (auction) {
      socket.emit('auction:snapshot', { auction, bids: auctions.bids(auctionId).slice(0, 40) });
    }
  });

  socket.on('auction:leave', (auctionId: string) => {
    socket.leave(`auction:${auctionId}`);
  });

  socket.on('auction:placeBid', (payload) => {
    const events = engine.placeBid(payload);
    broadcast(events);
  });

  socket.on('auction:autoBid', (payload) => {
    const events = engine.setAutoBid(payload);
    broadcast(events);
  });

  socket.on('auction:autoBidOff', (payload) => {
    engine.cancelAutoBid(payload.auctionId, payload.bidderId);
  });

  socket.on('stream:join', (streamId: string) => {
    socket.join(`stream:${streamId}`);
    const stream = streams.get(streamId);
    if (!stream) return;
    stream.viewerCount += 1;
    stream.peakViewerCount = Math.max(stream.peakViewerCount, stream.viewerCount);
    streams.save(stream);
    io.to(`stream:${streamId}`).emit('stream:viewers', { streamId, viewerCount: stream.viewerCount });
  });

  socket.on('stream:leave', (streamId: string) => {
    socket.leave(`stream:${streamId}`);
    const stream = streams.get(streamId);
    if (!stream) return;
    stream.viewerCount = Math.max(0, stream.viewerCount - 1);
    streams.save(stream);
    io.to(`stream:${streamId}`).emit('stream:viewers', { streamId, viewerCount: stream.viewerCount });
  });

  socket.on('chat:send', (payload) => {
    const message = chat.addChat({
      id: store.nextId('msg'),
      streamId: payload.streamId,
      userId: payload.userId,
      displayName: payload.displayName,
      body: payload.body.slice(0, 400),
      isPinned: false,
      isCreator: streams.get(payload.streamId)?.creatorId === payload.userId,
      createdAt: store.iso(),
    });
    io.to(`stream:${payload.streamId}`).emit('chat:message', message);
  });

  socket.on('chat:pin', (payload) => {
    const list = chat.get(payload.streamId);
    const target = list.find((m) => m.id === payload.messageId) ?? null;
    chat.pin(payload.streamId, target?.id ?? null);
    io.to(`stream:${payload.streamId}`).emit('chat:pin', { streamId: payload.streamId, message: target });
  });

  socket.on('user:join', (userId: string) => {
    socket.join(`user:${userId}`);
  });
});

/* ── Heartbeat: settle due auctions, push ticks, drift viewer counts ───── */

setInterval(() => {
  const due = engine.auctionsDueForSettlement();
  due.forEach((auction) => {
    const events = engine.tickAuction(auction.id);
    broadcast(events);
  });
}, 1000);

setInterval(() => {
  auctions.active().forEach((auction) => {
    io.to(`auction:${auction.id}`).emit('auction:tick', {
      auctionId: auction.id,
      endTime: auction.endTime,
      serverTime: store.iso(),
    });
  });
}, 5000);

setInterval(() => {
  streams.live().forEach((stream) => {
    const drift = Math.round((Math.random() - 0.42) * 24);
    stream.viewerCount = Math.max(12, stream.viewerCount + drift);
    stream.peakViewerCount = Math.max(stream.peakViewerCount, stream.viewerCount);
    streams.save(stream);
    io.to(`stream:${stream.id}`).emit('stream:viewers', { streamId: stream.id, viewerCount: stream.viewerCount });
  });
}, 4000);

/* ── Unified hosting: serve the built clients from this same origin ──────
   One origin means no CORS surface, a single TLS certificate, and deep links
   that resolve against the same host as the API they call. Disabled unless the
   build directories are configured, so the API still runs standalone in dev.
   ────────────────────────────────────────────────────────────────────────*/
const staticResult = mountStaticHost(app, {
  webDir: process.env.MM_WEB_DIR,
  tvDir: process.env.MM_TV_DIR,
  secure: Boolean(process.env.MM_TLS_CERT),
});

/* ── Error handling ────────────────────────────────────────────────────── */

app.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
  /**
   * A rejected Origin is a policy refusal, not a server fault. The browser blocks
   * the response either way because the CORS headers are absent, but answering
   * 403 keeps it out of error tracking and stops the message being reported as a
   * crash — and the message is logged without a stack, since it is expected.
   */
  if (error.message.startsWith('origin_not_allowed:')) {
    const origin = error.message.slice('origin_not_allowed:'.length);
    console.warn(`[moneymart-api] refused cross-origin request from ${origin} to ${req.path}`);
    res.status(403).json({ error: 'origin_not_allowed', detail: origin });
    return;
  }

  console.error('[moneymart-api] unhandled', error);
  res.status(500).json({ error: 'internal_error', detail: error.message });
});

/* ── Boot ──────────────────────────────────────────────────────────────── */

if (process.env.MM_SEED !== 'false') {
  seed();
}

http.listen(PORT, () => {
  const live = streams.live();
  console.log(`\n  MoneyMart API  •  Bid. Stream. Win.`);
  console.log(`  REST + WebSocket  →  ${tlsEnabled ? 'https' : 'http'}://127.0.0.1:${PORT}`);
  console.log(`  Live streams: ${live.length}   Live auctions: ${auctions.active().length}   Users: ${users.all().length}`);
  console.log(`  Anti-snipe: ${ANTI_SNIPE.triggerWindowMs / 1000}s window → +${ANTI_SNIPE.extensionMs / 1000}s`);
  console.log(`  CORS allowlist: ${allowedOrigins.size} explicit origin(s), vercel previews ${process.env.MM_ALLOW_VERCEL_PREVIEWS === 'false' ? 'blocked' : 'allowed'}`);
  if (staticResult.mounted.length) {
    console.log('  Serving clients:');
    staticResult.mounted.forEach((entry) => console.log(`    ${entry}`));
  }
  console.log('');
});

export { app, http, io };
