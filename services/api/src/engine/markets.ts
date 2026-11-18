/**
 * Countries MoneyMart trades in, their currencies, live exchange rates, and the Owner's per-country gates.
 *
 * - Each country can be open or closed for BUYING (members there can bid and buy; we ship there) and for SELLING
 *   (members there can set up a shop, list and host shows). The Owner sets this in the console (setting
 *   `markets.countries`); a country that is not listed is closed.
 * - Rates: the built-in table, refreshed every 6 hours from a public rates feed (no key needed; set
 *   `MM_FX_SOURCE=off` to disable or `MM_FX_URL` to point elsewhere). The source must answer
 *   `{ rates: { CODE: unitsPerUSD } }`.
 */
import { currency as currencyMeta, type CurrencyCode } from '@moneymart/tokens';
import { money } from './money.js';
import { setFxRates, fxRates } from './money.js';
import { valueOf } from '../ai/registry.js';

export interface Market {
  code: string;
  name: string;
  flag: string;
  currency: CurrencyCode;
}

export const MARKETS: Market[] = [
  { code: 'US', name: 'United States', flag: '🇺🇸', currency: 'USD' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦', currency: 'CAD' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', currency: 'GBP' },
  { code: 'IE', name: 'Ireland', flag: '🇮🇪', currency: 'EUR' },
  { code: 'FR', name: 'France', flag: '🇫🇷', currency: 'EUR' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪', currency: 'EUR' },
  { code: 'NL', name: 'Netherlands', flag: '🇳🇱', currency: 'EUR' },
  { code: 'ES', name: 'Spain', flag: '🇪🇸', currency: 'EUR' },
  { code: 'IT', name: 'Italy', flag: '🇮🇹', currency: 'EUR' },
  { code: 'NG', name: 'Nigeria', flag: '🇳🇬', currency: 'NGN' },
  { code: 'GH', name: 'Ghana', flag: '🇬🇭', currency: 'GHS' },
  { code: 'KE', name: 'Kenya', flag: '🇰🇪', currency: 'KES' },
  { code: 'ZA', name: 'South Africa', flag: '🇿🇦', currency: 'ZAR' },
];

export type CountryGate = { buy: boolean; sell: boolean };

/** Default: every listed country open for buying and selling. */
export const DEFAULT_GATES: Record<string, CountryGate> = Object.fromEntries(MARKETS.map((m) => [m.code, { buy: true, sell: true }]));

export function gates(): Record<string, CountryGate> {
  const stored = valueOf<Record<string, Partial<CountryGate>>>('markets.countries') ?? {};
  const out: Record<string, CountryGate> = {};
  for (const m of MARKETS) {
    const base = DEFAULT_GATES[m.code];
    const s = stored[m.code] ?? {};
    out[m.code] = { buy: s.buy ?? base.buy, sell: s.sell ?? base.sell };
  }
  return out;
}

export const marketOf = (code?: string) => MARKETS.find((m) => m.code === (code ?? '').toUpperCase());
export const canBuyIn = (code?: string) => Boolean(marketOf(code) && gates()[marketOf(code)!.code].buy);
export const canSellIn = (code?: string) => Boolean(marketOf(code) && gates()[marketOf(code)!.code].sell);

/** Check a gates value before it is saved. */
export function checkGates(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'must be an object of countries';
  for (const [code, gate] of Object.entries(value as Record<string, unknown>)) {
    if (!marketOf(code)) return `${code} is not a MoneyMart country`;
    if (!gate || typeof gate !== 'object') return `${code} needs buy and sell`;
    const g = gate as Record<string, unknown>;
    if ((g.buy !== undefined && typeof g.buy !== 'boolean') || (g.sell !== undefined && typeof g.sell !== 'boolean')) return `${code}: buy and sell are on or off`;
  }
  return null;
}

/** What the apps show: countries, their currency and whether they are open, plus rates. */
export function marketsView() {
  const g = gates();
  const { rates, updatedAt } = fxRates();
  return {
    countries: MARKETS.map((m) => ({ ...m, currencySymbol: currencyMeta[m.currency]?.symbol ?? m.currency, ...g[m.code] })),
    /** US dollars per one unit of each currency. */
    usdPerUnit: Object.fromEntries(Object.keys(currencyMeta).map((c) => [c, rates[c]])),
    ratesUpdatedAt: updatedAt,
    ratesSource: updatedAt ? 'live' : 'built-in',
  };
}

/** Amount in another currency (rounded), for "≈ in your currency" displays. */
export const convertFor = (amount: number, from: CurrencyCode, to: CurrencyCode) => money.convert(amount, from, to);

let timer: NodeJS.Timeout | null = null;
export async function refreshRates(): Promise<boolean> {
  if (process.env.MM_FX_SOURCE === 'off') return false;
  try {
    const response = await fetch(process.env.MM_FX_URL ?? 'https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return false;
    const body = (await response.json()) as { rates?: Record<string, number> };
    if (!body.rates) return false;
    const usdPer: Record<string, number> = {};
    for (const code of Object.keys(currencyMeta)) {
      const perUsd = body.rates[code];
      if (typeof perUsd === 'number' && perUsd > 0) usdPer[code] = 1 / perUsd;
    }
    if (!Object.keys(usdPer).length) return false;
    setFxRates(usdPer, new Date().toISOString());
    return true;
  } catch {
    return false;
  }
}

export function startRates(): void {
  if (timer || process.env.MM_FX_SOURCE === 'off') return;
  void refreshRates();
  timer = setInterval(() => void refreshRates(), 6 * 60 * 60 * 1000);
  timer.unref();
}
