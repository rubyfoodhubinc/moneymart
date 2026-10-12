/**
 * Market + currency metadata for the mobile app.
 * Mirrors the §3.1 country matrix in the blueprint: the launch rails and the
 * currencies each market settles in.
 */
import { currency, type CurrencyCode } from '@moneymart/tokens';

export interface MarketEntry {
  code: CurrencyCode;
  country: string;
  flag: string;
  symbol: string;
  locale: string;
  rails: string;
  languages: string;
  categories: string;
}

export const currencies: Record<CurrencyCode, MarketEntry> = {
  NGN: {
    code: 'NGN',
    country: 'Nigeria',
    flag: '🇳🇬',
    symbol: currency.NGN.symbol,
    locale: currency.NGN.locale,
    rails: 'Paystack · Flutterwave · USSD · Bank transfer',
    languages: 'English, Yoruba, Igbo, Hausa',
    categories: 'Fashion, Electronics, Art, Collectibles',
  },
  USD: {
    code: 'USD',
    country: 'United States',
    flag: '🇺🇸',
    symbol: currency.USD.symbol,
    locale: currency.USD.locale,
    rails: 'Stripe · PayPal · Apple Pay · Google Pay',
    languages: 'English',
    categories: 'Sneakers, Trading Cards, Watches, Jewelry',
  },
  GBP: {
    code: 'GBP',
    country: 'United Kingdom',
    flag: '🇬🇧',
    symbol: currency.GBP.symbol,
    locale: currency.GBP.locale,
    rails: 'Stripe · GoCardless · Open Banking (PSD2)',
    languages: 'English',
    categories: 'Antiques, Art, Designer Goods',
  },
  CAD: {
    code: 'CAD',
    country: 'Canada',
    flag: '🇨🇦',
    symbol: currency.CAD.symbol,
    locale: currency.CAD.locale,
    rails: 'Stripe · Interac e-Transfer',
    languages: 'English, French',
    categories: 'Art, Collectibles, Vehicles',
  },
  KES: {
    code: 'KES',
    country: 'Kenya',
    flag: '🇰🇪',
    symbol: currency.KES.symbol,
    locale: currency.KES.locale,
    rails: 'M-Pesa STK Push · Bank rails',
    languages: 'English, Kiswahili',
    categories: 'Agriculture, Vehicles, Art',
  },
  GHS: {
    code: 'GHS',
    country: 'Ghana',
    flag: '🇬🇭',
    symbol: currency.GHS.symbol,
    locale: currency.GHS.locale,
    rails: 'MTN MoMo · Bank transfer',
    languages: 'English, Twi',
    categories: 'Art, Kente, Collectibles',
  },
  ZAR: {
    code: 'ZAR',
    country: 'South Africa',
    flag: '🇿🇦',
    symbol: currency.ZAR.symbol,
    locale: currency.ZAR.locale,
    rails: 'Stripe · Local bank rails',
    languages: 'English, Afrikaans, Zulu',
    categories: 'Art, Watches, Vehicles',
  },
};

export const currencyMetaList: MarketEntry[] = Object.values(currencies);

export function marketFor(code: string): MarketEntry {
  return currencies[code as CurrencyCode] ?? currencies.USD;
}

export default currencies;
