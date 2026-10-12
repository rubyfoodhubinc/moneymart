/**
 * MoneyMart — HTTP rate limiting.
 *
 * The engine throttles bids per bidder per auction, but nothing throttled the
 * HTTP surface. Measured against production, eight consecutive OTP requests all
 * returned 200 — and each one is a billable SMS once Twilio is configured, so the
 * endpoint was an open door to SMS-bombing toll fraud, to using the platform as a
 * free SMS gateway, and to patient account enumeration.
 *
 * Design choices worth stating:
 *
 *  • **Sliding window per key**, not a fixed bucket. A fixed window lets an
 *    attacker send a full allowance at the end of one window and again at the
 *    start of the next, doubling the effective burst exactly when it matters.
 *  • **Both IP and subject are limited** for endpoints that send messages. An IP
 *    cap alone is defeated by rotating addresses, and a subject cap alone lets an
 *    attacker walk a list of phone numbers from one address.
 *  • **`req.ip` is the key**, which is meaningful only because `trust proxy` is
 *    set: behind a managed platform the socket address is the edge's, and keying
 *    on that would put every user in one bucket and rate-limit the world.
 *  • **In-memory**, which is correct for a single replica and honest about its
 *    limit: it does not coordinate across processes. Scaling out needs the same
 *    shift the Socket.IO rooms need, and `status()` exposes the store size so the
 *    constraint is visible rather than assumed.
 */
import type { NextFunction, Request, Response } from 'express';

export interface RateLimitPolicy {
  /** Stable name, used for the bucket key and for diagnostics. */
  name: string;
  windowMs: number;
  /** Allowed requests per window from one address. */
  max: number;
  /** How the subject is derived. Omit for an IP-only limit. */
  subject?: (req: Request) => string | undefined;
  /**
   * Allowed requests per window for one SUBJECT.
   *
   * Required whenever `subject` is supplied, and deliberately a separate number:
   * the two limits defend against different attacks. The address cap stops one
   * machine, while the subject cap stops someone rotating addresses to bomb a
   * single phone number or inbox. Using one number for both makes the subject
   * limit useless whenever the address cap is the looser of the two — which is
   * exactly how this was first written.
   */
  subjectMax?: number;
  /** Message returned with the 429. */
  message?: string;
}

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

/**
 * Key a request.
 *
 * `req.ip` is undefined in a non-HTTP context; falling back to a constant would
 * put every such request in one bucket, which is worse than not limiting, so an
 * unknown address is bucketed by a fixed label only because Express always
 * supplies one for a real connection.
 */
function ipKey(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

function hit(key: string, windowMs: number, max: number): { limited: boolean; remaining: number; retryAfterSeconds: number } {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };
  // Drop anything outside the window before counting, so the window truly slides.
  bucket.hits = bucket.hits.filter((timestamp) => now - timestamp < windowMs);

  if (bucket.hits.length >= max) {
    buckets.set(key, bucket);
    const oldest = bucket.hits[0] ?? now;
    return {
      limited: true,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
    };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { limited: false, remaining: max - bucket.hits.length, retryAfterSeconds: 0 };
}

/** How many limits this ONE process is enforcing. */
export function limiterStatus() {
  let tracked = 0;
  for (const bucket of buckets.values()) tracked += bucket.hits.length;
  return { keys: buckets.size, tracked };
}

/** Drop every bucket. Used by the suites so runs stay independent. */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * Build the middleware for one policy.
 *
 * Both checks must pass; the tighter one wins. Headers are set on every response
 * so a well-behaved client can back off before being refused.
 */
export function rateLimit(policy: RateLimitPolicy) {
  const { name, windowMs, max, subject, subjectMax, message } = policy;

  /**
   * A subject limit without its own number is a configuration mistake, not a
   * harmless default: silently reusing `max` would enforce nothing distinct.
   * Surfaced at construction so it cannot ship quietly.
   */
  if (subject && (subjectMax === undefined || subjectMax <= 0)) {
    throw new Error(`rate_limit_policy_invalid:${name} declares a subject but no subjectMax`);
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    const byIp = hit(`rl:${name}:ip:${ipKey(req)}`, windowMs, max);

    let bySubject: ReturnType<typeof hit> | null = null;
    const subjectValue = subject?.(req)?.trim().toLowerCase();
    // A subject limit only makes sense once we know what the subject is; an
    // empty field must not consume some other subject's allowance.
    if (subject && subjectValue) {
      bySubject = hit(`rl:${name}:subject:${subjectValue}`, windowMs, subjectMax as number);
    }

    const limited = byIp.limited || Boolean(bySubject?.limited);
    const retryAfter = Math.max(byIp.retryAfterSeconds, bySubject?.retryAfterSeconds ?? 0);
    const remaining = Math.min(byIp.remaining, bySubject?.remaining ?? byIp.remaining);

    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));

    if (limited) {
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        error: 'rate_limited',
        detail: message ?? 'Too many requests. Try again shortly.',
        retryAfterSeconds: retryAfter,
      });
      return;
    }

    next();
  };
}

/* ── Policies ──────────────────────────────────────────────────────────── */

/**
 * A tunable address ceiling.
 *
 * The defaults below are the production posture and stay that way. A verification
 * suite that needs to create dozens of accounts in one run would otherwise trip
 * this limiter and fail for a reason unrelated to what it is testing — so the
 * ceiling is overridable by environment, and only the ceiling. The SUBJECT cap is
 * deliberately not overridable: that is the one guarding a single inbox or number.
 */
const envMax = (name: string, fallback: number): number => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};

export const POLICIES = {
  /**
   * Sending a login code. The costliest endpoint: every call can be a billable
   * SMS, and it is also the account-enumeration surface.
   */
  authRequest: {
    name: 'auth-request',
    // Generous enough for a shared office or mobile carrier NAT, tight enough
    // that a script cannot run up a bill.
    windowMs: 15 * 60 * 1000,
    max: envMax('MM_AUTH_REQUEST_MAX', 20),
    subject: (req: Request) => String((req.body as { identifier?: string } | undefined)?.identifier ?? ''),
    // Far tighter than the address cap: a code is needed once, and the previous
    // one is invalidated on each new request anyway. This is the limit that stops
    // an attacker rotating addresses to bomb one number.
    subjectMax: 5,
    message: 'Too many codes requested. Wait a few minutes before trying again.',
  } satisfies RateLimitPolicy,

  /**
   * Verifying a code. The attempt limit inside the auth service is per
   * challenge; this bounds how many challenges one address may work through.
   */
  authVerify: {
    name: 'auth-verify',
    windowMs: 15 * 60 * 1000,
    max: envMax('MM_AUTH_VERIFY_MAX', 30),
    message: 'Too many verification attempts. Wait a few minutes.',
  } satisfies RateLimitPolicy,

  /** Creating listings. Bounds accidental loops and deliberate spam. */
  createListing: {
    name: 'create-listing',
    windowMs: 60 * 60 * 1000,
    max: 30,
    message: 'Too many listings created. Try again later.',
  } satisfies RateLimitPolicy,

  /** Chat over HTTP, if a client ever posts it that way. */
  chat: {
    name: 'chat',
    windowMs: 60 * 1000,
    max: 30,
    message: 'Slow down — too many messages.',
  } satisfies RateLimitPolicy,

  /**
   * The webhook surface. Generous, because a provider legitimately bursts, but
   * present so an unauthenticated flood cannot exhaust the process.
   */
  webhook: {
    name: 'webhook',
    windowMs: 60 * 1000,
    max: 300,
    message: 'Webhook rate exceeded.',
  } satisfies RateLimitPolicy,

  /**
   * A floor for the whole API: no single address may exceed this in a minute.
   * Protects against a runaway client as much as an attacker.
   */
  global: {
    name: 'global',
    windowMs: 60 * 1000,
    max: envMax('MM_GLOBAL_REQUEST_MAX', 600),
    message: 'Request rate exceeded.',
  } satisfies RateLimitPolicy,
} as const;

/**
 * Every bucket is swept on an interval.
 *
 * Without this the map grows without bound: a unique key per attacker address is
 * a memory-exhaustion vector, and a rate limiter that can be used to exhaust
 * memory is worse than none.
 */
export function startLimiterSweep(intervalMs = 5 * 60 * 1000): NodeJS.Timeout {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      bucket.hits = bucket.hits.filter((timestamp) => now - timestamp < 60 * 60 * 1000);
      if (!bucket.hits.length) buckets.delete(key);
    }
  }, intervalMs);
  timer.unref?.();
  return timer;
}

export const rateLimiter = { rateLimit, POLICIES, limiterStatus, resetRateLimits, startLimiterSweep };
export default rateLimiter;
