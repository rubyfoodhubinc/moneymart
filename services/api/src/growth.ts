/**
 * Wave C — growth.
 *
 * - Coins: Watch & Earn (a coin a minute in live shows, capped), challenges, and a rewards shop that turns coins into
 *   MoneyMart credit. Credit is taken off an unpaid order before paying; MoneyMart covers it, the seller is paid in full.
 * - Clubs: each seller's buyers are Bronze, Silver or Gold by what they spent with that seller.
 * - Referrals: an invite code; when the invited member pays for their first order, both get credit.
 * - Offers on Buy It Now listings: make, counter, accept (makes the order), decline, withdraw; 24 hours to answer.
 * - Clips: members save a moment of a show (up to 60 s) to share; it plays when show recordings are on.
 * - Leaderboards: top sellers per category over 30 days, and a seller's "#N in category".
 * - Messages: friends (mutual follows), and member-to-member messages between friends, buyers and sellers, or the
 *   two sides of an order. Blocks stop them.
 * - Buyer protection: claim windows by category, enforced when a claim is opened.
 * - Gated categories: listing in them needs a verified seller (setting `categories.gated`).
 * - Promotions: a seller boosts a show or listing to the top of the feed for a while.
 * - Vacation mode: no new listings, shows or offers; the profile says when the seller is back.
 */
import type { Express, Request, Response } from 'express';
import type { Order, User } from '@moneymart/types';
import type { CurrencyCode } from '@moneymart/tokens';
import { categoryTree } from '@moneymart/tokens';
import {
  auctions, blocks, db, follows, items, notifications, orders, store, streams, users,
  type Clip, type DirectMessage, type Offer, type Promo, type Wallet,
} from './store.js';
import { money } from './engine/money.js';
import { sellAt } from './engine/auctionEngine.js';
import { valueOf } from './ai/registry.js';
import { sellerCurrency } from './engagement.js';

type ActorFn = (req: Request) => string;
type Emit = (room: string, event: string, payload: unknown) => void;
export interface GrowthDeps {
  actorId: ActorFn;
  emit: Emit;
  expandStream: (id: string) => unknown;
  expandAuction: (id: string) => unknown;
}

const DAY = 86_400_000;
const USD = 'USD' as CurrencyCode;
const lastTick = new Map<string, number>();

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

/* ── Wallet ── */
export function walletOf(userId: string): Wallet {
  let w = db.wallets.get(userId);
  if (!w) {
    w = { userId, coins: 0, credit: 0, watched: {}, claimed: [], history: [] };
    db.wallets.set(userId, w);
  }
  return w;
}
function addCoins(userId: string, amount: number, reason: string) {
  const w = walletOf(userId);
  w.coins += amount;
  w.history.unshift({ at: store.iso(), kind: 'coins', amount, reason });
  w.history.splice(60);
  db.wallets.set(userId, w);
}
/** Credit is kept in US dollars and converted to the order's currency when used. */
function addCredit(userId: string, amountUSD: number, reason: string) {
  const w = walletOf(userId);
  w.credit = money.round2(w.credit + amountUSD);
  w.history.unshift({ at: store.iso(), kind: 'credit', amount: amountUSD, reason });
  w.history.splice(60);
  db.wallets.set(userId, w);
}

const WATCH_PER_STREAM_DAY = 30;
const WATCH_PER_DAY = 120;
const today = () => new Date().toISOString().slice(0, 10);
function watchedToday(w: Wallet) {
  const d = today();
  return Object.entries(w.watched).filter(([k]) => k.startsWith(d)).reduce((s, [, v]) => s + v, 0);
}
const watchedAllTime = (w: Wallet) => Object.values(w.watched).reduce((s, v) => s + v, 0);

/* ── Challenges ── */
interface Challenge { id: string; title: string; detail: string; goal: number; coins: number; progress: (userId: string) => number }
const bidsBy = (userId: string) => [...db.bids.values()].reduce((n, list) => n + list.filter((b) => b.bidderId === userId).length, 0);
export const CHALLENGES: Challenge[] = [
  { id: 'first_bid', title: 'Place your first bid', detail: 'Bid on anything in a show or listing.', goal: 1, coins: 50, progress: bidsBy },
  { id: 'follow_3', title: 'Follow 3 sellers', detail: 'Get told when they go live.', goal: 3, coins: 50, progress: (u) => follows.following(u).length },
  { id: 'watch_30', title: 'Watch 30 minutes of live shows', detail: 'Coins add up while you watch.', goal: 30, coins: 100, progress: (u) => watchedAllTime(walletOf(u)) },
  { id: 'enter_drop', title: 'Enter a Prize Drop', detail: 'Free prizes in live shows.', goal: 1, coins: 25, progress: (u) => [...db.giveaways.values()].filter((g) => g.entrants.includes(u)).length },
  { id: 'first_purchase', title: 'Make your first purchase', detail: 'Win a bid or Buy It Now, then pay.', goal: 1, coins: 200, progress: (u) => orders.buying(u).filter((o) => o.paymentStatus === 'paid' && o.source !== 'prize_drop').length },
  { id: 'invite_friend', title: 'Invite a friend who buys', detail: 'You both get credit too.', goal: 1, coins: 300, progress: (u) => [...db.referrals.values()].filter((r) => r.referrerId === u && r.rewardedAt).length },
];
export const REWARDS = [
  { id: 'credit_5', title: '$5 MoneyMart credit', coins: 1000, creditUSD: 5 },
  { id: 'credit_12', title: '$12 MoneyMart credit', coins: 2000, creditUSD: 12 },
  { id: 'credit_35', title: '$35 MoneyMart credit', coins: 5000, creditUSD: 35 },
];

/* ── Clubs ── */
const CLUB = [
  { id: 'gold', label: 'Gold', fromUSD: 1000, perk: 'Gold badge in chat and first look at new drops' },
  { id: 'silver', label: 'Silver', fromUSD: 250, perk: 'Silver badge in chat' },
  { id: 'bronze', label: 'Bronze', fromUSD: 0.01, perk: 'Bronze badge in chat' },
];
export function clubFor(buyerId: string, sellerId: string) {
  const spentUSD = money.round2(
    orders
      .buying(buyerId)
      .filter((o) => o.sellerId === sellerId && o.paymentStatus === 'paid')
      .reduce((s, o) => s + money.convert(o.hammerPrice, o.currency, USD), 0),
  );
  const tier = CLUB.find((t) => spentUSD >= t.fromUSD) ?? null;
  const next = tier ? CLUB[CLUB.indexOf(tier) - 1] : CLUB[CLUB.length - 1];
  return { spentUSD, tier: tier ? { id: tier.id, label: tier.label, perk: tier.perk } : null, next: next ? { id: next.id, label: next.label, fromUSD: next.fromUSD } : null };
}

/* ── Referrals ── */
export const referralCode = (u: User) => u.handle.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
const REFERRAL_USD = 5;
/** Called when an order is paid: the invited member's first paid order rewards both sides. */
export function onOrderPaid(order: Order): void {
  const ref = db.referrals.get(order.buyerId);
  if (!ref || ref.rewardedAt) return;
  ref.rewardedAt = store.iso();
  db.referrals.set(order.buyerId, ref);
  addCredit(order.buyerId, REFERRAL_USD, 'Welcome credit from your invite');
  addCredit(ref.referrerId, REFERRAL_USD, `@${users.get(order.buyerId)?.handle} made their first purchase`);
  notify(ref.referrerId, 'system', `You earned $${REFERRAL_USD} credit`, `@${users.get(order.buyerId)?.handle} made their first purchase.`, '/rewards');
}

/* ── Buyer protection ── */
const FAST = ['trading-cards', 'sneakers', 'collectibles', 'toys', 'comics'];
export function claimWindowDays(categoryId?: string): number {
  if (money.isLuxury(categoryId)) return 30;
  if (categoryId && FAST.includes(categoryId)) return 14;
  return 21;
}
/** Null when a claim may be opened; otherwise why not. */
export function claimBlocker(order: Order): string | null {
  if (!order.shippedAt) return null;
  const category = items.get(auctions.get(order.auctionId)?.itemId ?? '')?.categoryId;
  const days = claimWindowDays(category);
  return Date.now() - Date.parse(order.shippedAt) > days * DAY ? `Claims for this category close ${days} days after the item ships.` : null;
}

/* ── Gated categories and vacation ── */
export function gatedCategories(): string[] {
  const list = valueOf<string[]>('categories.gated');
  return Array.isArray(list) ? list : [];
}
/** Why this seller can't list in the category, or null. */
export function listingBlocker(sellerId: string, categoryId?: string): { code: string; message: string } | null {
  const seller = users.get(sellerId);
  if (seller?.vacation?.on) return { code: 'on_vacation', message: 'You’re on vacation. Turn vacation mode off to list or schedule shows.' };
  if (categoryId && gatedCategories().includes(categoryId) && seller?.verificationStatus !== 'verified') {
    return { code: 'category_gated', message: 'This category needs a verified seller. Get verified from Sell › Get verified.' };
  }
  return null;
}

/* ── Promotions ── */
const PROMO_PRICES_USD: Record<string, number> = { '1': 5, '3': 12, '24': 30 };
export function isPromoted(kind: Promo['kind'], targetId: string): boolean {
  const now = Date.now();
  return [...db.promos.values()].some((p) => p.kind === kind && p.targetId === targetId && Date.parse(p.startsAt) <= now && Date.parse(p.endsAt) > now);
}

/* ── Messages ── */
const threadKey = (a: string, b: string) => [a, b].sort().join('|');
const isSeller = (u?: User) => Boolean(u?.sellerProfile || u?.role === 'creator');
export function mayMessage(fromId: string, toId: string): string | null {
  if (fromId === toId) return 'You can’t message yourself.';
  const to = users.get(toId);
  if (!to) return 'Member not found.';
  if (blocks.between(fromId, toId)) return 'You can’t message this member.';
  const friends = follows.is(fromId, toId) && follows.is(toId, fromId);
  const ordered = orders.all().some((o) => (o.buyerId === fromId && o.sellerId === toId) || (o.buyerId === toId && o.sellerId === fromId));
  const existing = (db.dms.get(threadKey(fromId, toId)) ?? []).some((m) => m.fromId === toId);
  if (friends || ordered || existing || isSeller(to)) return null;
  return 'You can message friends (you follow each other), sellers, and people you’ve bought from or sold to.';
}

export function mountGrowthRoutes(app: Express, deps: GrowthDeps): void {
  const { actorId, emit, expandStream, expandAuction } = deps;
  const publicUser = (u?: User) => (u ? { id: u.id, handle: u.handle, displayName: u.displayName, avatarUrl: u.avatarUrl ?? null } : null);

  /* ── Wallet, Watch & Earn, challenges, rewards ── */
  app.get('/api/me/wallet', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const w = walletOf(me);
    res.json({
      coins: w.coins,
      creditUSD: w.credit,
      history: w.history.slice(0, 30),
      watchedTodayMinutes: watchedToday(w),
      watchDailyCap: WATCH_PER_DAY,
      challenges: CHALLENGES.map((c) => {
        const progress = Math.min(c.goal, c.progress(me));
        return { id: c.id, title: c.title, detail: c.detail, goal: c.goal, coins: c.coins, progress, done: progress >= c.goal, claimed: w.claimed.includes(c.id) };
      }),
      rewards: REWARDS.map((r) => ({ ...r, affordable: w.coins >= r.coins })),
    });
  });

  app.post('/api/streams/:id/watch-tick', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const stream = streams.get(req.params.id);
    if (!stream || stream.status !== 'live') return void res.json({ earned: 0, reason: 'not_live' });
    if (stream.creatorId === me) return void res.json({ earned: 0, reason: 'host' });
    const key = `${me}>${stream.id}`;
    if (Date.now() - (lastTick.get(key) ?? 0) < 55_000) return void res.json({ earned: 0, reason: 'too_soon' });
    lastTick.set(key, Date.now());
    const w = walletOf(me);
    const slot = `${today()}:${stream.id}`;
    if ((w.watched[slot] ?? 0) >= WATCH_PER_STREAM_DAY || watchedToday(w) >= WATCH_PER_DAY) return void res.json({ earned: 0, reason: 'daily_cap', coins: w.coins });
    w.watched[slot] = (w.watched[slot] ?? 0) + 1;
    db.wallets.set(me, w);
    addCoins(me, 1, 'Watch & Earn');
    res.json({ earned: 1, coins: walletOf(me).coins });
  });

  app.post('/api/me/challenges/:id/claim', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const c = CHALLENGES.find((x) => x.id === req.params.id);
    if (!c) return void res.status(404).json({ error: 'challenge_not_found' });
    const w = walletOf(me);
    if (w.claimed.includes(c.id)) return void res.status(409).json({ error: 'already_claimed', message: 'Already claimed.' });
    if (c.progress(me) < c.goal) return void res.status(409).json({ error: 'not_done', message: 'Finish the challenge first.' });
    w.claimed.push(c.id);
    db.wallets.set(me, w);
    addCoins(me, c.coins, c.title);
    res.json({ coins: walletOf(me).coins });
  });

  app.post('/api/me/rewards/:id/redeem', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const r = REWARDS.find((x) => x.id === req.params.id);
    if (!r) return void res.status(404).json({ error: 'reward_not_found' });
    const w = walletOf(me);
    if (w.coins < r.coins) return void res.status(409).json({ error: 'not_enough_coins', message: `You need ${r.coins - w.coins} more coins.` });
    addCoins(me, -r.coins, r.title);
    addCredit(me, r.creditUSD, r.title);
    res.json({ coins: walletOf(me).coins, creditUSD: walletOf(me).credit });
  });

  /** Use credit on an unpaid order. MoneyMart covers it; the seller's payout is unchanged. */
  app.post('/api/orders/:id/apply-credit', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const order = orders.get(req.params.id);
    if (!order || order.buyerId !== me) return void res.status(404).json({ error: 'order_not_found' });
    if (order.paymentStatus === 'paid' || order.paymentStatus === 'refunded') return void res.status(409).json({ error: 'already_paid', message: 'This order is already paid.' });
    if (order.creditApplied) return void res.status(409).json({ error: 'credit_already_used', message: 'Credit is already on this order.' });
    const w = walletOf(me);
    if (w.credit <= 0) return void res.status(409).json({ error: 'no_credit', message: 'You have no credit yet.' });
    const available = money.round2(money.convert(w.credit, USD, order.currency));
    // Keep at least 1 unit to charge, so the payment still confirms the buyer's card.
    const use = money.round2(Math.min(available, Math.max(0, order.totalAmount - 1)));
    if (use <= 0) return void res.status(409).json({ error: 'nothing_to_cover', message: 'This order is too small to use credit on.' });
    const usedUSD = money.round2(Math.min(w.credit, money.convert(use, order.currency, USD)));
    w.credit = money.round2(w.credit - usedUSD);
    w.history.unshift({ at: store.iso(), kind: 'credit', amount: -usedUSD, reason: `Used on order ${order.id}` });
    db.wallets.set(me, w);
    const saved = orders.save({ ...order, creditApplied: use, totalAmount: money.round2(order.totalAmount - use) });
    res.json({ order: saved, creditUSD: w.credit });
  });

  /* ── Clubs ── */
  app.get('/api/users/:id/club', (req, res) => {
    const me = actorId(req);
    const seller = users.get(req.params.id) ?? users.findByHandle(req.params.id.replace(/^@/, ''));
    if (!seller) return void res.status(404).json({ error: 'user_not_found' });
    const buyers = new Set(orders.selling(seller.id).filter((o) => o.paymentStatus === 'paid').map((o) => o.buyerId));
    const counts: Record<string, number> = { gold: 0, silver: 0, bronze: 0 };
    for (const b of buyers) {
      const t = clubFor(b, seller.id).tier;
      if (t) counts[t.id] += 1;
    }
    res.json({ tiers: CLUB.map(({ id, label, fromUSD, perk }) => ({ id, label, fromUSD, perk, members: counts[id] })), you: me ? clubFor(me, seller.id) : null });
  });

  /* ── Referrals ── */
  app.get('/api/me/referral', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const u = users.get(me)!;
    const invited = [...db.referrals.values()].filter((r) => r.referrerId === me);
    const code = referralCode(u);
    res.json({ code, link: `https://www.moneymart.app/join?ref=${code}`, invited: invited.length, rewarded: invited.filter((r) => r.rewardedAt).length, rewardUSD: REFERRAL_USD, invitedBy: db.referrals.get(me) ? publicUser(users.get(db.referrals.get(me)!.referrerId)) : null });
  });

  app.post('/api/referrals/claim', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const code = String((req.body as { code?: string }).code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const u = users.get(me)!;
    if (db.referrals.get(me)) return void res.status(409).json({ error: 'already_invited', message: 'You already used an invite code.' });
    if (Date.now() - Date.parse(u.createdAt) > 14 * DAY) return void res.status(409).json({ error: 'too_late', message: 'Invite codes are for new members (first 14 days).' });
    if (orders.buying(me).some((o) => o.paymentStatus === 'paid' && o.source !== 'prize_drop')) return void res.status(409).json({ error: 'not_new', message: 'Invite codes are for a first purchase.' });
    const referrer = users.all().find((x) => referralCode(x) === code);
    if (!referrer || referrer.id === me) return void res.status(404).json({ error: 'code_not_found', message: 'That code doesn’t match a member.' });
    db.referrals.set(me, { referredId: me, referrerId: referrer.id, code, at: store.iso() });
    res.status(201).json({ ok: true, invitedBy: publicUser(referrer), rewardUSD: REFERRAL_USD });
  });

  /* ── Offers ── */
  const offerView = (o: Offer, me: string) => {
    if (o.status === 'pending' && Date.now() - Date.parse(o.updatedAt) > DAY) {
      o.status = 'expired';
      db.offers.set(o.id, o);
    }
    const a = auctions.get(o.auctionId);
    return { ...o, title: a?.title ?? '', buyItNowPrice: a?.buyItNowPrice ?? null, buyer: publicUser(users.get(o.buyerId)), seller: publicUser(users.get(o.sellerId)), youAreSeller: o.sellerId === me };
  };
  const findOffer = (req: Request, res: Response, me: string) => {
    const o = db.offers.get(req.params.id);
    if (!o || (o.buyerId !== me && o.sellerId !== me)) {
      res.status(404).json({ error: 'offer_not_found' });
      return null;
    }
    offerView(o, me);
    return o;
  };
  const touch = (o: Offer, status: Offer['status'], patch: Partial<Offer> = {}) => {
    Object.assign(o, patch, { status, updatedAt: store.iso() });
    db.offers.set(o.id, o);
  };

  app.post('/api/auctions/:id/offers', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const a = auctions.get(req.params.id);
    if (!a) return void res.status(404).json({ error: 'auction_not_found' });
    const bin = a.buyItNowPrice ?? 0;
    if (!bin || !['live', 'scheduled'].includes(a.status)) return void res.status(409).json({ error: 'offers_closed', message: 'Offers are for Buy It Now listings that are still for sale.' });
    if (a.sellerId === me) return void res.status(409).json({ error: 'self_offer', message: 'You can’t make an offer on your own listing.' });
    if (users.get(a.sellerId)?.vacation?.on) return void res.status(409).json({ error: 'on_vacation', message: 'This seller is on vacation.' });
    if (blocks.between(a.sellerId, me)) return void res.status(403).json({ error: 'blocked' });
    const amount = money.round2(Number((req.body as { amount?: unknown }).amount));
    if (!Number.isFinite(amount) || amount < bin * 0.5) return void res.status(400).json({ error: 'offer_too_low', message: `Offers start at ${money.formatMoney(money.round2(bin * 0.5), a.currency)}.` });
    if (amount >= bin) return void res.status(400).json({ error: 'offer_at_price', message: 'That’s the Buy It Now price — just buy it.' });
    if ([...db.offers.values()].some((o) => o.auctionId === a.id && o.buyerId === me && ['pending', 'countered'].includes(offerView(o, me).status))) {
      return void res.status(409).json({ error: 'offer_open', message: 'You already have an offer open on this listing.' });
    }
    const message = typeof (req.body as { message?: unknown }).message === 'string' ? (req.body as { message: string }).message.trim().slice(0, 200) : undefined;
    const o: Offer = { id: store.nextId('ofr'), auctionId: a.id, buyerId: me, sellerId: a.sellerId, amount, currency: a.currency, status: 'pending', message: message || undefined, createdAt: store.iso(), updatedAt: store.iso() };
    db.offers.set(o.id, o);
    notify(a.sellerId, 'bids', 'New offer', `@${users.get(me)?.handle} offered ${money.formatMoney(amount, a.currency)} for ${a.title}.`, `/offers/${o.id}`);
    res.status(201).json({ offer: offerView(o, me) });
  });

  app.get('/api/me/offers', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const all = [...db.offers.values()].sort((x, y) => y.updatedAt.localeCompare(x.updatedAt)).map((o) => offerView(o, me));
    res.json({ sent: all.filter((o) => o.buyerId === me), received: all.filter((o) => o.sellerId === me) });
  });

  app.post('/api/offers/:id/:action', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const o = findOffer(req, res, me);
    if (!o) return;
    const action = req.params.action;
    const isSellerSide = o.sellerId === me;
    const a = auctions.get(o.auctionId);
    const fmt = (n: number) => money.formatMoney(n, o.currency as CurrencyCode);
    if (action === 'withdraw') {
      if (isSellerSide || !['pending', 'countered'].includes(o.status)) return void res.status(409).json({ error: 'cannot_withdraw' });
      touch(o, 'withdrawn');
      return void res.json({ offer: offerView(o, me) });
    }
    if (action === 'decline') {
      const can = (isSellerSide && o.status === 'pending') || (!isSellerSide && o.status === 'countered');
      if (!can) return void res.status(409).json({ error: 'cannot_decline' });
      touch(o, 'declined');
      notify(isSellerSide ? o.buyerId : o.sellerId, 'bids', 'Offer declined', `Your offer on ${a?.title ?? 'a listing'} was declined.`, `/offers/${o.id}`);
      return void res.json({ offer: offerView(o, me) });
    }
    if (action === 'counter') {
      if (!isSellerSide || o.status !== 'pending') return void res.status(409).json({ error: 'cannot_counter' });
      const amount = money.round2(Number((req.body as { amount?: unknown }).amount));
      if (!Number.isFinite(amount) || amount <= o.amount || (a?.buyItNowPrice && amount >= a.buyItNowPrice)) {
        return void res.status(400).json({ error: 'bad_counter', message: 'A counter is above the offer and below the Buy It Now price.' });
      }
      touch(o, 'countered', { counterAmount: amount });
      notify(o.buyerId, 'bids', 'Counter-offer', `@${users.get(o.sellerId)?.handle} countered at ${fmt(amount)} for ${a?.title}.`, `/offers/${o.id}`);
      return void res.json({ offer: offerView(o, me) });
    }
    if (action === 'accept') {
      const price = isSellerSide && o.status === 'pending' ? o.amount : !isSellerSide && o.status === 'countered' ? o.counterAmount : undefined;
      if (!price) return void res.status(409).json({ error: 'cannot_accept', message: 'This offer can’t be accepted now.' });
      const sale = sellAt({ auctionId: o.auctionId, buyerId: o.buyerId, price });
      if (!sale.order) return void res.status(409).json({ error: sale.error, message: sale.message });
      orders.save({ ...sale.order, source: 'offer' });
      touch(o, 'accepted', { orderId: sale.order.id });
      notify(isSellerSide ? o.buyerId : o.sellerId, 'orders', 'Offer accepted', `${a?.title} sold at ${fmt(price)}.`, `/orders/${sale.order.id}`);
      emit(`auction:${o.auctionId}`, 'auction:offer', { auctionId: o.auctionId, status: 'accepted' });
      return void res.json({ offer: offerView(o, me), orderId: sale.order.id });
    }
    res.status(404).json({ error: 'unknown_action' });
  });

  /* ── Clips ── */
  const clipView = (c: Clip) => ({ ...c, creator: publicUser(users.get(c.creatorId)), by: publicUser(users.get(c.byId)), streamTitle: streams.get(c.streamId)?.title ?? '', shareUrl: `https://www.moneymart.app/clips/${c.id}`, playable: false });
  app.post('/api/streams/:id/clips', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const stream = streams.get(req.params.id);
    if (!stream) return void res.status(404).json({ error: 'stream_not_found' });
    if (blocks.between(stream.creatorId, me)) return void res.status(403).json({ error: 'blocked' });
    const body = req.body as { title?: string; startSec?: number; endSec?: number };
    const title = String(body.title ?? '').trim().slice(0, 80);
    const start = Math.max(0, Math.floor(Number(body.startSec ?? 0)));
    const end = Math.floor(Number(body.endSec ?? start + 30));
    if (title.length < 2) return void res.status(400).json({ error: 'title_required', message: 'Give the clip a title.' });
    if (!(end > start) || end - start > 60) return void res.status(400).json({ error: 'bad_length', message: 'Clips are up to 60 seconds.' });
    const c: Clip = { id: store.nextId('clp'), streamId: stream.id, creatorId: stream.creatorId, byId: me, title, startSec: start, endSec: end, views: 0, createdAt: store.iso() };
    db.clips.set(c.id, c);
    res.status(201).json({ clip: clipView(c) });
  });
  app.get('/api/streams/:id/clips', (req, res) => {
    res.json({ items: [...db.clips.values()].filter((c) => c.streamId === req.params.id).reverse().map(clipView) });
  });
  app.get('/api/clips', (req, res) => {
    const creator = req.query.creator as string | undefined;
    const list = [...db.clips.values()].filter((c) => !creator || c.creatorId === creator).sort((a, b) => b.views - a.views || b.createdAt.localeCompare(a.createdAt));
    res.json({ items: list.slice(0, 60).map(clipView) });
  });
  app.post('/api/clips/:id/view', (req, res) => {
    const c = db.clips.get(req.params.id);
    if (!c) return void res.status(404).json({ error: 'clip_not_found' });
    c.views += 1;
    db.clips.set(c.id, c);
    res.json({ views: c.views });
  });

  /* ── Leaderboards ── */
  const board = (categoryId?: string) => {
    const since = Date.now() - 30 * DAY;
    const totals = new Map<string, { sales: number; gmvUSD: number }>();
    for (const o of orders.all()) {
      if (Date.parse(o.createdAt) < since || o.paymentStatus !== 'paid' || o.source === 'prize_drop') continue;
      const cat = items.get(auctions.get(o.auctionId)?.itemId ?? '')?.categoryId;
      if (categoryId && cat !== categoryId) continue;
      const t = totals.get(o.sellerId) ?? { sales: 0, gmvUSD: 0 };
      t.sales += 1;
      t.gmvUSD = money.round2(t.gmvUSD + money.convert(o.hammerPrice, o.currency, USD));
      totals.set(o.sellerId, t);
    }
    return [...totals.entries()].sort((a, b) => b[1].sales - a[1].sales || b[1].gmvUSD - a[1].gmvUSD).map(([id, t], i) => ({ rank: i + 1, seller: publicUser(users.get(id)), ...t }));
  };
  app.get('/api/leaderboards', (req, res) => {
    const categoryId = (req.query.category as string | undefined) || undefined;
    if (categoryId && !categoryTree.some((c) => c.id === categoryId)) return void res.status(404).json({ error: 'category_not_found' });
    res.json({ categoryId: categoryId ?? null, period: '30d', items: board(categoryId).slice(0, 50) });
  });
  app.get('/api/users/:id/ranks', (req, res) => {
    const u = users.get(req.params.id) ?? users.findByHandle(req.params.id.replace(/^@/, ''));
    if (!u) return void res.status(404).json({ error: 'user_not_found' });
    const ranks = categoryTree
      .map((c) => ({ categoryId: c.id, label: c.label, rank: board(c.id).find((r) => r.seller?.id === u.id)?.rank ?? 0 }))
      .filter((r) => r.rank > 0 && r.rank <= 50)
      .sort((a, b) => a.rank - b.rank);
    res.json({ items: ranks, vacation: u.vacation?.on ? u.vacation : null });
  });

  /* ── Friends and messages ── */
  app.get('/api/me/friends', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    res.json({ items: follows.following(me).filter((id) => follows.is(id, me)).map((id) => publicUser(users.get(id))).filter(Boolean) });
  });
  app.get('/api/me/threads', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const threads = [...db.dms.entries()]
      .filter(([k, list]) => k.split('|').includes(me) && list.length)
      .map(([k, list]) => {
        const other = k.split('|').find((id) => id !== me) ?? me;
        const last = list[list.length - 1];
        return { user: publicUser(users.get(other)), last, unread: list.filter((m) => m.toId === me && !m.readAt).length, blocked: blocks.between(me, other) };
      })
      .filter((t) => t.user && !t.blocked)
      .sort((a, b) => b.last.at.localeCompare(a.last.at));
    res.json({ items: threads, unread: threads.reduce((s, t) => s + t.unread, 0) });
  });
  app.get('/api/threads/:userId', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const other = users.get(req.params.userId) ?? users.findByHandle(req.params.userId.replace(/^@/, ''));
    if (!other) return void res.status(404).json({ error: 'user_not_found' });
    const key = threadKey(me, other.id);
    const list = db.dms.get(key) ?? [];
    let changed = false;
    for (const m of list) if (m.toId === me && !m.readAt) { m.readAt = store.iso(); changed = true; }
    if (changed) db.dms.set(key, list);
    res.json({ user: publicUser(other), messages: list.slice(-200), canSend: mayMessage(me, other.id) === null, reason: mayMessage(me, other.id) });
  });
  app.post('/api/threads/:userId', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const other = users.get(req.params.userId) ?? users.findByHandle(req.params.userId.replace(/^@/, ''));
    if (!other) return void res.status(404).json({ error: 'user_not_found' });
    const why = mayMessage(me, other.id);
    if (why) return void res.status(403).json({ error: 'cannot_message', message: why });
    const body = String((req.body as { body?: string }).body ?? '').trim().slice(0, 1000);
    if (!body) return void res.status(400).json({ error: 'empty' });
    const key = threadKey(me, other.id);
    const list = db.dms.get(key) ?? [];
    const recent = list.filter((m) => m.fromId === me && Date.now() - Date.parse(m.at) < 60_000).length;
    if (recent >= 20) return void res.status(429).json({ error: 'slow_down', message: 'Slow down a little.' });
    const m: DirectMessage = { id: store.nextId('dm'), fromId: me, toId: other.id, body, at: store.iso() };
    list.push(m);
    if (list.length > 500) list.splice(0, list.length - 500);
    db.dms.set(key, list);
    // Only the first unread message of a burst raises a notification.
    if (list.filter((x) => x.toId === other.id && !x.readAt).length === 1) {
      notify(other.id, 'system', `Message from @${users.get(me)?.handle}`, body.slice(0, 120), `/messages/${me}`);
    }
    res.status(201).json({ message: m });
  });

  /* ── Buyer protection ── */
  app.get('/api/policies/buyer-protection', (_req, res) => {
    res.json({
      summary: 'Your payment is held until you confirm the item arrived as described. If it doesn’t arrive, arrives damaged, isn’t as described or isn’t authentic, open a claim from the order and we hold the money while we look into it.',
      covered: ['It never arrived', 'It arrived damaged', 'It isn’t as described', 'It isn’t authentic'],
      notCovered: ['Changing your mind', 'Prize Drops (free items) are covered for non-arrival only'],
      windows: categoryTree.map((c) => ({ categoryId: c.id, label: c.label, days: claimWindowDays(c.id) })),
      windowNote: 'Claims can be opened until the window closes, counted from the day the item ships.',
    });
  });

  /* ── Promotions ── */
  app.post('/api/promos', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const body = req.body as { kind?: string; targetId?: string; hours?: number };
    const kind = body.kind === 'listing' ? 'listing' : body.kind === 'stream' ? 'stream' : null;
    const hours = String(body.hours ?? '');
    if (!kind || !PROMO_PRICES_USD[hours]) return void res.status(400).json({ error: 'bad_promo', message: 'Choose a show or listing and 1, 3 or 24 hours.' });
    const owner = kind === 'stream' ? streams.get(body.targetId ?? '')?.creatorId : auctions.get(body.targetId ?? '')?.sellerId;
    if (!owner) return void res.status(404).json({ error: 'not_found' });
    if (owner !== me) return void res.status(403).json({ error: 'not_yours' });
    if (isPromoted(kind, body.targetId!)) return void res.status(409).json({ error: 'already_promoted', message: 'This is already promoted.' });
    const currency = sellerCurrency(me) as CurrencyCode;
    const amount = money.round2(money.convert(PROMO_PRICES_USD[hours], USD, currency));
    const now = Date.now();
    const p: Promo = { id: store.nextId('prm'), sellerId: me, kind, targetId: body.targetId!, amount, currency, startsAt: new Date(now).toISOString(), endsAt: new Date(now + Number(hours) * 3_600_000).toISOString() };
    db.promos.set(p.id, p);
    res.status(201).json({ promo: p, simulated: true });
  });
  app.get('/api/promos/prices', (req, res) => {
    const me = actorId(req);
    const currency = (me ? sellerCurrency(me) : 'USD') as CurrencyCode;
    res.json({ currency, options: Object.entries(PROMO_PRICES_USD).map(([h, usd]) => ({ hours: Number(h), amount: money.round2(money.convert(usd, USD, currency)) })) });
  });
  app.get('/api/me/promos', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    res.json({ items: [...db.promos.values()].filter((p) => p.sellerId === me).reverse().map((p) => ({ ...p, active: Date.parse(p.endsAt) > Date.now(), target: p.kind === 'stream' ? expandStream(p.targetId) : expandAuction(p.targetId) })) });
  });

  /* ── Vacation mode ── */
  app.put('/api/me/vacation', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const body = req.body as { on?: boolean; message?: string; until?: string };
    const u = users.get(me)!;
    const until = body.until && !Number.isNaN(Date.parse(body.until)) ? new Date(body.until).toISOString() : undefined;
    u.vacation = body.on ? { on: true, message: String(body.message ?? '').trim().slice(0, 140) || undefined, until } : { on: false };
    users.upsert(u);
    if (body.on) {
      // Offers waiting on this seller are closed so buyers aren't left hanging.
      for (const o of db.offers.values()) if (o.sellerId === me && o.status === 'pending') { o.status = 'declined'; o.updatedAt = store.iso(); db.offers.set(o.id, o); }
    }
    res.json({ vacation: u.vacation });
  });
}

/** Vacation ends by itself on its date (called from the heartbeat). */
export function endVacations(): void {
  const now = Date.now();
  for (const u of users.all()) {
    if (u.vacation?.on && u.vacation.until && Date.parse(u.vacation.until) <= now) {
      u.vacation = { on: false };
      users.upsert(u);
    }
  }
}
