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
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, resolve as resolvePath } from 'node:path';
import { createHash } from 'node:crypto';
import { Server as SocketServer } from 'socket.io';
import type {
  AuctionWithRelations,
  ClientToServerEvents,
  LiveVideoSettings,
  PostalAddress,
  SellerProfile,
  Stream,
  Item,
  Order,
  PublicProfile,
  ServerToClientEvents,
  Storefront,
  User,
} from '@moneymart/types';
import { DEFAULT_USER_PREFERENCES, type UserPreferences } from '@moneymart/types';
import { categories, categoryTree, isCategory, isSubcategoryOf } from '@moneymart/tokens';
import { ANTI_SNIPE, ITEM_TIMER, categoryLabel } from './lib/labels.js';
import { engine, type EngineEvent } from './engine/auctionEngine.js';
import { money } from './engine/money.js';
import { escrow, EscrowError } from './engine/escrow.js';
import { providerRegistry } from './engine/payments.js';
import { qrToSvgDataUri } from './lib/qr.js';
import { mountStaticHost } from './lib/staticHost.js';
import { createPersistence, shouldSeed } from './lib/persistence.js';
import { rateLimit, POLICIES, limiterStatus, resetRateLimits, startLimiterSweep } from './lib/rateLimit.js';
import { subscriptionsService, ENTITLEMENTS } from './engine/subscriptions.js';
import { authService, deliveryConfigured } from './engine/auth.js';
import { oauthService } from './engine/oauth.js';
import { resolveStreamPlayback } from './engine/playback.js';
import {
  LIVE_VIDEO_PROVIDERS,
  LiveVideoError,
  PROVIDER_LABELS,
  closeRoom,
  createRoomWithFallback,
  hostCredentials,
  isConfigured as liveVideoConfigured,
  viewerCredentials,
  type LiveVideoProviderId,
} from './engine/liveVideo.js';
import { validateImage, validateImages, MAX_IMAGES } from './lib/images.js';
import {
  auctions,
  categoryRequests,
  settings,
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
import { mountAiRoutes, startAiCompany } from './ai/routes.js';

const PORT = Number(process.env.PORT ?? 4317);
const app = express();
/**
 * ── HLS media ──────────────────────────────────────────────────────────────
 *
 * The stream room had nothing to play: every stream carried `hlsUrl: ""`, so the
 * player could only show a poster over an offline notice. These are the real HLS
 * playlists and MPEG-TS segments the room now plays, produced by
 * `scripts/generate-hls.sh`.
 *
 * Segments are immutable once written, so they are cached for a year; playlists are
 * re-read every minute so a future live playlist can advance. CORS is open because
 * hls.js fetches segments with XHR from the web and TV origins, which are different
 * from the API's.
 */
const MEDIA_ROOT = findMediaRoot();

/**
 * Locate the media directory.
 *
 * It sits at the package root, but this module's own path differs between the two
 * ways it is loaded: `src/index.ts` under tsx, and
 * `dist/services/api/src/index.js` after a build. Walking up a FIXED number of
 * levels is right for one and silently wrong for the other — which is exactly what
 * happened: the playlist route answered `stream_not_found` for media that was
 * present on disk, because the path resolved to `dist/services/media`.
 *
 * Candidates are tried in order and the first that exists wins. The first candidate
 * is returned when none match, so a missing directory fails in the route with a
 * clear 404 rather than at import time.
 */
function findMediaRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolvePath(here, '../../../media'), // source under tsx: src -> services/api/media
    resolvePath(here, '../../media'), // built: dist/services/api/src -> services/api/media
    resolvePath(process.cwd(), 'media'),
    resolvePath(process.cwd(), 'services/api/media'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

/**
 * Where this gateway is reachable, for building absolute media URLs.
 *
 * HLS clients fetch playlists over HTTP, so a relative path is not enough for every
 * consumer. An explicit `MM_MEDIA_BASE_URL` wins; otherwise the managed platform's
 * public domain is used. When neither is available the helper returns undefined and
 * playback falls back to the public demo manifests, which is the honest outcome for
 * a deployment that never generated the media.
 */
function mediaBaseUrl(): string | undefined {
  const explicit = process.env.MM_MEDIA_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const domain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (domain) return `https://${domain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  // Local development: the gateway is reachable on its own port.
  if (existsSync(join(MEDIA_ROOT, 'hls'))) return `http://127.0.0.1:${PORT}`;
  return undefined;
}

const STREAM_NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;

app.get('/media/hls/:name/index.m3u8', (req, res) => {
  const name = String(req.params.name);
  if (!STREAM_NAME.test(name)) {
    res.status(400).json({ error: 'invalid_stream_name' });
    return;
  }
  try {
    // Relative segment URIs in the playlist resolve against the playlist URL, which
    // is the behaviour we want.
    const playlist = readFileSync(join(MEDIA_ROOT, 'hls', name, 'index.m3u8'), 'utf8');
    res.type('application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(playlist);
  } catch {
    res.status(404).json({ error: 'stream_not_found', detail: `No stream named ${name}.` });
  }
});

app.get('/media/hls/:name/:segment', (req, res) => {
  const name = String(req.params.name);
  const segment = String(req.params.segment);
  if (!STREAM_NAME.test(name) || !/^seg\d{3}\.ts$/.test(segment)) {
    res.status(400).json({ error: 'invalid_segment' });
    return;
  }
  /**
   * Resolved, then checked for containment. The pattern above already forbids
   * separators and traversal, but asserting containment means a future loosening of
   * that pattern cannot silently become a directory escape.
   */
  const base = join(MEDIA_ROOT, 'hls');
  const target = normalize(join(base, name, segment));
  if (target !== join(base, name, segment) || !target.startsWith(base + '/')) {
    res.status(400).json({ error: 'invalid_segment' });
    return;
  }
  try {
    const body = readFileSync(target);
    res.type('video/mp2t');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(body);
  } catch {
    res.status(404).json({ error: 'segment_not_found' });
  }
});



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
/**
 * Body limit.
 *
 * Sized so the image validator is what refuses an oversized payload, rather than
 * the parser cutting the request off first with an opaque error. The per-image
 * ceiling is 3 MB of raw bytes, which is roughly 4 MB once base64-encoded, so a
 * full gallery needs headroom well beyond the old 2 MB.
 */
app.use(express.json({ limit: '16mb' }));

/**
 * Rate limiting.
 *
 * Applied after the body parser so the auth policies can key on the submitted
 * identifier, and in order of increasing specificity: a floor for the whole API,
 * then tight limits on the endpoints that send messages or create records.
 * Without this, eight consecutive OTP requests all succeeded in production — and
 * each is a billable SMS once a provider is configured.
 */
app.use(rateLimit(POLICIES.global));
app.use('/api/auth/request', rateLimit(POLICIES.authRequest));
app.use('/api/auth/verify', rateLimit(POLICIES.authVerify));
app.use('/api/webhooks', rateLimit(POLICIES.webhook));

const io = new SocketServer<ClientToServerEvents, ServerToClientEvents>(http, {
  cors: { origin: corsOrigin, credentials: true },
  path: '/socket.io',
});

/**
 * Socket authentication.
 *
 * This was missing, and its absence was a complete authorization bypass: the
 * write handlers took `bidderId` from the payload, so an anonymous socket could
 * place a real bid as any user. REST refused the same write with 401, which made
 * the hole easy to miss — the HTTP surface looked locked down while the realtime
 * surface, which is the one that actually moves money, was open.
 *
 * The token arrives in the handshake because a WebSocket upgrade cannot carry an
 * Authorization header from a browser; `auth.token` is the supported channel.
 * Read-only joins stay available so a signed-out visitor can watch.
 */
io.use((socket, next) => {
  const handshake = socket.handshake.auth as { token?: string } | undefined;
  const headerToken = /^Bearer\s+(.+)$/i.exec(String(socket.handshake.headers.authorization ?? ''))?.[1];

  const devUserId = authService.demoHeaderAllowed()
    ? String((socket.handshake.auth as { userId?: string } | undefined)?.userId ?? '')
    : '';

  const token = handshake?.token ?? headerToken;
  if (token) {
    const session = authService.authenticate(token);
    if (!session) {
      next(new Error('invalid_token'));
      return;
    }
    // The verified identity is what handlers must use; nothing in a payload can
    // override it.
    (socket.data as { userId?: string }).userId = session.userId;
    next();
    return;
  }

  if (devUserId && users.get(devUserId)) {
    (socket.data as { userId?: string }).userId = devUserId;
    next();
    return;
  }

  // Anonymous: permitted to watch, refused by every write handler.
  (socket.data as { userId?: string }).userId = undefined;
  next();
});

/**
 * The authenticated user for this socket.
 *
 * Handlers must use this rather than trusting `payload.bidderId`. Returning
 * undefined means the caller is anonymous, and a write handler must refuse.
 */
function socketUserId(socket: { data: unknown }): string | undefined {
  return (socket.data as { userId?: string }).userId;
}

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

/** Public web address of a show; the app opens `moneymart://stream/<id>`. */
function showShareUrl(streamId: string): string {
  const base = (process.env.MM_PUBLIC_WEB_URL ?? 'https://www.moneymart.app').replace(/\/+$/, '');
  return `${base}/stream/${encodeURIComponent(streamId)}`;
}

function expandStream(streamId: string) {
  const stream = streams.get(streamId);
  if (!stream) return null;
  // Who asked for a reminder and which words are muted are the host's business only.
  const { reminderUserIds, mutedWords: _muted, video, ...visible } = stream;
  const live = stream.status === 'live' && video;
  return {
    ...visible,
    /** Which live video service carries this show; clients pick the matching player. */
    liveVideoProvider: video?.provider,
    reminderCount: reminderUserIds?.length ?? 0,
    shareUrl: showShareUrl(stream.id),
    moderators: (stream.moderatorIds ?? []).map((id) => publicProfile(id)),
    creator: publicProfile(stream.creatorId),
    activeAuction: stream.activeAuctionId ? (expandAuction(stream.activeAuctionId) ?? undefined) : undefined,
    queuedCount: stream.itemQueue.length,
    /**
     * Resolved here so every client (web, TV, mobile) agrees on what is playing
     * and whether it is a real broadcast. An unresolvable stored URL becomes a
     * labelled demo rather than a dead player.
     */
    // A real broadcast is joined through /watch, not an HLS URL.
    playback: live
      ? { mode: 'live' as const, label: 'Live now', updatedAt: store.iso() }
      : resolveStreamPlayback({
          streamId: stream.id,
          status: stream.status,
          storedUrl: stream.hlsUrl,
          fallbackUrl: process.env.MM_DEMO_HLS_URL,
          mediaBaseUrl: mediaBaseUrl(),
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
 * Resolve the acting identity.
 *
 * A verified session token is the real path:
 *
 *   Authorization: Bearer <token>
 *
 * `x-mm-user` remains as a development stand-in so multi-user realtime flows can
 * be driven without signing in repeatedly. It is honoured only outside
 * production (or behind MM_ALLOW_DEMO_AUTH), because an unverified header that
 * selects any account IS an authentication bypass — which is precisely the flaw
 * this replaces. An unknown identity is never downgraded to the session default,
 * since that would serve one user's wallet and orders to a caller who merely
 * claimed a different id.
 */
function bearerToken(req: Request): string | null {
  const raw = req.header('authorization');
  if (!raw) return null;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match ? match[1]!.trim() : null;
}

function actorId(req: Request, explicit?: string): string {
  // 1. A verified session.
  const token = bearerToken(req);
  if (token) {
    const session = authService.authenticate(token);
    if (session) return session.userId;
  }

  // 2. An explicit body field, used by tests and admin tooling.
  if (explicit && users.get(explicit)) return explicit;

  // 3. The development stand-ins, refused in production.
  if (authService.demoHeaderAllowed()) {
    const header = req.header('x-mm-user');
    if (header && users.get(header)) return header;
    /**
     * The dev session endpoint's selection.
     *
     * Kept INSIDE this branch deliberately. The store's `session.userId` is
     * pre-populated by the demo seed (seed.ts sets it to the demo buyer), so
     * returning it outside this branch made every unauthenticated request in
     * production resolve to a real, fully-privileged account — with the wallet,
     * orders and Pro pricing that go with it. Seeding populated an identity, and
     * an auth fallback then trusted it.
     */
    return store.db.session.userId;
  }

  /**
   * No verified identity. An empty string propagates to route handlers, which
   * look the user up and fail closed, rather than naming an account.
   */
  return '';
}

/**
 * Reject requests asserting an identity that cannot be verified.
 *
 * Applied globally rather than per route: authorisation must fail closed, and a
 * per-route check is a standing invitation to forget one. A malformed or expired
 * bearer token is refused outright rather than silently falling through to the
 * demo header, so a client with a stale token learns it must sign in again
 * instead of quietly acting as somebody else.
 */
/**
 * Guard an order-scoped route.
 *
 * Order routes loaded the order by id and answered with it, so ANY authenticated
 * caller could read any order — buyer and seller ids, the total, the delivery
 * address and the tracking number — simply by knowing or guessing an id. That is
 * a straightforward IDOR, and an id is not a secret: it appears in URLs, in
 * notifications and in support conversations.
 *
 * Returns the order when the caller is the buyer or the seller, otherwise
 * responds and returns null. A 404 is used rather than 403 for a non-participant
 * so the endpoint does not confirm that an order id exists.
 */
function requireOrderParticipant(
  req: Request,
  res: Response,
  orderId: string,
): Order | null {
  const order = orders.get(orderId);
  if (!order) {
    res.status(404).json({ error: 'order_not_found' });
    return null;
  }
  const actor = actorId(req);
  if (!actor || (actor !== order.buyerId && actor !== order.sellerId)) {
    res.status(404).json({ error: 'order_not_found' });
    return null;
  }
  return order;
}

/* ── REST: authentication (§9.1 Auth Service) ──────────────────────────────
   Passwordless: a one-time code proves control of an email address or phone
   number, and possession of that identifier IS the account. There is no
   password database to breach and no reset flow to build, and phone
   verification — which a marketplace handling money needs anyway — falls out
   of the same mechanism.
   ────────────────────────────────────────────────────────────────────────*/

app.post('/api/auth/request', async (req, res) => {
  const { identifier } = req.body as { identifier?: string };
  const result = await authService.start(String(identifier ?? ''));
  if (!result) {
    res.status(400).json({ error: 'invalid_identifier', detail: 'Provide an email address or phone number.' });
    return;
  }

  /**
   * The response deliberately does not reveal whether an account exists for the
   * identifier — that would turn this endpoint into an account-enumeration
   * oracle. The one thing that does vary is whether the code could be delivered,
   * because a user staring at an empty inbox needs to know that.
   */
  res.json({
    ok: true,
    challengeId: result.challengeId,
    kind: result.identifier.kind,
    destination: result.identifier.destination.replace(
      result.identifier.kind === 'email' ? /^(.).*(@.*)$/ : /^(\+?\d{0,3})\d+(\d{2})$/,
      result.identifier.kind === 'email' ? '$1***$2' : '$1****$2',
    ),
    expiresInSeconds: result.expiresInSeconds,
    delivery: {
      delivered: result.delivery.delivered,
      transport: result.delivery.transport,
      ...(result.delivery.detail ? { detail: result.delivery.detail } : {}),
      /**
       * True only when a message was actually sent. A client must not tell a user
       * to check their inbox when nothing was dispatched — which is the state
       * production is in until a provider key is configured.
       */
      reachable: result.delivery.delivered,
      configured: deliveryConfigured(),
    },
    // Only populated when development exposure is enabled.
    ...(result.devCode ? { devCode: result.devCode } : {}),
  });
});

app.post('/api/auth/verify', (req, res) => {
  const { identifier, code } = req.body as { identifier?: string; code?: string };
  const result = authService.verify(String(identifier ?? ''), String(code ?? ''));

  if (!result.ok) {
    const status = result.error === 'too_many_attempts' ? 429 : result.error === 'expired' ? 410 : 401;
    res.status(status).json({ error: result.error });
    return;
  }

  res.json({
    ok: true,
    token: result.token,
    expiresAt: new Date(result.expiresAt).toISOString(),
    user: result.user,
    profile: publicProfile(result.user.id),
    /** True when the account still needs a name, handle and country. */
    needsProfile: !result.user.displayName || result.user.verificationStatus !== 'verified',
  });
});

/** Who the caller is, according to their token. */
app.get('/api/auth/session', (req, res) => {
  const token = bearerToken(req);
  const session = token ? authService.authenticate(token) : null;
  if (!session) {
    res.status(401).json({ error: 'not_authenticated' });
    return;
  }
  res.json({
    ok: true,
    user: users.get(session.userId),
    profile: publicProfile(session.userId),
    session: {
      createdAt: new Date(session.createdAt).toISOString(),
      expiresAt: new Date(session.expiresAt).toISOString(),
      /**
       * How this session was established. The account screen shows it, and it is
       * what makes "is this session from a social provider or a code?" answerable
       * rather than guesswork.
       */
      method: session.method,
      identifier: session.identifier,
    },
  });
});

app.post('/api/auth/signout', (req, res) => {
  const token = bearerToken(req);
  // Idempotent: signing out twice is not an error.
  const revoked = token ? authService.signOut(token) : false;
  res.json({ ok: true, revoked });
});

/** Active sessions for the account screen. */
app.get('/api/auth/sessions', (req, res) => {
  res.json({ items: authService.sessionsFor(actorId(req)) });
});

/**
 * Identity enforcement, mounted AFTER the public and authentication routes.
 *
 * Position matters and is the whole reason this is not at the top of the file: a
 * global guard placed before the auth routes intercepts the very requests that
 * exist to obtain a token, so nobody could ever sign in. Registering it here
 * means the routes below are the protected surface, and everything above is
 * deliberately reachable.
 */
app.use((req: Request, res: Response, next: NextFunction) => {
  const token = bearerToken(req);
  if (token && !authService.authenticate(token)) {
    res.status(401).json({ error: 'invalid_token', detail: 'The session token is expired or unknown.' });
    return;
  }

  if (!authService.demoHeaderAllowed()) {
    /**
     * Production: an identity-less write must be refused outright.
     *
     * Reads are public — browsing lots, health, configuration — so they are
     * exempted by METHOD rather than by a path list, which would silently start
     * 401-ing the moment a new public read was added. Anything that writes is
     * attributable and therefore needs an identity.
     *
     * Without this a handler would look up an empty user id and answer 200 with
     * zeros: not a leak, but a request that cannot be attributed should fail
     * closed rather than receive a plausible-looking empty account.
     */
    /**
     * Reads are public by default, because browsing lots, health and
     * configuration must work without an account. A read that exposes a
     * SPECIFIC account is not public, so those paths are called out — a
     * method-only rule let an unauthenticated `GET /api/wallet` answer 200 with
     * an empty account, which reads as a real balance of zero.
     *
     * Only the paths that resolve `actorId` to an account need to be listed, and
     * the write path is covered regardless of method, so a new endpoint is
     * private until it is deliberately made public.
     */
    const isPublicRead = req.method === 'GET' || req.method === 'HEAD';
    const needsIdentity =
      !isPublicRead ||
      /^\/api\/(wallet|orders|notifications|selling|purchases|watchlist|addresses|payouts|subscription|auth\/session|auth\/sessions)(\/|$)/.test(
        req.path,
      );

    /**
     * `/api/session` is exempted because it gates ITSELF: with the demo header
     * disabled it answers 403, which names the real reason (the control is
     * switched off) rather than 401 (you are not signed in). Both refuse the
     * request; the specific answer is more useful to the caller.
     */
    /**
     * Self-gated routes: they answer 403 rather than 401 when the control is
     * switched off, which names the real reason. `/api/dev/*` is included because
     * every dev endpoint already refuses in production, so a 401 from the guard
     * would mask the more specific answer.
     */
    /**
     * Self-gated routes refuse with a reason of their own rather than 401.
     *
     * `/api/auth/oauth/*` MUST be here: starting a sign-in happens precisely when
     * the caller has no identity yet, so requiring one makes social sign-in
     * unreachable in production. It was caught only by exercising the endpoint on
     * the deployment — every local test ran with the demo header allowed, where
     * the guard takes a different branch entirely.
     */
    const isSelfGated =
      req.path === '/api/session' ||
      req.path.startsWith('/api/dev/') ||
      req.path.startsWith('/api/auth/oauth/');

    if (needsIdentity && !isSelfGated && !actorId(req)) {
      res.status(401).json({ error: 'not_authenticated', detail: 'Provide an Authorization: Bearer token.' });
      return;
    }
    next();
    return;
  }

  // Development: the demo header selects the actor, but only if it names a real
  // user. An unknown identity is never downgraded to the session default.
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
    /**
     * Which persistence adapter is active, or null when the store is volatile.
     * Exposed so a deployment's durability is observable from outside instead of
     * being an assumption about its configuration.
     */
    persistence: persistence ? persistence.status().adapter : null,
    auth: {
      demoHeader: authService.demoHeaderAllowed(),
      liveSessions: store.db.authSessions.size,
      /**
       * Whether a sign-in code can actually reach anyone. False means the
       * platform cannot onboard a new user, which is worth seeing without
       * reading a log.
       */
      delivery: deliveryConfigured(),
      /** Which social providers are usable, so a client need not guess. */
      oauth: oauthService.status(),
    },
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

/**
 * Who the caller is.
 *
 * Resolved through `actorId`, so it answers for a bearer token rather than only
 * the development session. Returning 401 when nothing resolves is what lets a
 * client tell "signed out" from "signed in as nobody" — the previous version
 * always answered 200 with whatever the store held, which a client cannot
 * distinguish from a real session.
 */
app.get('/api/session', (req, res) => {
  const userId = actorId(req);
  const user = userId ? users.get(userId) : undefined;
  if (!user) {
    res.status(401).json({ error: 'not_authenticated', user: null, profile: null });
    return;
  }
  res.json({ user, profile: publicProfile(userId) });
});

/**
 * Switch the development identity.
 *
 * Explicitly gated rather than implied: this endpoint sets who subsequent
 * requests act as, so leaving it open in production would be an account-takeover
 * primitive.
 */
app.post('/api/session', (req, res) => {
  if (!authService.demoHeaderAllowed()) {
    res.status(403).json({ error: 'dev_controls_disabled', detail: 'The demo identity switch is disabled in production.' });
    return;
  }
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
  const { type, category, subcategory, seller, status, q, sort, limit } = req.query as Record<string, string | undefined>;
  let list = auctions.all().map((a) => expandAuction(a.id)).filter((a): a is AuctionWithRelations => Boolean(a));

  if (type) list = list.filter((a) => a.auctionType === type);
  if (category) list = list.filter((a) => a.item.categoryId === category);
  if (subcategory) list = list.filter((a) => a.item.subcategoryId === subcategory);
  if (seller) {
    // `me` is the caller's own shop: the seller picks show items from it.
    const sellerId = seller === 'me' ? actorId(req) : (users.findByHandle(seller)?.id ?? seller);
    list = list.filter((a) => a.sellerId === sellerId);
  }
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

/**
 * Buy It Now. The buyer is the session's account (never a body field), and the
 * sale settles through the same path as a won lot: order, escrow, fees, notices.
 */
app.post('/api/auctions/:id/buy-now', (req, res) => {
  const buyer = actorId(req);
  const user = users.get(buyer);
  if (!user) {
    res.status(401).json({ error: 'not_authenticated' });
    return;
  }
  const events = engine.buyItNow({ auctionId: req.params.id, buyerId: buyer, buyerHandle: user.handle });
  if (!events.length) {
    res.status(404).json({ error: 'auction_not_found' });
    return;
  }
  broadcast(events);
  const rejection = events.find((e) => e.type === 'rejected');
  if (rejection && rejection.type === 'rejected') {
    res.status(409).json(rejection.payload);
    return;
  }
  const order = orders.all().find((o) => o.auctionId === req.params.id && o.buyerId === buyer);
  res.json({ ok: true, auction: expandAuction(req.params.id), orderId: order?.id });
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
app.post('/api/auctions', rateLimit(POLICIES.createListing), (req, res) => {
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
    subcategoryId?: string;
  };

  if (!body.title || !body.startingPrice) {
    res.status(400).json({ error: 'title_and_starting_price_required' });
    return;
  }

  /**
   * The category must be one the taxonomy knows. An unknown id used to be stored
   * verbatim and the listing then matched no category page, so it was invisible
   * to every buyer browsing by category.
   */
  if (body.categoryId !== undefined && !isCategory(body.categoryId)) {
    res.status(400).json({ error: 'unknown_category', detail: 'Pick a category from the list, or request a new one.' });
    return;
  }
  if (body.subcategoryId !== undefined && !isSubcategoryOf(body.subcategoryId, body.categoryId ?? 'collectibles')) {
    res.status(400).json({ error: 'unknown_subcategory', detail: 'That subcategory does not belong to the chosen category.' });
    return;
  }

  /**
   * Validate images before anything is written.
   *
   * Previously any string was stored verbatim: a script-bearing SVG was accepted
   * and redistributed, and a 1.5 MB data URI inflated every read. The check
   * refuses the request rather than silently dropping offending entries, so a
   * client is told which image failed and why.
   */
  const imageCheck = validateImages(body.images);
  if (!imageCheck.ok) {
    res.status(400).json({ error: 'invalid_images', detail: imageCheck.reason, maxImages: MAX_IMAGES });
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
    subcategoryId: body.subcategoryId,
    condition: body.condition ?? 'good',
    images: imageCheck.values,
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

/* ── REST: categories ──────────────────────────────────────────────────── */

/**
 * The full taxonomy with live activity counts, so a picker can sort by
 * popularity and a browse page can show where buyers are right now.
 */
app.get('/api/categories', (_req, res) => {
  const liveViewers = new Map<string, number>();
  const liveShows = new Map<string, number>();
  for (const stream of streams.live()) {
    liveViewers.set(stream.category, (liveViewers.get(stream.category) ?? 0) + stream.viewerCount);
    liveShows.set(stream.category, (liveShows.get(stream.category) ?? 0) + 1);
  }
  const listingCounts = new Map<string, number>();
  for (const auction of auctions.all()) {
    if (!auctions.isLive(auction)) continue;
    const item = items.get(auction.itemId);
    if (!item) continue;
    listingCounts.set(item.categoryId, (listingCounts.get(item.categoryId) ?? 0) + 1);
    if (item.subcategoryId) listingCounts.set(item.subcategoryId, (listingCounts.get(item.subcategoryId) ?? 0) + 1);
  }
  res.json({
    items: categoryTree.map((entry, order) => ({
      ...entry,
      order,
      liveViewers: liveViewers.get(entry.id) ?? 0,
      liveShows: liveShows.get(entry.id) ?? 0,
      listings: listingCounts.get(entry.id) ?? 0,
      subcategories: entry.subcategories.map((child) => ({ ...child, listings: listingCounts.get(child.id) ?? 0 })),
    })),
  });
});

/** A seller asks for a category the taxonomy lacks. Signed-in callers only. */
app.post('/api/categories/requests', (req, res) => {
  const userId = actorId(req);
  if (!users.get(userId)) {
    res.status(401).json({ error: 'not_authenticated' });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = String(body.name ?? '').trim();
  if (name.length < 2 || name.length > 60) {
    res.status(400).json({ error: 'invalid_name', detail: 'A category name is 2–60 characters.' });
    return;
  }
  const parentId = body.parentId === undefined || body.parentId === '' ? undefined : String(body.parentId);
  if (parentId && !isCategory(parentId)) {
    res.status(400).json({ error: 'unknown_category', detail: 'The parent category does not exist.' });
    return;
  }
  // Bounded per user so the queue cannot be flooded.
  if (categoryRequests.byUser(userId).length >= 20) {
    res.status(429).json({ error: 'too_many_requests', detail: 'You have reached the limit of open category requests.' });
    return;
  }
  const request = categoryRequests.create({
    id: store.nextId('catreq'),
    userId,
    name,
    parentId,
    note: body.note === undefined ? undefined : String(body.note).trim().slice(0, 280),
    createdAt: store.iso(),
  });
  res.status(201).json({ request });
});

/* ── REST: streams ─────────────────────────────────────────────────────── */

/**
 * Load a show the caller hosts.
 *
 * Starting an item and ending a show were open to any caller, so anyone could
 * take over or shut down another seller's broadcast. Only the host may control a
 * show. A non-host gets 404, like a missing show, so ids are not confirmed.
 */
function requireHost(req: Request, res: Response, streamId: string): Stream | null {
  const stream = streams.get(streamId);
  const actor = actorId(req);
  if (!stream || !actor || stream.creatorId !== actor) {
    res.status(404).json({ error: 'stream_not_found' });
    return null;
  }
  return stream;
}

/* ── Live video: provider choice, go live, watch ─────────────────────── */

function isStaff(userId: string): boolean {
  return users.get(userId)?.role === 'admin';
}

const LIVE_VIDEO_KEY = 'liveVideo';

/** Current platform choice. Defaults to IVS with Cloudflare as automatic backup. */
function liveVideoSettings(): LiveVideoSettings {
  const stored = settings.get<LiveVideoSettings>(LIVE_VIDEO_KEY);
  const envPrimary = process.env.MM_LIVE_VIDEO_PRIMARY === 'cloudflare' ? 'cloudflare' : 'ivs';
  return { primary: envPrimary, autoFallback: true, ...(stored ?? {}) };
}

function liveVideoStatus() {
  const current = liveVideoSettings();
  return {
    ...current,
    updatedByName: current.updatedBy ? users.get(current.updatedBy)?.displayName : undefined,
    providers: LIVE_VIDEO_PROVIDERS.map((id) => ({
      id,
      label: PROVIDER_LABELS[id],
      configured: liveVideoConfigured(id),
      role: id === current.primary ? 'primary' : 'backup',
    })),
    liveShows: streams.live().filter((s) => s.video).map((s) => ({ id: s.id, title: s.title, provider: s.video!.provider })),
  };
}

/* Owner console: President Ore's office, settings, audit; Ore in the app. */
mountAiRoutes(app, (req) => actorId(req));

/** Staff only. 404 for everyone else, so the console's existence is not confirmed. */
function requireStaff(req: Request, res: Response): string | null {
  const userId = actorId(req);
  if (!userId || !isStaff(userId)) {
    res.status(404).json({ error: 'not_found' });
    return null;
  }
  return userId;
}

app.get('/api/admin/live-video', (req, res) => {
  if (!requireStaff(req, res)) return;
  res.json(liveVideoStatus());
});

/**
 * Switch the live video provider. Affects shows that go live from now on; a show
 * already broadcasting keeps its provider (moving it would cut viewers off).
 */
app.put('/api/admin/live-video', (req, res) => {
  const staffId = requireStaff(req, res);
  if (!staffId) return;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const current = liveVideoSettings();
  let primary = current.primary;
  if (body.primary !== undefined) {
    if (!LIVE_VIDEO_PROVIDERS.includes(body.primary as LiveVideoProviderId)) {
      res.status(400).json({ error: 'unknown_provider', detail: 'Choose ivs or cloudflare.' });
      return;
    }
    primary = body.primary as LiveVideoProviderId;
    if (!liveVideoConfigured(primary)) {
      res.status(409).json({ error: 'provider_not_configured', detail: `${PROVIDER_LABELS[primary]} has no credentials on the server yet.` });
      return;
    }
  }
  let autoFallback = current.autoFallback;
  if (body.autoFallback !== undefined) {
    if (typeof body.autoFallback !== 'boolean') {
      res.status(400).json({ error: 'invalid_setting', detail: 'autoFallback must be true or false.' });
      return;
    }
    autoFallback = body.autoFallback;
  }
  settings.set<LiveVideoSettings>(LIVE_VIDEO_KEY, { ...current, primary, autoFallback, updatedAt: store.iso(), updatedBy: staffId });
  console.log(`[live-video] ${staffId} set primary=${primary} autoFallback=${autoFallback}`);
  res.json(liveVideoStatus());
});

/** One go-live at a time per show, so a double tap cannot open two paid rooms. */
const goLiveInFlight = new Map<string, Promise<unknown>>();

/**
 * Start broadcasting. Opens the show's room on the platform's provider (falling
 * back automatically when allowed) and returns the host's broadcast credentials.
 * Calling again re-issues credentials for the same room. `useBackup` moves the
 * show to the other provider — the host's escape hatch when their stream will not
 * connect.
 */
app.post('/api/streams/:id/go-live', rateLimit(POLICIES.liveVideo), async (req, res) => {
  const stream = requireHost(req, res, req.params.id);
  if (!stream) return;
  if (stream.status === 'ended') {
    res.status(409).json({ error: 'show_ended', detail: 'This show has ended. Schedule a new one.' });
    return;
  }
  const previous = goLiveInFlight.get(stream.id);
  if (previous) await previous.catch(() => undefined);

  const useBackup = (req.body ?? {}).useBackup === true;
  const work = (async () => {
    let failedOver: { from: LiveVideoProviderId; reason: string } | undefined;
    if (!stream.video || useBackup) {
      const config = liveVideoSettings();
      if (useBackup) {
        const current = stream.video?.provider ?? config.primary;
        const backup = LIVE_VIDEO_PROVIDERS.find((p) => p !== current)!;
        if (!liveVideoConfigured(backup)) {
          throw new LiveVideoError(backup, 'not_configured', `${PROVIDER_LABELS[backup]} is not configured, so there is no backup to switch to.`);
        }
        const opened = await createRoomWithFallback(backup, false, stream.id, stream.title);
        if (stream.video) void closeRoom(stream.video);
        stream.video = { ...opened.room };
        failedOver = { from: current, reason: 'host_requested' };
      } else {
        const opened = await createRoomWithFallback(config.primary, config.autoFallback, stream.id, stream.title);
        stream.video = { ...opened.room };
        failedOver = opened.failedOver;
      }
      if (failedOver) {
        settings.set<LiveVideoSettings>(LIVE_VIDEO_KEY, {
          ...liveVideoSettings(),
          lastFailover: { at: store.iso(), from: failedOver.from, to: stream.video.provider, reason: failedOver.reason, showId: stream.id },
        });
        console.warn(`[live-video] show ${stream.id} moved ${failedOver.from} → ${stream.video.provider} (${failedOver.reason})`);
      }
    }
    const credentials = await hostCredentials(stream.video, stream.creatorId);
    const firstStart = !stream.actualStartTime;
    stream.status = 'live';
    stream.actualStartTime = stream.actualStartTime ?? store.iso();
    streams.save(stream);
    if (firstStart) notifyShowLive(stream);
    io.to(`stream:${stream.id}`).emit('stream:started', { streamId: stream.id, liveVideoProvider: stream.video.provider });
    return { credentials, failedOver };
  })();
  goLiveInFlight.set(stream.id, work);
  try {
    const { credentials, failedOver } = await work;
    res.json({ stream: hostView(stream.id), broadcast: credentials, failedOver });
  } catch (error) {
    const failure = error instanceof LiveVideoError ? error : new LiveVideoError('ivs', 'error', 'Live video failed');
    res.status(503).json({ error: 'live_video_unavailable', provider: failure.provider, reason: failure.reason, detail: failure.message });
  } finally {
    if (goLiveInFlight.get(stream.id) === work) goLiveInFlight.delete(stream.id);
  }
});

/** Join a live show's video. Open to anyone who can open the show, signed in or not. */
app.get('/api/streams/:id/watch', rateLimit(POLICIES.liveVideo), async (req, res) => {
  const stream = streams.get(req.params.id);
  if (!stream) {
    res.status(404).json({ error: 'stream_not_found' });
    return;
  }
  if (stream.status !== 'live' || !stream.video) {
    res.status(409).json({ error: 'not_live', detail: 'This show is not broadcasting right now.' });
    return;
  }
  try {
    const viewer = actorId(req);
    res.json({ viewer: await viewerCredentials(stream.video, viewer && users.get(viewer) ? viewer : null) });
  } catch (error) {
    const failure = error instanceof LiveVideoError ? error : new LiveVideoError(stream.video.provider, 'error', 'Live video failed');
    res.status(503).json({ error: 'live_video_unavailable', provider: failure.provider, reason: failure.reason, detail: failure.message });
  }
});

const SHOW_FORMATS = ['auction', 'buy_now', 'mixed'] as const;
const SHOW_TITLE_MAX = 150;

/**
 * Validate the editable fields of a show. Returns an error message, or null
 * after writing the accepted values onto `target`.
 */
function applyShowFields(body: Record<string, unknown>, target: Partial<Stream>, creating: boolean, hostId = ''): string | null {
  if (creating || body.title !== undefined) {
    const title = String(body.title ?? '').trim();
    if (title.length < 3 || title.length > SHOW_TITLE_MAX) return `A show title is 3–${SHOW_TITLE_MAX} characters.`;
    target.title = title;
  }
  if (creating || body.categoryId !== undefined) {
    if (!isCategory(body.categoryId)) return 'Pick a category from the list.';
    target.category = body.categoryId;
  }
  if (body.subcategoryId !== undefined) {
    const parent = target.category ?? '';
    if (body.subcategoryId === null || body.subcategoryId === '') target.subcategory = undefined;
    else if (!isSubcategoryOf(body.subcategoryId, parent)) return 'That subcategory does not belong to the chosen category.';
    else target.subcategory = String(body.subcategoryId);
  }
  if (creating || body.scheduledStartTime !== undefined) {
    const when = Date.parse(String(body.scheduledStartTime ?? ''));
    if (!Number.isFinite(when)) return 'A show needs a valid start time.';
    // A little slack for clock drift; a year ahead is the scheduling horizon.
    if (when < Date.now() - 5 * 60_000) return 'A show cannot start in the past.';
    if (when > Date.now() + 366 * 86_400_000) return 'A show can be scheduled up to a year ahead.';
    target.scheduledStartTime = new Date(when).toISOString();
  }
  if (body.description !== undefined) target.description = String(body.description).trim().slice(0, 1000);
  if (body.format !== undefined) {
    if (!SHOW_FORMATS.includes(body.format as (typeof SHOW_FORMATS)[number])) return 'Format must be auction, buy_now or mixed.';
    target.format = body.format as Stream['format'];
  }
  if (body.visibility !== undefined) {
    if (body.visibility !== 'public' && body.visibility !== 'private') return 'Visibility must be public or private.';
    target.visibility = body.visibility;
  }
  if (body.language !== undefined) {
    const value = String(body.language).trim();
    if (!LANGUAGE_TAG.test(value)) return 'A language must be a tag such as `en` or `es`.';
    target.language = value;
  }
  if (body.moderators !== undefined) {
    if (!Array.isArray(body.moderators) || body.moderators.length > 10) return 'Up to 10 moderators.';
    const ids: string[] = [];
    for (const raw of body.moderators) {
      const handle = String(raw).trim().replace(/^@/, '');
      const user = users.findByHandle(handle) ?? users.get(handle);
      if (!user) return `No account called @${handle}.`;
      if (user.id === hostId) continue;
      if (!ids.includes(user.id)) ids.push(user.id);
    }
    target.moderatorIds = ids;
  }
  if (body.mutedWords !== undefined) {
    if (!Array.isArray(body.mutedWords) || body.mutedWords.length > 50) return 'Up to 50 muted words.';
    const words = body.mutedWords.map((w) => String(w).trim().toLowerCase()).filter(Boolean);
    if (words.some((w) => w.length > 30)) return 'A muted word is at most 30 characters.';
    target.mutedWords = [...new Set(words)];
  }
  if (body.explicit !== undefined) {
    if (typeof body.explicit !== 'boolean') return 'explicit must be true or false.';
    target.explicit = body.explicit;
  }
  if (body.shipping !== undefined) {
    const raw = body.shipping as Record<string, unknown> | null;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'shipping must be an object.';
    const freePickup = raw.freePickup === undefined ? false : raw.freePickup;
    if (typeof freePickup !== 'boolean') return 'freePickup must be true or false.';
    let shippingCap: number | undefined;
    if (raw.shippingCap !== undefined && raw.shippingCap !== null && raw.shippingCap !== '') {
      shippingCap = Number(raw.shippingCap);
      if (!Number.isFinite(shippingCap) || shippingCap < 0 || shippingCap > 1000) return 'A shipping cap is between 0 and 1,000.';
      shippingCap = Math.round(shippingCap * 100) / 100;
    }
    target.shipping = { freePickup, shippingCap };
  }
  if (body.posterUrl !== undefined) {
    if (body.posterUrl === null || body.posterUrl === '') target.posterUrl = '';
    else {
      const checked = validateImage(body.posterUrl);
      if (!checked.ok) return `Thumbnail: ${checked.reason}`;
      target.posterUrl = checked.value;
    }
  }
  return null;
}

/**
 * Create (schedule) a show. The caller becomes the host. A seller must finish
 * seller onboarding first: the return address is what shipping is quoted from,
 * so a show without one could not sell anything.
 */
app.post('/api/streams', (req, res) => {
  const userId = actorId(req);
  const user = users.get(userId);
  if (!user) {
    res.status(401).json({ error: 'not_authenticated' });
    return;
  }
  if (!user.sellerProfile) {
    res.status(403).json({ error: 'seller_profile_required', detail: 'Finish seller setup (including your return address) before scheduling a show.' });
    return;
  }
  const upcoming = streams.byCreator(userId).filter((s) => s.status !== 'ended');
  if (upcoming.length >= 50) {
    res.status(429).json({ error: 'too_many_shows', detail: 'You can have up to 50 upcoming shows.' });
    return;
  }
  const draft: Partial<Stream> = {};
  const problem = applyShowFields((req.body ?? {}) as Record<string, unknown>, draft, true, userId);
  if (problem) {
    res.status(400).json({ error: 'invalid_show', detail: problem });
    return;
  }
  const stream = buildShow(user, draft);
  streams.create(stream);
  res.status(201).json({ stream: hostView(stream.id) });
});

/** A new scheduled show from validated fields. */
function buildShow(user: User, draft: Partial<Stream>, seriesId?: string): Stream {
  return {
    id: store.nextId('str'),
    creatorId: user.id,
    seriesId,
    moderatorIds: draft.moderatorIds ?? [],
    mutedWords: draft.mutedWords ?? [],
    explicit: draft.explicit ?? false,
    shipping: draft.shipping ?? { freePickup: false },
    reminderUserIds: [],
    title: draft.title!,
    category: draft.category!,
    subcategory: draft.subcategory,
    description: draft.description,
    format: draft.format ?? 'auction',
    visibility: draft.visibility ?? 'public',
    language: draft.language ?? preferencesFor(user).language,
    createdAt: store.iso(),
    scheduledStartTime: draft.scheduledStartTime!,
    status: 'scheduled',
    viewerCount: 0,
    peakViewerCount: 0,
    // No broadcast yet: playback resolves to "offline" until the host goes live.
    hlsUrl: '',
    posterUrl: draft.posterUrl ?? '',
    itemQueue: [],
    totalGMV: 0,
    chatEnabled: true,
  };
}

/** The host's own view of a show: the public shape plus their muted words. */
function hostView(streamId: string) {
  const stream = streams.get(streamId);
  const expanded = expandStream(streamId);
  if (!stream || !expanded) return null;
  return { ...expanded, mutedWords: stream.mutedWords ?? [] };
}

/**
 * Schedule a run of shows in one step (the guided scheduler's "every Tuesday and
 * Thursday for two weeks"). All-or-nothing: one bad time refuses the whole batch,
 * so a seller never ends up with half a schedule.
 */
app.post('/api/streams/batch', (req, res) => {
  const userId = actorId(req);
  const user = users.get(userId);
  if (!user) {
    res.status(401).json({ error: 'not_authenticated' });
    return;
  }
  if (!user.sellerProfile) {
    res.status(403).json({ error: 'seller_profile_required', detail: 'Finish seller setup (including your return address) before scheduling a show.' });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const times = Array.isArray(body.startTimes) ? body.startTimes.map(String) : [];
  if (times.length < 1 || times.length > 20) {
    res.status(400).json({ error: 'invalid_schedule', detail: 'Choose between 1 and 20 show times.' });
    return;
  }
  const upcoming = streams.byCreator(userId).filter((s) => s.status !== 'ended').length;
  if (upcoming + times.length > 50) {
    res.status(429).json({ error: 'too_many_shows', detail: 'You can have up to 50 upcoming shows.' });
    return;
  }
  const show = (typeof body.show === 'object' && body.show !== null ? body.show : {}) as Record<string, unknown>;
  const drafts: Partial<Stream>[] = [];
  for (const time of times) {
    const draft: Partial<Stream> = {};
    const problem = applyShowFields({ ...show, scheduledStartTime: time }, draft, true, userId);
    if (problem) {
      res.status(400).json({ error: 'invalid_show', detail: problem, at: time });
      return;
    }
    drafts.push(draft);
  }
  const sorted = drafts.map((d) => Date.parse(d.scheduledStartTime!)).sort((a, b) => a - b);
  if (sorted.some((t, i) => i > 0 && t - sorted[i - 1]! < 30 * 60_000)) {
    res.status(400).json({ error: 'invalid_schedule', detail: 'Shows must be at least 30 minutes apart.' });
    return;
  }
  const seriesId = times.length > 1 ? store.nextId('ser') : undefined;
  const created = drafts.map((draft) => {
    const stream = buildShow(user, draft, seriesId);
    streams.create(stream);
    return hostView(stream.id);
  });
  res.status(201).json({ streams: created, seriesId });
});

/**
 * Save a show and be notified when it goes live. Any signed-in viewer except the
 * host; only while the show is still scheduled.
 */
app.post('/api/streams/:id/remind', (req, res) => {
  const userId = actorId(req);
  if (!users.get(userId)) {
    res.status(401).json({ error: 'not_authenticated' });
    return;
  }
  // A private show is reachable by its link, so whoever holds the link may save it.
  const stream = streams.get(req.params.id);
  if (!stream) {
    res.status(404).json({ error: 'stream_not_found' });
    return;
  }
  if (stream.creatorId === userId) {
    res.status(400).json({ error: 'own_show', detail: 'You are hosting this show.' });
    return;
  }
  if (stream.status !== 'scheduled') {
    res.status(409).json({ error: 'show_not_scheduled', detail: 'Reminders are for shows that have not started.' });
    return;
  }
  const on = (req.body ?? {}).on !== false;
  const list = new Set(stream.reminderUserIds ?? []);
  if (on) list.add(userId);
  else list.delete(userId);
  stream.reminderUserIds = [...list].slice(0, 100_000);
  streams.save(stream);
  res.json({ ok: true, reminded: on, reminderCount: stream.reminderUserIds.length });
});

/** Edit a show that has not started. */
app.patch('/api/streams/:id', (req, res) => {
  const stream = requireHost(req, res, req.params.id);
  if (!stream) return;
  if (stream.status !== 'scheduled') {
    res.status(409).json({ error: 'show_not_editable', detail: 'Only a show that has not started can be edited.' });
    return;
  }
  const draft: Partial<Stream> = { category: stream.category };
  const problem = applyShowFields((req.body ?? {}) as Record<string, unknown>, draft, false, stream.creatorId);
  if (problem) {
    res.status(400).json({ error: 'invalid_show', detail: problem });
    return;
  }
  // A category change drops a subcategory that no longer belongs to it.
  if (draft.category !== stream.category && draft.subcategory === undefined) stream.subcategory = undefined;
  Object.assign(stream, draft);
  streams.save(stream);
  res.json({ stream: hostView(stream.id) });
});

/** Cancel a show that has not started. */
app.delete('/api/streams/:id', (req, res) => {
  const stream = requireHost(req, res, req.params.id);
  if (!stream) return;
  if (stream.status !== 'scheduled') {
    res.status(409).json({ error: 'show_not_cancellable', detail: 'A show that has started is ended, not cancelled.' });
    return;
  }
  stream.status = 'ended';
  stream.endTime = store.iso();
  stream.itemQueue = [];
  streams.save(stream);
  res.json({ ok: true, stream: expandStream(stream.id) });
});

/** The caller's own shows, upcoming first, then past. */
app.get('/api/me/streams', (req, res) => {
  const userId = actorId(req);
  if (!users.get(userId)) {
    res.status(401).json({ error: 'not_authenticated' });
    return;
  }
  const mine = streams.byCreator(userId).map((s) => hostView(s.id)!).filter(Boolean);
  const upcoming = mine.filter((s) => s.status !== 'ended').sort((a, b) => Date.parse(a.scheduledStartTime) - Date.parse(b.scheduledStartTime));
  const past = mine.filter((s) => s.status === 'ended').sort((a, b) => Date.parse(b.endTime ?? b.scheduledStartTime) - Date.parse(a.endTime ?? a.scheduledStartTime));
  res.json({ upcoming, past });
});

/**
 * Put one of the host's own listings into the show's run order. A listing can be
 * queued in one open show at a time, so a sale cannot happen twice.
 */
app.post('/api/streams/:id/items', (req, res) => {
  const stream = requireHost(req, res, req.params.id);
  if (!stream) return;
  if (stream.status === 'ended') {
    res.status(409).json({ error: 'show_ended' });
    return;
  }
  const auctionId = String((req.body ?? {}).auctionId ?? '');
  const auction = auctions.get(auctionId);
  if (!auction || auction.sellerId !== stream.creatorId) {
    res.status(404).json({ error: 'listing_not_found', detail: 'Only your own listings can be added to your show.' });
    return;
  }
  if (auction.status === 'sold' || auction.status === 'ended' || auction.status === 'cancelled') {
    res.status(409).json({ error: 'listing_closed', detail: 'That listing has already closed.' });
    return;
  }
  if (stream.itemQueue.includes(auction.id)) {
    res.json({ ok: true, stream: expandStream(stream.id) });
    return;
  }
  const elsewhere = streams.byCreator(stream.creatorId).find((s) => s.id !== stream.id && s.status !== 'ended' && s.itemQueue.includes(auction.id));
  if (elsewhere) {
    res.status(409).json({ error: 'listing_in_other_show', detail: `That listing is already in "${elsewhere.title}".` });
    return;
  }
  if (stream.itemQueue.length >= 500) {
    res.status(409).json({ error: 'queue_full', detail: 'A show can hold up to 500 items.' });
    return;
  }
  stream.itemQueue.push(auction.id);
  auction.streamId = stream.id;
  auctions.save(auction);
  streams.save(stream);
  res.status(201).json({ ok: true, stream: expandStream(stream.id) });
});

/** Take a listing out of the run order (not while it is the item on screen). */
app.delete('/api/streams/:id/items/:auctionId', (req, res) => {
  const stream = requireHost(req, res, req.params.id);
  if (!stream) return;
  if (stream.activeAuctionId === req.params.auctionId && stream.status === 'live') {
    res.status(409).json({ error: 'item_on_screen', detail: 'That item is running now.' });
    return;
  }
  stream.itemQueue = stream.itemQueue.filter((id) => id !== req.params.auctionId);
  const auction = auctions.get(req.params.auctionId);
  if (auction && auction.streamId === stream.id) {
    auction.streamId = undefined;
    auctions.save(auction);
  }
  streams.save(stream);
  res.json({ ok: true, stream: expandStream(stream.id) });
});

app.get('/api/streams', (req, res) => {
  const { status } = req.query as { status?: string };
  // A private show is reachable by its link, never listed.
  let list = streams.all().filter((s) => s.visibility !== 'private').map((s) => expandStream(s.id)).filter(Boolean);
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
  const viewer = actorId(req);
  res.json({
    stream,
    reminded: Boolean(viewer && streams.get(req.params.id)?.reminderUserIds?.includes(viewer)),
    chat: chat.get(req.params.id),
    queue: stream.itemQueue
      .map((id) => expandAuction(id))
      .filter((a): a is AuctionWithRelations => Boolean(a)),
  });
});

app.post('/api/streams/:id/items/:auctionId/activate', (req, res) => {
  const stream = requireHost(req, res, req.params.id);
  if (!stream) return;
  const auction = auctions.get(req.params.auctionId);
  // Only an item from this show's own run order can be put on screen.
  if (!auction || !stream.itemQueue.includes(auction.id) || auction.sellerId !== stream.creatorId) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  if (auction.status === 'sold' || auction.status === 'ended' || auction.status === 'cancelled') {
    res.status(409).json({ error: 'item_closed', detail: 'That item has already sold or closed.' });
    return;
  }
  // One item on screen at a time: the current one must finish first.
  const current = stream.activeAuctionId ? auctions.get(stream.activeAuctionId) : undefined;
  if (current && current.id !== auction.id && current.status === 'live' && Date.parse(current.endTime) > Date.now() && stream.video) {
    res.status(409).json({ error: 'item_running', detail: 'Wait for the item on screen to finish.' });
    return;
  }

  /**
   * The host sets how the item runs: a 5–120 second clock, a starting price
   * (only before anyone has bid), and optionally sudden death.
   */
  const options = (req.body ?? {}) as { seconds?: unknown; startingPrice?: unknown; suddenDeath?: unknown };
  let seconds: number = ITEM_TIMER.default;
  if (options.seconds !== undefined) {
    const value = Number(options.seconds);
    if (!Number.isInteger(value) || value < 5 || value > 120) {
      res.status(400).json({ error: 'invalid_timer', detail: 'A timer is 5 to 120 seconds.' });
      return;
    }
    seconds = value;
  }
  if (options.startingPrice !== undefined) {
    const price = Number(options.startingPrice);
    if (!Number.isFinite(price) || price < 1 || price > 1_000_000) {
      res.status(400).json({ error: 'invalid_price', detail: 'A starting price is between 1 and 1,000,000.' });
      return;
    }
    if (auction.bidCount > 0) {
      res.status(409).json({ error: 'price_locked', detail: 'The starting price cannot change after bidding has begun.' });
      return;
    }
    auction.startingPrice = money.round2(price);
  }
  if (options.suddenDeath !== undefined) {
    if (typeof options.suddenDeath !== 'boolean') {
      res.status(400).json({ error: 'invalid_option', detail: 'suddenDeath must be true or false.' });
      return;
    }
    auction.suddenDeath = options.suddenDeath;
  }

  const firstStart = !stream.actualStartTime;
  stream.activeAuctionId = auction.id;
  stream.status = 'live';
  stream.actualStartTime = stream.actualStartTime ?? store.iso();
  if (firstStart) notifyShowLive(stream);
  streams.save(stream);
  auction.status = 'live';
  auction.startTime = store.iso();
  auction.endTime = new Date(Date.now() + seconds * 1000).toISOString();
  auction.streamId = stream.id;
  auctions.save(auction);
  io.to(`stream:${stream.id}`).emit('stream:item', {
    streamId: stream.id,
    auctionId: auction.id,
    nextInQueue: stream.itemQueue.length,
  });
  res.json({ ok: true, stream: expandStream(stream.id), auction: expandAuction(auction.id) });
});

/** Tell everyone who saved the show that it has started. Once per show. */
function notifyShowLive(stream: Stream): void {
  const host = users.get(stream.creatorId);
  for (const userId of stream.reminderUserIds ?? []) {
    const notification = notifications.create({
      id: store.nextId('ntf'),
      userId,
      category: 'streams',
      title: `${host?.displayName ?? 'A seller you follow'} is live`,
      body: stream.title,
      href: `/stream/${stream.id}`,
      read: false,
      createdAt: store.iso(),
    });
    io.to(`user:${userId}`).emit('notification', notification);
  }
}

app.post('/api/streams/:id/end', (req, res) => {
  // Staff may end any show (the admin kill switch); everyone else only their own.
  const staff = isStaff(actorId(req));
  const stream = staff ? streams.get(req.params.id) : requireHost(req, res, req.params.id);
  if (!stream) {
    if (staff) res.status(404).json({ error: 'stream_not_found' });
    return;
  }
  if (stream.video) {
    void closeRoom(stream.video);
    stream.video = undefined;
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
  const order = requireOrderParticipant(req, res, req.params.id);
  if (!order) return;
  res.json({
    order,
    auction: expandAuction(order.auctionId),
    buyer: publicProfile(order.buyerId),
    seller: publicProfile(order.sellerId),
  });
});

app.post('/api/orders/:id/status', (req, res) => {
  const order = requireOrderParticipant(req, res, req.params.id);
  if (!order) return;

  /**
   * Fulfilment is the SELLER's action. A buyer marking their own order shipped
   * would defeat the escrow guarantee, since release depends on the seller having
   * dispatched the item.
   */
  if (actorId(req) !== order.sellerId) {
    res.status(403).json({ error: 'not_the_seller', detail: 'Only the seller may update fulfilment.' });
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
 * Dev-only email lookup.
 *
 * `/api/users/:handle` returns a public profile and deliberately omits the email,
 * so a verification suite has no way to assert account linkage without either a
 * leak or an endpoint like this. Refused in production with the other dev
 * controls, since the address is exactly what an enumeration attack wants.
 */
app.get('/api/dev/user-email', (req, res) => {
  if (process.env.NODE_ENV === 'production' && process.env.MM_ALLOW_DEMO_AUTH !== 'true') {
    res.status(403).json({ error: 'dev_controls_disabled' });
    return;
  }
  const userId = String((req.query as { userId?: string }).userId ?? '');
  const user = userId ? users.get(userId) : undefined;
  if (!user) {
    res.status(404).json({ error: 'user_not_found' });
    return;
  }
  res.json({ userId: user.id, email: user.email, handle: user.handle });
});

/**
 * Dev-only rate-limit reset.
 *
 * The verification suites deliberately drive endpoints to their limits, so a
 * previous run must not consume the next one's allowance. Refused in production
 * like the other dev controls — clearing limits there would be a bypass.
 */
app.post('/api/dev/rate-limit/reset', (_req, res) => {
  if (process.env.NODE_ENV === 'production' && process.env.MM_ALLOW_DEMO_AUTH !== 'true') {
    res.status(403).json({ error: 'dev_controls_disabled' });
    return;
  }
  resetRateLimits();
  res.json({ ok: true, ...limiterStatus() });
});

/**
 * Dev-only session minting.
 *
 * The realtime layer requires a verified identity, which is correct, but the
 * verification suites drive flows as several demo accounts at once to exercise
 * outbid routing and concurrency. Rather than weaken the socket guard, this
 * issues a real session for a named demo user — and it is refused in production
 * for the same reason the identity switch is, because otherwise it would be an
 * account-takeover primitive enabled by an environment variable.
 */
app.post('/api/dev/token', (req, res) => {
  if (process.env.NODE_ENV === 'production' && process.env.MM_ALLOW_DEMO_AUTH !== 'true') {
    res.status(403).json({ error: 'dev_controls_disabled' });
    return;
  }
  const { userId } = req.body as { userId?: string };
  const user = userId ? users.get(userId) : undefined;
  if (!user) {
    res.status(404).json({ error: 'user_not_found' });
    return;
  }
  const token = authService.issueSessionFor(user.id, 'dev');
  res.json({ ok: true, token, userId: user.id });
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

  // Private shows are shared by link only, so they stay out of the public guide.
  const events = streams.all().filter((s) => s.visibility !== 'private').sort(
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
  const order = requireOrderParticipant(req, res, req.params.id);
  if (!order) return;
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

  /**
   * The seller's books are read from the LEDGER, never re-derived.
   *
   * This endpoint previously recomputed everything with invented numbers:
   *
   *   • the seller fee was hardcoded at 10%, while the settlement charges a
   *     category rate (12% for luxury), so the balance overstated what the seller
   *     had actually earned — measured at $3.00 on a $150 hammer
   *   • a buyer's spend was subtracted from the SELLER's balance as `spent * 0.15`,
   *     charging a seller for their own unrelated purchases
   *   • `lifetimeGross` added a flat $120 per purchase, a figure that corresponds
   *     to nothing
   *   • each sale was reported at a flat 10% fee in the transaction list
   *
   * A payout record already carries the exact gross, fee and net that the
   * settlement computed, so the wallet reports those. Where no payout exists yet,
   * the same `sellerNetFor` the settlement uses is applied, which keeps one
   * definition of the fee instead of two that can disagree.
   */
  const sellerPayouts = payouts.bySeller(userId);
  const settledOrderIds = new Set(sellerPayouts.flatMap((payout) => payout.orderIds));

  /** Category per order, so a pending sale is valued at its own rate. */
  const categoryForOrder = (orderId: string): string | undefined => {
    const order = orders.get(orderId);
    if (!order) return undefined;
    const auction = auctions.get(order.auctionId);
    return auction ? items.get(auction.itemId)?.categoryId : undefined;
  };

  const released = sellerPayouts
    .filter((payout) => payout.status === 'processing' || payout.status === 'paid')
    .reduce((sum, payout) => sum + payout.netAmount, 0);

  const awaitingRelease = selling
    // Only sales without a payout are still in flight; counting both would
    // double-count a settled order.
    .filter((order) => !settledOrderIds.has(order.id))
    /**
     * A refunded sale is not money the seller will ever receive. Counting it
     * would inflate what they believe they are owed by the full net value of an
     * order that was returned.
     */
    .filter((order) => order.paymentStatus !== 'refunded')
    .reduce((sum, order) => sum + escrow.sellerNetFor(order, categoryForOrder(order.id)), 0);

  res.json({
    currency: users.get(userId)?.currencyCode ?? 'USD',
    /** Money the seller can draw: payouts the settlement has released. */
    available: money.round2(released),
    /** Money earned on sales whose escrow has not yet released. */
    pending: money.round2(awaitingRelease),
    /** Gross the seller has actually transacted, plus what they have bought. */
    lifetimeGross: money.round2(selling.reduce((sum, order) => sum + order.hammerPrice, 0)),
    payouts: sellerPayouts,
    transactions: [
      ...buying.map((o) => ({
        id: o.id,
        type: 'purchase' as const,
        label: `Purchase ${o.id}`,
        amount: -o.totalAmount,
        currency: o.currency,
        at: o.createdAt,
      })),
      ...selling.map((o) => {
        const payout = sellerPayouts.find((entry) => entry.orderIds.includes(o.id));
        /**
         * A refunded sale earned NOTHING.
         *
         * This previously reported the seller's net for every sale regardless of
         * outcome, so a fully refunded order still appeared in the ledger as
         * income — the seller's transaction list claimed money that had been
         * returned to the buyer.
         */
        // `refunded` is a payment status; OrderStatus has no such member.
        const refunded = o.paymentStatus === 'refunded';
        return {
          id: `${o.id}-sale`,
          type: 'sale' as const,
          label: refunded ? `Refunded ${o.id}` : `Sale ${o.id}`,
          /**
           * The settled net where a payout exists, otherwise the net the
           * settlement would produce — never a flat percentage, and never
           * anything at all for a refund.
           */
          amount: refunded ? 0 : payout ? payout.netAmount : escrow.sellerNetFor(o, categoryForOrder(o.id)),
          currency: o.currency,
          at: o.createdAt,
        };
      }),
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

  /**
   * The storefront being written is the CALLER's, always.
   *
   * This previously took the handle from the request body and saved against it,
   * so any authenticated user could overwrite any creator's shop by naming their
   * handle — demonstrated by renaming another account's storefront from an
   * unrelated session. A handle is public information, so it can never be the
   * authorization for a write.
   *
   * An explicit, mismatched handle is refused rather than ignored, so a client
   * that believes it is editing someone else's shop finds out instead of silently
   * editing its own.
   */
  const actor = actorId(req);
  const owner = users.get(actor);
  if (!owner) {
    res.status(401).json({ error: 'not_authenticated' });
    return;
  }
  if (body.handle && body.handle !== owner.handle) {
    res.status(403).json({
      error: 'not_your_storefront',
      detail: 'A storefront can only be saved by its owner.',
    });
    return;
  }
  const handle = owner.handle;
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

/* ── REST: account preferences (§9.1 Auth Service) ──────────────────────── */

/**
 * Resolve stored preferences against the documented defaults.
 *
 * Every read goes through this so a client never has to know which fields were
 * introduced when, and an account created before this existed behaves exactly like
 * a new one.
 */
function preferencesFor(user: User): UserPreferences {
  return {
    ...DEFAULT_USER_PREFERENCES,
    ...(user.preferences ?? {}),
    notifications: { ...(user.preferences?.notifications ?? {}) },
  };
}

const LANGUAGE_TAG = /^[a-z]{2}(-[A-Za-z]{2,8})?$/;

/** Notification switches a client may set, matching the settings screen. */
const NOTIFICATION_KEYS = ['outbid', 'streamStart', 'endingSoon', 'orderUpdates', 'priceDrops', 'marketing'] as const;

/**
 * Update the caller's own account.
 *
 * There was previously NO way to persist a profile change: the web settings screen
 * kept currency, language, privacy and notification choices in component state and
 * discarded them on navigation, and the mobile setup screen's save button was
 * literally `onPress={() => undefined}`. Users could change these and nothing
 * happened, which is worse than not offering them.
 *
 * Only the caller's own account can be written — the id comes from the session, not
 * the body — and every value is validated, because these fields are echoed back to
 * other users (display name, bio, privacy) and rendered by every client.
 */
app.patch('/api/me', (req, res) => {
  const userId = actorId(req);
  const user = users.get(userId);
  if (!user) {
    res.status(401).json({ error: 'not_authenticated' });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const changed: string[] = [];

  if (body.displayName !== undefined) {
    const value = String(body.displayName).trim();
    if (value.length < 2 || value.length > 40) {
      res.status(400).json({ error: 'invalid_display_name', detail: 'A display name is 2–40 characters.' });
      return;
    }
    user.displayName = value;
    changed.push('displayName');
  }

  if (body.bio !== undefined) {
    const value = String(body.bio).trim().slice(0, 280);
    user.bio = value;
    changed.push('bio');
  }

  if (body.countryCode !== undefined) {
    const value = String(body.countryCode).trim().toUpperCase();
    // ISO 3166-1 alpha-2; a free-text country would break tax and shipping quoting.
    if (!/^[A-Z]{2}$/.test(value)) {
      res.status(400).json({ error: 'invalid_country', detail: 'A country must be a two-letter ISO code.' });
      return;
    }
    user.countryCode = value;
    changed.push('countryCode');
  }

  if (body.currencyCode !== undefined) {
    const value = String(body.currencyCode).trim().toUpperCase();
    const supported = ['USD', 'GBP', 'EUR', 'NGN', 'CAD', 'KES', 'ZAR'];
    if (!supported.includes(value)) {
      res.status(400).json({ error: 'unsupported_currency', detail: `Currency must be one of ${supported.join(', ')}.` });
      return;
    }
    user.currencyCode = value as User['currencyCode'];
    changed.push('currencyCode');
  }

  if (body.avatarUrl !== undefined) {
    // Reuse the image rules, so an avatar cannot smuggle what a listing cannot.
    const checked = validateImage(body.avatarUrl);
    if (!checked.ok) {
      res.status(400).json({ error: 'invalid_avatar', detail: checked.reason });
      return;
    }
    user.avatarUrl = checked.value;
    changed.push('avatarUrl');
  }

  if (body.preferences !== undefined) {
    const incoming = body.preferences as Record<string, unknown>;
    if (typeof incoming !== 'object' || incoming === null || Array.isArray(incoming)) {
      res.status(400).json({ error: 'invalid_preferences', detail: 'preferences must be an object.' });
      return;
    }

    const current = preferencesFor(user);

    if (incoming.publicProfile !== undefined) {
      if (typeof incoming.publicProfile !== 'boolean') {
        res.status(400).json({ error: 'invalid_preference', detail: 'publicProfile must be a boolean.' });
        return;
      }
      current.publicProfile = incoming.publicProfile;
    }

    if (incoming.bidHistoryPublic !== undefined) {
      if (typeof incoming.bidHistoryPublic !== 'boolean') {
        res.status(400).json({ error: 'invalid_preference', detail: 'bidHistoryPublic must be a boolean.' });
        return;
      }
      current.bidHistoryPublic = incoming.bidHistoryPublic;
    }

    if (incoming.language !== undefined) {
      const value = String(incoming.language).trim();
      if (!LANGUAGE_TAG.test(value)) {
        res.status(400).json({ error: 'invalid_language', detail: 'A language must be a tag such as `en` or `en-GB`.' });
        return;
      }
      current.language = value;
    }

    if (incoming.interests !== undefined) {
      /**
       * Interests are validated against the platform's OWN category list rather
       * than accepted as free text: they drive which lots a user is shown, so an
       * arbitrary value would be a stored string nothing could ever match.
       */
      if (!Array.isArray(incoming.interests)) {
        res.status(400).json({ error: 'invalid_preference', detail: 'interests must be an array.' });
        return;
      }
      const known = new Set<string>(categories.map((entry) => String(entry.id)));
      const chosen = incoming.interests.map((value) => String(value));
      const unknown = chosen.filter((value) => !known.has(value));
      if (unknown.length) {
        res.status(400).json({ error: 'unknown_interest', detail: `Unknown categor${unknown.length > 1 ? 'ies' : 'y'}: ${unknown.slice(0, 3).join(', ')}` });
        return;
      }
      // Bounded so the stored document cannot grow without limit.
      current.interests = [...new Set(chosen)].slice(0, 12);
    }

    if (incoming.notifications !== undefined) {
      const list = incoming.notifications as Record<string, unknown>;
      if (typeof list !== 'object' || list === null || Array.isArray(list)) {
        res.status(400).json({ error: 'invalid_preference', detail: 'notifications must be an object.' });
        return;
      }
      const merged = { ...(current.notifications ?? {}) };
      for (const [key, value] of Object.entries(list)) {
        /**
         * A key must be a known notification category and the value a boolean.
         * Accepting arbitrary keys would let a client grow the stored document
         * without bound.
         */
        /**
         * The same keys the clients render. A separate server-side vocabulary would
         * drift, and then a switch the user flips would be rejected as unknown.
         */
        if (!NOTIFICATION_KEYS.includes(key as (typeof NOTIFICATION_KEYS)[number])) {
          res.status(400).json({ error: 'unknown_notification_type', detail: `Unknown notification type: ${key}` });
          return;
        }
        if (typeof value !== 'boolean') {
          res.status(400).json({ error: 'invalid_preference', detail: `${key} must be a boolean.` });
          return;
        }
        merged[key] = value;
      }
      current.notifications = merged;
    }

    user.preferences = current;
    changed.push('preferences');
  }

  if (!changed.length) {
    res.status(400).json({ error: 'nothing_to_update', detail: 'Send at least one field to change.' });
    return;
  }

  users.upsert(user);
  res.json({
    ok: true,
    changed,
    user,
    profile: publicProfile(user.id),
    preferences: preferencesFor(user),
  });
});

/* ── Seller onboarding ─────────────────────────────────────────────────── */

const SELLER_BUSINESS_TYPES = ['reseller', 'liquidator', 'brand', 'retailer', 'consignment', 'other'] as const;
const SELLER_CHANNELS = ['website', 'social', 'store', 'marketplaces', 'none'] as const;
const SOCIAL_NETWORKS = ['instagram', 'tiktok', 'youtube', 'twitch', 'x', 'facebook', 'other'] as const;
const BAND = /^[a-z0-9_+-]{1,24}$/;

function readAddress(raw: unknown): PostalAddress | string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'A return address is required.';
  const a = raw as Record<string, unknown>;
  const text = (key: string, min: number, max: number) => {
    const value = String(a[key] ?? '').trim();
    return value.length >= min && value.length <= max ? value : null;
  };
  const fullName = text('fullName', 2, 80);
  const line1 = text('line1', 3, 120);
  const city = text('city', 2, 80);
  const region = text('region', 1, 80);
  const postalCode = text('postalCode', 2, 16);
  const countryCode = String(a.countryCode ?? '').trim().toUpperCase();
  if (!fullName) return 'Enter your legal name as it appears on your ID.';
  if (!line1) return 'Enter the street address.';
  if (/\b(p\.?\s*o\.?\s*box|post office box)\b/i.test(line1)) return 'A return address cannot be a PO box.';
  if (!city) return 'Enter the city.';
  if (!region) return 'Enter the state, province or region.';
  if (!postalCode) return 'Enter the postal code.';
  if (!/^[A-Z]{2}$/.test(countryCode)) return 'A country must be a two-letter ISO code.';
  const line2 = a.line2 === undefined ? undefined : String(a.line2).trim().slice(0, 120) || undefined;
  return { fullName, line1, line2, city, region, postalCode, countryCode };
}

/**
 * Save seller onboarding. Becoming a seller is self-service; this records who the
 * seller is and where they ship from. The address is private to the account.
 */
app.put('/api/me/seller-profile', (req, res) => {
  const userId = actorId(req);
  const user = users.get(userId);
  if (!user) {
    res.status(401).json({ error: 'not_authenticated' });
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const fail = (detail: string) => res.status(400).json({ error: 'invalid_seller_profile', detail });

  if (body.entity !== 'individual' && body.entity !== 'business') return void fail('Choose individual or registered business.');
  let businessType: SellerProfile['businessType'];
  if (body.businessType !== undefined && body.businessType !== null && body.businessType !== '') {
    if (!SELLER_BUSINESS_TYPES.includes(body.businessType as (typeof SELLER_BUSINESS_TYPES)[number])) return void fail('Unknown business type.');
    businessType = body.businessType as SellerProfile['businessType'];
  }
  if (body.entity === 'business' && !businessType) return void fail('Choose what best describes your business.');
  if (!isCategory(body.mainCategory)) return void fail('Choose the category you will sell in most.');
  const mainCategory = body.mainCategory;
  const subs = Array.isArray(body.subcategories) ? body.subcategories.map(String) : [];
  if (subs.some((id) => !isSubcategoryOf(id, mainCategory))) return void fail('A subcategory does not belong to your main category.');
  const channels = Array.isArray(body.channels) ? body.channels.map(String) : [];
  if (channels.some((c) => !SELLER_CHANNELS.includes(c as (typeof SELLER_CHANNELS)[number]))) return void fail('Unknown sales channel.');
  const socials: Record<string, string> = {};
  if (body.socials !== undefined) {
    if (typeof body.socials !== 'object' || body.socials === null || Array.isArray(body.socials)) return void fail('socials must be an object.');
    for (const [network, handle] of Object.entries(body.socials as Record<string, unknown>)) {
      if (!SOCIAL_NETWORKS.includes(network as (typeof SOCIAL_NETWORKS)[number])) return void fail(`Unknown social network: ${network}`);
      const value = String(handle ?? '').trim().replace(/^@/, '');
      if (!value) continue;
      if (!/^[A-Za-z0-9._-]{1,40}$/.test(value)) return void fail(`That ${network} username does not look right.`);
      socials[network] = value;
    }
  }
  const band = (key: string): string | undefined | false => {
    const value = body[key];
    if (value === undefined || value === null || value === '') return undefined;
    return BAND.test(String(value)) ? String(value) : false;
  };
  const monthlyRevenue = band('monthlyRevenue');
  const inventorySize = band('inventorySize');
  const teamSize = band('teamSize');
  const weeklyLiveHours = band('weeklyLiveHours');
  if ([monthlyRevenue, inventorySize, teamSize, weeklyLiveHours].includes(false)) return void fail('An answer was not one of the offered options.');
  const address = readAddress(body.returnAddress);
  if (typeof address === 'string') return void fail(address);

  const now = store.iso();
  const profile: SellerProfile = {
    entity: body.entity,
    businessType,
    mainCategory,
    subcategories: [...new Set(subs)].slice(0, 12),
    channels: [...new Set(channels)],
    socials,
    monthlyRevenue: monthlyRevenue || undefined,
    inventorySize: inventorySize || undefined,
    teamSize: teamSize || undefined,
    weeklyLiveHours: weeklyLiveHours || undefined,
    returnAddress: address,
    completedAt: user.sellerProfile?.completedAt ?? now,
    updatedAt: now,
  };
  user.sellerProfile = profile;
  if (user.role === 'buyer') user.role = 'seller';
  users.upsert(user);
  res.json({ ok: true, sellerProfile: profile, user });
});

app.get('/api/me/seller-profile', (req, res) => {
  const user = users.get(actorId(req));
  if (!user) {
    res.status(401).json({ error: 'not_authenticated' });
    return;
  }
  res.json({ sellerProfile: user.sellerProfile ?? null });
});

/** The caller's own account, including preferences the public profile omits. */
app.get('/api/me', (req, res) => {
  const userId = actorId(req);
  const user = users.get(userId);
  if (!user) {
    res.status(401).json({ error: 'not_authenticated' });
    return;
  }
  res.json({
    user,
    profile: publicProfile(user.id),
    preferences: preferencesFor(user),
  });
});

/**
 * The caller's own data, as a download.
 *
 * NDPR, CCPA, UK GDPR and PIPEDA all grant a right of access, and the settings
 * screen has always claimed to honour it — but the button only raised a toast
 * promising an archive "within 30 days" and nothing was ever produced. A promise
 * that cannot be kept is worse than a smaller promise that is.
 *
 * This returns the data immediately, scoped to the caller, with credentials
 * excluded: a session token in an archive is a live credential in a file the user
 * will email around.
 */
app.get('/api/me/export', (req, res) => {
  const userId = actorId(req);
  const user = users.get(userId);
  if (!user) {
    res.status(401).json({ error: 'not_authenticated' });
    return;
  }

  const asBuyer = orders.buying(userId);
  const asSeller = orders.selling(userId);

  const archive = {
    exportedAt: store.iso(),
    notice: 'This is every record MoneyMart holds about your account. Session tokens and linked sign-in identities are deliberately excluded.',
    account: {
      id: user.id,
      email: user.email,
      phone: user.phone ?? null,
      displayName: user.displayName,
      handle: user.handle,
      bio: user.bio ?? null,
      countryCode: user.countryCode,
      currencyCode: user.currencyCode,
      role: user.role,
      isPro: user.isPro,
      verificationStatus: user.verificationStatus,
      kycLevel: user.kycLevel,
      preferences: preferencesFor(user),
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt ?? null,
    },
    /**
     * Bids are stored per AUCTION, so the caller's own bids are gathered across
     * every lot rather than read from a per-bidder index that does not exist.
     */
    bids: auctions
      .all()
      .flatMap((auction) => auctions.bids(auction.id).filter((bid) => bid.bidderId === userId))
      .map((bid) => ({
        id: bid.id,
        auctionId: bid.auctionId,
        amount: bid.amount,
        status: bid.status,
        placedAt: bid.timestamp,
      })),
    orders: { buying: asBuyer, selling: asSeller },
    payouts: payouts.bySeller(userId),
    notifications: notifications.forUser(userId),
    listings: auctions.bySeller(userId),
  };

  /**
   * `Content-Disposition` so a browser saves it rather than rendering JSON, and a
   * dated filename so several exports are distinguishable.
   */
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="moneymart-account-${user.handle}-${store.iso().slice(0, 10)}.json"`);
  res.send(JSON.stringify(archive, null, 2));
});

/* ── REST: social sign-in (§9.1 Auth Service) ───────────────────────────── */

/**
 * Which social providers are usable, so a client renders only the buttons that
 * can work instead of offering a sign-in that dead-ends.
 */
app.get('/api/auth/oauth/providers', (_req, res) => {
  res.json({ providers: oauthService.status() });
});

/**
 * Begin a flow. Answers with the provider URL rather than redirecting, so the
 * web app can drive a popup and the mobile app can open a system browser — the
 * two platforms need different presentation for the same exchange.
 */
app.post('/api/auth/oauth/:provider/start', rateLimit(POLICIES.authVerify), (req, res) => {
  const { provider } = req.params;
  const redirect = String((req.body as { redirect?: string } | undefined)?.redirect ?? '/');
  const result = oauthService.begin(provider, redirect);

  if ('error' in result) {
    const status = result.error === 'unknown_provider' ? 404 : 503;
    res.status(status).json({
      error: result.error,
      detail:
        result.error === 'provider_not_configured'
          ? `${provider} sign-in is not configured on this deployment.`
          : `Unknown provider: ${provider}`,
    });
    return;
  }

  res.json({ url: result.url, state: result.state });
});

/**
 * Complete a flow.
 *
 * The provider redirects the BROWSER here, so this endpoint cannot rely on the
 * app's usual headers. On success it hands the session token back in the URL
 * **fragment**: a fragment is not sent to any server, so it stays out of access
 * logs, proxy logs and Referer headers, which a query parameter would not.
 *
 * GET is supported for Google's query-string redirect and for a user who
 * refreshes; Apple posts a form.
 */
async function oauthCallback(req: Request, res: Response): Promise<void> {
  const { provider } = req.params;
  const source = { ...(req.query as Record<string, unknown>), ...(req.body as Record<string, unknown>) };
  const code = typeof source.code === 'string' ? source.code : '';
  const state = typeof source.state === 'string' ? source.state : '';

  const failTo = (appPath: string, reason: string) =>
    res.redirect(`${appPath}${appPath.includes('?') ? '&' : '?'}auth_error=${encodeURIComponent(reason)}`);

  // The provider may report a refusal instead of a code.
  const providerError = typeof source.error === 'string' ? source.error : '';
  if (providerError) {
    failTo('/', `provider_${providerError}`);
    return;
  }
  if (!code || !state) {
    failTo('/', 'missing_code_or_state');
    return;
  }

  // Single-use, so a replayed state cannot mint a second session.
  const flow = oauthService.consume(state);
  if (!flow || flow.provider !== provider) {
    failTo('/', 'invalid_or_expired_state');
    return;
  }

  try {
    const profile = await oauthService.complete(flow, code);
    const identityKey = `${provider}:${profile.subject}`;

    /**
     * Resolve the account.
     *
     * Linking by email is only allowed when the PROVIDER asserts the address is
     * verified. Accepting an unverified address would let anyone who can register
     * `victim@example.com` at a loose provider take over the MoneyMart account
     * that owns it.
     */
    let userId = store.db.oauthIdentities.get(identityKey);
    if (!userId) {
      const existing = profile.email && profile.emailVerified ? users.findByEmail(profile.email) : undefined;
      if (existing) {
        userId = existing.id;
      } else {
        // A stable id derived from the identity, so a concurrent callback for the
        // same person converges on one account rather than racing to create two.
        userId = `usr_${createHash('sha256').update(identityKey).digest('hex').slice(0, 12)}`;
        users.ensure(userId, { email: profile.email ?? `${profile.subject}@${provider}.oauth` });
      }
      store.db.oauthIdentities.set(identityKey, userId);
    }

    const user = users.ensure(userId, { email: profile.email });
    // Fill in what the provider gave us, without overwriting anything the user
    // has since set themselves.
    let changed = false;
    if (profile.displayName && (!user.displayName || /^[A-Z0-9_]{4,10}$/.test(user.displayName))) {
      user.displayName = profile.displayName;
      changed = true;
    }
    if (profile.avatarUrl && !user.avatarUrl) {
      user.avatarUrl = profile.avatarUrl;
      changed = true;
    }
    if (profile.email && profile.emailVerified && user.email.endsWith('@moneymart.demo')) {
      user.email = profile.email;
      changed = true;
    }
    if (changed) users.upsert(user);

    const token = authService.issueSessionFor(user.id, 'oauth');

    /**
     * Fragment, not query: a fragment is never sent to a server, so the token
     * stays out of access logs, proxy logs and Referer headers.
     *
     * `redirect` is validated as an in-app path so the callback cannot be turned
     * into an open redirect. MM_OAUTH_APP_ORIGIN is separate and operator-set: the
     * app is a different origin from the gateway when the web build is served
     * anywhere other than the API (Vercel, a preview, or the web dev server), and
     * without it the browser would receive the handoff on the API origin, which
     * has no app to consume it.
     */
    const target = flow.redirect.startsWith('/') && !flow.redirect.startsWith('//') ? flow.redirect : '/';
    const appOrigin = (process.env.MM_OAUTH_APP_ORIGIN ?? '').replace(/\/$/, '');
    res.redirect(`${appOrigin}${target}#token=${encodeURIComponent(token)}&provider=${provider}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'exchange_failed';
    console.warn(`  [oauth] ${provider} exchange failed: ${detail}`);
    failTo('/', detail.startsWith('google_') || detail.startsWith('apple_') ? detail : 'exchange_failed');
  }
}

app.get('/api/auth/oauth/:provider/callback', oauthCallback);
// Apple posts the authorization response as a form.
app.post('/api/auth/oauth/:provider/callback', express.urlencoded({ extended: false }), oauthCallback);

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

  /**
   * Bid placement.
   *
   * The bidder is the AUTHENTICATED identity, never `payload.bidderId`. Taking it
   * from the payload is what allowed an anonymous client to bid as any user; the
   * payload field is now ignored outright rather than merely validated, so no
   * future caller can reintroduce the hole by sending it.
   */
  socket.on('auction:placeBid', (payload) => {
    const bidderId = socketUserId(socket);
    if (!bidderId) {
      socket.emit('auction:rejected', {
        auctionId: payload?.auctionId ?? '',
        reason: 'not_authenticated',
        message: 'Sign in to place a bid.',
        minimumBid: 0,
      });
      return;
    }
    const events = engine.placeBid({ ...payload, bidderId });
    broadcast(events);
  });

  socket.on('auction:autoBid', (payload) => {
    const bidderId = socketUserId(socket);
    if (!bidderId) {
      socket.emit('auction:rejected', {
        auctionId: payload?.auctionId ?? '',
        reason: 'not_authenticated',
        message: 'Sign in to set a maximum bid.',
        minimumBid: 0,
      });
      return;
    }
    const events = engine.setAutoBid({ ...payload, bidderId });
    broadcast(events);
  });

  socket.on('auction:autoBidOff', (payload) => {
    const bidderId = socketUserId(socket);
    if (!bidderId) return;
    // Scoped to the caller: cancelling someone else's proxy bid must be impossible.
    engine.cancelAutoBid(payload.auctionId, bidderId);
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
    const userId = socketUserId(socket);
    if (!userId) return;
    const author = users.get(userId);
    const room = streams.get(payload.streamId);
    const body = String(payload.body ?? '').slice(0, 400);
    /**
     * The host's muted words: a matching message is not stored or broadcast. The
     * sender is not told, so the filter cannot be probed word by word.
     */
    if (room?.mutedWords?.length && room.creatorId !== userId) {
      const lower = body.toLowerCase();
      if (room.mutedWords.some((word) => lower.includes(word))) return;
    }
    // The author is the authenticated user, so a display name or creator badge
    // cannot be forged by the payload.
    const message = chat.addChat({
      id: store.nextId('msg'),
      streamId: payload.streamId,
      userId,
      displayName: author?.displayName ?? 'Member',
      body,
      isPinned: false,
      isCreator: streams.get(payload.streamId)?.creatorId === userId,
      createdAt: store.iso(),
    });
    io.to(`stream:${payload.streamId}`).emit('chat:message', message);
  });

  socket.on('chat:pin', (payload) => {
    const userId = socketUserId(socket);
    const owner = streams.get(payload.streamId)?.creatorId;
    // Only the creator of the room may pin, or any viewer could control the room.
    if (!userId || (owner && owner !== userId)) return;
    const list = chat.get(payload.streamId);
    const target = list.find((m) => m.id === payload.messageId) ?? null;
    chat.pin(payload.streamId, target?.id ?? null);
    io.to(`stream:${payload.streamId}`).emit('chat:pin', { streamId: payload.streamId, message: target });
  });

  socket.on('user:join', (requested: string) => {
    /**
     * Personal rooms carry outbid alerts and order notifications. Joining
     * someone else's room would leak their private events, so the requested id is
     * ignored in favour of the authenticated one.
     */
    const userId = socketUserId(socket);
    if (!userId) return;
    socket.join(`user:${userId}`);
    void requested;
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

app.use((error: Error & { type?: string; status?: number }, req: Request, res: Response, next: NextFunction) => {
  /**
   * A payload over the limit is a CLIENT error, not a server fault.
   *
   * Express's body parser threw this and the generic handler reported 500, which
   * misleads the caller and pollutes error tracking with what is really a bad
   * request. 413 with a specific reason lets a client shrink the payload.
   */
  if (error?.type === 'entity.too.large' || error?.status === 413) {
    res.status(413).json({
      error: 'payload_too_large',
      detail: 'The request body is too large. Send smaller or fewer images.',
    });
    return;
  }
  if (error?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'malformed_json', detail: 'The request body is not valid JSON.' });
    return;
  }
  next(error);
});

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

/**
 * Restore before seeding.
 *
 * The order matters: seeding writes the demo auction house into the store, so
 * doing it first would overwrite a restored snapshot with demo data and lose
 * every real listing, bid and escrow record on each restart. The store is only
 * seeded when there is genuinely nothing to restore.
 */
const persistence = createPersistence();
const restoredRecords = persistence ? await persistence.restore() : 0;

if (shouldSeed(restoredRecords)) {
  seed();
} else if (restoredRecords > 0 && process.env.MM_SEED !== 'false') {
  console.log(`  Restored ${restoredRecords} records; skipping the demo seed so live data is not overwritten.`);
} else if (process.env.MM_SEED === 'false') {
  console.log('  MM_SEED=false — starting without demo data.');
}

persistence?.start();
startLimiterSweep();
startAiCompany();

/**
 * Expired codes and sessions are swept on an interval. Unref'd so the timer
 * never keeps the process alive on its own.
 */
const authSweep = setInterval(() => {
  const swept = authService.sweep();
  if (swept.challenges || swept.sessions) {
    console.log(`[auth] swept ${swept.challenges} expired code(s), ${swept.sessions} expired session(s)`);
  }
}, 5 * 60 * 1000);
authSweep.unref?.();

http.listen(PORT, () => {
  const live = streams.live();
  console.log(`\n  MoneyMart API  •  Bid. Stream. Win.`);
  console.log(`  REST + WebSocket  →  ${tlsEnabled ? 'https' : 'http'}://127.0.0.1:${PORT}`);
  console.log(`  Live streams: ${live.length}   Live auctions: ${auctions.active().length}   Users: ${users.all().length}`);
  console.log(`  Anti-snipe: ${ANTI_SNIPE.triggerWindowMs / 1000}s window → +${ANTI_SNIPE.extensionMs / 1000}s`);
  console.log(`  CORS allowlist: ${allowedOrigins.size} explicit origin(s), vercel previews ${process.env.MM_ALLOW_VERCEL_PREVIEWS === 'false' ? 'blocked' : 'allowed'}`);
  console.log(`  Rate limiting: on (${limiterStatus().keys} active bucket(s) at boot)`);
  console.log(
    `  Auth: passwordless OTP — demo header ${authService.demoHeaderAllowed() ? 'ALLOWED' : 'refused'}` +
      (authService.demoHeaderAllowed() ? (process.env.NODE_ENV === 'production' ? ' (MM_ALLOW_DEMO_AUTH=true)' : ' (non-production)') : ''),
  );
  const channels = deliveryConfigured();
  if (!channels.sms && !channels.email) {
    console.log('  Auth delivery: NONE CONFIGURED — sign-in codes are generated but cannot be sent');
  } else {
    console.log(`  Auth delivery: ${[channels.sms ? 'Twilio (SMS)' : null, channels.email ? 'Resend (email)' : null].filter(Boolean).join(' + ')}`);
  }
  console.log(`  Auth codes exposed in responses: ${process.env.MM_AUTH_DEV_CODES === 'true' || (process.env.MM_AUTH_DEV_CODES !== 'false' && process.env.NODE_ENV !== 'production') ? 'yes (development)' : 'no'}`);
  if (persistence) {
    const status = persistence.status();
    console.log(
      `  Persistence: ${status.adapter} every ${status.intervalMs / 1000}s` +
        (status.lastSavedAt ? ` (last snapshot ${status.lastSavedAt})` : ' (no snapshot yet)'),
    );
    if (status.lastError) console.log(`    last error: ${status.lastError}`);
  } else {
    console.log('  Persistence: disabled (MM_PERSISTENCE=off) — the store is volatile');
  }
  if (staticResult.mounted.length) {
    console.log('  Serving clients:');
    staticResult.mounted.forEach((entry) => console.log(`    ${entry}`));
  }
  console.log('');
});

export { app, http, io };

/* ── Shutdown ──────────────────────────────────────────────────────────────
   Flush the final snapshot so a normal restart or redeploy does not depend on
   the interval happening to have fired. Railway sends SIGTERM before replacing a
   container, which is the common case this covers.
   ──────────────────────────────────────────────────────────────────────────*/
let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n  ${signal} received — flushing snapshot and closing.`);
    clearInterval(authSweep);
    void persistence
      ?.close()
      .catch((error) => console.error('[shutdown] flush failed:', error))
      .finally(() => {
        http.close(() => process.exit(0));
        // Do not hang forever if a socket refuses to close.
        setTimeout(() => process.exit(0), 5000).unref();
      });
  });
}
