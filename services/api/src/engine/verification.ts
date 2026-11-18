/**
 * Seller identity checks through Didit (https://docs.didit.me).
 *
 * - A person (individual seller) runs the KYC workflow: ID document, selfie and liveness.
 * - A business runs the KYB workflow: registry, documents and the people behind it.
 *
 * The member is sent to Didit's hosted page (`url`). MoneyMart never sees or stores the documents; it keeps only
 * the session id, Didit's status word and the outcome. The result arrives two ways, and either is enough:
 * a signed webhook (`DIDIT_WEBHOOK_SECRET`), and a refresh the app makes when the member comes back, which reads
 * the decision straight from Didit with the API key. Nothing in a request body is ever trusted as the outcome.
 *
 * Keys (Railway): DIDIT_API_KEY, DIDIT_KYC_WORKFLOWID_KEY, DIDIT_KYB_WORKFLOWID_KEY, DIDIT_WEBHOOK_SECRET.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { KycLevel, User, VerificationStatus } from '@moneymart/types';
import { notifications, store, users, verifications, type VerificationRecord } from '../store.js';

export type CheckKind = 'person' | 'business';

const base = () => (process.env.MM_DIDIT_BASE ?? 'https://verification.didit.me').replace(/\/$/, '');
const apiKey = () => process.env.DIDIT_API_KEY ?? '';
const workflowFor = (kind: CheckKind) =>
  (kind === 'business' ? process.env.DIDIT_KYB_WORKFLOWID_KEY ?? process.env.DIDIT_KYB_WORKFLOW_ID : process.env.DIDIT_KYC_WORKFLOWID_KEY ?? process.env.DIDIT_KYC_WORKFLOW_ID) ?? '';

export const verificationConfigured = (kind: CheckKind = 'person') => Boolean(apiKey() && workflowFor(kind));
export const webhookConfigured = () => Boolean(process.env.DIDIT_WEBHOOK_SECRET);

/** Didit's status word → the account's status. */
export function statusFrom(providerStatus: string): VerificationStatus {
  switch (providerStatus) {
    case 'Approved':
      return 'verified';
    case 'Declined':
      return 'rejected';
    case 'Not Started':
    case 'In Progress':
    case 'In Review':
    case 'Resubmitted':
    case 'Awaiting User':
      return 'pending';
    default:
      // Expired, Abandoned, Kyc Expired and anything new: the member can start again.
      return 'unverified';
  }
}

const levelFor = (kind: CheckKind): KycLevel => (kind === 'business' ? 3 : 2);

/** What the member's own app is shown. Never the session token. */
export function viewFor(user: User) {
  const record = verifications.get(user.id);
  const kind: CheckKind = record?.kind ?? (user.sellerProfile?.entity === 'business' ? 'business' : 'person');
  return {
    status: user.verificationStatus,
    kycLevel: user.kycLevel,
    kind,
    providerStatus: record?.providerStatus ?? null,
    reason: record?.reason ?? null,
    startedAt: record?.startedAt ?? null,
    decidedAt: record?.decidedAt ?? null,
    available: verificationConfigured(kind),
    canStart: verificationConfigured(kind) && user.verificationStatus !== 'verified' && user.verificationStatus !== 'pending',
    /** A pending check can be resumed on Didit's page. */
    resumeUrl: user.verificationStatus === 'pending' ? record?.url ?? null : null,
  };
}

export class VerificationError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function didit(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(`${base()}${path}`, {
    ...init,
    headers: { 'x-api-key': apiKey(), 'content-type': 'application/json', accept: 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new VerificationError(502, 'provider_error', `Didit answered ${response.status}.`);
  return data;
}

/** Open (or resume) a Didit session and return the page the member should open. */
export async function startCheck(user: User, requested?: CheckKind, callback?: string): Promise<{ url: string; record: VerificationRecord }> {
  const kind: CheckKind = requested ?? (user.sellerProfile?.entity === 'business' ? 'business' : 'person');
  if (!verificationConfigured(kind)) throw new VerificationError(503, 'verification_unavailable', 'Identity checks are not switched on yet.');
  if (user.verificationStatus === 'verified') throw new VerificationError(409, 'already_verified', 'This account is already verified.');
  const existing = verifications.get(user.id);
  if (existing && user.verificationStatus === 'pending' && existing.url && existing.kind === kind) return { url: existing.url, record: existing };

  const body: Record<string, unknown> = {
    workflow_id: workflowFor(kind),
    vendor_data: user.id,
    metadata: { app: 'moneymart', kind },
    language: (user.preferences?.language ?? 'en').slice(0, 2),
  };
  if (callback) body.callback = callback;
  if (user.email && !user.email.endsWith('.invalid')) body.contact_details = { email: user.email, send_notification_emails: false };
  if (kind === 'business' && user.displayName) body.expected_details = { company_name: user.displayName };

  const data = await didit('/v3/session/', { method: 'POST', body: JSON.stringify(body) });
  const sessionId = String(data.session_id ?? '');
  const url = String(data.url ?? '');
  const localStandIn = process.env.NODE_ENV !== 'production' && /^http:\/\/127\.0\.0\.1[:/]/.test(url);
  if (!sessionId || !(/^https:\/\//.test(url) || localStandIn)) throw new VerificationError(502, 'provider_error', 'Didit did not return a verification page.');
  const now = store.iso();
  const record = verifications.save({
    userId: user.id,
    provider: 'didit',
    kind,
    sessionId,
    providerStatus: String(data.status ?? 'Not Started'),
    url,
    startedAt: now,
    updatedAt: now,
  });
  users.upsert({ ...user, verificationStatus: 'pending' });
  return { url, record };
}

/** Apply a status Didit reported for a session, once per change. Returns the updated record. */
export function applyStatus(record: VerificationRecord, providerStatus: string, reason?: string): VerificationRecord {
  const user = users.get(record.userId);
  if (!user) return record;
  const before = user.verificationStatus;
  const status = statusFrom(providerStatus);
  const now = store.iso();
  const updated = verifications.save({
    ...record,
    providerStatus,
    reason: reason ?? record.reason,
    updatedAt: now,
    decidedAt: status === 'verified' || status === 'rejected' ? record.decidedAt ?? now : record.decidedAt,
    url: status === 'pending' ? record.url : undefined,
  });
  // A decided account is never silently downgraded by a late, out-of-order event.
  if (before === 'verified' && status !== 'verified' && providerStatus !== 'Kyc Expired') return updated;
  const kycLevel = status === 'verified' ? (Math.max(user.kycLevel, levelFor(record.kind)) as KycLevel) : user.kycLevel;
  users.upsert({ ...user, verificationStatus: status, kycLevel });
  const enteredReview = providerStatus === 'In Review' && record.providerStatus !== 'In Review';
  if (before !== status || enteredReview) {
    const message =
      status === 'verified'
        ? { title: 'You are verified', body: record.kind === 'business' ? 'Your business passed its checks. Buyers now see the verified badge on your shop.' : 'Your identity check passed. Buyers now see the verified badge on your shop.' }
        : status === 'rejected'
          ? { title: 'Verification not approved', body: 'Your identity check was not approved. Open Verification to see what to do next, or contact support.' }
          : status === 'pending' && providerStatus === 'In Review'
            ? { title: 'Verification in review', body: 'Your check is being reviewed. We will tell you as soon as there is a decision.' }
            : status === 'unverified' && before === 'pending'
              ? { title: 'Verification not finished', body: 'Your identity check expired before it was finished. You can start it again any time.' }
              : null;
    if (message) {
      notifications.create({ id: store.nextId('ntf'), userId: user.id, category: 'system', ...message, href: '/verification', read: false, createdAt: now });
    }
  }
  return updated;
}

/** Read the decision straight from Didit (used when the member returns to the app). */
export async function refreshCheck(user: User): Promise<VerificationRecord | undefined> {
  const record = verifications.get(user.id);
  if (!record || !apiKey()) return record;
  const data = await didit(`/v3/session/${encodeURIComponent(record.sessionId)}/decision/`);
  const providerStatus = String(data.status ?? record.providerStatus);
  return applyStatus(record, providerStatus, reasonFrom(data));
}

function reasonFrom(data: Record<string, unknown>): string | undefined {
  const decision = (data.decision ?? data) as Record<string, unknown>;
  const warnings = [decision.id_verification, decision.liveness, decision.face_match]
    .flatMap((part) => ((part as { warnings?: { short_description?: string; risk?: string }[] } | undefined)?.warnings ?? []))
    .map((w) => w.short_description ?? w.risk)
    .filter(Boolean);
  return warnings.length ? String(warnings[0]).slice(0, 200) : undefined;
}

/* ── Webhook ─────────────────────────────────────────────────────────── */

const sortKeys = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sortKeys)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value as object).sort().map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]))
      : value;

const hmac = (secret: string, data: string | Buffer) => createHmac('sha256', secret).update(data).digest('hex');
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Check a Didit delivery: timestamp within 5 minutes and a matching raw-body or canonical-JSON signature. */
export function verifyWebhook(headers: Record<string, string | string[] | undefined>, raw: Buffer | undefined, body: unknown, now = Date.now()): boolean {
  const secret = process.env.DIDIT_WEBHOOK_SECRET;
  if (!secret) return false;
  const header = (name: string) => {
    const v = headers[name];
    return (Array.isArray(v) ? v[0] : v) ?? '';
  };
  const timestamp = Number.parseInt(header('x-timestamp'), 10);
  if (!Number.isFinite(timestamp) || Math.abs(now / 1000 - timestamp) > 300) return false;
  const candidates: string[] = [];
  if (raw) candidates.push(hmac(secret, raw));
  candidates.push(hmac(secret, JSON.stringify(sortKeys(body))));
  const given = [header('x-signature'), header('x-signature-v2'), header('x-signature-previous'), header('x-signature-v2-previous')].filter(Boolean);
  return given.some((g) => candidates.some((c) => same(g.toLowerCase(), c)));
}

const seenEvents = new Map<string, number>();

/** Apply a verified webhook. Returns what happened, for the response body. */
export function handleWebhook(body: Record<string, unknown>): { applied: boolean; reason?: string } {
  const eventId = String(body.event_id ?? '');
  if (eventId) {
    if (seenEvents.has(eventId)) return { applied: false, reason: 'duplicate' };
    seenEvents.set(eventId, Date.now());
    if (seenEvents.size > 5000) seenEvents.delete(seenEvents.keys().next().value!);
  }
  const sessionId = String(body.session_id ?? '');
  const record = verifications.bySession(sessionId);
  // The session must be one this server opened, and for the member it was opened for.
  if (!record || (body.vendor_data !== undefined && String(body.vendor_data) !== record.userId)) return { applied: false, reason: 'unknown_session' };
  const status = String(body.status ?? '');
  if (!status) return { applied: false, reason: 'no_status' };
  applyStatus(record, status, body.decision ? reasonFrom(body as Record<string, unknown>) : undefined);
  return { applied: true };
}
