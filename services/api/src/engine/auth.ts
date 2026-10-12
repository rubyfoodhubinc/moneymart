/**
 * MoneyMart — authentication (§9.1 Auth Service).
 *
 * Identity was a plain `x-mm-user` header with no verification, and the mobile
 * app's "OTP" accepted any six digits. Both are replaced here by a real
 * passwordless flow:
 *
 *   POST /api/auth/request  { identifier }        → issues a one-time code
 *   POST /api/auth/verify   { identifier, code }  → issues a session token
 *   Authorization: Bearer <token>                 → identifies the caller
 *
 * Passwordless is a deliberate choice over passwords: there is no password
 * database to breach, no reset flow to build, and phone verification — which the
 * blueprint needs anyway for a marketplace handling money — falls out of it. A
 * six-digit code with a short life and a bounded attempt count is the standard
 * shape of that trade.
 *
 * Delivery is honest about its own limits. With no provider configured the code
 * is returned in the response ONLY when MM_AUTH_DEV_CODES is on (default outside
 * production) and is otherwise logged, never silently dropped — a login that
 * cannot be completed must fail loudly rather than appear to succeed.
 */
import { createHash, randomInt, randomBytes, timingSafeEqual } from 'node:crypto';
import type { User } from '@moneymart/types';
import { store } from '../store.js';

/** Six digits, five minutes, five attempts — the usual shape for this flow. */
export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
/** Sessions last long enough to be usable, short enough to expire stale ones. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuthChallenge {
  id: string;
  identifier: string;
  /** Hash of the code, never the code itself. */
  codeHash: string;
  attempts: number;
  expiresAt: number;
  createdAt: number;
}

export interface AuthSession {
  token: string;
  userId: string;
  identifier: string;
  createdAt: number;
  expiresAt: number;
  /** Rolling metadata for the account screen. */
  lastSeenAt: number;
  method: 'otp';
}

/* ── Identifier handling ───────────────────────────────────────────────── */

export type IdentifierKind = 'email' | 'phone';

export interface NormalisedIdentifier {
  kind: IdentifierKind;
  /** Canonical form used as the lookup key. */
  value: string;
  /** Where a code should be sent. */
  destination: string;
}

/**
 * Canonicalise an email or phone number.
 *
 * Without this, `Ada@Example.com ` and `ada@example.com` are different accounts
 * and a user can end up with two identities for one person. Phones are reduced
 * to digits with a single leading `+`, so `+234 801 234 5678` and
 * `+2348012345678` match.
 */
export function normaliseIdentifier(input: string): NormalisedIdentifier | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;

  if (raw.includes('@')) {
    const value = raw.toLowerCase();
    // Deliberately permissive: the code proves ownership, so a strict RFC 5322
    // pattern would only lock out valid addresses.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return null;
    return { kind: 'email', value, destination: value };
  }

  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  const value = `+${digits}`;
  return { kind: 'phone', value, destination: value };
}

/** Look up an existing account by email or phone, or create a minimal one. */
function resolveUser(identifier: NormalisedIdentifier): User {
  const existing = store.users
    .all()
    .find((user) =>
      identifier.kind === 'email'
        ? user.email?.toLowerCase() === identifier.value
        : user.phone?.replace(/[^\d]/g, '') === identifier.value.replace(/[^\d]/g, ''),
    );
  if (existing) return existing;

  // A verified identifier is proof enough to open an account; the profile is
  // completed in onboarding. Using the identifier's own hash keeps the generated
  // id stable, so a second sign-in from the same address finds the same account
  // rather than creating a duplicate.
  const suffix = createHash('sha256').update(identifier.value).digest('hex').slice(0, 12);
  const id = `usr_${suffix}`;
  const handle = identifier.kind === 'email' ? identifier.value.split('@')[0]!.slice(0, 18) : `mm${suffix.slice(0, 6)}`;

  return store.users.ensure(id, {
    ...(identifier.kind === 'email' ? { email: identifier.value } : {}),
  }) && store.users.upsert({
    ...store.users.require(id),
    handle: store.users.findByHandle(handle) ? `${handle}${suffix.slice(0, 3)}` : handle,
    displayName: handle,
    ...(identifier.kind === 'phone' ? { phone: identifier.value } : {}),
  });
}

/* ── Codes ─────────────────────────────────────────────────────────────── */

/** Codes are compared by hash and never stored in the clear. */
function hashCode(challengeId: string, code: string): string {
  const pepper = process.env.MM_AUTH_PEPPER ?? 'moneymart-dev-pepper';
  return createHash('sha256').update(`${pepper}:${challengeId}:${code}`).digest('hex');
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/* ── Delivery ──────────────────────────────────────────────────────────── */

export interface DeliveryResult {
  delivered: boolean;
  /** Which transport was used, for the response and the audit trail. */
  transport: 'twilio' | 'resend' | 'log';
  detail?: string;
}

/**
 * Send the code.
 *
 * Twilio Verify is used when configured, otherwise Resend for email, otherwise
 * the code is logged. Logging is not a fallback that pretends to work — the
 * caller is told `transport: 'log'` so the UI can say a code was generated for
 * development rather than claiming a message was sent.
 */
export async function deliverCode(identifier: NormalisedIdentifier, code: string): Promise<DeliveryResult> {
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioService = process.env.TWILIO_VERIFY_SERVICE_SID;

  if (identifier.kind === 'phone' && twilioSid && twilioToken && twilioService) {
    try {
      const response = await fetch(
        `https://verify.twilio.com/v2/Services/${twilioService}/Verifications`,
        {
          method: 'POST',
          headers: {
            authorization: `Basic ${Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64')}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ To: identifier.destination, Channel: 'sms' }).toString(),
        },
      );
      if (response.ok) return { delivered: true, transport: 'twilio' };
      return { delivered: false, transport: 'twilio', detail: `twilio_${response.status}` };
    } catch (error) {
      return { delivered: false, transport: 'twilio', detail: error instanceof Error ? error.message : 'twilio_error' };
    }
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (identifier.kind === 'email' && resendKey) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${resendKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: process.env.MM_AUTH_FROM ?? 'MoneyMart <no-reply@moneymart.app>',
          to: [identifier.destination],
          subject: `Your MoneyMart code: ${code}`,
          text: `Your MoneyMart sign-in code is ${code}. It expires in 5 minutes.`,
        }),
      });
      if (response.ok) return { delivered: true, transport: 'resend' };
      return { delivered: false, transport: 'resend', detail: `resend_${response.status}` };
    } catch (error) {
      return { delivered: false, transport: 'resend', detail: error instanceof Error ? error.message : 'resend_error' };
    }
  }

  console.log(`[auth] code for ${identifier.value}: ${code} (no delivery provider configured)`);
  return { delivered: false, transport: 'log', detail: 'no_provider_configured' };
}

/* ── Service ───────────────────────────────────────────────────────────── */

export interface StartResult {
  challengeId: string;
  identifier: NormalisedIdentifier;
  delivery: DeliveryResult;
  expiresInSeconds: number;
  /**
   * The code, only when development exposure is enabled. Present so a developer
   * or an automated test can complete a login without a mail or SMS account.
   */
  devCode?: string;
}

export function devCodesEnabled(): boolean {
  if (process.env.MM_AUTH_DEV_CODES === 'true') return true;
  if (process.env.MM_AUTH_DEV_CODES === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

export const authService = {
  normaliseIdentifier,

  /** Issue a code. Any previous challenge for the identifier is replaced. */
  async start(identifierInput: string): Promise<StartResult | null> {
    const identifier = normaliseIdentifier(identifierInput);
    if (!identifier) return null;

    const user = resolveUser(identifier);

    // One live challenge per identifier: a second request must not leave the
    // first code valid, or an attacker could keep an old code alive.
    for (const [id, challenge] of store.db.authChallenges) {
      if (challenge.identifier === identifier.value) store.db.authChallenges.delete(id);
    }

    const challengeId = store.nextId('otp');
    // randomInt is rejection-sampled, unlike % on randomBytes, so the digits are
    // uniformly distributed.
    const code = String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');

    const challenge: AuthChallenge = {
      id: challengeId,
      identifier: identifier.value,
      codeHash: hashCode(challengeId, code),
      attempts: 0,
      expiresAt: Date.now() + OTP_TTL_MS,
      createdAt: Date.now(),
    };
    store.db.authChallenges.set(challengeId, challenge);

    const delivery = await deliverCode(identifier, code);
    void user;

    return {
      challengeId,
      identifier,
      delivery,
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
      ...(devCodesEnabled() ? { devCode: code } : {}),
    };
  },

  /**
   * Exchange a code for a session token.
   *
   * Failure modes are distinguished so the client can respond usefully, while the
   * response never reveals whether an account exists for the identifier.
   */
  verify(
    identifierInput: string,
    codeInput: string,
  ):
    /* The public profile is assembled by the route, because it needs live-stream
       state that authentication has no business knowing about. */
    | { ok: true; token: string; user: User; expiresAt: number }
    | { ok: false; error: 'invalid_identifier' | 'no_challenge' | 'expired' | 'too_many_attempts' | 'invalid_code' } {
    const identifier = normaliseIdentifier(identifierInput);
    if (!identifier) return { ok: false, error: 'invalid_identifier' };

    const challenge = [...store.db.authChallenges.values()].find(
      (entry) => entry.identifier === identifier.value,
    );
    if (!challenge) return { ok: false, error: 'no_challenge' };

    if (Date.now() > challenge.expiresAt) {
      store.db.authChallenges.delete(challenge.id);
      return { ok: false, error: 'expired' };
    }

    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      store.db.authChallenges.delete(challenge.id);
      return { ok: false, error: 'too_many_attempts' };
    }

    const code = String(codeInput ?? '').replace(/\D/g, '');
    if (code.length !== OTP_LENGTH || !constantTimeEqual(hashCode(challenge.id, code), challenge.codeHash)) {
      challenge.attempts += 1;
      // Burn the challenge on the final failure rather than leaving a code that
      // has one guess left indefinitely.
      if (challenge.attempts >= OTP_MAX_ATTEMPTS) store.db.authChallenges.delete(challenge.id);
      return { ok: false, error: 'invalid_code' };
    }

    // Single use.
    store.db.authChallenges.delete(challenge.id);

    const user = resolveUser(identifier);
    const now = Date.now();
    const session: AuthSession = {
      // 32 bytes of entropy; the token is the only bearer credential.
      token: randomBytes(32).toString('base64url'),
      userId: user.id,
      identifier: identifier.value,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
      lastSeenAt: now,
      method: 'otp',
    };
    store.db.authSessions.set(session.token, session);

    const updated = store.users.upsert({ ...user, lastLoginAt: store.iso() });
    store.db.session.userId = updated.id;

    return {
      ok: true,
      token: session.token,
      user: updated,
      expiresAt: session.expiresAt,
    };
  },

  /** Resolve a bearer token to a user, refreshing last-seen. */
  authenticate(token: string): AuthSession | null {
    const session = store.db.authSessions.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      store.db.authSessions.delete(token);
      return null;
    }
    if (!store.users.get(session.userId)) {
      // The account was removed; the session must not outlive it.
      store.db.authSessions.delete(token);
      return null;
    }
    session.lastSeenAt = Date.now();
    return session;
  },

  /** End a session. Idempotent, so a repeated sign-out is not an error. */
  signOut(token: string): boolean {
    return store.db.authSessions.delete(token);
  },

  /** Live sessions for an account, for the account screen. */
  sessionsFor(userId: string): Omit<AuthSession, 'token'>[] {
    return [...store.db.authSessions.values()]
      .filter((session) => session.userId === userId && Date.now() <= session.expiresAt)
      .map(({ token, ...rest }) => {
        void token;
        return rest;
      });
  },

  /** Drop expired challenges and sessions. Called on an interval. */
  sweep(): { challenges: number; sessions: number } {
    const now = Date.now();
    let challenges = 0;
    let sessions = 0;
    for (const [id, challenge] of store.db.authChallenges) {
      if (now > challenge.expiresAt) {
        store.db.authChallenges.delete(id);
        challenges += 1;
      }
    }
    for (const [token, session] of store.db.authSessions) {
      if (now > session.expiresAt) {
        store.db.authSessions.delete(token);
        sessions += 1;
      }
    }
    return { challenges, sessions };
  },

  /**
   * Whether the demo header may be used.
   *
   * Allowed outside production, and in production only behind an explicit flag,
   * so the header cannot be a live authentication bypass by accident. The
   * verification suites rely on this staying available in development.
   */
  demoHeaderAllowed(): boolean {
    if (process.env.MM_ALLOW_DEMO_AUTH === 'true') return true;
    if (process.env.MM_ALLOW_DEMO_AUTH === 'false') return false;
    return process.env.NODE_ENV !== 'production';
  },
};

export default authService;
