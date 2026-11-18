/**
 * Buyer readiness, follows, blocks, reports and show moderation.
 *
 * - Addresses: a buyer's shipping addresses (private). One is the default; bids and buys need one
 *   (`buyers.address_required`), and orders copy it at the moment of sale.
 * - Follows: real follow/unfollow with live counts; a seller you follow going live notifies you.
 * - Blocks: a block also removes follows both ways; the seller's blocked members cannot bid or chat in their shows,
 *   and the app hides chat from people you blocked.
 * - Reports: members report a member, listing, show or chat message; the Owner console (tab `tickets`) works them.
 * - Moderation: the host and their moderators can pin, remove a message and time a member out of chat.
 */
import type { Express, Request, Response } from 'express';
import type { BuyerAddress, ReportKind, Stream } from '@moneymart/types';
import { addresses, auctions, blocks, chat, chatMutes, follows, reports, store, streams, users } from './store.js';
import { accessFor, writeAudit } from './ai/access.js';
import { money } from './engine/money.js';
import { baseQuote, buyerBlocker, quoteForSale } from './engine/shipping.js';
import { isProUser } from './engine/subscriptions.js';
import { canBuyIn, checkGates, marketOf, marketsView, MARKETS } from './engine/markets.js';
import { settings } from './store.js';

type ActorFn = (req: Request) => string;
type Emit = (room: string, event: 'chat:removed' | 'chat:pin', payload: unknown) => void;

const COUNTRY = /^[A-Za-z]{2}$/;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function signedIn(req: Request, res: Response, actorId: ActorFn): string | null {
  const id = actorId(req);
  if (!id || !users.get(id)) {
    res.status(401).json({ error: 'not_authenticated' });
    return null;
  }
  return id;
}

function findUser(idOrHandle: string) {
  return users.get(idOrHandle) ?? users.findByHandle(idOrHandle.replace(/^@/, ''));
}

/** Host or one of the show's moderators. */
export function canModerate(stream: Stream | undefined, userId: string): boolean {
  return Boolean(stream && userId && (stream.creatorId === userId || (stream.moderatorIds ?? []).includes(userId)));
}

function checkAddress(body: Record<string, unknown>): { value?: Omit<BuyerAddress, 'id' | 'createdAt' | 'isDefault'>; error?: string } {
  const fullName = text(body.fullName, 80);
  const line1 = text(body.line1, 120);
  const city = text(body.city, 80);
  const region = text(body.region, 80);
  const postalCode = text(body.postalCode, 20);
  const countryCode = text(body.countryCode, 2).toUpperCase();
  if (!fullName) return { error: 'Add the name the parcel is for.' };
  if (!line1) return { error: 'Add the street address.' };
  if (!city) return { error: 'Add the city.' };
  if (!COUNTRY.test(countryCode)) return { error: 'Choose a country.' };
  if (!canBuyIn(countryCode)) return { error: `We don’t deliver to ${marketOf(countryCode)?.name ?? countryCode} yet.` };
  if (!postalCode && ['US', 'GB', 'CA'].includes(countryCode)) return { error: 'Add the postal code.' };
  const phone = text(body.phone, 30);
  if (phone && !/^[+\d][\d\s()-]{5,}$/.test(phone)) return { error: 'That phone number does not look right.' };
  return { value: { fullName, line1, line2: text(body.line2, 120) || undefined, city, region, postalCode, countryCode, phone: phone || undefined } };
}

export function mountCommunityRoutes(app: Express, actorId: ActorFn, emit: Emit): void {
  /* ── Countries and currencies ── */
  app.get('/api/markets', (_req, res) => {
    res.json(marketsView());
  });

  app.get('/api/admin/markets', (req, res) => {
    const me = actorId(req);
    const access = me ? accessFor(users.get(me)) : null;
    if (!access || !access.tabs.includes('settings')) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const members = users.all();
    res.json({
      ...marketsView(),
      members: Object.fromEntries(MARKETS.map((m) => [m.code, members.filter((u) => u.countryCode === m.code).length])),
    });
  });

  app.put('/api/admin/markets', (req, res) => {
    const me = actorId(req);
    const access = me ? accessFor(users.get(me)) : null;
    if (!access || !access.tabs.includes('settings')) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const countries = (req.body as { countries?: unknown }).countries;
    const problem = checkGates(countries);
    if (problem) {
      res.status(400).json({ error: 'invalid', detail: problem });
      return;
    }
    const before = settings.get<Record<string, unknown>>('markets.countries') ?? {};
    const next = { ...before, ...(countries as Record<string, unknown>) };
    settings.set('markets.countries', next);
    writeAudit(access.email || me, 'markets.update', 'markets.countries', { changes: countries });
    res.json({ ok: true, ...marketsView() });
  });

  /* ── Addresses ── */
  app.get('/api/me/addresses', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    res.json({ items: addresses.forUser(me), ready: Boolean(addresses.defaultFor(me)) });
  });

  app.post('/api/me/addresses', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const list = addresses.forUser(me);
    if (list.length >= 10) {
      res.status(400).json({ error: 'invalid_address', detail: 'You can keep up to 10 addresses.' });
      return;
    }
    const { value, error } = checkAddress((req.body ?? {}) as Record<string, unknown>);
    if (!value) {
      res.status(400).json({ error: 'invalid_address', detail: error });
      return;
    }
    const isDefault = list.length === 0 || (req.body as { isDefault?: boolean }).isDefault === true;
    const address: BuyerAddress = { id: store.nextId('adr'), ...value, isDefault, createdAt: store.iso() };
    addresses.save(me, [...list.map((a) => (isDefault ? { ...a, isDefault: false } : a)), address]);
    res.json({ ok: true, address, items: addresses.forUser(me) });
  });

  app.put('/api/me/addresses/:id', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const list = addresses.forUser(me);
    const existing = list.find((a) => a.id === req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'address_not_found' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { value, error } = checkAddress({ ...existing, ...body });
    if (!value) {
      res.status(400).json({ error: 'invalid_address', detail: error });
      return;
    }
    const makeDefault = body.isDefault === true;
    addresses.save(
      me,
      list.map((a) => (a.id === existing.id ? { ...a, ...value, isDefault: makeDefault || a.isDefault } : makeDefault ? { ...a, isDefault: false } : a)),
    );
    res.json({ ok: true, items: addresses.forUser(me) });
  });

  app.delete('/api/me/addresses/:id', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const list = addresses.forUser(me);
    const removed = list.find((a) => a.id === req.params.id);
    let next = list.filter((a) => a.id !== req.params.id);
    if (removed?.isDefault && next.length) next = next.map((a, i) => ({ ...a, isDefault: i === 0 }));
    addresses.save(me, next);
    res.json({ ok: true, items: next });
  });

  /** What it would cost this buyer, shipped to their default address, at a given price (bid or Buy It Now). */
  app.get('/api/auctions/:id/quote', (req, res) => {
    const auction = auctions.get(req.params.id);
    if (!auction) {
      res.status(404).json({ error: 'auction_not_found' });
      return;
    }
    const me = actorId(req);
    const price = Number(req.query.price ?? auction.buyItNowPrice ?? Math.max(auction.currentBid, auction.startingPrice));
    if (!Number.isFinite(price) || price <= 0) {
      res.status(400).json({ error: 'invalid_price' });
      return;
    }
    const isPro = me ? isProUser(me) : false;
    const rate = money.effectiveBuyersPremiumRate(auction.buyersPremiumRate, undefined, isPro);
    const hasAddress = Boolean(me && addresses.defaultFor(me));
    const quote = me && hasAddress ? quoteForSale(auction, me, price) : { amount: baseQuote(auction.sellerId, me || auction.sellerId, price, auction.currency).amount, note: 'Estimated — add your address for the exact amount' };
    const breakdown = money.costBreakdown({
      hammerPrice: price,
      currency: auction.currency,
      buyersPremiumRate: rate,
      isPro,
      buyerCountry: (me && addresses.defaultFor(me)?.countryCode) || users.get(me)?.countryCode || 'US',
      sellerCountry: users.get(auction.sellerId)?.sellerProfile?.returnAddress?.countryCode?.toUpperCase() ?? users.get(auction.sellerId)?.countryCode ?? 'US',
      shipping: quote.amount,
    });
    const blocker = me ? buyerBlocker(auction, me) : null;
    const viewerCurrency = (me && users.get(me)?.currencyCode) || auction.currency;
    res.json({
      ...breakdown,
      shippingNote: quote.note,
      ready: !blocker,
      blocker: blocker?.reason ?? null,
      /** The buyer's own currency and the total converted at today's rate (an estimate; charged in `currency`). */
      viewerCurrency,
      viewerTotal: viewerCurrency === auction.currency ? breakdown.total : money.convert(breakdown.total, auction.currency, viewerCurrency),
    });
  });

  /* ── Follows ── */
  const followResponse = (me: string, sellerId: string) => {
    const seller = users.get(sellerId)!;
    return { following: follows.is(me, sellerId), followersCount: seller.followersCount };
  };

  app.post('/api/users/:id/follow', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const seller = findUser(req.params.id);
    if (!seller) {
      res.status(404).json({ error: 'user_not_found' });
      return;
    }
    if (seller.id === me) {
      res.status(400).json({ error: 'cannot_follow_self' });
      return;
    }
    if (blocks.between(me, seller.id)) {
      res.status(403).json({ error: 'blocked', detail: 'You can’t follow this member.' });
      return;
    }
    if (!follows.is(me, seller.id)) {
      follows.add(me, seller.id);
      users.upsert({ ...seller, followersCount: (seller.followersCount ?? 0) + 1 });
      const self = users.get(me)!;
      users.upsert({ ...self, followingCount: (self.followingCount ?? 0) + 1 });
    }
    res.json({ ok: true, ...followResponse(me, seller.id) });
  });

  app.delete('/api/users/:id/follow', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const seller = findUser(req.params.id);
    if (!seller) {
      res.status(404).json({ error: 'user_not_found' });
      return;
    }
    unfollow(me, seller.id);
    res.json({ ok: true, ...followResponse(me, seller.id) });
  });

  app.get('/api/me/following', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    res.json({ ids: follows.following(me) });
  });

  /** How the signed-in member relates to another member (for Follow / Blocked buttons). */
  app.get('/api/users/:id/relationship', (req, res) => {
    const me = actorId(req);
    const other = findUser(req.params.id);
    if (!other) {
      res.status(404).json({ error: 'user_not_found' });
      return;
    }
    res.json({
      following: Boolean(me && follows.is(me, other.id)),
      followsYou: Boolean(me && follows.is(other.id, me)),
      blocked: Boolean(me && blocks.has(me, other.id)),
      followersCount: other.followersCount,
      followingCount: other.followingCount,
    });
  });

  /* ── Blocks ── */
  app.post('/api/users/:id/block', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const other = findUser(req.params.id);
    if (!other || other.id === me) {
      res.status(404).json({ error: 'user_not_found' });
      return;
    }
    blocks.add(me, other.id);
    unfollow(me, other.id);
    unfollow(other.id, me);
    res.json({ ok: true, blocked: true });
  });

  app.delete('/api/users/:id/block', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const other = findUser(req.params.id);
    if (other) blocks.remove(me, other.id);
    res.json({ ok: true, blocked: false });
  });

  app.get('/api/me/blocks', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    res.json({ ids: blocks.by(me) });
  });

  /* ── Reports ── */
  const KINDS: ReportKind[] = ['user', 'listing', 'show', 'message'];
  const reportLog = new Map<string, number[]>();
  app.post('/api/reports', (req, res) => {
    const me = signedIn(req, res, actorId);
    if (!me) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const kind = body.kind as ReportKind;
    const targetId = text(body.targetId, 80);
    const reason = text(body.reason, 60);
    if (!KINDS.includes(kind) || !targetId || !reason) {
      res.status(400).json({ error: 'invalid_report', detail: 'Choose what is wrong.' });
      return;
    }
    const recent = (reportLog.get(me) ?? []).filter((t) => Date.now() - t < 86_400_000);
    if (recent.length >= 20) {
      res.status(429).json({ error: 'rate_limited', detail: 'You’ve sent a lot of reports today. We’re reviewing them.' });
      return;
    }
    reportLog.set(me, [...recent, Date.now()]);
    const report = reports.save({
      id: store.nextId('rep'),
      reporterId: me,
      kind,
      targetId,
      contextId: text(body.contextId, 80) || undefined,
      reason,
      note: text(body.note, 500) || undefined,
      status: 'open',
      createdAt: store.iso(),
    });
    res.json({ ok: true, id: report.id });
  });

  app.get('/api/admin/reports', (req, res) => {
    const me = actorId(req);
    const access = me ? accessFor(users.get(me)) : null;
    if (!access || !access.tabs.includes('tickets')) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const label = (id: string) => {
      const u = users.get(id);
      return u ? `${u.displayName} (@${u.handle})` : id;
    };
    const target = (r: { kind: ReportKind; targetId: string; contextId?: string }) => {
      if (r.kind === 'user') return label(r.targetId);
      if (r.kind === 'listing') return auctions.get(r.targetId)?.title ?? r.targetId;
      if (r.kind === 'show') return streams.get(r.targetId)?.title ?? r.targetId;
      const msg = chat.get(r.contextId ?? '').find((m) => m.id === r.targetId);
      return msg ? `“${msg.body.slice(0, 120)}” — ${label(msg.userId)}` : 'Message (removed)';
    };
    res.json({ items: reports.all().slice(0, 300).map((r) => ({ ...r, reporter: label(r.reporterId), target: target(r) })) });
  });

  app.post('/api/admin/reports/:id', (req, res) => {
    const me = actorId(req);
    const access = me ? accessFor(users.get(me)) : null;
    if (!access || !access.tabs.includes('tickets')) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const report = reports.get(req.params.id);
    if (!report) {
      res.status(404).json({ error: 'report_not_found' });
      return;
    }
    const status = (req.body as { status?: string }).status;
    if (status !== 'actioned' && status !== 'dismissed' && status !== 'open') {
      res.status(400).json({ error: 'invalid_status' });
      return;
    }
    const resolution = text((req.body as { resolution?: unknown }).resolution, 300) || undefined;
    reports.save({ ...report, status, resolution, resolvedAt: status === 'open' ? undefined : store.iso(), resolvedBy: status === 'open' ? undefined : access.email || me });
    writeAudit(access.email || me, 'report.resolve', report.id, { status, kind: report.kind });
    res.json({ ok: true });
  });

  /* ── Show moderation (host and moderators) ── */
  const moderated = (req: Request, res: Response): { me: string; stream: Stream } | null => {
    const me = actorId(req);
    const stream = streams.get(req.params.id);
    if (!stream || !canModerate(stream, me)) {
      res.status(404).json({ error: 'stream_not_found' });
      return null;
    }
    return { me, stream };
  };

  /** The host names or removes moderators at any time, including during the show. */
  app.put('/api/streams/:id/moderators', (req, res) => {
    const me = actorId(req);
    const stream = streams.get(req.params.id);
    if (!stream || stream.creatorId !== me) {
      res.status(404).json({ error: 'stream_not_found' });
      return;
    }
    const raw = (req.body as { moderators?: unknown }).moderators;
    if (!Array.isArray(raw) || raw.length > 10) {
      res.status(400).json({ error: 'invalid_moderators', detail: 'Up to 10 moderators.' });
      return;
    }
    const ids: string[] = [];
    for (const entry of raw) {
      const user = findUser(String(entry).trim());
      if (!user) {
        res.status(400).json({ error: 'invalid_moderators', detail: `No account called @${String(entry).replace(/^@/, '')}.` });
        return;
      }
      if (user.id !== stream.creatorId && !ids.includes(user.id)) ids.push(user.id);
    }
    streams.save({ ...stream, moderatorIds: ids });
    res.json({ ok: true, moderatorIds: ids });
  });

  app.post('/api/streams/:id/pin', (req, res) => {
    const m = moderated(req, res);
    if (!m) return;
    const messageId = (req.body as { messageId?: string | null }).messageId ?? null;
    const target = messageId ? chat.get(m.stream.id).find((msg) => msg.id === messageId) ?? null : null;
    if (messageId && !target) {
      res.status(404).json({ error: 'message_not_found' });
      return;
    }
    chat.pin(m.stream.id, target?.id ?? null);
    emit(`stream:${m.stream.id}`, 'chat:pin', { streamId: m.stream.id, message: target });
    res.json({ ok: true, message: target });
  });

  app.post('/api/streams/:id/chat/:messageId/remove', (req, res) => {
    const m = moderated(req, res);
    if (!m) return;
    const removed = chat.remove(m.stream.id, req.params.messageId);
    if (removed) emit(`stream:${m.stream.id}`, 'chat:removed', { streamId: m.stream.id, messageId: req.params.messageId });
    res.json({ ok: true, removed });
  });

  app.post('/api/streams/:id/timeout', (req, res) => {
    const m = moderated(req, res);
    if (!m) return;
    const { userId, minutes } = (req.body ?? {}) as { userId?: string; minutes?: number };
    const target = userId ? users.get(userId) : undefined;
    if (!target || target.id === m.stream.creatorId) {
      res.status(400).json({ error: 'invalid_target' });
      return;
    }
    const mins = Math.round(Number(minutes ?? 10));
    if (!Number.isFinite(mins) || mins < 0 || mins > 1440) {
      res.status(400).json({ error: 'invalid_minutes', detail: 'Between 0 and 1440 minutes.' });
      return;
    }
    if (mins === 0) chatMutes.clear(m.stream.id, target.id);
    else chatMutes.set(m.stream.id, target.id, new Date(Date.now() + mins * 60_000).toISOString());
    res.json({ ok: true, until: chatMutes.until(m.stream.id, target.id) ?? null });
  });
}

function unfollow(followerId: string, sellerId: string): void {
  if (!follows.is(followerId, sellerId)) return;
  follows.remove(followerId, sellerId);
  const seller = users.get(sellerId);
  if (seller) users.upsert({ ...seller, followersCount: Math.max(0, (seller.followersCount ?? 0) - 1) });
  const follower = users.get(followerId);
  if (follower) users.upsert({ ...follower, followingCount: Math.max(0, (follower.followingCount ?? 0) - 1) });
}

/** Whether a chat message from this member is allowed in this show. */
export function mayChat(stream: Stream | undefined, userId: string): boolean {
  if (!stream) return false;
  if (blocks.has(stream.creatorId, userId)) return false;
  return !chatMutes.isMuted(stream.id, userId);
}
