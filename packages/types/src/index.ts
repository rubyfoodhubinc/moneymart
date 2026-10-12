/**
 * MoneyMart domain model — blueprint §9.3 Data Models.
 * Shared by the API service and every client. One definition, no drift.
 */
import type { CurrencyCode } from '@moneymart/tokens';

export type ISODate = string;
export type UserRole = 'buyer' | 'seller' | 'creator' | 'admin';
export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';
export type KycLevel = 0 | 1 | 2 | 3;

export interface User {
  id: string;
  email: string;
  phone?: string;
  displayName: string;
  handle: string;
  avatarUrl?: string;
  bio?: string;
  countryCode: string;
  currencyCode: CurrencyCode;
  role: UserRole;
  verificationStatus: VerificationStatus;
  kycLevel: KycLevel;
  rating: number;
  totalSales: number;
  followersCount: number;
  followingCount: number;
  responseTimeMinutes: number;
  isPro: boolean;
  createdAt: ISODate;
  lastLoginAt?: ISODate;
}

export type ItemCondition = 'new' | 'like_new' | 'good' | 'fair' | 'parts';

export interface Item {
  id: string;
  sellerId: string;
  title: string;
  description: string;
  categoryId: string;
  subcategoryId?: string;
  condition: ItemCondition;
  images: string[];
  provenance?: string;
  conditionReport?: string;
  /** MoneyMart Verified (MV) badge — §4.3 */
  authenticityStatus: 'unverified' | 'pending' | 'verified' | 'rejected';
  isVerified: boolean;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type AuctionType = 'live_stream' | 'traditional' | 'buy_now' | 'make_offer';
export type AuctionStatus = 'draft' | 'scheduled' | 'live' | 'ended' | 'sold' | 'cancelled';

export interface Auction {
  id: string;
  itemId: string;
  sellerId: string;
  auctionType: AuctionType;
  title: string;
  startingPrice: number;
  reservePrice?: number;
  currentBid: number;
  currentBidderId?: string;
  bidCount: number;
  buyItNowPrice?: number;
  startTime: ISODate;
  endTime: ISODate;
  status: AuctionStatus;
  buyersPremiumRate: number;
  currency: CurrencyCode;
  lotNumber?: string;
  streamId?: string;
  /** Winning state — §4.2 Step 5 */
  hammerPrice?: number;
  winnerId?: string;
  /** Watchlist count for social proof */
  watchers: number;
  featured?: boolean;
}

export type BidStatus = 'pending' | 'accepted' | 'rejected' | 'outbid' | 'winning';

export interface Bid {
  id: string;
  auctionId: string;
  bidderId: string;
  bidderHandle: string;
  amount: number;
  currency: CurrencyCode;
  timestamp: ISODate;
  isAutoBid: boolean;
  status: BidStatus;
}

export interface AutoBid {
  id: string;
  auctionId: string;
  bidderId: string;
  maxAmount: number;
  increment: number;
  aggressive: boolean;
  active: boolean;
  createdAt: ISODate;
}

export type StreamStatus = 'scheduled' | 'live' | 'ended';

/**
 * What a room should actually play, resolved server-side.
 *
 * `mode` is deliberately explicit: a demo manifest must never be presented as a
 * live broadcast, and an offline room must not hand a player a URL that fails.
 */
export type PlaybackMode = 'live' | 'demo' | 'offline';

export interface StreamPlayback {
  url?: string;
  mode: PlaybackMode;
  /** Human-readable source label for the player chrome. */
  label: string;
  updatedAt: ISODate;
}

export interface Stream {
  id: string;
  creatorId: string;
  title: string;
  category: string;
  scheduledStartTime: ISODate;
  actualStartTime?: ISODate;
  endTime?: ISODate;
  status: StreamStatus;
  viewerCount: number;
  peakViewerCount: number;
  hlsUrl: string;
  posterUrl: string;
  itemQueue: string[];
  activeAuctionId?: string;
  totalGMV: number;
  chatEnabled: boolean;
  recordingUrl?: string;
}

export interface ChatMessage {
  id: string;
  streamId: string;
  userId: string;
  displayName: string;
  body: string;
  isPinned: boolean;
  isCreator: boolean;
  createdAt: ISODate;
}

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type OrderStatus = 'pending' | 'processing' | 'shipped' | 'delivered' | 'disputed' | 'complete';

export interface Order {
  id: string;
  auctionId: string;
  buyerId: string;
  sellerId: string;
  hammerPrice: number;
  buyersPremium: number;
  shipping: number;
  tax: number;
  totalAmount: number;
  currency: CurrencyCode;
  paymentStatus: PaymentStatus;
  shippingAddress?: Address;
  trackingNumber?: string;
  courierName?: string;
  orderStatus: OrderStatus;
  createdAt: ISODate;
  completedAt?: ISODate;
}

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode?: string;
  countryCode: string;
}

export interface Payout {
  id: string;
  sellerId: string;
  orderIds: string[];
  grossAmount: number;
  platformFee: number;
  netAmount: number;
  currency: CurrencyCode;
  payoutMethod: 'bank' | 'mobile_money' | 'wallet';
  status: 'pending' | 'processing' | 'paid' | 'failed';
  initiatedAt: ISODate;
  completedAt?: ISODate;
  referenceId: string;
}

export type NotificationCategory = 'bids' | 'streams' | 'orders' | 'system';

export interface AppNotification {
  id: string;
  userId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  /** Deep link — §5.2 Notifications deep-linking */
  href: string;
  read: boolean;
  createdAt: ISODate;
}

/** Price history point — §4.3 market data */
export interface PricePoint {
  label: string;
  value: number;
}

/** §9.2 Bid validation pipeline outcome. */
export type BidRejectionReason =
  | 'auction_not_live'
  | 'auction_ended'
  | 'insufficient_funds'
  | 'below_minimum_increment'
  | 'already_winning'
  | 'self_bid'
  | 'rate_limited';

export interface BidPlacedPayload {
  auction: AuctionWithRelations;
  bid: Bid;
  /** True when anti-snipe pushed the clock — §9.2 */
  extended: boolean;
  extensionMs: number;
}

export interface BidRejectedPayload {
  auctionId: string;
  reason: BidRejectionReason;
  message: string;
  minimumBid: number;
}

export interface AuctionWonPayload {
  auction: AuctionWithRelations;
  winnerId: string;
  hammerPrice: number;
  buyersPremium: number;
  total: number;
}

export interface ApiError {
  error: string;
  code?: string;
  detail?: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface AuctionWithRelations extends Auction {
  item: Item;
  seller: PublicProfile;
  /** Watchers count / viewer count context */
  isLive: boolean;
  reserveMet: boolean;
}

export interface PublicProfile {
  id: string;
  displayName: string;
  handle: string;
  avatarUrl?: string;
  bio?: string;
  countryCode: string;
  rating: number;
  totalSales: number;
  followersCount: number;
  isVerified: boolean;
  isLive: boolean;
  responseTimeMinutes: number;
}

export interface StreamWithRelations extends Stream {
  /** Server-resolved playback source. */
  playback?: StreamPlayback;
  creator: PublicProfile;
  activeAuction?: AuctionWithRelations;
  queuedCount: number;
}

/* Financial helpers shared by every client so numbers never disagree. */
export interface CostBreakdown {
  hammerPrice: number;
  buyersPremium: number;
  buyersPremiumRate: number;
  shipping: number;
  tax: number;
  total: number;
  currency: CurrencyCode;
}

/** §9.2 Socket.IO event contract. */
export interface ServerToClientEvents {
  'auction:snapshot': (payload: { auction: AuctionWithRelations; bids: Bid[] }) => void;
  'auction:bid': (payload: BidPlacedPayload) => void;
  'auction:rejected': (payload: BidRejectedPayload) => void;
  'auction:won': (payload: AuctionWonPayload) => void;
  'auction:tick': (payload: { auctionId: string; endTime: ISODate; serverTime: ISODate }) => void;
  'auction:extended': (payload: { auctionId: string; endTime: ISODate; extensionMs: number }) => void;
  'auction:created': (payload: { auction: AuctionWithRelations }) => void;
  'stream:viewers': (payload: { streamId: string; viewerCount: number }) => void;
  'stream:item': (payload: { streamId: string; auctionId?: string; nextInQueue: number }) => void;
  'stream:ended': (payload: { streamId: string; totalGMV: number }) => void;
  'chat:message': (payload: ChatMessage) => void;
  'chat:pin': (payload: { streamId: string; message: ChatMessage | null }) => void;
  'notification': (payload: AppNotification) => void;
}

export interface ClientToServerEvents {
  /** Join the personal room so outbid and order alerts reach the client anywhere. */
  'user:join': (userId: string) => void;
  'auction:join': (auctionId: string) => void;
  'auction:leave': (auctionId: string) => void;
  'auction:placeBid': (payload: {
    auctionId: string;
    amount: number;
    bidderId: string;
    bidderHandle: string;
    isAutoBid?: boolean;
  }) => void;
  'auction:autoBid': (payload: {
    auctionId: string;
    bidderId: string;
    bidderHandle: string;
    maxAmount: number;
    increment: number;
    aggressive: boolean;
  }) => void;
  'auction:autoBidOff': (payload: { auctionId: string; bidderId: string }) => void;
  'stream:join': (streamId: string) => void;
  'stream:leave': (streamId: string) => void;
  'chat:send': (payload: { streamId: string; userId: string; displayName: string; body: string }) => void;
  'chat:pin': (payload: { streamId: string; messageId: string; userId: string }) => void;
}


/* ── Studio: creator storefront documents (no-code builder) ─────────────── */

export type StoreBlockKind =
  | 'hero'
  | 'liveNow'
  | 'featuredLots'
  | 'categoryGrid'
  | 'about'
  | 'stats'
  | 'testimonials'
  | 'newsletter'
  | 'cta'
  | 'recentSales';

export interface StoreBlock {
  id: string;
  kind: StoreBlockKind;
  copy: {
    title?: string;
    subtitle?: string;
    body?: string;
    ctaLabel?: string;
    ctaHref?: string;
    items?: string[];
  };
  options?: {
    columns?: number;
    limit?: number;
    tone?: 'gold' | 'green' | 'neutral';
    categoryId?: string;
    fullBleed?: boolean;
  };
  visible: boolean;
}

export interface StoreTheme {
  accent: string;
  surface: 'navy' | 'charcoal' | 'midnight';
  radius: 'sharp' | 'soft' | 'pill';
  density: 'compact' | 'comfortable' | 'spacious';
  showTagline: boolean;
}

export interface Storefront {
  id: string;
  ownerId: string;
  handle: string;
  name: string;
  tagline: string;
  logoText: string;
  theme: StoreTheme;
  blocks: StoreBlock[];
  published: boolean;
  updatedAt: string;
}

/* ── Payments & escrow (§9.1 Payments Service, §4.1 Step 6) ─────────────────
   MoneyMart holds buyer funds in escrow and releases them to the seller only
   after the buyer confirms the item arrived as described. These types are the
   contract every payment provider adapter must satisfy.
   ────────────────────────────────────────────────────────────────────────── */

/**
 * Escrow lifecycle for a single order.
 *
 *   requires_payment ──pay──▶ in_escrow ──buyer confirms──▶ releasing ──▶ released
 *          │                      │
 *          │                      ├──dispute──▶ disputed ──refund──▶ refunded
 *          └──fail──▶ failed      └──cancel───▶ cancelled
 */
export type EscrowState =
  | 'requires_payment'
  | 'processing'
  | 'in_escrow'
  | 'releasing'
  | 'released'
  | 'disputed'
  | 'refunded'
  | 'failed'
  | 'cancelled';

/** Which regional rail a payment used (§3.1 country matrix). */
export type PaymentProviderId =
  | 'stripe'
  | 'paypal'
  | 'paystack'
  | 'flutterwave'
  | 'interac'
  | 'mpesa'
  | 'simulated';

/**
 * Membership tiers, backed by RevenueCat entitlements.
 *
 * Deliberately separate from order payments: an order settles once through the
 * escrow state machine, whereas a membership is a recurring entitlement that
 * lives on the user and gates Pro pricing (10%/15% buyer's premium vs 15%/20%).
 */
export type SubscriptionTier = 'free' | 'pro' | 'elite';

export type SubscriptionStatus = 'active' | 'trialing' | 'grace_period' | 'expired' | 'canceled';

export interface Subscription {
  userId: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  /** Entitlement identifier as configured in RevenueCat. */
  entitlement: string;
  productIdentifier?: string;
  store?: 'app_store' | 'play_store' | 'stripe' | 'promotional';
  startedAt: string;
  expiresAt?: string;
  renewsAt?: string;
  /** True while the membership is usable, including a grace period. */
  isActive: boolean;
}

export type PaymentIntentStatus = 'requires_confirmation' | 'processing' | 'succeeded' | 'failed' | 'canceled';

export interface PaymentIntent {
  id: string;
  orderId: string;
  provider: PaymentProviderId;
  /** Amount the buyer is charged, in the order currency. */
  amount: number;
  currency: CurrencyCode;
  status: PaymentIntentStatus;
  /** Provider-side client secret / redirect token used to complete payment. */
  clientSecret?: string;
  /** Human-readable rejection reason when status is 'failed'. */
  failureReason?: string;
  createdAt: ISODate;
  settledAt?: ISODate;
}

export interface EscrowRecord {
  orderId: string;
  state: EscrowState;
  /** Amount collected from the buyer and currently held. */
  heldAmount: number;
  releasedAmount: number;
  refundedAmount: number;
  currency: CurrencyCode;
  provider: PaymentProviderId;
  /** Buyer-side charge reference. */
  chargeId?: string;
  /** Seller-side payout reference, set when funds are released. */
  payoutId?: string;
  /** Cross-border fee applied at checkout (§10). */
  crossBorderFee: number;
  history: EscrowEvent[];
  updatedAt: ISODate;
}

export interface EscrowEvent {
  at: ISODate;
  state: EscrowState;
  /** Who or what caused the transition: a user id, or 'system'. */
  actor: string;
  note?: string;
}

export interface PaymentMethodSummary {
  id: string;
  provider: PaymentProviderId;
  label: string;
  /** Last four digits, masked account, or mobile-money number. */
  reference: string;
  isDefault: boolean;
  /** Rails available for this method, e.g. ['card', 'bank_transfer']. */
  rails: string[];
}

export interface EscrowSummary {
  orderId: string;
  state: EscrowState;
  heldAmount: number;
  releasedAmount: number;
  refundedAmount: number;
  currency: CurrencyCode;
  provider: PaymentProviderId;
  canPay: boolean;
  canConfirmReceipt: boolean;
  canDispute: boolean;
  canRefund: boolean;
  /** Unix-ms timestamp when the auto-release window expires, if applied. */
  autoReleaseAt?: ISODate;
}
