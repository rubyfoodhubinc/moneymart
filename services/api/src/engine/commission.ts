/**
 * Tiered seller commission (from 8%). The tier comes from the seller's last 30 days of sales, in US dollars,
 * so a busy seller in any currency moves up the same way. Luxury categories cost two points more at every tier.
 */
import { money } from './money.js';
import { orders } from '../store.js';
import type { CurrencyCode } from '@moneymart/tokens';

export interface CommissionTier {
  id: 'starter' | 'rising' | 'power';
  label: string;
  /** 30-day sales (USD) needed to reach this tier. */
  fromUSD: number;
  rate: number;
}

export const TIERS: CommissionTier[] = [
  { id: 'starter', label: 'Starter', fromUSD: 0, rate: 0.1 },
  { id: 'rising', label: 'Rising', fromUSD: 1_000, rate: 0.09 },
  { id: 'power', label: 'Power Seller', fromUSD: 10_000, rate: 0.08 },
];
const LUXURY_EXTRA = 0.02;

export function salesUSD30(sellerId: string): number {
  const since = Date.now() - 30 * 86_400_000;
  return money.round2(
    orders
      .selling(sellerId)
      .filter((o) => Date.parse(o.createdAt) >= since && o.paymentStatus !== 'refunded')
      .reduce((sum, o) => sum + money.convert(o.hammerPrice, o.currency, 'USD' as CurrencyCode), 0),
  );
}

export function tierFor(sellerId: string): { tier: CommissionTier; next?: CommissionTier; salesUSD: number; toNextUSD?: number } {
  const salesUSD = salesUSD30(sellerId);
  const tier = [...TIERS].reverse().find((t) => salesUSD >= t.fromUSD) ?? TIERS[0];
  const next = TIERS[TIERS.indexOf(tier) + 1];
  return { tier, next, salesUSD, toNextUSD: next ? money.round2(next.fromUSD - salesUSD) : undefined };
}

export function feeRateFor(sellerId: string, categoryId?: string): number {
  const { tier } = tierFor(sellerId);
  return money.round2(tier.rate + (money.isLuxury(categoryId) ? LUXURY_EXTRA : 0));
}
