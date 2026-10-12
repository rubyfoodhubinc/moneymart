/**
 * MoneyMart web — formatting & financial display helpers.
 *
 * One place for every displayed number so prices, timers and fees can never
 * disagree between surfaces. Rules mirror the server money engine (§10).
 */
import { MONETIZATION, currency as currencyMeta, type CurrencyCode } from '@moneymart/tokens';

export function isLuxury(categoryId?: string): boolean {
  if (!categoryId) return false;
  return (MONETIZATION.luxuryCategories as readonly string[]).includes(categoryId);
}

/** §10: 15% standard, 20% luxury; MoneyMart Pro reduces to 10% / 15%. */
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

export function currencySymbol(code: string): string {
  return (currencyMeta[code as CurrencyCode] ?? currencyMeta.USD).symbol;
}

/** Tiered bid increments — mirrors the server §9.2 increment schedule. */
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

/** §5.2 countdown formats: MM:SS under an hour, D:H:M:S above. */
export function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return '00:00';
  const totalSeconds = Math.floor(msRemaining / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  if (days > 0) return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

/** Relative age for notifications: Just now / 5m ago / 2h ago / Yesterday. */
export function formatAge(iso: string): string {
  const delta = Date.now() - Date.parse(iso);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatViewers(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return String(count);
}

export function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** Anonymise a bidder for the public history table (§5.2 Auction Detail). */
export function anonymiseBidder(bidderId: string, index: number): string {
  const digits = bidderId.replace(/\D/g, '').slice(-2);
  const base = 40 + ((digits ? Number(digits) : index * 7) % 60);
  return `Bidder #${String(base).padStart(4, '0')}`;
}

/** Deterministic accent used for chat names and avatar rings. */
export function accentFor(seed: string): string {
  const palette = ['#F5A623', '#00D4A1', '#4A9DEC', '#FFC85C', '#7C8CF8', '#FF8A65'];
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) % 9973;
  return palette[hash % palette.length] ?? '#F5A623';
}
