/**
 * MoneyMart — subscriptions and entitlements (RevenueCat).
 *
 * Deliberately NOT a PaymentProvider. An order settles exactly once through the
 * escrow state machine, whereas a membership is a recurring entitlement that
 * lives on the user and changes what they pay: Pro reduces the buyer's premium
 * from 15%/20% to 10%/15% (§10).
 *
 * RevenueCat is the source of truth on a device purchase, and this service
 * mirrors it server-side. Two consequences shape the design:
 *
 *  • A webhook can arrive before, after, or without the client ever calling us,
 *    so entitlements are stored on the user and read from there.
 *  • A real charge must never be priced off a client's claim of being Pro, so the
 *    premium rate is resolved server-side at settlement from this record.
 *
 * Without REVENUECAT_SECRET_KEY the API stays fully exercisable: entitlements
 * can be granted through the dev-only endpoint, and the demo buyer is seeded as
 * a member so the Pro pricing path is always visible.
 */
import type { Subscription, SubscriptionStatus, SubscriptionTier } from '@moneymart/types';
import { store } from '../store.js';

/** Entitlement identifiers as configured in the RevenueCat dashboard. */
export const ENTITLEMENTS: Record<Exclude<SubscriptionTier, 'free'>, string> = {
  pro: 'pro',
  elite: 'elite',
};

/** Tiers ordered by capability; a higher tier satisfies a lower requirement. */
const TIER_RANK: Record<SubscriptionTier, number> = { free: 0, pro: 1, elite: 2 };

export interface RevenueCatWebhookEvent {
  type?: string;
  app_user_id?: string;
  product_id?: string;
  entitlement_ids?: string[] | null;
  expiration_at_ms?: number | null;
  purchased_at_ms?: number | null;
  store?: string;
  period_type?: string;
  environment?: string;
}

/* ── RevenueCat REST client ────────────────────────────────────────────── */

export class RevenueCatClient {
  private readonly secretKey: string | undefined;
  private readonly baseUrl = 'https://api.revenuecat.com/v1';

  constructor(secretKey = process.env.REVENUECAT_SECRET_KEY) {
    this.secretKey = secretKey;
  }

  isConfigured(): boolean {
    return Boolean(this.secretKey && this.secretKey.length > 8);
  }

  /**
   * Fetch a subscriber's entitlements.
   * Returns null when unconfigured so the caller can fall back to local state
   * rather than treating "no credentials" as "no subscription".
   */
  async getSubscriber(appUserId: string): Promise<{ entitlements: Record<string, { expires_date: string | null; product_identifier?: string }> } | null> {
    if (!this.isConfigured()) return null;
    const response = await fetch(`${this.baseUrl}/subscribers/${encodeURIComponent(appUserId)}`, {
      headers: { authorization: `Bearer ${this.secretKey}`, accept: 'application/json' },
    });
    if (response.status === 404) return { entitlements: {} };
    if (!response.ok) throw new Error(`revenuecat_error:${response.status}`);
    const json = (await response.json()) as {
      subscriber?: { entitlements?: Record<string, { expires_date: string | null; product_identifier?: string }> };
    };
    return { entitlements: json.subscriber?.entitlements ?? {} };
  }
}

export const revenueCat = new RevenueCatClient();

/* ── Entitlement resolution ────────────────────────────────────────────── */

function nowMs(): number {
  return Date.now();
}

/** Is this entitlement currently valid, allowing for RevenueCat's null = lifetime? */
function entitlementActive(expiresDate: string | null | undefined): boolean {
  if (!expiresDate) return true; // lifetime / non-expiring
  const expiry = Date.parse(expiresDate);
  return Number.isFinite(expiry) ? expiry > nowMs() : false;
}

/**
 * Map an entitlement identifier to a tier.
 *
 * Matching is against the configured identifiers (ENTITLEMENTS) rather than a
 * substring test. A substring test looks reasonable but fails on the dashboard's
 * own casing — `PRO` does not include the lowercase `pro` — and on identifiers
 * like "pro_annual" that mean something other than the standard Pro tier. An
 * unrecognised identifier must resolve to `free` rather than silently granting.
 */
export function tierForEntitlement(identifier: string): SubscriptionTier {
  const canonical = identifier.trim().toLowerCase();
  if (canonical === ENTITLEMENTS.elite.toLowerCase()) return 'elite';
  if (canonical === ENTITLEMENTS.pro.toLowerCase()) return 'pro';
  return 'free';
}

export function highestTier(entitlements: Record<string, { expires_date: string | null }>): SubscriptionTier {
  let tier: SubscriptionTier = 'free';
  for (const [id, detail] of Object.entries(entitlements)) {
    if (!entitlementActive(detail.expires_date)) continue;
    const candidate = tierForEntitlement(id);
    if (TIER_RANK[candidate] > TIER_RANK[tier]) tier = candidate;
  }
  return tier;
}

export function tierRank(tier: SubscriptionTier): number {
  return TIER_RANK[tier] ?? 0;
}

/**
 * Does the user hold at least the Pro entitlement?
 *
 * Resolved server-side. The seeded `User.isPro` flag is honoured as a baseline
 * so the demo buyer keeps Pro pricing, but a stored subscription always wins.
 */
export function isProUser(userId: string): boolean {
  const subscription = store.subscriptions.get(userId);
  if (subscription) {
    /**
     * Gate on status first. `tier` records what the user bought and survives an
     * expiration, so trusting it alone would keep granting Pro pricing to a
     * lapsed member — exactly the bug this shape prevents.
     */
    const usable =
      subscription.status === 'active' ||
      subscription.status === 'trialing' ||
      subscription.status === 'grace_period' ||
      (subscription.status === 'canceled' && entitlementActive(subscription.expiresAt));
    if (!usable) return false;
    return tierRank(subscription.tier) >= TIER_RANK.pro;
  }
  return Boolean(store.users.get(userId)?.isPro);
}

/** The user's current membership, synthesising a free tier when none is stored. */
export function getSubscription(userId: string): Subscription {
  const stored = store.subscriptions.get(userId);
  if (stored) {
    // Expiry is authoritative: a lapsed record must not keep granting benefits.
    if (stored.expiresAt && Date.parse(stored.expiresAt) <= nowMs() && stored.status === 'active') {
      const expired: Subscription = { ...stored, status: 'expired', isActive: false };
      store.subscriptions.save(expired);
      return expired;
    }
    return stored;
  }

  const user = store.users.get(userId);
  return {
    userId,
    tier: user?.isPro ? 'pro' : 'free',
    status: user?.isPro ? 'active' : 'expired',
    entitlement: user?.isPro ? ENTITLEMENTS.pro : 'none',
    store: 'promotional',
    startedAt: user?.createdAt ?? store.iso(),
    isActive: Boolean(user?.isPro),
  };
}

/* ── Webhook handling ──────────────────────────────────────────────────── */

/**
 * Webhook event types that end a membership immediately.
 * TRANSFER moves a subscription to a different app user id, so the old record
 * must be cleared or two users would both hold the entitlement.
 */
const REVOKING_EVENTS = new Set([
  'EXPIRATION',
  'SUBSCRIPTION_PAUSED',
  'TRANSFER',
  'REFUND',
]);

const GRANTING_EVENTS = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'PRODUCT_CHANGE',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
  'SUBSCRIPTION_EXTENDED',
  'TEMPORARY_ENTITLEMENT_GRANT',
]);

/** RevenueCat reports an `environment`; only apply live events in production. */
export function shouldApplyEvent(event: RevenueCatWebhookEvent): boolean {
  if (process.env.MM_APPLY_SANDBOX_EVENTS === 'true') return true;
  if (process.env.NODE_ENV !== 'production') return true;
  return event.environment !== 'SANDBOX';
}

/**
 * Apply a RevenueCat event to the local entitlement record.
 * Returns the resulting subscription, or null when the event carries no user.
 */
export function applyWebhookEvent(event: RevenueCatWebhookEvent): Subscription | null {
  const userId = event.app_user_id;
  if (!userId) return null;

  /**
   * The store can confirm a purchase before the app has ever called the API, so
   * the webhook may name an unknown buyer. Provisioning here is what makes the
   * entitlement attachable without discarding a paid-for subscription.
   */
  store.users.ensure(userId);

  const type = String(event.type ?? '').toUpperCase();
  const existing = store.subscriptions.get(userId);
  const expiresAt = event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : existing?.expiresAt;
  const store_: Subscription['store'] =
    event.store === 'APP_STORE' ? 'app_store' : event.store === 'PLAY_STORE' ? 'play_store' : event.store === 'STRIPE' ? 'stripe' : existing?.store;

  if (REVOKING_EVENTS.has(type)) {
    /**
     * Every revoking event clears the tier. Retaining it would leave a record
     * that reads as a Pro member to anything inspecting `tier` without also
     * checking `status`, and an EXPIRATION is not a downgrade the user chose —
     * it is the end of the entitlement.
     */
    return store.subscriptions.save({
      userId,
      tier: 'free',
      status: type === 'TRANSFER' ? 'canceled' : 'expired',
      entitlement: 'none',
      productIdentifier: event.product_id ?? existing?.productIdentifier,
      store: store_,
      startedAt: existing?.startedAt ?? store.iso(),
      expiresAt,
      isActive: false,
    });
  }

  if (!GRANTING_EVENTS.has(type) && type !== 'CANCELLATION' && type !== 'BILLING_ISSUE') {
    // Unrecognised event: leave state untouched rather than guessing.
    return existing ?? null;
  }

  const entitlements = (event.entitlement_ids ?? []).map((id) => [id, { expires_date: expiresAt ?? null }]);
  const tier = highestTier(Object.fromEntries(entitlements));
  // Persist the canonical entitlement for the resolved tier, so a later read
  // does not depend on the dashboard's casing.
  const canonicalEntitlement =
    tier === 'free' ? 'none' : (ENTITLEMENTS[tier as Exclude<SubscriptionTier, 'free'>] ?? 'none');

  /**
   * CANCELLATION means auto-renew was turned off — access continues until the
   * paid period ends, which is distinct from an expiration.
   * BILLING_ISSUE places the subscription in a grace period.
   */
  const status: SubscriptionStatus =
    type === 'CANCELLATION' ? 'canceled' : type === 'BILLING_ISSUE' ? 'grace_period' : 'active';

  /**
   * A CANCELLATION or BILLING_ISSUE payload may omit entitlement_ids, in which
   * case the tier must be carried over from the existing record rather than
   * being downgraded to free while access is still paid for.
   */
  const carriedTier = tier === 'free' && existing && tierRank(existing.tier) > 0 ? existing.tier : tier;
  const active =
    status === 'active' ||
    status === 'grace_period' ||
    (status === 'canceled' && entitlementActive(expiresAt));
  const resolvedEntitlement =
    canonicalEntitlement !== 'none'
      ? canonicalEntitlement
      : (existing?.entitlement && existing.entitlement !== 'none' ? existing.entitlement : 'none');

  return store.subscriptions.save({
    userId,
    tier: active ? carriedTier : 'free',
    status,
    entitlement: active ? resolvedEntitlement : 'none',
    productIdentifier: event.product_id ?? existing?.productIdentifier,
    store: store_,
    startedAt: event.purchased_at_ms ? new Date(event.purchased_at_ms).toISOString() : (existing?.startedAt ?? store.iso()),
    expiresAt,
    isActive: active,
  });
}

/**
 * Reconcile local state with RevenueCat on demand.
 * The webhook is authoritative but can be missed, so the client can ask for a
 * refresh. Falls back to the stored record when RevenueCat is unconfigured.
 */
export async function syncFromRevenueCat(userId: string): Promise<Subscription> {
  if (!revenueCat.isConfigured()) return getSubscription(userId);

  const subscriber = await revenueCat.getSubscriber(userId);
  if (!subscriber) return getSubscription(userId);

  const tier = highestTier(subscriber.entitlements);
  const first = Object.entries(subscriber.entitlements).find(([, detail]) => entitlementActive(detail.expires_date));
  // Pick the furthest-out expiry so a second, longer entitlement is not lost.
  const latestExpiry = Object.values(subscriber.entitlements)
    .map((detail) => detail.expires_date)
    .filter((value): value is string => Boolean(value))
    .sort()
    .pop();

  const existing = store.subscriptions.get(userId);
  return store.subscriptions.save({
    userId,
    tier,
    status: tier === 'free' ? 'expired' : 'active',
    entitlement: first?.[0] ?? 'none',
    productIdentifier: first?.[1].product_identifier ?? existing?.productIdentifier,
    store: existing?.store,
    startedAt: existing?.startedAt ?? store.iso(),
    expiresAt: latestExpiry,
    isActive: tier !== 'free',
  });
}

export const subscriptionsService = {
  ENTITLEMENTS,
  tierForEntitlement,
  get: getSubscription,
  isProUser,
  applyWebhookEvent,
  shouldApplyEvent,
  syncFromRevenueCat,
  highestTier,
  tierRank,
  /**
   * Dev-only grant. Present so the Pro pricing path is testable without store
   * credentials; the caller must refuse this in production.
   */
  grant(userId: string, tier: SubscriptionTier, days = 30): Subscription {
    const expiresAt = tier === 'free' ? undefined : new Date(Date.now() + days * 86_400_000).toISOString();
    return store.subscriptions.save({
      userId,
      tier,
      status: tier === 'free' ? 'expired' : 'active',
      entitlement: tier === 'free' ? 'none' : ENTITLEMENTS[tier as Exclude<SubscriptionTier, 'free'>] ?? 'none',
      store: 'promotional',
      startedAt: store.iso(),
      expiresAt,
      isActive: tier !== 'free',
    });
  },
};

export default subscriptionsService;
