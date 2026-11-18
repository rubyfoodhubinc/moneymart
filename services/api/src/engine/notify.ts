/**
 * Notification delivery: one path for every notification the platform creates.
 *
 * Every `notifications.create` (outbid, won, sold, paid, shipped, show live, membership, verification, President
 * messages, Owner broadcasts) lands in the member's inbox, and then:
 *   1. a live banner over the socket to any open app or web page (`notification` on room `user:<id>`), and
 *   2. a push to each registered iPhone through APNs, when the member's switch for that kind is on.
 *
 * Push keys (Railway): APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY (the .p8 text; `\n` escapes allowed),
 * optional APNS_TOPIC (bundle id, default com.rubynav.moneymart). TestFlight and App Store builds use the
 * production APNs host; development builds register as sandbox and are sent to the sandbox host.
 */
import { connect, constants, type ClientHttp2Session } from 'node:http2';
import { createPrivateKey, sign } from 'node:crypto';
import type { AppNotification, User } from '@moneymart/types';
import { broadcasts, notifications, onNotification, pushDevices, store, users, type BroadcastRecord, type PushDevice } from '../store.js';

type Emit = (room: string, event: string, payload: unknown) => void;

/** Which member switch governs a notification (the switches the app's Settings shows). */
export function preferenceKey(n: Pick<AppNotification, 'category' | 'title' | 'href'>): string | null {
  if (n.category === 'bids') return 'outbid';
  if (n.category === 'streams') return 'streamStart';
  if (n.category === 'orders') return 'orderUpdates';
  if (n.href.startsWith('/promo') || n.title.startsWith('Offer:')) return 'marketing';
  return null; // account and safety messages always go through
}

export function wants(user: User | undefined, key: string | null): boolean {
  if (!key) return true;
  return user?.preferences?.notifications?.[key] !== false;
}

/* ── APNs ─────────────────────────────────────────────────────────────── */

const apnsKey = () => (process.env.APNS_PRIVATE_KEY ?? '').replace(/\\n/g, '\n').trim();
export const pushConfigured = () => Boolean(process.env.APNS_KEY_ID && process.env.APNS_TEAM_ID && apnsKey());
const topic = () => process.env.APNS_TOPIC ?? 'com.rubynav.moneymart';

let jwtCache: { token: string; at: number } | null = null;
function providerToken(): string {
  // APNs accepts a token for up to an hour and rejects refreshing more than every 20 minutes.
  if (jwtCache && Date.now() - jwtCache.at < 40 * 60_000) return jwtCache.token;
  const b64 = (v: object | Buffer) => (Buffer.isBuffer(v) ? v : Buffer.from(JSON.stringify(v))).toString('base64url');
  const head = b64({ alg: 'ES256', kid: process.env.APNS_KEY_ID });
  const claims = b64({ iss: process.env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) });
  const signature = sign('sha256', Buffer.from(`${head}.${claims}`), { key: createPrivateKey(apnsKey()), dsaEncoding: 'ieee-p1363' });
  jwtCache = { token: `${head}.${claims}.${b64(signature)}`, at: Date.now() };
  return jwtCache.token;
}

const sessions = new Map<string, ClientHttp2Session>();
function hostFor(env: PushDevice['env']): string {
  if (process.env.MM_APNS_BASE) return process.env.MM_APNS_BASE;
  return env === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
}
function sessionFor(host: string): ClientHttp2Session {
  const existing = sessions.get(host);
  if (existing && !existing.closed && !existing.destroyed) return existing;
  const session = connect(host);
  session.on('error', () => sessions.delete(host));
  session.on('close', () => sessions.delete(host));
  session.unref();
  sessions.set(host, session);
  return session;
}

/** Send one push. Resolves to the APNs status (0 when the connection failed). Drops tokens Apple says are dead. */
export function sendPush(device: PushDevice, n: AppNotification, badge?: number): Promise<number> {
  if (!pushConfigured()) return Promise.resolve(0);
  return new Promise((resolve) => {
    let settled = false;
    const done = (status: number) => {
      if (!settled) {
        settled = true;
        resolve(status);
      }
    };
    try {
      const payload = JSON.stringify({
        aps: { alert: { title: n.title.slice(0, 120), body: n.body.slice(0, 400) }, sound: 'default', ...(badge !== undefined ? { badge } : {}), 'thread-id': n.category },
        href: n.href,
        id: n.id,
      });
      const request = sessionFor(hostFor(device.env)).request({
        [constants.HTTP2_HEADER_METHOD]: 'POST',
        [constants.HTTP2_HEADER_PATH]: `/3/device/${device.token}`,
        authorization: `bearer ${providerToken()}`,
        'apns-topic': topic(),
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-expiration': String(Math.floor(Date.now() / 1000) + 86_400),
        'content-type': 'application/json',
      });
      let status = 0;
      let text = '';
      request.setTimeout(10_000, () => {
        request.close();
        done(0);
      });
      request.on('response', (headers) => {
        status = Number(headers[constants.HTTP2_HEADER_STATUS] ?? 0);
      });
      request.on('data', (chunk) => {
        text += chunk;
      });
      request.on('end', () => {
        // 410 Unregistered, or 400 BadDeviceToken / DeviceTokenNotForTopic: the token will never work again.
        if (status === 410 || (status === 400 && /BadDeviceToken|DeviceTokenNotForTopic/.test(text))) pushDevices.remove(device.token);
        done(status);
      });
      request.on('error', () => done(0));
      request.end(payload);
    } catch {
      done(0);
    }
  });
}

const unreadCount = (userId: string) => notifications.forUser(userId).filter((x) => !x.read).length;

/** Push to all of a member's phones. Returns how many accepted it. */
export async function pushToUser(n: AppNotification): Promise<number> {
  const devices = pushDevices.forUser(n.userId);
  if (!devices.length || !pushConfigured()) return 0;
  const badge = unreadCount(n.userId);
  const results = await Promise.all(devices.map((d) => sendPush(d, n, badge)));
  return results.filter((s) => s === 200).length;
}

/* ── Wiring ───────────────────────────────────────────────────────────── */

let started = false;
/** Deliver every notification created anywhere: live banner always, push when the member's switch allows it. */
export function startDelivery(emit: Emit): void {
  if (started) return;
  started = true;
  onNotification((n) => {
    emit(`user:${n.userId}`, 'notification', n);
    if (wants(users.get(n.userId), preferenceKey(n))) void pushToUser(n);
  });
}

/* ── Owner broadcasts ─────────────────────────────────────────────────── */

export type Audience = 'everyone' | 'buyers' | 'sellers' | 'verified_sellers' | 'pro' | `member:${string}`;

/** A seller is anyone who finished seller setup or holds a selling role. */
export const isSeller = (u: User) => Boolean(u.sellerProfile) || u.role === 'seller' || u.role === 'creator';

export function audienceOf(audience: string): User[] | { error: string } {
  const all = users.all().filter((u) => !u.email.endsWith('@system.invalid'));
  switch (audience) {
    case 'everyone':
      return all;
    case 'buyers':
      return all.filter((u) => !isSeller(u));
    case 'sellers':
      return all.filter(isSeller);
    case 'verified_sellers':
      return all.filter((u) => isSeller(u) && u.verificationStatus === 'verified');
    case 'pro':
      return all.filter((u) => u.isPro);
    default: {
      if (audience.startsWith('member:')) {
        const handle = audience.slice(7).replace(/^@/, '').trim();
        const user = handle ? users.findByHandle(handle) ?? users.findByEmail(handle) : undefined;
        return user ? [user] : { error: `No member @${handle}.` };
      }
      return { error: 'Choose who receives it.' };
    }
  }
}

export interface BroadcastInput {
  title: string;
  body: string;
  audience: string;
  kind?: 'announcement' | 'marketing';
  href?: string;
}

export function checkBroadcast(input: BroadcastInput): string | null {
  if (!input.title?.trim() || input.title.length > 80) return 'A title is needed (up to 80 characters).';
  if (!input.body?.trim() || input.body.length > 600) return 'A message is needed (up to 600 characters).';
  if (input.href && !/^\/[\w\-/?=&.]*$/.test(input.href)) return 'The link must be an app path such as /stream/abc.';
  return null;
}

/** Send to an audience. Marketing respects each member's marketing switch, in the inbox as well as on the phone. */
export function sendBroadcast(by: string, input: BroadcastInput): BroadcastRecord | { error: string } {
  const problem = checkBroadcast(input);
  if (problem) return { error: problem };
  const people = audienceOf(input.audience);
  if (!Array.isArray(people)) return people;
  const kind = input.kind === 'marketing' ? 'marketing' : 'announcement';
  const recipients = kind === 'marketing' ? people.filter((u) => wants(u, 'marketing')) : people;
  const title = kind === 'marketing' && !input.title.startsWith('Offer:') ? `Offer: ${input.title.trim()}` : input.title.trim();
  const href = input.href || (kind === 'marketing' ? '/promo' : '/notifications');
  const devices = recipients.reduce((sum, u) => sum + pushDevices.forUser(u.id).length, 0);
  for (const u of recipients) {
    notifications.create({ id: store.nextId('ntf'), userId: u.id, category: 'system', title, body: input.body.trim(), href, read: false, createdAt: store.iso() });
  }
  return broadcasts.save({
    id: store.nextId('brd'),
    by,
    title,
    body: input.body.trim(),
    audience: input.audience,
    kind,
    href,
    recipients: recipients.length,
    pushed: pushConfigured() ? devices : 0,
    createdAt: store.iso(),
  });
}

export function deliveryStatus() {
  return { push: pushConfigured(), devices: pushDevices.count(), topic: topic() };
}
