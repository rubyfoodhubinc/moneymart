/**
 * MoneyMart Escrow Service — the platform's trust mechanic (§4.1 Step 6, §9.1).
 *
 * The blueprint's promise is precise: "Payment processing (5-business-day payment
 * window) → seller payout released after buyer confirmation (typically 7–10
 * business days post-auction)." This service is that promise expressed as a state
 * machine that refuses illegal transitions.
 *
 * Enforced invariants:
 *   • A buyer cannot be charged without an order and an explicit confirmation.
 *   • Held funds cannot reach the seller before the buyer confirms receipt.
 *   • Only the buyer may confirm receipt; only the seller may mark shipped.
 *   • Every transition appends to an audit trail with the acting identity.
 *   • Released + refunded can never exceed what was actually collected.
 */
import type {
  EscrowEvent,
  EscrowRecord,
  EscrowState,
  EscrowSummary,
  Order,
  PaymentIntent,
  PaymentProviderId,
} from '@moneymart/types';
import { providerRegistry, type PaymentProvider } from './payments.js';
import { money } from './money.js';
import { orderEscrow, store } from '../store.js';

/** Seller-side platform fee by category — mirrors the payout engine (§10). */
function sellerFeeRate(categoryId?: string): number {
  return money.isLuxury(categoryId) ? 0.12 : 0.1;
}

export class EscrowError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 409) {
    super(message);
    this.name = 'EscrowError';
    this.code = code;
    this.status = status;
  }
}

/** Legal transitions, so an invalid move is a compile-time-ish refusal. */
const ALLOWED: Record<EscrowState, EscrowState[]> = {
  requires_payment: ['processing', 'in_escrow', 'failed', 'cancelled'],
  processing: ['in_escrow', 'failed'],
  in_escrow: ['releasing', 'disputed', 'refunded'],
  releasing: ['released', 'in_escrow'],
  released: [],
  disputed: ['refunded', 'releasing'],
  refunded: [],
  failed: ['requires_payment'],
  cancelled: [],
};

function transition(record: EscrowRecord, next: EscrowState, actor: string, note?: string): EscrowRecord {
  if (record.state === next) return record;
  const allowed = ALLOWED[record.state] ?? [];
  if (!allowed.includes(next)) {
    throw new EscrowError(
      'illegal_escrow_transition',
      `Cannot move escrow for ${record.orderId} from '${record.state}' to '${next}'.`,
    );
  }

  const outflow = money.round2(record.releasedAmount + record.refundedAmount);
  if (outflow > money.round2(record.heldAmount) + 0.01) {
    throw new EscrowError(
      'escrow_ledger_unbalanced',
      `Escrow ${record.orderId} would move ${outflow} against ${record.heldAmount} collected.`,
      500,
    );
  }

  const event: EscrowEvent = { at: store.iso(), state: next, actor, note };
  return orderEscrow.save({ ...record, state: next, history: [...record.history, event], updatedAt: store.iso() });
}

export interface OpenEscrowInput {
  order: Order;
  categoryId?: string;
  buyerCountry?: string;
  sellerCountry?: string;
}

/**
 * Create the escrow record for a freshly settled order. Called by the auction
 * engine at hammer fall, so no order can exist without an escrow ledger.
 */
export function openEscrow(input: OpenEscrowInput): EscrowRecord {
  const { order } = input;
  const existing = orderEscrow.get(order.id);
  if (existing) return existing;

  const crossBorder = Boolean(
    input.buyerCountry && input.sellerCountry && input.buyerCountry !== input.sellerCountry,
  );
  const provider = providerRegistry.selectFor(order.currency, input.buyerCountry);

  const record: EscrowRecord = {
    orderId: order.id,
    state: 'requires_payment',
    heldAmount: 0,
    releasedAmount: 0,
    refundedAmount: 0,
    currency: order.currency,
    provider: provider.id,
    crossBorderFee: crossBorder ? money.crossBorderFee(order.hammerPrice + order.buyersPremium, true) : 0,
    history: [{ at: store.iso(), state: 'requires_payment', actor: 'system', note: 'Invoice issued' }],
    updatedAt: store.iso(),
  };
  return orderEscrow.save(record);
}

/** What the buyer owes, straight from the order (never recomputed). */
function amountDue(order: Order): number {
  return money.round2(order.totalAmount);
}

/** What the seller receives once the buyer confirms, after platform fees. */
export function sellerNetFor(order: Order, categoryId?: string): number {
  const fee = money.round2(order.hammerPrice * sellerFeeRate(categoryId));
  return money.round2(order.hammerPrice - fee);
}

export function getEscrow(orderId: string): EscrowRecord | undefined {
  return orderEscrow.get(orderId);
}

export function requireEscrow(orderId: string): EscrowRecord {
  const record = orderEscrow.get(orderId);
  if (!record) throw new EscrowError('escrow_not_found', `No escrow ledger for order ${orderId}.`, 404);
  return record;
}

/**
 * Step 1 — the buyer pays. Creates a provider intent and, once the provider
 * confirms, moves the funds into escrow. A declined card leaves the record in
 * 'failed' with the reason preserved.
 */
export async function payOrder(params: {
  order: Order;
  actorId: string;
  categoryId?: string;
  providerId?: PaymentProviderId;
  rail?: string;
  /**
   * Charge a different amount than the invoice. Used only by the dev/test
   * controls to exercise the declined-card path deterministically.
   */
  chargeAmountOverride?: number;
}): Promise<{ intent: PaymentIntent; escrow: EscrowRecord }> {
  const { order, actorId } = params;
  if (order.buyerId !== actorId) {
    throw new EscrowError('not_the_buyer', 'Only the winning buyer can pay for this order.', 403);
  }

  let record = requireEscrow(order.id);
  if (record.state === 'in_escrow') {
    throw new EscrowError('already_paid', 'This order is already paid and held in escrow.');
  }
  if (record.state === 'released' || record.state === 'refunded') {
    throw new EscrowError('escrow_closed', 'This escrow has already been settled.');
  }
  if (record.state === 'disputed') {
    throw new EscrowError('escrow_disputed', 'Resolve the open dispute before paying again.');
  }

  /**
   * A declined payment must be retryable — the blueprint gives the buyer a
   * 5-business-day payment window (§4.2 Step 6). A `failed` escrow therefore
   * returns to `requires_payment` (the order is unpaid again) before a new
   * charge is attempted, rather than jumping straight to `processing`, which is
   * not a legal transition from `failed`.
   */
  if (record.state === 'failed') {
    record = transition(record, 'requires_payment', actorId, 'Retrying payment after a decline');
  }

  const provider: PaymentProvider = params.providerId
    ? (providerRegistry.get(params.providerId) ?? providerRegistry.selectFor(order.currency))
    : providerRegistry.selectFor(order.currency);

  record = transition(record, 'processing', actorId, `Charging via ${provider.id}`);

  const chargeAmount = params.chargeAmountOverride ?? amountDue(order);

  const intent = await provider.createIntent({
    orderId: order.id,
    amount: chargeAmount,
    currency: order.currency,
    rail: params.rail,
    customerId: order.buyerId,
  });

  const confirmed = await provider.confirmIntent(intent.id);

  if (confirmed.status !== 'succeeded') {
    const failed = transition(record, 'failed', actorId, confirmed.failureReason ?? 'payment_failed');
    return { intent: confirmed, escrow: failed };
  }

  const held = orderEscrow.save({
    ...record,
    heldAmount: money.round2(record.heldAmount + chargeAmount),
    provider: provider.id,
    chargeId: confirmed.id,
  });

  const inEscrow = transition(held, 'in_escrow', actorId, `Funds held: ${order.currency} ${chargeAmount}`);
  return { intent: { ...confirmed, orderId: order.id }, escrow: inEscrow };
}

/** Step 2 — the seller marks the lot shipped (does not release funds). */
export function markShipped(params: {
  order: Order;
  actorId: string;
  trackingNumber?: string;
  courierName?: string;
  categoryId?: string;
}): { order: Order; escrow: EscrowRecord } {
  const { order, actorId } = params;
  if (order.sellerId !== actorId) {
    throw new EscrowError('not_the_seller', 'Only the seller can mark this order shipped.', 403);
  }
  const record = requireEscrow(order.id);
  if (record.state !== 'in_escrow' && record.state !== 'releasing') {
    throw new EscrowError('escrow_not_funded', 'Goods can only ship once the buyer has paid into escrow.');
  }

  const updated: Order = {
    ...order,
    orderStatus: 'shipped',
    trackingNumber: params.trackingNumber ?? order.trackingNumber,
    courierName: params.courierName ?? order.courierName,
  };
  return { order: updated, escrow: record };
}

/**
 * Step 3 — the buyer confirms receipt. This is the only path that releases
 * funds, and it is the buyer's alone to take.
 */
export function confirmReceipt(params: {
  order: Order;
  actorId: string;
  categoryId?: string;
}): { order: Order; escrow: EscrowRecord; payoutAmount: number } {
  const { order, actorId } = params;
  if (order.buyerId !== actorId) {
    throw new EscrowError('not_the_buyer', 'Only the buyer can confirm receipt and release funds.', 403);
  }
  let record = requireEscrow(order.id);
  if (record.state === 'released') {
    throw new EscrowError('already_released', 'These funds have already been released.');
  }
  if (record.state !== 'in_escrow') {
    throw new EscrowError('escrow_not_funded', 'There are no held funds to release for this order.');
  }

  const payoutAmount = sellerNetFor(order, params.categoryId);
  record = transition(record, 'releasing', actorId, 'Buyer confirmed receipt');

  const payout = store.payouts.create({
    id: store.nextId('pay'),
    sellerId: order.sellerId,
    orderIds: [order.id],
    grossAmount: order.hammerPrice,
    platformFee: money.round2(order.hammerPrice - payoutAmount),
    netAmount: payoutAmount,
    currency: order.currency,
    payoutMethod: 'wallet',
    status: 'processing',
    initiatedAt: store.iso(),
    referenceId: `MM-PAY-${store.nextId('r').toUpperCase()}`,
  });

  const released = orderEscrow.save({
    ...record,
    releasedAmount: money.round2(record.releasedAmount + payoutAmount),
    payoutId: payout.id,
  });
  record = transition(released, 'released', 'system', `Released ${order.currency} ${payoutAmount} to seller`);

  const completed: Order = {
    ...order,
    orderStatus: 'complete',
    paymentStatus: 'paid',
    completedAt: store.iso(),
  };
  return { order: completed, escrow: record, payoutAmount };
}

/** The buyer raises a dispute: funds stay held, release is blocked. */
export function openDispute(params: { order: Order; actorId: string; reason?: string }): EscrowRecord {
  const { order, actorId } = params;
  if (order.buyerId !== actorId) {
    throw new EscrowError('not_the_buyer', 'Only the buyer can dispute this order.', 403);
  }
  const record = requireEscrow(order.id);
  return transition(record, 'disputed', actorId, params.reason ?? 'Buyer opened a dispute');
}

/** Admin resolution of a dispute: refund the buyer, or release to the seller. */
export function resolveDispute(params: {
  order: Order;
  actorId: string;
  resolution: 'refund' | 'release';
  categoryId?: string;
}): { escrow: EscrowRecord; order: Order } {
  const { order, actorId, resolution } = params;
  const record = requireEscrow(order.id);
  if (record.state !== 'disputed') {
    throw new EscrowError('not_disputed', 'Only a disputed escrow can be resolved.', 409);
  }

  if (resolution === 'refund') {
    // heldAmount records what was COLLECTED; refundedAmount records what went
    // back. Zeroing held here would destroy the audit trail and make the
    // balance invariant unverifiable.
    const refunded = orderEscrow.save({
      ...record,
      refundedAmount: money.round2(record.refundedAmount + record.heldAmount),
    });
    const final = transition(refunded, 'refunded', actorId, 'Dispute resolved in the buyer’s favour');
    return { escrow: final, order: { ...order, paymentStatus: 'refunded', orderStatus: 'complete' } };
  }

  // Release to the seller on the buyer's behalf.
  const payoutAmount = sellerNetFor(order, params.categoryId);
  const payout = store.payouts.create({
    id: store.nextId('pay'),
    sellerId: order.sellerId,
    orderIds: [order.id],
    grossAmount: order.hammerPrice,
    platformFee: money.round2(order.hammerPrice - payoutAmount),
    netAmount: payoutAmount,
    currency: order.currency,
    payoutMethod: 'wallet',
    status: 'processing',
    initiatedAt: store.iso(),
    referenceId: `MM-PAY-${store.nextId('r').toUpperCase()}`,
  });
  const released = orderEscrow.save({
    ...record,
    releasedAmount: money.round2(record.releasedAmount + payoutAmount),
    payoutId: payout.id,
  });
  const final = transition(released, 'released', actorId, 'Dispute resolved in the seller’s favour');
  return { escrow: final, order: { ...order, orderStatus: 'complete', paymentStatus: 'paid' } };
}

/**
 * Record that an order was already paid for before this ledger existed (seeded
 * or migrated data). Uses the same transitions as a live payment so the audit
 * trail and invariants hold identically.
 */
export function recordHistoricalPayment(params: {
  orderId: string;
  amount: number;
  actor: string;
  note?: string;
}): EscrowRecord {
  const record = requireEscrow(params.orderId);
  if (record.state === 'in_escrow' || record.state === 'released') return record;
  let current = transition(record, 'processing', params.actor, params.note ?? 'Historical payment');
  current = orderEscrow.save({ ...current, heldAmount: money.round2(params.amount), chargeId: store.nextId('pi_hist') });
  return transition(current, 'in_escrow', params.actor, 'Funds held in escrow');
}

/**
 * Invariant: heldAmount is cumulative COLLECTED (never decremented), while
 * releasedAmount/refundedAmount accumulate what left. So the condition is simply
 * released + refunded <= held. Enforced inside transition() on every move.
 */
export function assertLedgerBalanced(record: EscrowRecord): void {
  const outflow = money.round2(record.releasedAmount + record.refundedAmount);
  if (outflow > money.round2(record.heldAmount) + 0.01) {
    throw new EscrowError(
      'escrow_ledger_unbalanced',
      `Escrow ${record.orderId} released ${outflow} against ${record.heldAmount} held.`,
      500,
    );
  }
}

/** Presentation-ready summary for the API and every client. */
export function summarise(record: EscrowRecord): EscrowSummary {
  return {
    orderId: record.orderId,
    state: record.state,
    heldAmount: record.heldAmount,
    releasedAmount: record.releasedAmount,
    refundedAmount: record.refundedAmount,
    currency: record.currency,
    provider: record.provider,
    canPay: record.state === 'requires_payment' || record.state === 'failed',
    canConfirmReceipt: record.state === 'in_escrow',
    canDispute: record.state === 'in_escrow',
    canRefund: record.state === 'disputed',
  };
}

export const escrow = {
  open: openEscrow,
  recordHistoricalPayment,
  get: getEscrow,
  require: requireEscrow,
  pay: payOrder,
  markShipped,
  confirmReceipt,
  openDispute,
  resolveDispute,
  summarise,
  sellerNetFor,
  assertLedgerBalanced,
};

export default escrow;
