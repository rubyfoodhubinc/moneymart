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
  /**
   * Account preferences the user controls.
   *
   * These settings existed only as component state on the web and as
   * `onPress={() => undefined}` on mobile, so every one of them was discarded —
   * a currency change, a privacy toggle and a notification choice all appeared to
   * work and none of them survived leaving the screen. They live on the account
   * because that is the only place a preference can survive a restart.
   */
  preferences?: UserPreferences;
  /**
   * Seller onboarding answers and the return address shipping is quoted from.
   * Private to the account owner: never part of the public profile.
   */
  sellerProfile?: SellerProfile;
  /** Seller vacation mode: no new listings, shows or offers while on. */
  vacation?: { on: boolean; message?: string; until?: ISODate };
  createdAt: ISODate;
  lastLoginAt?: ISODate;
}

export interface UserPreferences {
  /** Whether the shop and listings are publicly visible. */
  publicProfile: boolean;
  /** Whether this user's bid history is shown to others. */
  bidHistoryPublic: boolean;
  /** Interface language tag, e.g. `en`. */
  language: string;
  /**
   * Per-category notification switches, keyed by the category the client uses
   * (`outbid`, `streamStart`, `endingSoon`, `orderUpdates`, `priceDrops`,
   * `marketing`). Absent keys mean "on".
   */
  notifications?: Record<string, boolean>;
  /**
   * Categories the user asked to see more of.
   *
   * Collected by the mobile setup screen. It was being sent and silently dropped,
   * which is the same defect as a toggle that does not save.
   */
  interests?: string[];
}

export type SellerEntity = 'individual' | 'business';
export type SellerBusinessType = 'reseller' | 'liquidator' | 'brand' | 'retailer' | 'consignment' | 'other';

export interface PostalAddress {
  fullName: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  countryCode: string;
}

/** Seller onboarding answers (bands are stored as the option id the client showed). */
export interface SellerProfile {
  entity: SellerEntity;
  businessType?: SellerBusinessType;
  mainCategory: string;
  subcategories: string[];
  channels: string[];
  socials: Record<string, string>;
  monthlyRevenue?: string;
  inventorySize?: string;
  teamSize?: string;
  weeklyLiveHours?: string;
  returnAddress: PostalAddress;
  completedAt: ISODate;
  updatedAt: ISODate;
}

/** A seller's request for a category the taxonomy does not have yet. */
export interface CategoryRequest {
  id: string;
  userId: string;
  name: string;
  parentId?: string;
  note?: string;
  createdAt: ISODate;
}

/** Resolved preferences, with the documented defaults filled in. */
export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  publicProfile: true,
  bidHistoryPublic: true,
  language: 'en',
};

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
  /** Live show item: no extra time for late bids — the clock never moves. */
  suddenDeath?: boolean;
  /** Buy It Now stock: units offered (default 1) and units sold so far. */
  quantity?: number;
  quantitySold?: number;
}

/** A buyer's shipping address. */
export interface BuyerAddress extends PostalAddress {
  id: string;
  phone?: string;
  isDefault: boolean;
  createdAt: ISODate;
}

export type ReportKind = 'user' | 'listing' | 'show' | 'message';
export interface SafetyReport {
  id: string;
  reporterId: string;
  kind: ReportKind;
  targetId: string;
  /** For a message: the show it was said in. */
  contextId?: string;
  reason: string;
  note?: string;
  status: 'open' | 'actioned' | 'dismissed';
  createdAt: ISODate;
  resolvedAt?: ISODate;
  resolvedBy?: string;
  resolution?: string;
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

export type ShowFormat = 'auction' | 'buy_now' | 'mixed';

export type LiveVideoProviderId = 'ivs' | 'cloudflare';

export interface StreamVideoRoom {
  provider: LiveVideoProviderId;
  roomId: string;
  /** Cloudflare WHIP ingest URL — a broadcast credential. */
  whipUrl?: string;
  whepUrl?: string;
  createdAt: ISODate;
}

/** Platform-wide live video choice, switched by staff from the admin dashboard. */
export interface LiveVideoSettings {
  primary: LiveVideoProviderId;
  /** Try the other provider when the primary cannot open a room. */
  autoFallback: boolean;
  updatedAt?: ISODate;
  updatedBy?: string;
  lastFailover?: { at: ISODate; from: LiveVideoProviderId; to: LiveVideoProviderId; reason: string; showId: string };
}

export interface ShowShipping {
  /** Buyers may collect in person instead of paying for shipping. */
  freePickup: boolean;
  /** Most a buyer pays in shipping across everything they win in this show. */
  shippingCap?: number;
}
export type ShowVisibility = 'public' | 'private';

export interface Stream {
  id: string;
  creatorId: string;
  title: string;
  category: string;
  subcategory?: string;
  description?: string;
  format?: ShowFormat;
  visibility?: ShowVisibility;
  /** BCP-47 tag of the language the host will speak. */
  language?: string;
  createdAt?: ISODate;
  /** Shows created together from one schedule share a series id. */
  seriesId?: string;
  /** Accounts the host trusts to moderate chat. */
  moderatorIds?: string[];
  /** Host-only: chat messages containing these words are held back. */
  mutedWords?: string[];
  /** The host flagged mature content; viewers see a warning first. */
  explicit?: boolean;
  shipping?: ShowShipping;
  /** Host-private: accounts to notify when the show goes live. */
  reminderUserIds?: string[];
  /** Host-private: the live video room this show broadcasts through. */
  video?: StreamVideoRoom;
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
  /** Sent by one of the show's moderators. */
  isModerator?: boolean;
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
  /** Who the parcel goes to (snapshot of the buyer's default address when the order was made). */
  shipToName?: string;
  /** How shipping was worked out, e.g. "Combined with your other items from this show". */
  shippingNote?: string;
  /** Show the order came from, so shipping can be combined per show. */
  streamId?: string;
  /** What was sold, for orders with no listing behind them (a Prize Drop). */
  title?: string;
  /** How the order came about when it was not a bid or Buy It Now. */
  source?: 'offer' | 'prize_drop';
  paidAt?: ISODate;
  shippedAt?: ISODate;
  /** MoneyMart credit the buyer used on this order (already taken off totalAmount). */
  creditApplied?: number;
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
  | 'rate_limited'
  /** The caller is not signed in, or the session token was rejected. */
  | 'not_authenticated'
  /** No shipping address on the account yet — the app asks for it before the first bid or buy. */
  | 'shipping_info_required'
  /** The seller has blocked this member. */
  | 'blocked'
  /** Every unit of this Buy It Now listing has sold. */
  | 'sold_out'
  /** MoneyMart is not open for buying in the buyer's country yet. */
  | 'country_closed';

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
  /** Public handle of the winner, for "X won!" in the live room. */
  winnerHandle?: string;
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
  /** The host started broadcasting; viewers waiting on the show should join the video. */
  'stream:started': (payload: { streamId: string; liveVideoProvider: LiveVideoProviderId }) => void;
  'chat:message': (payload: ChatMessage) => void;
  'chat:pin': (payload: { streamId: string; message: ChatMessage | null }) => void;
  /** A host or moderator removed a message. */
  'chat:removed': (payload: { streamId: string; messageId: string }) => void;
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
