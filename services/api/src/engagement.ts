/**
 * Wave B — engagement in the live room and the seller's tools.
 *
 * - Prize Drops: the host (or a moderator) runs a giveaway in a show; signed-in viewers with a shipping address
 *   enter; the draw picks one entrant at random and makes a free order the seller ships like any other.
 * - Tips: a viewer tips the host (charged like every other payment; simulated until real cards are live).
 * - Reactions, join lines and the first-purchase celebration: short live events in the room.
 * - Seller Studio: orders to ship, payouts, account health and the commission tier.
 * - Category feed: what is live and for sale in a category, sorted Popular / New / Buy It Now.
 * - Watchlist: saved listings kept on the account, so they follow the member to every device.
 */
import type { Express, Request, Response } from 'express';
import type { Order, Stream } from '@moneymart/types';
import { categoryTree } from '@moneymart/tokens';
import {
  addresses, auctions, blocks, db, follows, items, notifications, onOrderCreated, orders, payouts, store, streams, users,
  type Giveaway, type Tip,
} from './store.js';
import { canModerate } from './community.js';
import { getEscrow, markPrepaid, openEscrow } from './engine/escrow.js';
import { money } from './engine/money.js';
import { canBuyIn, marketOf } from './engine/markets.js';
import { valueOf } from './ai/registry.js';
import { TIERS, tierFor } from './engine/commission.js';

type ActorFn = (req: Request) => string;
type Emit = (room: string, event: string, payload: unknown) => void;
export interface EngagementDeps {
  actorId: ActorFn;
  emit: Emit;
  expandStream: (id: string) => unknown;
  expandAuction: (id: string) => unknown;
}

const REACTIONS = ['🔥', '❤️', '😂', '👏', '😮', '💰'] as const;
const reactedAt = new Map<string, number>();
const joinedAt = new Map<string, number>();

function signedIn(req: Request, res: Response, actorId: ActorFn): string | null {
  const id = actorId(req);
  if (!id || !users.get(id)) {
    res.status(401).json({ error: 'not_authenticated' });
    return null;
  }
  return id;
}

function notify(userId: string, category: 'orders' | 'streams' | 'system' | 'bids', title: string, body: string, href: string) {
  notifications.create({ id: store.nextId('ntf'), userId, category, title, body, href, read: false, createdAt: store.iso() });
}

/** Currency a seller is paid in: their country's market currency. */
export function sellerCurrency(sellerId: string): string {
  const user = users.get(sellerId);
  const code = user?.sellerProfile?.returnAddress?.countryCode?.toUpperCase() ?? user?.countryCode ?? 'US';
  return marketOf(code)?.currency ?? 'USD';
}

function giveawayView(g: Giveaway, viewerId: string) {
  return {
    id: g.id,
    streamId: g.streamId,
    title: g.title,
    image: g.image ?? null,
    followersOnly: g.followersOnly,
    status: g.status,
    entrantCount: g.entrants.length,
    entered: Boolean(viewerId && g.entrants.includes(viewerId)),
    winnerHandle: g.winnerId ? users.get(g.winnerId)?.handle ?? null : null,
    youWon: Boolean(viewerId && g.winnerId === viewerId),
    orderId: viewerId && (g.winnerId === viewerId || g.sellerId === viewerId) ? g.orderId ?? null : null,
    createdAt: g.createdAt,
    drawnAt: g.drawnAt ?? null,
  };
}

/** Why a member can't enter a Prize Drop, or null. */
function entryBlocker(g: Giveaway, userId: string): string | null {
  if (g.status !== 'open') return 'This Prize Drop has closed.';
  if (g.sellerId === userId) return 'Hosts can’t enter their own Prize Drop.';
  if (blocks.between(g.sellerId, userId)) return 'You can’t enter this Prize Drop.';
  if (g.followersOnly && !follows.is(userId, g.sellerId)) return 'Follow the host to enter this Prize Drop.';
  const address = addresses.defaultFor(userId);
  if (valueOf<boolean>('buyers.address_required') && !address) return 'Add a shipping address first, so the prize can reach you.';
  if (address && !canBuyIn(address.countryCode)) return `Prizes can’t ship to ${marketOf(address.countryCode)?.name ?? address.countryCode} yet.`;
  return null;
}

/** Creates the winner's free order: same ship → confirm path as a sale, nothing to pay. */
function prizeOrder(g: Giveaway, winnerId: string): Order {
  const address = addresses.defaultFor(winnerId);
  const order = orders.create({
    id: store.nextId('ord'),
    auctionId: `prize:${g.id}`,
    buyerId: winnerId,
    sellerId: g.sellerId,
    hammerPrice: 0,
    buyersPremium: 0,
    shipping: 0,
    tax: 0,
    totalAmount: 0,
    currency: sellerCurrency(g.sellerId) as Order['currency'],
    paymentStatus: 'paid',
    orderStatus: 'processing',
    paidAt: store.iso(),
    title: g.title,
    source: 'prize_drop',
    streamId: g.streamId,
    shippingNote: 'Prize Drop — free, shipping paid by the host',
    shipToName: address?.fullName,
    shippingAddress: address
      ? { line1: address.line1, line2: address.line2, city: address.city, region: address.region, postalCode: address.postalCode, countryCode: address.countryCode }
      : undefined,
    createdAt: store.iso(),
  });
  openEscrow({ order, buyerCountry: address?.countryCode, sellerCountry: users.get(g.sellerId)?.countryCode });
  markPrepaid(order, g.sellerId, 'Prize Drop');
  return order;
}

/** Account health: the four promises a seller keeps, from their real orders. */
export function accountHealth(sellerId: string) {
  const sold = orders.selling(sellerId).filter((o) => o.paymentStatus === 'paid' || o.paymentStatus === 'refunded');
  const pct = (good: number, total: number) => (total ? Math.round((good / total) * 100) : 100);
  const paidAt = (o: Order) => o.paidAt ?? getEscrow(o.id)?.history.find((h) => h.state === 'in_escrow')?.at ?? o.createdAt;
  const shipped = sold.filter((o) => o.shippedAt);
  const onTime = shipped.filter((o) => Date.parse(o.shippedAt!) - Date.parse(paidAt(o)) <= 3 * 86_400_000).length;
  const late = sold.filter((o) => !o.shippedAt && ['pending', 'processing'].includes(o.orderStatus) && Date.now() - Date.parse(paidAt(o)) > 3 * 86_400_000).length;
  const refunded = sold.filter((o) => o.paymentStatus === 'refunded').length;
  const claimed = sold.filter((o) => o.orderStatus === 'disputed' || getEscrow(o.id)?.history.some((h) => h.state === 'disputed')).length;
  // Response rate: buyer threads the seller answered.
  let asked = 0;
  let answered = 0;
  for (const [key, messages] of db.dms) {
    if (!key.split('|').includes(sellerId) || !messages.length) continue;
    if (messages.some((m) => m.toId === sellerId)) {
      asked += 1;
      if (messages.some((m) => m.fromId === sellerId)) answered += 1;
    }
  }
  const metrics = [
    { id: 'on_time_shipping', label: 'Ships on time (within 3 days)', value: pct(onTime, shipped.length + late), target: 95 },
    { id: 'refund_free', label: 'Orders without a refund', value: pct(sold.length - refunded, sold.length), target: 97 },
    { id: 'claim_free', label: 'Orders without a claim', value: pct(sold.length - claimed, sold.length), target: 98 },
    { id: 'response_rate', label: 'Messages answered', value: pct(answered, asked), target: 90 },
  ];
  const status = metrics.every((m) => m.value >= m.target) ? 'great' : metrics.some((m) => m.value < m.target - 15) ? 'at_risk' : 'good';
  return { status, ordersCounted: sold.length, lateToShip: late, metrics };
}

export function mountEngagementRoutes(app: Express, deps: EngagementDeps): void {
  const { actorId, emit, expandStream, expandAuction } = deps;

  /* First purchase in a show: the room celebrates (once per buyer, ever). */
  onOrderCreated((order) => {
    if (!order.streamId || order.source === 'prize_drop') return;
    if (orders.buying(order.buyerId).filter((o) => o.source !== 'prize_drop').length !== 1) return;
    const handle = users.get(order.buyerId)?.handle;
    if (handle) emit(`stream:${order.streamId}`, 'stream:celebrate', { streamId: order.streamId, kind: 'first_purchase', handle });
  });

  /* ── Prize Drops ── */
  app.get('/api/streams/:id/giveaways', (req, res) => {
    const me = actorId(req);
    const list = [...db.giveaways.values()].filter((g) => g.streamId === req.params.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ items: list.map((g) => giveawayView(g, me)) });
  });

  app.post('/api/streams/:id/giveaways', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const stream = streams.get(req.params.id);
    if (!stream) return void res.status(404).json({ error: 'stream_not_found' });
    if (!canModerate(stream, me)) return void res.status(403).json({ error: 'not_host', message: 'Only the host or a moderator can run a Prize Drop.' });
    if (stream.status === 'ended') return void res.status(409).json({ error: 'stream_ended', message: 'This show has ended.' });
    if ([...db.giveaways.values()].some((g) => g.streamId === stream.id && g.status === 'open')) {
      return void res.status(409).json({ error: 'giveaway_open', message: 'Draw or cancel the current Prize Drop first.' });
    }
    const body = req.body as { title?: string; followersOnly?: boolean; image?: string };
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 80) : '';
    if (title.length < 2) return void res.status(400).json({ error: 'title_required', message: 'Say what the prize is.' });
    const g: Giveaway = {
      id: store.nextId('gw'),
      streamId: stream.id,
      sellerId: stream.creatorId,
      title,
      image: typeof body.image === 'string' && body.image.startsWith('http') ? body.image.slice(0, 500) : undefined,
      followersOnly: body.followersOnly !== false,
      entrants: [],
      status: 'open',
      createdAt: store.iso(),
    };
    db.giveaways.set(g.id, g);
    emit(`stream:${stream.id}`, 'giveaway:update', giveawayView(g, ''));
    res.status(201).json({ giveaway: giveawayView(g, me) });
  });

  app.post('/api/giveaways/:id/enter', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const g = db.giveaways.get(req.params.id);
    if (!g) return void res.status(404).json({ error: 'giveaway_not_found' });
    if (!g.entrants.includes(me)) {
      const blocker = entryBlocker(g, me);
      if (blocker) {
        const code = blocker.startsWith('Add a shipping') ? 'shipping_info_required' : blocker.startsWith('Follow') ? 'follow_required' : 'not_allowed';
        return void res.status(409).json({ error: code, message: blocker });
      }
      g.entrants.push(me);
      db.giveaways.set(g.id, g);
      emit(`stream:${g.streamId}`, 'giveaway:update', giveawayView(g, ''));
    }
    res.json({ giveaway: giveawayView(g, me) });
  });

  app.post('/api/giveaways/:id/draw', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const g = db.giveaways.get(req.params.id);
    if (!g) return void res.status(404).json({ error: 'giveaway_not_found' });
    if (!canModerate(streams.get(g.streamId), me)) return void res.status(403).json({ error: 'not_host' });
    if (g.status !== 'open') return void res.status(409).json({ error: 'giveaway_closed', message: 'This Prize Drop has already closed.' });
    // Entrants who can no longer receive it (blocked since, address removed) are skipped.
    const eligible = g.entrants.filter((id) => users.get(id) && !blocks.between(g.sellerId, id) && (!valueOf<boolean>('buyers.address_required') || addresses.defaultFor(id)));
    if (!eligible.length) return void res.status(409).json({ error: 'no_entrants', message: 'Nobody has entered yet.' });
    const winnerId = eligible[Math.floor(Math.random() * eligible.length)];
    const order = prizeOrder(g, winnerId);
    Object.assign(g, { status: 'drawn', winnerId, orderId: order.id, drawnAt: store.iso() });
    db.giveaways.set(g.id, g);
    const host = users.get(g.sellerId);
    notify(winnerId, 'orders', 'You won a Prize Drop! 🎉', `${g.title} from @${host?.handle ?? 'the host'} is yours — free. They'll ship it to your default address.`, `/orders/${order.id}`);
    notify(g.sellerId, 'orders', 'Prize Drop drawn', `@${users.get(winnerId)?.handle} won ${g.title}. Ship it from your orders.`, `/orders/${order.id}`);
    emit(`stream:${g.streamId}`, 'giveaway:update', giveawayView(g, ''));
    emit(`stream:${g.streamId}`, 'stream:celebrate', { streamId: g.streamId, kind: 'prize_drop', handle: users.get(winnerId)?.handle });
    res.json({ giveaway: giveawayView(g, me), orderId: order.id });
  });

  app.post('/api/giveaways/:id/cancel', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const g = db.giveaways.get(req.params.id);
    if (!g) return void res.status(404).json({ error: 'giveaway_not_found' });
    if (!canModerate(streams.get(g.streamId), me)) return void res.status(403).json({ error: 'not_host' });
    if (g.status === 'open') {
      g.status = 'cancelled';
      db.giveaways.set(g.id, g);
      emit(`stream:${g.streamId}`, 'giveaway:update', giveawayView(g, ''));
    }
    res.json({ giveaway: giveawayView(g, me) });
  });

  /* ── Tips ── */
  app.post('/api/streams/:id/tips', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const stream = streams.get(req.params.id);
    if (!stream) return void res.status(404).json({ error: 'stream_not_found' });
    if (stream.creatorId === me) return void res.status(409).json({ error: 'self_tip', message: 'You can’t tip yourself.' });
    if (blocks.between(stream.creatorId, me)) return void res.status(403).json({ error: 'blocked' });
    const amount = money.round2(Number((req.body as { amount?: unknown }).amount));
    const currency = sellerCurrency(stream.creatorId);
    const maxUSD = 500;
    if (!Number.isFinite(amount) || amount <= 0) return void res.status(400).json({ error: 'amount_required', message: 'Choose an amount.' });
    if (money.convert(amount, currency as Order['currency'], 'USD') > maxUSD) {
      return void res.status(400).json({ error: 'amount_too_high', message: `Tips are up to ${money.formatMoney(money.round2(money.convert(maxUSD, 'USD', currency as Order['currency'])), currency as Order['currency'])}.` });
    }
    const note = typeof (req.body as { note?: unknown }).note === 'string' ? ((req.body as { note: string }).note).trim().slice(0, 120) : undefined;
    const tip: Tip = { id: store.nextId('tip'), streamId: stream.id, fromId: me, toId: stream.creatorId, amount, currency, note: note || undefined, at: store.iso() };
    db.tips.set(tip.id, tip);
    const from = users.get(me);
    notify(stream.creatorId, 'streams', 'You got a tip 💰', `@${from?.handle} tipped ${money.formatMoney(amount, currency as Order['currency'])}${note ? `: “${note}”` : '.'}`, `/streams/${stream.id}`);
    emit(`stream:${stream.id}`, 'stream:tip', { streamId: stream.id, handle: from?.handle, amount, currency, note: note || null });
    res.status(201).json({ tip, simulated: true });
  });

  app.get('/api/me/tips', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const all = [...db.tips.values()];
    const received = all.filter((t) => t.toId === me);
    res.json({
      received: received.slice(-50).reverse().map((t) => ({ ...t, fromHandle: users.get(t.fromId)?.handle })),
      sent: all.filter((t) => t.fromId === me).slice(-50).reverse(),
      receivedTotal: money.round2(received.reduce((s, t) => s + t.amount, 0)),
      currency: sellerCurrency(me),
    });
  });

  /* ── Reactions and join lines ── */
  app.post('/api/streams/:id/react', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const emoji = (req.body as { emoji?: string }).emoji;
    if (!REACTIONS.includes(emoji as (typeof REACTIONS)[number])) return void res.status(400).json({ error: 'unknown_reaction', allowed: REACTIONS });
    if (!streams.get(req.params.id)) return void res.status(404).json({ error: 'stream_not_found' });
    const key = `${req.params.id}>${me}`;
    const last = reactedAt.get(key) ?? 0;
    if (Date.now() - last < 400) return void res.json({ ok: true, throttled: true });
    reactedAt.set(key, Date.now());
    emit(`stream:${req.params.id}`, 'stream:reaction', { streamId: req.params.id, emoji });
    res.json({ ok: true });
  });

  /* ── Seller Studio ── */
  app.get('/api/seller/studio', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const mine = orders.selling(me);
    const line = (o: Order) => ({
      id: o.id,
      title: o.title ?? auctions.get(o.auctionId)?.title ?? 'Order',
      buyerHandle: users.get(o.buyerId)?.handle ?? '',
      totalAmount: o.totalAmount,
      hammerPrice: o.hammerPrice,
      currency: o.currency,
      paidAt: o.paidAt ?? null,
      orderStatus: o.orderStatus,
      paymentStatus: o.paymentStatus,
      source: o.source ?? null,
      createdAt: o.createdAt,
    });
    const toShip = mine.filter((o) => o.paymentStatus === 'paid' && ['pending', 'processing'].includes(o.orderStatus));
    const held = mine.filter((o) => getEscrow(o.id)?.state === 'in_escrow');
    const paidOut = payouts.bySeller(me);
    const currency = sellerCurrency(me) as Order['currency'];
    const inCur = (amount: number, from: Order['currency']) => money.convert(amount, from, currency);
    const tier = tierFor(me);
    const tips = [...db.tips.values()].filter((t) => t.toId === me);
    res.json({
      currency,
      toShip: toShip.sort((a, b) => (a.paidAt ?? a.createdAt).localeCompare(b.paidAt ?? b.createdAt)).map(line),
      awaitingPayment: mine.filter((o) => o.paymentStatus === 'pending').map(line),
      payouts: {
        held: money.round2(held.reduce((s, o) => s + inCur(o.hammerPrice, o.currency), 0)),
        paid: money.round2(paidOut.reduce((s, p) => s + inCur(p.netAmount, p.currency), 0)),
        tips: money.round2(tips.reduce((s, t) => s + inCur(t.amount, t.currency as Order['currency']), 0)),
        recent: paidOut.slice(-10).reverse().map((p) => ({ id: p.id, netAmount: p.netAmount, platformFee: p.platformFee, currency: p.currency, status: p.status, initiatedAt: p.initiatedAt })),
        note: 'Released to you when the buyer confirms the item arrived.',
      },
      health: accountHealth(me),
      commission: {
        tier: tier.tier,
        next: tier.next ?? null,
        salesUSD30: tier.salesUSD,
        toNextUSD: tier.toNextUSD ?? null,
        tiers: TIERS,
        byCategory: categoryTree.map((c) => ({ id: c.id, label: c.label, rate: money.round2(tier.tier.rate + (money.isLuxury(c.id) ? 0.02 : 0)) })),
      },
    });
  });

  /* ── Category feed ── */
  app.get('/api/categories/:id/feed', (req, res) => {
    const id = req.params.id;
    const node = categoryTree.find((c) => c.id === id);
    if (!node) return void res.status(404).json({ error: 'category_not_found' });
    const sort = String(req.query.sort ?? 'popular');
    const live = streams
      .all()
      .filter((s: Stream) => s.visibility !== 'private' && s.category === id && s.status !== 'ended')
      .sort((a, b) => (a.status === 'live' ? 0 : 1) - (b.status === 'live' ? 0 : 1) || b.viewerCount - a.viewerCount)
      .map((s) => expandStream(s.id))
      .filter(Boolean);
    let listings = auctions
      .all()
      .filter((a) => ['live', 'scheduled'].includes(a.status) && items.get(a.itemId)?.categoryId === id);
    if (sort === 'bin') listings = listings.filter((a) => (a.buyItNowPrice ?? 0) > 0);
    listings.sort((a, b) =>
      sort === 'new' ? b.startTime.localeCompare(a.startTime) : sort === 'bin' ? (a.buyItNowPrice ?? 0) - (b.buyItNowPrice ?? 0) : b.bidCount - a.bidCount || b.currentBid - a.currentBid,
    );
    res.json({
      category: { id: node.id, label: node.label, emoji: node.emoji },
      sort,
      live,
      listings: listings.slice(0, 60).map((a) => expandAuction(a.id)).filter(Boolean),
    });
  });

  /* ── Watchlist on the account ── */
  const watchlistOf = (userId: string) => db.watchlists.get(userId) ?? [];
  app.get('/api/me/watchlist', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const ids = watchlistOf(me).filter((id) => auctions.get(id));
    res.json({ ids, items: ids.map((id) => expandAuction(id)).filter(Boolean) });
  });
  app.put('/api/me/watchlist/:auctionId', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    if (!auctions.get(req.params.auctionId)) return void res.status(404).json({ error: 'auction_not_found' });
    const ids = watchlistOf(me);
    if (!ids.includes(req.params.auctionId)) db.watchlists.set(me, [req.params.auctionId, ...ids].slice(0, 300));
    res.json({ ids: watchlistOf(me) });
  });
  app.delete('/api/me/watchlist/:auctionId', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    db.watchlists.set(me, watchlistOf(me).filter((id) => id !== req.params.auctionId));
    res.json({ ids: watchlistOf(me) });
  });
}

/** Called when a signed-in member joins a show's room: "@name joined" at most once a minute per member. */
export function joinLine(streamId: string, userId: string, emit: Emit): void {
  const handle = users.get(userId)?.handle;
  if (!handle) return;
  const key = `${streamId}>${userId}`;
  if (Date.now() - (joinedAt.get(key) ?? 0) < 60_000) return;
  joinedAt.set(key, Date.now());
  emit(`stream:${streamId}`, 'stream:joined', { streamId, handle });
}
