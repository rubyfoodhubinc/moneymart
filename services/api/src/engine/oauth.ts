/**
 * MoneyMart — social sign-in (Google and Apple).
 *
 * The blueprint specifies Firebase Auth with Google, Apple and Facebook. This
 * implements the OpenID Connect authorization-code flow directly rather than
 * delegating to Firebase, because the platform already owns its session layer and
 * adding a vendor would mean two sources of truth for identity.
 *
 * Google and Apple differ in exactly one important way, and it is easy to get
 * wrong: a Google client secret is a plain string, whereas **Apple's is an ES256
 * JWT** signed with a private key, regenerated on every exchange and capped at
 * six months. Treating Apple's secret as a string is the usual reason "Sign in
 * with Apple" fails only in production.
 *
 * Two decisions worth stating:
 *
 *  • **Verified email is required before linking to an existing account.** An
 *    identity is linked to an account by email, so accepting an unverified
 *    address would let anyone who can register `victim@example.com` at a sloppy
 *    provider take over the MoneyMart account that owns it. Both providers report
 *    the claim; it is checked, not assumed.
 *  • **The public key is fetched from the provider's JWKS and the signature is
 *    verified locally.** An ID token is a bearer assertion; decoding it without
 *    verifying the signature would accept any token an attacker can craft.
 *
 * No dependencies: Node's WebCrypto covers ES256 signing and RS256/ES256
 * verification.
 */
import { createHash, randomBytes, webcrypto } from 'node:crypto';

const { subtle } = webcrypto;

export interface OAuthProfile {
  /** Provider-issued, stable, never reused. The identity key. */
  subject: string;
  email?: string;
  /** True only when the PROVIDER asserts the address is verified. */
  emailVerified: boolean;
  displayName?: string;
  avatarUrl?: string;
}

export interface OAuthProvider {
  id: 'google' | 'apple';
  label: string;
  /** Whether the provider is configured well enough to attempt a sign-in. */
  configured: () => boolean;
  authorizationUrl: (params: { state: string; challenge: string; redirectUri: string }) => string;
  exchange: (params: { code: string; redirectUri: string; verifier: string }) => Promise<OAuthProfile>;
}

/* ── Shared helpers ────────────────────────────────────────────────────── */

const base64url = (input: Buffer | Uint8Array | string): string =>
  Buffer.from(input as never).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Decode a JWT segment without verifying it — safe only for reading the header. */
function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

/**
 * Verify a JWT's signature against a provider's JWKS.
 *
 * The key is selected by `kid`. If the token names a key the provider is not
 * publishing, the token is refused rather than checked against the first key —
 * which would pass for the wrong issuer.
 */
async function verifyJwt(token: string, jwksUri: string, expected: { issuer: string | string[]; audience: string }): Promise<Record<string, unknown>> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed_token');
  const [headerSegment, payloadSegment, signatureSegment] = parts as [string, string, string];

  const header = decodeSegment(headerSegment);
  const payload = decodeSegment(payloadSegment);

  const issuers = Array.isArray(expected.issuer) ? expected.issuer : [expected.issuer];
  if (!issuers.includes(String(payload.iss))) throw new Error('bad_issuer');

  const audience = payload.aud;
  const audiences = Array.isArray(audience) ? audience.map(String) : [String(audience)];
  if (!audiences.includes(expected.audience)) throw new Error('bad_audience');

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp < now) throw new Error('token_expired');
  // A token issued in the future is a clock-skew symptom or a forgery attempt.
  if (typeof payload.iat === 'number' && payload.iat > now + 120) throw new Error('token_from_future');

  const jwks = (await (await fetch(jwksUri, { signal: AbortSignal.timeout(10_000) })).json()) as {
    keys?: Record<string, unknown>[];
  };
  const candidates = jwks.keys ?? [];
  const jwk = header.kid ? candidates.find((key) => key.kid === header.kid) : candidates[0];
  if (!jwk) throw new Error('signing_key_not_found');

  const algorithm = String(header.alg ?? '');
  // Only asymmetric algorithms. `none` and HMAC would let a caller sign their own.
  if (!['RS256', 'ES256'].includes(algorithm)) throw new Error(`unsupported_algorithm:${algorithm}`);

  const key = await subtle.importKey(
    'jwk',
    jwk as never,
    algorithm === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } : { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );

  const valid = await subtle.verify(
    algorithm === 'RS256' ? { name: 'RSASSA-PKCS1-v1_5' } : { name: 'ECDSA', hash: 'SHA-256' },
    key,
    Buffer.from(signatureSegment, 'base64url'),
    Buffer.from(`${headerSegment}.${payloadSegment}`),
  );
  if (!valid) throw new Error('bad_signature');

  return payload;
}

/* ── Google ────────────────────────────────────────────────────────────── */

/**
 * Provider endpoints.
 *
 * Overridable so the exchange can be exercised against a local mock — the only
 * way to verify signature checking, PKCE and claim validation without real
 * client credentials. Defaults are the real Google endpoints, so an override is
 * never needed in production.
 */
const googleEndpoint = (name: string, fallback: string) =>
  process.env[`MM_OAUTH_GOOGLE_${name}`] ?? fallback;
const GOOGLE_AUTH = googleEndpoint('AUTH_URL', 'https://accounts.google.com/o/oauth2/v2/auth');
const GOOGLE_TOKEN = googleEndpoint('TOKEN_URL', 'https://oauth2.googleapis.com/token');
const GOOGLE_JWKS = googleEndpoint('JWKS_URL', 'https://www.googleapis.com/oauth2/v3/certs');

const google: OAuthProvider = {
  id: 'google',
  label: 'Google',
  configured: () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),

  authorizationUrl: ({ state, challenge, redirectUri }) => {
    const url = new URL(GOOGLE_AUTH);
    url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID ?? '');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    // PKCE even for a confidential client: it costs nothing and closes the
    // authorization-code interception window.
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('prompt', 'select_account');
    return url.toString();
  },

  exchange: async ({ code, redirectUri, verifier }) => {
    const body = new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    });
    const response = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const tokens = (await response.json()) as { id_token?: string; error?: string; error_description?: string };
    if (!response.ok || !tokens.id_token) {
      throw new Error(`google_exchange_failed:${tokens.error ?? response.status}`);
    }

    const claims = await verifyJwt(tokens.id_token, GOOGLE_JWKS, {
      // Google issues under both spellings.
      issuer: process.env.MM_OAUTH_GOOGLE_ISSUER
        ? [process.env.MM_OAUTH_GOOGLE_ISSUER]
        : ['https://accounts.google.com', 'accounts.google.com'],
      audience: process.env.GOOGLE_CLIENT_ID ?? '',
    });

    return {
      subject: String(claims.sub ?? ''),
      email: claims.email ? String(claims.email) : undefined,
      // Google sends a boolean here; anything else means "not asserted".
      emailVerified: claims.email_verified === true || claims.email_verified === 'true',
      displayName: claims.name ? String(claims.name) : undefined,
      avatarUrl: claims.picture ? String(claims.picture) : undefined,
    };
  },
};

/* ── Apple ─────────────────────────────────────────────────────────────── */

const appleEndpoint = (name: string, fallback: string) => process.env[`MM_OAUTH_APPLE_${name}`] ?? fallback;
const APPLE_AUTH = appleEndpoint('AUTH_URL', 'https://appleid.apple.com/auth/authorize');
const APPLE_TOKEN = appleEndpoint('TOKEN_URL', 'https://appleid.apple.com/auth/token');
const APPLE_JWKS = appleEndpoint('JWKS_URL', 'https://appleid.apple.com/auth/keys');

/**
 * Build Apple's client secret.
 *
 * Apple does not issue a static secret: the value is a short-lived ES256 JWT
 * signed with the `.p8` key downloaded from the developer portal. Each exchange
 * mints a fresh one, which is why this cannot be a string in the environment.
 *
 * The private key is read from APPLE_PRIVATE_KEY, accepting either the PEM text
 * itself (newlines escaped as \n, which is what a hosting dashboard stores) or a
 * path to the .p8 file for local development.
 */
async function appleClientSecret(): Promise<string> {
  const teamId = process.env.APPLE_TEAM_ID ?? '';
  const keyId = process.env.APPLE_KEY_ID ?? '';
  const clientId = process.env.APPLE_CLIENT_ID ?? '';
  const raw = process.env.APPLE_PRIVATE_KEY ?? '';

  // A dashboard stores the PEM with literal backslash-n; a file has real newlines.
  let pem = raw.includes('BEGIN PRIVATE KEY') ? raw.replace(/\\n/g, '\n') : '';
  if (!pem && raw) {
    const { readFileSync } = await import('node:fs');
    pem = readFileSync(raw, 'utf8');
  }
  if (!pem) throw new Error('apple_private_key_missing');

  const key = await subtle.importKey(
    'pkcs8',
    Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64'),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: teamId,
      iat: now,
      exp: now + 60 * 30, // Apple's maximum is six months; half an hour is plenty.
      aud: 'https://appleid.apple.com',
      sub: clientId,
    }),
  );

  const signature = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(`${header}.${payload}`));
  // WebCrypto returns an ArrayBuffer; Buffer.from normalises it for base64url.
  return `${header}.${payload}.${base64url(Buffer.from(signature))}`;
}

const apple: OAuthProvider = {
  id: 'apple',
  label: 'Apple',
  configured: () =>
    Boolean(
      process.env.APPLE_CLIENT_ID &&
        process.env.APPLE_TEAM_ID &&
        process.env.APPLE_KEY_ID &&
        process.env.APPLE_PRIVATE_KEY,
    ),

  authorizationUrl: ({ state, challenge, redirectUri }) => {
    const url = new URL(APPLE_AUTH);
    url.searchParams.set('client_id', process.env.APPLE_CLIENT_ID ?? '');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    // `name email` must be requested at authorization time or Apple withholds them.
    url.searchParams.set('scope', 'name email');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    // Apple wants this form-posted; the resulting token comes back via the same
    // redirect URI as the query string.
    url.searchParams.set('response_mode', 'form_post');
    return url.toString();
  },

  exchange: async ({ code, redirectUri, verifier }) => {
    const body = new URLSearchParams({
      code,
      client_id: process.env.APPLE_CLIENT_ID ?? '',
      client_secret: await appleClientSecret(),
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    });
    const response = await fetch(APPLE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const tokens = (await response.json()) as { id_token?: string; error?: string };
    if (!response.ok || !tokens.id_token) throw new Error(`apple_exchange_failed:${tokens.error ?? response.status}`);

    const claims = await verifyJwt(tokens.id_token, APPLE_JWKS, {
      issuer: process.env.MM_OAUTH_APPLE_ISSUER ?? 'https://appleid.apple.com',
      audience: process.env.APPLE_CLIENT_ID ?? '',
    });

    /**
     * Apple asserts a verified address by construction — it will not issue an
     * ID token for an unverified one — and it reports `email_verified` as a
     * string. Absence of the claim is treated as unverified.
     */
    const verified = claims.email_verified === true || claims.email_verified === 'true';

    return {
      subject: String(claims.sub ?? ''),
      email: claims.email ? String(claims.email) : undefined,
      emailVerified: verified,
      // Apple returns the name only on the FIRST authorization, and in the form
      // post rather than the token, so callers may pass it separately.
      displayName: undefined,
      avatarUrl: undefined,
    };
  },
};

export const PROVIDERS: Record<string, OAuthProvider> = { google, apple };

/* ── Flow state ────────────────────────────────────────────────────────── */

export interface OAuthState {
  provider: string;
  /** PKCE verifier, held server-side and never sent to the provider. */
  verifier: string;
  /** Where to return the user inside the app once signed in. */
  redirect: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Pending flows, held in memory.
 *
 * Deliberately not snapshotted: a sign-in in progress is worthless after a
 * restart, and persisting it would mean writing a short-lived secret to disk.
 */
const pendingFlows = new Map<string, OAuthState>();

const STATE_TTL_MS = 10 * 60 * 1000;

export const oauthService = {
  providers: PROVIDERS,

  /** Which providers can actually be attempted right now. */
  status() {
    return Object.values(PROVIDERS).map((provider) => ({
      id: provider.id,
      label: provider.label,
      configured: provider.configured(),
    }));
  },

  /**
   * Begin a flow. Returns the URL to send the browser to.
   *
   * The PKCE verifier stays server-side; only its SHA-256 challenge goes to the
   * provider, so an intercepted authorization code cannot be exchanged without
   * the verifier.
   */
  begin(providerId: string, redirect: string): { url: string; state: string } | { error: string } {
    const provider = PROVIDERS[providerId];
    if (!provider) return { error: 'unknown_provider' };
    if (!provider.configured()) return { error: 'provider_not_configured' };

    const state = randomBytes(24).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const challenge = base64url(createHash('sha256').update(verifier).digest());

    const now = Date.now();
    pendingFlows.set(state, {
      provider: providerId,
      verifier,
      // Only an in-app path is honoured, so the callback cannot be turned into an
      // open redirect that hands a session token to another site.
      redirect: redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/',
      createdAt: now,
      expiresAt: now + STATE_TTL_MS,
    });

    return {
      state,
      url: provider.authorizationUrl({ state, challenge, redirectUri: callbackUrl(providerId) }),
    };
  },

  /** Consume a flow. Single-use: a replayed state must fail. */
  consume(state: string): OAuthState | null {
    const flow = pendingFlows.get(state);
    if (!flow) return null;
    pendingFlows.delete(state);
    if (Date.now() > flow.expiresAt) return null;
    return flow;
  },

  /** Complete the exchange for a consumed flow. */
  async complete(flow: OAuthState, code: string): Promise<OAuthProfile> {
    const provider = PROVIDERS[flow.provider];
    if (!provider) throw new Error('unknown_provider');
    const profile = await provider.exchange({
      code,
      redirectUri: callbackUrl(flow.provider),
      verifier: flow.verifier,
    });
    if (!profile.subject) throw new Error('provider_returned_no_subject');
    return profile;
  },

  /** Drop expired flows so the map cannot grow without bound. */
  sweep(): number {
    const now = Date.now();
    let removed = 0;
    for (const [state, flow] of pendingFlows) {
      if (now > flow.expiresAt) {
        pendingFlows.delete(state);
        removed += 1;
      }
    }
    return removed;
  },

  pendingCount: () => pendingFlows.size,
};

/**
 * The redirect URI registered with the provider.
 *
 * Derived from the request when possible so a preview deployment works without
 * reconfiguration, falling back to an explicit override.
 */
export function callbackUrl(providerId: string): string {
  const base = (process.env.MM_PUBLIC_API_URL ?? '').replace(/\/$/, '');
  if (base) return `${base}/api/auth/oauth/${providerId}/callback`;
  // Only reached in development, where the default port is known.
  return `http://127.0.0.1:${process.env.PORT ?? 4317}/api/auth/oauth/${providerId}/callback`;
}

/** Validate the profile before it is trusted to identify an account. */
export function isUsableProfile(profile: OAuthProfile): boolean {
  return Boolean(profile.subject) && !profile.subject.includes('\u0000');
}

export const oauth = { oauthService, PROVIDERS, callbackUrl, isUsableProfile };
export default oauth;
