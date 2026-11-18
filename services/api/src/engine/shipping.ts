/**
 * Shipping for live sales, and whether a buyer is ready to buy.
 *
 * - The quote runs from the seller's return address to the buyer's default address: another country costs the
 *   cross-border rate, the same state/region a quarter less than elsewhere in the country.
 * - Inside one show the buyer pays shipping once: each new item only adds the difference if its quote is higher
 *   than what they have already paid for that show. A show's shipping cap (0 = free shipping) limits the total.
 * - A buyer needs a shipping address before their first bid or buy (setting `buyers.address_required`), so a won
 *   item can always be shipped. Nothing is charged until they win.
 */
import type { Auction, BidRejectionReason } from '@moneymart/types';
import { money } from './money.js';
import { addresses, blocks, orders, streams, users } from '../store.js';
import { valueOf } from '../ai/registry.js';
import { canBuyIn, marketOf } from './markets.js';

export interface ShippingQuote {
  amount: number;
  note: string;
  shipToName?: string;
  shippingAddress?: { line1: string; line2?: string; city: string; region?: string; postalCode?: string; countryCode: string };
}

/** Base quote for one parcel from the seller to the buyer. */
export function baseQuote(sellerId: string, buyerId: string, price: number, listingCurrency: Auction['currency'] = 'USD'): { amount: number; crossBorder: boolean; sameRegion: boolean } {
  const seller = users.get(sellerId);
  const buyer = users.get(buyerId);
  const from = seller?.sellerProfile?.returnAddress;
  const to = addresses.defaultFor(buyerId);
  const fromCountry = (from?.countryCode ?? seller?.countryCode ?? 'US').toUpperCase();
  const toCountry = (to?.countryCode ?? buyer?.countryCode ?? 'US').toUpperCase();
  const crossBorder = fromCountry !== toCountry;
  const sameRegion = !crossBorder && Boolean(from?.region && to?.region && from.region.trim().toLowerCase() === to.region.trim().toLowerCase());
  // Zone prices are in US dollars; the order is in the listing's currency.
  const zoneUsd = money.shippingQuote(toCountry, crossBorder, money.convert(price, listingCurrency, 'USD'));
  const zone = money.convert(zoneUsd, 'USD', listingCurrency);
  return { amount: money.round2(sameRegion ? zone * 0.75 : zone), crossBorder, sameRegion };
}

/** Shipping to charge on a new order for this auction, taking the show's combined shipping and cap into account. */
export function quoteForSale(auction: Auction, buyerId: string, price: number): ShippingQuote {
  const to = addresses.defaultFor(buyerId);
  const shipTo = to
    ? { shipToName: to.fullName, shippingAddress: { line1: to.line1, line2: to.line2, city: to.city, region: to.region, postalCode: to.postalCode, countryCode: to.countryCode } }
    : {};
  const base = baseQuote(auction.sellerId, buyerId, price, auction.currency);
  const stream = auction.streamId ? streams.get(auction.streamId) : undefined;
  if (!stream) return { amount: base.amount, note: base.crossBorder ? 'International shipping' : 'Shipping from the seller', ...shipTo };

  const cap = stream.shipping?.shippingCap;
  const earlier = orders.all().filter((o) => o.streamId === stream.id && o.buyerId === buyerId && o.orderStatus !== 'disputed');
  const paidSoFar = money.round2(earlier.reduce((sum, o) => sum + (o.shipping ?? 0), 0));
  // What has been paid so far is the highest quote so far, so the total becomes the highest quote overall.
  let target = Math.max(paidSoFar, base.amount);
  if (cap !== undefined) target = Math.min(target, cap);
  const amount = money.round2(Math.max(0, target - paidSoFar));
  const note =
    cap === 0
      ? 'Free shipping in this show'
      : earlier.length && amount === 0
        ? 'Combined with your other items from this show'
        : earlier.length
          ? 'Combined shipping for this show (difference only)'
          : cap !== undefined
            ? `Shipping in this show is capped at ${money.formatMoney(cap, auction.currency)}`
            : 'Pay shipping once per show';
  return { amount, note, ...shipTo };
}

/** Why this buyer may not bid or buy on this listing yet, or null when they may. */
export function buyerBlocker(auction: Auction, buyerId: string): { reason: BidRejectionReason; message: string } | null {
  if (blocks.has(auction.sellerId, buyerId)) return { reason: 'blocked', message: 'This seller is not accepting bids from your account.' };
  const country = addresses.defaultFor(buyerId)?.countryCode ?? users.get(buyerId)?.countryCode;
  if (country && !canBuyIn(country)) {
    return { reason: 'country_closed', message: `MoneyMart isn’t open for buying in ${marketOf(country)?.name ?? country} yet.` };
  }
  if (valueOf<boolean>('buyers.address_required') && !addresses.defaultFor(buyerId)) {
    return { reason: 'shipping_info_required', message: 'Add your shipping address to bid or buy. Nothing is charged until you win.' };
  }
  return null;
}
