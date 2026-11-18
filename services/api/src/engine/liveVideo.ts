/**
 * Live video — two interchangeable providers behind one interface.
 *
 *   Amazon IVS Real-Time  (primary by default)  — a "stage" per show; hosts get a
 *                                                 PUBLISH token, viewers SUBSCRIBE.
 *   Cloudflare Stream     (backup)              — a WebRTC live input per show;
 *                                                 the host pushes WHIP, viewers pull WHEP.
 *
 * Which one new shows use is a platform setting staff can flip from the admin
 * dashboard. When automatic fallback is on and the chosen provider fails (not
 * configured, rejected, timed out), the other one is tried, so a provider outage
 * does not cancel a seller's show. A show keeps the provider its room was created
 * on; the host can ask to move a running show to the backup.
 *
 * No SDKs: both are plain HTTPS APIs. IVS requests are signed with AWS Signature
 * Version 4 (implemented below and checked against AWS's published test vector).
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';

export type LiveVideoProviderId = 'ivs' | 'cloudflare';
export const LIVE_VIDEO_PROVIDERS: LiveVideoProviderId[] = ['ivs', 'cloudflare'];

/** Where a show's room lives. Host-private: never sent to viewers as-is. */
export interface LiveRoom {
  provider: LiveVideoProviderId;
  /** IVS stage ARN or Cloudflare live input uid. */
  roomId: string;
  /** Cloudflare: the WHIP ingest URL (a secret — whoever has it can broadcast). */
  whipUrl?: string;
  /** Cloudflare: the WHEP playback URL. */
  whepUrl?: string;
  createdAt: string;
}

export interface HostCredentials {
  provider: LiveVideoProviderId;
  ivs?: { stageArn: string; token: string; participantId?: string; expiresAt?: string };
  cloudflare?: { whipUrl: string };
}

export interface ViewerCredentials {
  provider: LiveVideoProviderId;
  ivs?: { token: string; participantId?: string; expiresAt?: string };
  cloudflare?: { whepUrl: string };
}

export class LiveVideoError extends Error {
  constructor(public provider: LiveVideoProviderId, public reason: string, message: string) {
    super(message);
  }
}

const TIMEOUT_MS = Number(process.env.MM_LIVE_VIDEO_TIMEOUT_MS ?? 8000);

/* ── AWS Signature Version 4 ─────────────────────────────────────────── */

const sha256 = (data: string) => createHash('sha256').update(data, 'utf8').digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data, 'utf8').digest();

/** RFC 3986 encoding as SigV4 requires (encodeURIComponent leaves !'()* alone). */
const awsEncode = (value: string) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export interface SignInput {
  method: string;
  url: string;
  region: string;
  service: string;
  headers: Record<string, string>;
  body: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  now?: Date;
}

/** Returns the headers to send, including `authorization` and `x-amz-date`. */
export function signAwsRequest(input: SignInput): Record<string, string> {
  const url = new URL(input.url);
  const amzDate = (input.now ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const headers: Record<string, string> = { ...input.headers, host: url.host, 'x-amz-date': amzDate };
  if (input.sessionToken) headers['x-amz-security-token'] = input.sessionToken;

  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const lowered = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const canonicalHeaders = names.map((h) => `${h}:${String(lowered[h]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalQuery = [...url.searchParams.entries()]
    .map(([k, v]) => [awsEncode(k), awsEncode(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x! < y! ? -1 : 1) : a! < b! ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalPath = url.pathname.split('/').map((part) => awsEncode(decodeURIComponent(part))).join('/') || '/';
  const canonicalRequest = [input.method.toUpperCase(), canonicalPath, canonicalQuery, canonicalHeaders, signedHeaders, sha256(input.body)].join('\n');

  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  const kSigning = hmac(hmac(hmac(kDate, input.region), input.service), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const out: Record<string, string> = { ...headers };
  delete out.host; // fetch sets Host itself
  out.authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return out;
}

/* ── Provider configuration (environment only; secrets never stored) ─── */

function ivsConfig() {
  const accessKeyId = process.env.MM_IVS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.MM_IVS_SECRET_ACCESS_KEY;
  const region = process.env.MM_IVS_REGION ?? 'us-east-1';
  if (!accessKeyId || !secretAccessKey) return null;
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: process.env.MM_IVS_SESSION_TOKEN,
    region,
    endpoint: (process.env.MM_IVS_ENDPOINT ?? `https://ivsrealtime.${region}.amazonaws.com`).replace(/\/+$/, ''),
  };
}

function cloudflareConfig() {
  const accountId = process.env.MM_CF_ACCOUNT_ID;
  const token = process.env.MM_CF_STREAM_TOKEN;
  if (!accountId || !token) return null;
  return {
    accountId,
    token,
    apiBase: (process.env.MM_CF_API_BASE ?? 'https://api.cloudflare.com/client/v4').replace(/\/+$/, ''),
  };
}

export function isConfigured(provider: LiveVideoProviderId): boolean {
  return provider === 'ivs' ? Boolean(ivsConfig()) : Boolean(cloudflareConfig());
}

export const PROVIDER_LABELS: Record<LiveVideoProviderId, string> = {
  ivs: 'Amazon IVS Real-Time',
  cloudflare: 'Cloudflare Stream',
};

/* ── HTTP ─────────────────────────────────────────────────────────────── */

async function call(provider: LiveVideoProviderId, url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    const timedOut = (error as Error)?.name === 'TimeoutError';
    throw new LiveVideoError(provider, timedOut ? 'timeout' : 'unreachable', `${PROVIDER_LABELS[provider]} did not respond`);
  }
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!response.ok) {
    // Provider messages can echo request details; keep only a short code for logs and clients.
    const code = (json as { code?: string; __type?: string; errors?: { code?: number }[] } | null);
    const detail = code?.code ?? code?.__type ?? String(code?.errors?.[0]?.code ?? response.status);
    throw new LiveVideoError(provider, `http_${response.status}`, `${PROVIDER_LABELS[provider]} refused the request (${detail})`);
  }
  return json;
}

/* ── Amazon IVS Real-Time ─────────────────────────────────────────────── */

async function ivs<T>(operation: string, payload: Record<string, unknown>): Promise<T> {
  const config = ivsConfig();
  if (!config) throw new LiveVideoError('ivs', 'not_configured', 'Amazon IVS is not configured');
  const url = `${config.endpoint}/${operation}`;
  const body = JSON.stringify(payload);
  const headers = signAwsRequest({
    method: 'POST',
    url,
    region: config.region,
    service: 'ivs',
    headers: { 'content-type': 'application/json' },
    body,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    sessionToken: config.sessionToken,
  });
  return (await call('ivs', url, { method: 'POST', headers, body })) as T;
}

/** IVS token lifetime, minutes (IVS allows up to 14 days). */
const HOST_TOKEN_MINUTES = 12 * 60;
const VIEWER_TOKEN_MINUTES = 6 * 60;

async function ivsToken(stageArn: string, userId: string, publish: boolean, minutes: number) {
  const result = await ivs<{ participantToken?: { token?: string; participantId?: string; expirationTime?: string } }>(
    'CreateParticipantToken',
    {
      stageArn,
      userId: userId.slice(0, 128),
      duration: minutes,
      capabilities: publish ? ['PUBLISH', 'SUBSCRIBE'] : ['SUBSCRIBE'],
      attributes: { role: publish ? 'host' : 'viewer' },
    },
  );
  const token = result?.participantToken?.token;
  if (!token) throw new LiveVideoError('ivs', 'bad_response', 'Amazon IVS returned no token');
  return { token, participantId: result.participantToken?.participantId, expiresAt: result.participantToken?.expirationTime };
}

/* ── Cloudflare Stream ────────────────────────────────────────────────── */

async function cloudflare<T>(method: string, path: string, payload?: Record<string, unknown>): Promise<T> {
  const config = cloudflareConfig();
  if (!config) throw new LiveVideoError('cloudflare', 'not_configured', 'Cloudflare Stream is not configured');
  const result = (await call('cloudflare', `${config.apiBase}/accounts/${encodeURIComponent(config.accountId)}${path}`, {
    method,
    headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  })) as { success?: boolean; result?: T } | null;
  if (result && result.success === false) throw new LiveVideoError('cloudflare', 'rejected', 'Cloudflare Stream rejected the request');
  return result?.result as T;
}

/* ── Public operations ───────────────────────────────────────────────── */

/** Create a room for a show on one provider. */
export async function createRoom(provider: LiveVideoProviderId, showId: string, title: string): Promise<LiveRoom> {
  const name = `mm-${showId}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 128);
  if (provider === 'ivs') {
    // No tags: tagging needs the extra ivs:TagResource permission, and the stage
    // name already identifies the show.
    const result = await ivs<{ stage?: { arn?: string } }>('CreateStage', { name });
    const arn = result?.stage?.arn;
    if (!arn) throw new LiveVideoError('ivs', 'bad_response', 'Amazon IVS returned no stage');
    return { provider, roomId: arn, createdAt: new Date().toISOString() };
  }
  const input = await cloudflare<{ uid?: string; webRTC?: { url?: string }; webRTCPlayback?: { url?: string } }>('POST', '/stream/live_inputs', {
    meta: { name: `${title}`.slice(0, 100), show: showId },
    recording: { mode: 'off' },
  });
  if (!input?.uid || !input.webRTC?.url || !input.webRTCPlayback?.url) {
    throw new LiveVideoError('cloudflare', 'bad_response', 'Cloudflare Stream returned no WebRTC addresses');
  }
  return { provider, roomId: input.uid, whipUrl: input.webRTC.url, whepUrl: input.webRTCPlayback.url, createdAt: new Date().toISOString() };
}

export async function hostCredentials(room: LiveRoom, hostId: string): Promise<HostCredentials> {
  if (room.provider === 'ivs') {
    return { provider: 'ivs', ivs: { stageArn: room.roomId, ...(await ivsToken(room.roomId, hostId, true, HOST_TOKEN_MINUTES)) } };
  }
  if (!room.whipUrl) throw new LiveVideoError('cloudflare', 'bad_room', 'The show has no broadcast address');
  return { provider: 'cloudflare', cloudflare: { whipUrl: room.whipUrl } };
}

export async function viewerCredentials(room: LiveRoom, viewerId: string | null): Promise<ViewerCredentials> {
  if (room.provider === 'ivs') {
    return { provider: 'ivs', ivs: await ivsToken(room.roomId, viewerId ?? `guest-${randomUUID()}`, false, VIEWER_TOKEN_MINUTES) };
  }
  if (!room.whepUrl) throw new LiveVideoError('cloudflare', 'bad_room', 'The show has no playback address');
  return { provider: 'cloudflare', cloudflare: { whepUrl: room.whepUrl } };
}

/** Best effort: a room left behind costs nothing while idle, so failures are logged, not thrown. */
export async function closeRoom(room: LiveRoom): Promise<void> {
  try {
    if (room.provider === 'ivs') await ivs('DeleteStage', { arn: room.roomId });
    else await cloudflare('DELETE', `/stream/live_inputs/${encodeURIComponent(room.roomId)}`);
  } catch (error) {
    console.warn(`[live-video] could not close ${room.provider} room: ${(error as Error).message}`);
  }
}

/**
 * Create a room on the preferred provider, falling back to the other one when
 * allowed. Returns the room and, when the primary failed, why.
 */
export async function createRoomWithFallback(
  primary: LiveVideoProviderId,
  autoFallback: boolean,
  showId: string,
  title: string,
): Promise<{ room: LiveRoom; failedOver?: { from: LiveVideoProviderId; reason: string } }> {
  const order: LiveVideoProviderId[] = [primary, ...(autoFallback ? LIVE_VIDEO_PROVIDERS.filter((p) => p !== primary) : [])];
  let firstFailure: LiveVideoError | undefined;
  for (const provider of order) {
    if (!isConfigured(provider)) {
      firstFailure ??= new LiveVideoError(provider, 'not_configured', `${PROVIDER_LABELS[provider]} is not configured`);
      continue;
    }
    try {
      const room = await createRoom(provider, showId, title);
      return provider === primary ? { room } : { room, failedOver: { from: primary, reason: firstFailure?.reason ?? 'unavailable' } };
    } catch (error) {
      firstFailure ??= error instanceof LiveVideoError ? error : new LiveVideoError(provider, 'error', String(error));
    }
  }
  throw firstFailure ?? new LiveVideoError(primary, 'not_configured', 'No live video provider is configured');
}
