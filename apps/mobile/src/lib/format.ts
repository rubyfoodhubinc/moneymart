/**
 * MoneyMart mobile — shared formatting and money helpers.
 * The web app has an identical module; both mirror the server money engine so a
 * price on the phone always equals the price on the web.
 */
import { MONETIZATION, currency as currencyMeta, type CurrencyCode } from '@moneymart/tokens';

export function isLuxury(categoryId?: string): boolean {
  if (!categoryId) return false;
  return (MONETIZATION.luxuryCategories as readonly string[]).includes(categoryId);
}

export function buyersPremiumRate(categoryId?: string, isPro = false): number {
  const luxury = isLuxury(categoryId);
  if (isPro) return luxury ? MONETIZATION.proBuyersPremiumLuxury : MONETIZATION.proBuyersPremiumStandard;
  return luxury ? MONETIZATION.buyersPremiumLuxury : MONETIZATION.buyersPremiumStandard;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatMoney(
  amount: number,
  code: CurrencyCode | string = 'USD',
  options: { compact?: boolean; showCode?: boolean; decimals?: number } = {},
): string {
  const meta = currencyMeta[code as CurrencyCode] ?? currencyMeta.USD;
  const { compact = false, showCode = false, decimals } = options;
  const digits = decimals ?? (compact || Math.abs(amount) >= 1000 ? 0 : 2);
  let body: string;
  try {
    body = new Intl.NumberFormat(meta.locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      notation: compact && Math.abs(amount) >= 10_000 ? 'compact' : 'standard',
    }).format(amount);
  } catch {
    body = amount.toFixed(digits);
  }
  return showCode ? `${meta.symbol}${body} ${code}` : `${meta.symbol}${body}`;
}

/** Tiered increments — mirrors the server §9.2 schedule exactly. */
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

export function minimumNextBid(startingPrice: number, currentBid: number, bidCount: number): number {
  if (bidCount === 0 || currentBid <= 0) return round2(startingPrice);
  return round2(currentBid + minimumIncrement(currentBid));
}

/** §5.2 countdown: MM:SS under an hour, D:H:M:S above. */
export function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return '00:00';
  const total = Math.floor(msRemaining / 1000);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  if (days > 0) return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function formatAge(iso: string): string {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

export function formatViewers(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return String(count);
}

export function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function anonymiseBidder(bidderId: string, index: number): string {
  const digits = bidderId.replace(/\D/g, '').slice(-2);
  const base = 40 + ((digits ? Number(digits) : index * 7) % 60);
  return `Bidder #${String(base).padStart(4, '0')}`;
}

export function categoryLabel(categoryId?: string): string {
  const labels: Record<string, string> = {
    sneakers: 'Sneakers',
    watches: 'Watches',
    jewelry: 'Jewelry',
    art: 'Art',
    collectibles: 'Collectibles',
    cards: 'Trading Cards',
    fashion: 'Fashion',
    electronics: 'Electronics',
    vehicles: 'Vehicles',
    antiques: 'Antiques',
  };
  return labels[categoryId ?? ''] ?? 'Collectibles';
}

export function conditionLabel(condition?: string): string {
  const labels: Record<string, string> = {
    new: 'New',
    like_new: 'Like New',
    good: 'Good',
    fair: 'Fair',
    parts: 'Parts Only',
  };
  return labels[condition ?? ''] ?? 'Good';
}
