/** Shared display labels for web surfaces — mirrors services/api labels. */
import { categories, conditionGrades } from '@moneymart/tokens';

export function categoryLabel(categoryId?: string): string {
  if (!categoryId) return 'Collectibles';
  return categories.find((category) => category.id === categoryId)?.label ?? 'Collectibles';
}

export function categoryEmoji(categoryId?: string): string {
  if (!categoryId) return '🏺';
  return categories.find((category) => category.id === categoryId)?.emoji ?? '🏺';
}

export function conditionLabel(condition?: string): string {
  if (!condition) return 'Good';
  return conditionGrades.find((grade) => grade.value === condition)?.label ?? 'Good';
}

export function conditionHint(condition?: string): string {
  if (!condition) return '';
  return conditionGrades.find((grade) => grade.value === condition)?.hint ?? '';
}

export function auctionTypeLabel(type?: string): string {
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

export function orderStatusLabel(status?: string): string {
  switch (status) {
    case 'pending':
      return 'Pending payment';
    case 'processing':
      return 'Awaiting shipment';
    case 'shipped':
      return 'Shipped';
    case 'delivered':
      return 'Delivered';
    case 'disputed':
      return 'Disputed';
    case 'complete':
      return 'Complete';
    default:
      return 'Processing';
  }
}

export function statusTone(status?: string): 'gold' | 'green' | 'error' | 'neutral' {
  switch (status) {
    case 'shipped':
    case 'delivered':
    case 'complete':
      return 'green';
    case 'processing':
    case 'pending':
      return 'gold';
    case 'disputed':
      return 'error';
    default:
      return 'neutral';
  }
}
