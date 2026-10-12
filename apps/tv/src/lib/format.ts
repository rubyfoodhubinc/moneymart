/**
 * MoneyMart TV — shared formatting.
 * Identical rules to web and mobile so a price never differs per screen.
 */
import { currency as currencyMeta, type CurrencyCode } from '@moneymart/tokens';

export function formatMoney(
  amount: number,
  code: string = 'USD',
  options: { compact?: boolean; decimals?: number } = {},
): string {
  const meta = currencyMeta[code as CurrencyCode] ?? currencyMeta.USD;
  const { compact = false, decimals } = options;
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
  return `${meta.symbol}${body}`;
}

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

export function formatViewers(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return String(count);
}

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
  if (bidCount === 0 || currentBid <= 0) return startingPrice;
  return currentBid + minimumIncrement(currentBid);
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDayTime(iso: string): string {
  return new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}
