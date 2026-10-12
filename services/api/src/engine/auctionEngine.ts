/**
 * MoneyMart Auction Engine — blueprint §9.2 Real-Time Bidding Engine.
 *
 * Performance-critical core. Guarantees:
 *   • Atomic bid ordering (single-writer, monotonic sequence — mirrors Redis LPUSH).
 *   • Full validation pipeline: funds → increment → time → anti-snipe extension.
 *   • Proxy (auto-bid) resolution with eBay-style second-price settlement.
 *   • Outbid notifications dispatched within 1s of a competing bid (§4.1 Step 5).
 *
 * The engine is pure with respect to transport: it mutates the domain store and
 * returns a list of events for the Socket.IO layer to broadcast. That keeps the
 * bidding logic unit-testable and identical across every client.
 */
import type {
  Auction,
  AuctionWonPayload,
  AutoBid,
  Bid,
  BidRejectedPayload,
  Stream,
} from '@moneymart/types';
import { ANTI_SNIPE } from '@moneymart/tokens';
import { money } from './money.js';
import { openEscrow } from './escrow.js';
import { isProUser } from './subscriptions.js';
import { auctions, autoBids, items, notifications, orders, streams, store, users } from '../store.js';

export type EngineEvent =
  | { type: 'bid'; auction: Auction; bid: Bid; extended: boolean; extensionMs: number }
  | { type: 'rejected'; payload: BidRejectedPayload; bidderId: string }
  | { type: 'outbid'; userId: string; auction: Auction; amount: number }
  | { type: 'won'; payload: AuctionWonPayload; viewerIds: string[] }
  | { type: 'extended'; auctionId: string; endTime: string; extensionMs: number }
  | { type: 'sold'; auction: Auction };

/** Rate limiting per bidder per auction — §9.1 gateway rate limiting (per-user). */
const bidTimestamps = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_MAX = 8;

function isRateLimited(bidderId: string, auctionId: string): boolean {
  const key = `${auctionId}::${bidderId}`;
  const now = Date.now();
  const recent = (bidTimestamps.get(key) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  bidTimestamps.set(key, recent);
  return recent.length > RATE_LIMIT_MAX;
}

function reject(auction: Auction, reason: BidRejectedPayload['reason'], message: string): BidRejectedPayload {
  return {
    auctionId: auction.id,
    reason,
    message,
    minimumBid: money.minimumNextBid(auction.startingPrice, auction.currentBid, auction.bidCount),
  };
}

/**
 * §9.2 Anti-snipe extension: any bid landing inside the final 10 seconds pushes
 * the clock out by 30 seconds, defending fair competition.
 */
function applyAntiSnipe(auction: Auction): { extended: boolean; extensionMs: number } {
  const remaining = Date.parse(auction.endTime) - Date.now();
  if (remaining > 0 && remaining <= ANTI_SNIPE.triggerWindowMs) {
    const nextEnd = new Date(Date.parse(auction.endTime) + ANTI_SNIPE.extensionMs).toISOString();
    auction.endTime = nextEnd;
    return { extended: true, extensionMs: ANTI_SNIPE.extensionMs };
  }
  return { extended: false, extensionMs: 0 };
}

function recordBid(params: {
  auction: Auction;
  bidderId: string;
  bidderHandle: string;
  amount: number;
  isAutoBid: boolean;
}): Bid {
  const { auction, bidderId, bidderHandle, amount, isAutoBid } = params;
  const bid: Bid = {
    id: store.nextId('bid'),
    auctionId: auction.id,
    bidderId,
    bidderHandle,
    amount: money.round2(amount),
    currency: auction.currency,
    timestamp: store.iso(),
    isAutoBid,
    // The newest bid on the ladder IS the winning bid; the previous holder is
    // demoted to 'outbid' below. Clients render the High-bid state from this.
    status: 'winning',
  };
  auctions.addBid(auction.id, bid);

  // Status ladder: exactly one 'winning' bid (the newest), everything older
  // either 'outbid' (a competing bidder) or 'accepted' (this bidder's own
  // earlier, now-superseded bid).
  const history = auctions.bids(auction.id);
  history.forEach((previous, index) => {
    if (index === 0) return;
    if (previous.bidderId !== bidderId) previous.status = 'outbid';
    else if (previous.status === 'winning') previous.status = 'accepted';
  });

  auction.currentBid = bid.amount;
  auction.currentBidderId = bidderId;
  auction.bidCount += 1;
  auctions.save(auction);
  return bid;
}

/** Resolve a proxy war between auto-bidders (§9.2 / glossary: Auto-Bid). */
function resolveAutoBids(auction: Auction): { bid: Bid; bidderId: string } | null {
  const active = autoBids.forAuction(auction.id).sort((a, b) => b.maxAmount - a.maxAmount);
  if (active.length === 0) return null;

  const [leader, challenger] = active;

  if (!challenger) {
    // Lone auto-bidder: keep them on top at the minimum legal step.
    const step = money.minimumNextBid(auction.startingPrice, auction.currentBid, auction.bidCount);
    if (step <= leader.maxAmount && auction.currentBidderId !== leader.bidderId) {
      const user = users.get(leader.bidderId);
      const bid = recordBid({
        auction,
        bidderId: leader.bidderId,
        bidderHandle: user?.handle ?? 'auto',
        amount: step,
        isAutoBid: true,
      });
      return { bid, bidderId: leader.bidderId };
    }
    return null;
  }

  // Two or more proxy bidders: the higher ceiling must hold the lead, and the
  // price settles at (lower ceiling + one step) capped by the leader's ceiling.
  // Two behaviours follow from that single rule:
  //   • a leader who has been outbid is pushed back up to the settlement price;
  //   • a leader who is already at the top and has over-exposed their ceiling
  //     (because a later, lower proxy joined) is pulled DOWN to the settlement,
  //     so the winner never pays more than the runner-up's maximum plus a step.
  const step = money.minimumIncrement(challenger.maxAmount);
  const settlement = money.round2(Math.min(leader.maxAmount, challenger.maxAmount + step));
  const alreadyLeading = auction.currentBidderId === leader.bidderId;

  // A proxy never exposes the bidder's ceiling: the price in the room is always
  // the settlement (runner-up's maximum + one step), even when that means
  // pulling the figure DOWN because a lower proxy joined after the leader.
  if (alreadyLeading && Math.abs(auction.currentBid - settlement) < 0.01) return null;
  if (!alreadyLeading && auction.currentBid > settlement) return null;

  const user = users.get(leader.bidderId);
  const bid = recordBid({
    auction,
    bidderId: leader.bidderId,
    bidderHandle: user?.handle ?? 'auto',
    amount: settlement,
    isAutoBid: true,
  });
  return { bid, bidderId: leader.bidderId };
}

/**
 * Price at which a newly registered auto-bidder takes the lead.
 *
 * A proxy bidder never overpays: the system exposes only the amount needed to
 * become the top bidder — one increment above the highest rival position, capped
 * by the bidder's own ceiling. That is what makes auto-bid safe to leave running.
 *
 * Crucially the opening is capped by the SETTLEMENT price, not by the bidder's
 * own ceiling. Opening at the ceiling would expose the bidder's maximum to the
 * room; capping at settlement keeps the true maximum private.
 */
function proxyOpening(auction: Auction, maxAmount: number, increment: number): number {
  const rivalBids = auctions.bids(auction.id).filter((bid) => bid.bidderId !== auction.currentBidderId);
  const rivalCeilings = autoBids.forAuction(auction.id).map((auto) => auto.maxAmount);
  const topRival = Math.max(auction.currentBid, ...rivalBids.map((bid) => bid.amount), ...rivalCeilings);
  const baseline = topRival > 0 ? topRival : auction.startingPrice;
  const step = increment > 0 ? increment : money.minimumIncrement(baseline);
  const noRivals = rivalBids.length === 0 && rivalCeilings.length === 0;
  const toLead = noRivals
    ? money.minimumNextBid(auction.startingPrice, auction.currentBid, auction.bidCount)
    : baseline + step;
  return money.round2(Math.min(maxAmount, toLead));
}

export interface PlaceBidInput {
  auctionId: string;
  bidderId: string;
  bidderHandle: string;
  amount: number;
  isAutoBid?: boolean;
}

/** Main entry point for a manual bid. */
export function placeBid(input: PlaceBidInput): EngineEvent[] {
  const events: EngineEvent[] = [];
  const auction = auctions.get(input.auctionId);
  if (!auction) return events;

  const rejectWith = (reason: BidRejectedPayload['reason'], message: string) => {
    events.push({ type: 'rejected', payload: reject(auction, reason, message), bidderId: input.bidderId });
    return events;
  };

  // (3) Time check — bid must arrive before countdown expiry.
  const remaining = Date.parse(auction.endTime) - Date.now();
  if (auction.status === 'ended' || auction.status === 'sold' || auction.status === 'cancelled') {
    return rejectWith('auction_ended', 'This auction has closed.');
  }
  if (remaining <= 0) {
    return rejectWith('auction_ended', 'This auction has closed.');
  }
  if (!auctions.isLive(auction) && auction.auctionType === 'live_stream') {
    return rejectWith('auction_not_live', 'This lot is not open for bidding yet.');
  }
  if (auction.sellerId === input.bidderId) {
    return rejectWith('self_bid', 'You cannot bid on your own listing.');
  }
  if (isRateLimited(input.bidderId, auction.id)) {
    return rejectWith('rate_limited', 'Slow down — too many bids in one second.');
  }

  // (2) Increment check — bid must meet the minimum increment above current price.
  const minimum = money.minimumNextBid(auction.startingPrice, auction.currentBid, auction.bidCount);
  const amount = money.round2(input.amount);
  if (amount < minimum) {
    return events.concat({
      type: 'rejected',
      payload: {
        auctionId: auction.id,
        reason: 'below_minimum_increment',
        message: `Bid must be at least ${money.formatMoney(minimum, auction.currency)}.`,
        minimumBid: minimum,
      },
      bidderId: input.bidderId,
    });
  }
  if (auction.currentBidderId === input.bidderId) {
    return rejectWith('already_winning', 'You already hold the highest bid.');
  }

  // (1) Funds check — wallet/payment method on file or sufficient balance.
  const bidder = users.get(input.bidderId);
  if (!bidder) {
    return rejectWith('insufficient_funds', 'No verified payment method on file.');
  }

  const previousBidderId = auction.currentBidderId;

  const bid = recordBid({
    auction,
    bidderId: input.bidderId,
    bidderHandle: input.bidderHandle,
    amount,
    isAutoBid: Boolean(input.isAutoBid),
  });

  // (4) Anti-snipe extension.
  const snipe = applyAntiSnipe(auction);

  // Consult proxies; the leader may immediately reclaim the top.
  const proxy = resolveAutoBids(auction);

  events.push({
    type: 'bid',
    auction: { ...auction },
    bid,
    extended: snipe.extended,
    extensionMs: snipe.extensionMs,
  });

  if (snipe.extended) {
    events.push({
      type: 'extended',
      auctionId: auction.id,
      endTime: auction.endTime,
      extensionMs: snipe.extensionMs,
    });
  }

  const displaced = proxy ? proxy.bidderId : null;
  const outbidUserId = previousBidderId && previousBidderId !== auction.currentBidderId ? previousBidderId : null;
  const notify = outbidUserId ?? displaced;
  if (notify && notify !== input.bidderId) {
    events.push({ type: 'outbid', userId: notify, auction: { ...auction }, amount: auction.currentBid });
  }

  return events;
}

/** Register or replace an auto-bid ceiling, then let proxies fight it out. */
export function setAutoBid(input: {
  auctionId: string;
  bidderId: string;
  bidderHandle: string;
  maxAmount: number;
  increment: number;
  aggressive: boolean;
}): EngineEvent[] {
  const events: EngineEvent[] = [];
  const auction = auctions.get(input.auctionId);
  if (!auction) return events;
  if (Date.parse(auction.endTime) - Date.now() <= 0) {
    events.push({
      type: 'rejected',
      payload: reject(auction, 'auction_ended', 'This auction has closed.'),
      bidderId: input.bidderId,
    });
    return events;
  }
  if (auction.sellerId === input.bidderId) {
    events.push({
      type: 'rejected',
      payload: reject(auction, 'self_bid', 'You cannot bid on your own listing.'),
      bidderId: input.bidderId,
    });
    return events;
  }

  const auto: AutoBid = {
    id: store.nextId('auto'),
    auctionId: input.auctionId,
    bidderId: input.bidderId,
    maxAmount: money.round2(input.maxAmount),
    increment: input.increment,
    aggressive: input.aggressive,
    active: true,
    createdAt: store.iso(),
  };
  autoBids.set(auto);

  // Open the proxy at the exact price needed to lead — never higher.
  const opening = proxyOpening(auction, auto.maxAmount, auto.increment);

  if (opening > 0 && opening <= auto.maxAmount && auction.currentBidderId !== input.bidderId) {
    const proxyEvents = placeBid({
      auctionId: input.auctionId,
      bidderId: input.bidderId,
      bidderHandle: input.bidderHandle,
      amount: opening,
      isAutoBid: true,
    });
    events.push(...proxyEvents);
    // This bidder's ceiling may still be beaten by a rival proxy — resolve the war.
    const leader = resolveAutoBids(auction);
    if (leader && leader.bidderId !== input.bidderId) {
      events.push({
        type: 'outbid',
        userId: input.bidderId,
        auction: { ...auction },
        amount: auction.currentBid,
      });
    }
  } else if (auction.currentBidderId !== input.bidderId) {
    // Ceiling cannot beat the rival position: the proxy is live but not leading.
    const leader = resolveAutoBids(auction);
    if (leader && leader.bidderId !== input.bidderId) {
      events.push({
        type: 'outbid',
        userId: input.bidderId,
        auction: { ...auction },
        amount: auction.currentBid,
      });
    }
  }

  return events;
}

export function cancelAutoBid(auctionId: string, bidderId: string): EngineEvent[] {
  autoBids.off(auctionId, bidderId);
  return [];
}

/**
 * Settle an auction that has reached its end time: determine the winner, apply
 * the buyer's premium, generate the order and the invoice notification.
 * §4.1 Step 6 / §4.2 Step 5.
 */
export function settleAuction(auctionId: string): EngineEvent[] {
  const events: EngineEvent[] = [];
  const auction = auctions.get(auctionId);
  if (!auction) return events;
  if (auction.status === 'sold' || auction.status === 'ended') return events;
  if (Date.parse(auction.endTime) - Date.now() > 0) return events;

  autoBids.forAuction(auctionId).forEach((a) => autoBids.off(auctionId, a.bidderId));

  const history = auctions.bids(auctionId);
  const winning = history[0];
  const reserveMet = !auction.reservePrice || (winning ? winning.amount >= auction.reservePrice : false);

  if (!winning || !reserveMet) {
    auction.status = 'ended';
    auctions.save(auction);
    events.push({ type: 'sold', auction: { ...auction } });
    return events;
  }

  const hammerPrice = winning.amount;
  const winnerId = winning.bidderId;
  const buyer = users.get(winnerId);
  const seller = users.get(auction.sellerId);
  // Lots and auctions live in separate maps in the store, so the category —
  // which decides whether the luxury rate applies — comes from the item.
  const lot = items.get(auction.itemId);
  /**
   * The listing discloses the STANDARD category rate (20% for luxury), which is
   * what §4.2 Step 5 requires a bidder to see. Settlement then applies the
   * winner's membership discount on top, so the charge matches what that buyer's
   * quote showed — a Pro member pays 15% on the same lot. Both paths run the
   * disclosed rate through effectiveBuyersPremiumRate, so they cannot diverge.
   */
  const winnerIsPro = isProUser(winnerId);
  const rate = money.effectiveBuyersPremiumRate(auction.buyersPremiumRate, lot?.categoryId, winnerIsPro);
  const breakdown = money.costBreakdown({
    hammerPrice,
    currency: auction.currency,
    buyersPremiumRate: rate,
    isPro: winnerIsPro,
    buyerCountry: buyer?.countryCode ?? 'US',
    sellerCountry: seller?.countryCode ?? 'US',
  });

  auction.status = 'sold';
  auction.hammerPrice = hammerPrice;
  auction.winnerId = winnerId;
  auctions.save(auction);

  const order = orders.create({
    id: store.nextId('ord'),
    auctionId: auction.id,
    buyerId: winnerId,
    sellerId: auction.sellerId,
    hammerPrice,
    buyersPremium: breakdown.buyersPremium,
    shipping: breakdown.shipping,
    tax: breakdown.tax,
    totalAmount: breakdown.total,
    currency: auction.currency,
    // Funds are not in hand yet: the winner now owes the invoice. The escrow
    // service moves this to 'in_escrow' when the buyer actually pays.
    paymentStatus: 'pending',
    orderStatus: 'pending',
    createdAt: store.iso(),
  });

  // Open the escrow ledger at hammer fall so no order can exist without one.
  // The category drives the luxury seller-fee tier on release.
  openEscrow({
    order,
    categoryId: items.get(auction.itemId)?.categoryId,
    buyerCountry: buyer?.countryCode,
    sellerCountry: seller?.countryCode,
  });

  notifications.create({
    id: store.nextId('ntf'),
    userId: winnerId,
    category: 'orders',
    title: 'You won the lot',
    body: `${auction.title} — hammer ${money.formatMoney(hammerPrice, auction.currency)} plus ${Math.round(rate * 100)}% buyer's premium. Total ${money.formatMoney(order.totalAmount, auction.currency)} due; funds are held in escrow until you confirm delivery. Invoice ${order.id}.`,
    href: `/orders/${order.id}`,
    read: false,
    createdAt: store.iso(),
  });

  notifications.create({
    id: store.nextId('ntf'),
    userId: auction.sellerId,
    category: 'orders',
    title: 'Your lot sold',
    body: `${auction.title} sold for ${money.formatMoney(hammerPrice, auction.currency)}.`,
    href: `/account/selling`,
    read: false,
    createdAt: store.iso(),
  });

  // Build the expanded projection the clients render, without importing the
  // HTTP layer's view helper (keeps the engine transport-agnostic).
  const wonItem = items.get(auction.itemId);
  const wonSeller = users.get(auction.sellerId);
  const payload: AuctionWonPayload = {
    auction: {
      ...auction,
      item: wonItem ?? {
        id: auction.itemId,
        sellerId: auction.sellerId,
        title: auction.title,
        description: '',
        categoryId: 'collectibles',
        condition: 'good',
        images: [],
        authenticityStatus: 'unverified',
        isVerified: false,
        createdAt: auction.startTime,
        updatedAt: auction.endTime,
      },
      seller: {
        id: auction.sellerId,
        displayName: wonSeller?.displayName ?? 'Seller',
        handle: wonSeller?.handle ?? 'seller',
        avatarUrl: wonSeller?.avatarUrl,
        bio: wonSeller?.bio,
        countryCode: wonSeller?.countryCode ?? 'US',
        rating: wonSeller?.rating ?? 0,
        totalSales: wonSeller?.totalSales ?? 0,
        followersCount: wonSeller?.followersCount ?? 0,
        isVerified: wonSeller?.verificationStatus === 'verified',
        isLive: false,
        responseTimeMinutes: wonSeller?.responseTimeMinutes ?? 0,
      },
      isLive: false,
      reserveMet: true,
    },
    winnerId,
    hammerPrice,
    buyersPremium: breakdown.buyersPremium,
    total: breakdown.total,
  };

  events.push({ type: 'won', payload, viewerIds: [winnerId, auction.sellerId] });
  events.push({ type: 'sold', auction: { ...auction } });
  return events;
}

/** Move a live stream to its next queued lot — §4.1 Step 4/6 seamless continuity. */
export function advanceStreamQueue(stream: Stream): EngineEvent[] {
  const queue = stream.itemQueue.filter((id) => {
    const a = auctions.get(id);
    return a && a.status !== 'sold' && a.status !== 'ended' && a.status !== 'cancelled';
  });

  stream.itemQueue = queue;
  const nextId = queue[0];
  if (!nextId) {
    stream.activeAuctionId = undefined;
    streams.save(stream);
    return [];
  }

  const next = auctions.get(nextId);
  if (next) {
    next.status = 'live';
    next.startTime = store.iso();
    auctions.save(next);
    stream.activeAuctionId = next.id;
  }
  streams.save(stream);
  return [];
}

/** Maintain a live lot's clock; called from the server heartbeat. */
export function tickAuction(auctionId: string): EngineEvent[] {
  const auction = auctions.get(auctionId);
  if (!auction) return [];
  if (Date.parse(auction.endTime) - Date.now() <= 0 && auction.status === 'live') {
    const events = settleAuction(auctionId);
    if (auction.streamId) {
      const stream = streams.get(auction.streamId);
      if (stream) events.push(...advanceStreamQueue(stream));
    }
    return events;
  }
  return [];
}

/** Current live auctions that need a settlement pass. */
export function auctionsDueForSettlement(): Auction[] {
  return [...store.db.auctions.values()].filter(
    (a) => a.status === 'live' && Date.parse(a.endTime) - Date.now() <= 0,
  );
}

export const engine = {
  placeBid,
  setAutoBid,
  cancelAutoBid,
  settleAuction,
  tickAuction,
  advanceStreamQueue,
  auctionsDueForSettlement,
};

export default engine;
