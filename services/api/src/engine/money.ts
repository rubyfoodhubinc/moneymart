/**
 * MoneyMart money + fee engine — blueprint §10 Monetization Model.
 * One implementation of every financial rule so no client can disagree.
 */
import { MONETIZATION, currency as currencyMeta, fxToUSD, type CurrencyCode } from '@moneymart/tokens';
import type { CostBreakdown } from '@moneymart/types';

export function isLuxury(categoryId?: string): boolean {
  if (!categoryId) return false;
  return (MONETIZATION.luxuryCategories as readonly string[]).includes(categoryId);
}

/**
 * Buyer's premium rate for a lot. §10: 15% standard, 20% luxury.
 * MoneyMart Pro reduces to 10% / 15%.
 */
export function buyersPremiumRate(categoryId?: string, isPro = false): number {
  const luxury = isLuxury(categoryId);
  if (isPro) return luxury ? MONETIZATION.proBuyersPremiumLuxury : MONETIZATION.proBuyersPremiumStandard;
  return luxury ? MONETIZATION.buyersPremiumLuxury : MONETIZATION.buyersPremiumStandard;
}

/** §10 Cross-border fee — applied when buyer and seller sit in different countries. */
export function crossBorderFee(amount: number, crossBorder: boolean): number {
  return crossBorder ? round2(amount * MONETIZATION.crossBorderFee) : 0;
}

/** Deterministic local tax stand-in for Avalara AvaTax (dev). */
export function taxRate(countryCode: string): number {
  switch (countryCode) {
    case 'NG':
      return 0.075; // VAT 7.5%
    case 'GB':
      return 0.2; // VAT 20%
    case 'CA':
      return 0.13; // HST (ON) representative
    case 'US':
      return 0.0725; // blended state sales tax
    default:
      return 0.05;
  }
}

/** Flat-zone shipping quote; replaced by DHL/FedEx/GIG integrations in production. */
export function shippingQuote(
  countryCode: string,
  crossBorder: boolean,
  hammerPrice: number,
): number {
  if (crossBorder) return hammerPrice > 2500 ? 95 : 48;
  switch (countryCode) {
    case 'NG':
      return hammerPrice > 2500 ? 25 : 12;
    case 'GB':
      return hammerPrice > 2500 ? 32 : 15;
    case 'CA':
      return hammerPrice > 2500 ? 38 : 18;
    default:
      return hammerPrice > 2500 ? 40 : 19;
  }
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Full checkout breakdown for a hammer price, exactly as disclosed to the buyer
 * before bid confirmation (§3.2, §4.2 Step 5).
 */
export function costBreakdown(params: {
  hammerPrice: number;
  currency: CurrencyCode;
  categoryId?: string;
  /**
   * Explicit premium already disclosed on the listing. When supplied it is
   * authoritative — the buyer must never be charged a different rate than the
   * one shown at bid time (§4.2 Step 5, §10).
   */
  buyersPremiumRate?: number;
  isPro?: boolean;
  buyerCountry?: string;
  sellerCountry?: string;
  shipping?: number;
  includeShipping?: boolean;
}): CostBreakdown {
  const {
    hammerPrice,
    currency,
    categoryId,
    isPro = false,
    buyerCountry = 'US',
    sellerCountry = 'US',
    includeShipping = true,
  } = params;

  const rate = params.buyersPremiumRate ?? buyersPremiumRate(categoryId, isPro);
  const buyersPremium = round2(hammerPrice * rate);
  const crossBorder = buyerCountry !== sellerCountry;
  const shipping = includeShipping
    ? params.shipping ?? shippingQuote(buyerCountry, crossBorder, hammerPrice)
    : 0;
  const taxable = hammerPrice + buyersPremium;
  const tax = round2(taxable * taxRate(buyerCountry));
  const border = crossBorderFee(hammerPrice + buyersPremium, crossBorder);
  const total = round2(hammerPrice + buyersPremium + shipping + tax + border);

  return {
    hammerPrice: round2(hammerPrice),
    buyersPremium,
    buyersPremiumRate: rate,
    shipping,
    tax: round2(tax + border),
    total,
    currency,
  };
}

/** §10 Creator split on live-stream GMV: 85% creator / 15% platform. */
export function creatorSplit(gmv: number): { creator: number; platform: number } {
  return {
    creator: round2(gmv * MONETIZATION.creatorShare),
    platform: round2(gmv * MONETIZATION.creatorPlatformShare),
  };
}

/** Seller payout after platform fee. */
export function sellerNet(hammerPrice: number, categoryId?: string): { gross: number; fee: number; net: number } {
  const rate = isLuxury(categoryId) ? 0.12 : 0.1;
  const fee = round2(hammerPrice * rate);
  return { gross: round2(hammerPrice), fee, net: round2(hammerPrice - fee) };
}

/* ── Formatting ────────────────────────────────────────── */

export function convert(amount: number, from: CurrencyCode, to: CurrencyCode): number {
  if (from === to) return amount;
  const usd = amount * (fxToUSD[from] ?? 1);
  return round2(usd / (fxToUSD[to] ?? 1));
}

export function formatMoney(
  amount: number,
  code: CurrencyCode = 'USD',
  options: { compact?: boolean; showCode?: boolean; decimals?: number } = {},
): string {
  const meta = currencyMeta[code] ?? currencyMeta.USD;
  const { compact = false, showCode = false, decimals } = options;
  const fractionDigits = decimals ?? (compact || amount >= 1000 ? 0 : 2);

  let body: string;
  try {
    body = new Intl.NumberFormat(meta.locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
      notation: compact && amount >= 10_000 ? 'compact' : 'standard',
    }).format(amount);
  } catch {
    body = amount.toFixed(fractionDigits);
  }
  return showCode ? `${meta.symbol}${body} ${code}` : `${meta.symbol}${body}`;
}

/**
 * §9.2 Increment check — bid must meet the minimum increment above current price.
 * Tiered schedule keeps low-value lots lively and high-value lots disciplined.
 */
export function minimumIncrement(currentBid: number): number {
  if (currentBid < 25) return 1;
  if (currentBid < 100) return 5;
  if (currentBid < 250) return 10;
  if (currentBid < 1000) return 25;
  if (currentBid < 2500) return 50;
  if (currentBid < 10_000) return 100;
  if (currentBid < 50_000) return 500;
  return 1000;
}

/** The lowest acceptable next bid for an auction. */
export function minimumNextBid(startingPrice: number, currentBid: number, bidCount: number): number {
  if (bidCount === 0 || currentBid <= 0) return round2(startingPrice);
  return round2(currentBid + minimumIncrement(currentBid));
}

/** Auto-bid increment options surfaced in the AutoBidModal (§5.2). */
export function autoBidIncrements(currentBid: number) {
  const base = minimumIncrement(currentBid);
  return {
    minimum: base,
    mid: round2(base * 2),
    aggressive: round2(base * 5),
  };
}

export const money = {
  isLuxury,
  buyersPremiumRate,
  crossBorderFee,
  taxRate,
  shippingQuote,
  round2,
  costBreakdown,
  creatorSplit,
  sellerNet,
  convert,
  formatMoney,
  minimumIncrement,
  minimumNextBid,
  autoBidIncrements,
};

export default money;
