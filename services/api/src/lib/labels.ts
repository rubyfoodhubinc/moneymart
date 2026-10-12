/** Shared display labels — single source so no surface invents its own wording. */
import { ANTI_SNIPE, ITEM_TIMER, categories, conditionGrades } from '@moneymart/tokens';

export function categoryLabel(categoryId: string): string {
  return categories.find((c) => c.id === categoryId)?.label ?? 'Collectibles';
}

export function categoryEmoji(categoryId: string): string {
  return categories.find((c) => c.id === categoryId)?.emoji ?? '🏺';
}

export function conditionLabel(condition: string): string {
  return conditionGrades.find((c) => c.value === condition)?.label ?? 'Good';
}

export function auctionTypeLabel(type: string): string {
  switch (type) {
    case 'live_stream':
      return 'Live Stream';
    case 'traditional':
      return 'Traditional Auction';
    case 'buy_now':
      return 'Buy Now';
    case 'make_offer':
      return 'Make an Offer';
    default:
      return 'Auction';
  }
}

export { ANTI_SNIPE, ITEM_TIMER };
