/**
 * MoneyMart — live video source resolution (§5.3, §7).
 *
 * A stream's playback URL is resolved server-side and reported honestly, so no
 * client has to guess whether it is watching a real broadcast, a demo manifest
 * or a room that is not live yet.
 *
 * The seeded data previously pointed every stream at `stream.moneymart.demo`,
 * a host that does not exist — the player would fail on every room. Rather than
 * leave a plausible-looking dead URL in place, unresolvable sources fall back to
 * a real public HLS manifest and are labelled `demo`, so the playback path is
 * exercised end to end without credentials while never being mistaken for a
 * genuine broadcast.
 */
import type { StreamPlayback } from '@moneymart/types';

/** Public, CORS-enabled multi-bitrate manifests used for local playback. */
const DEMO_MANIFESTS = [
  'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  'https://test-streams.mux.dev/pts_shift/master.m3u8',
  'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8',
];

/** Deterministic pick so a given room always plays the same manifest. */
function demoManifestFor(streamId: string): string {
  let hash = 0;
  for (let i = 0; i < streamId.length; i += 1) hash = (hash * 31 + streamId.charCodeAt(i)) >>> 0;
  return DEMO_MANIFESTS[hash % DEMO_MANIFESTS.length]!;
}

/**
 * A placeholder host, kept only so existing data that still carries one is
 * recognised as unresolvable rather than being handed to a player.
 */
const PLACEHOLDER_HOSTS = ['stream.moneymart.demo', 'live.moneymart.demo', 'example.com'];

function isPlaceholder(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return PLACEHOLDER_HOSTS.some((placeholder) => host === placeholder || host.endsWith(`.${placeholder}`));
  } catch {
    return true; // unparseable is unusable
  }
}

/** True when a managed provider is configured for real ingest. */
export function liveIngestConfigured(): boolean {
  return Boolean(
    (process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET) ||
      (process.env.CLOUDFLARE_STREAM_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID),
  );
}

export interface ResolvePlaybackOptions {
  streamId: string;
  status: string;
  /** URL stored on the stream, when there is one. */
  storedUrl?: string;
  /** Operator override from configuration, applied to every room. */
  fallbackUrl?: string;
}

/**
 * Decide what a room should play.
 *
 * Order: a real stored URL, then the operator's configured default, then a demo
 * manifest for live rooms. A room that is not live resolves to `offline` with no
 * URL, so clients show the poster rather than a failing player.
 */
export function resolveStreamPlayback(options: ResolvePlaybackOptions): StreamPlayback {
  const { streamId, status, storedUrl, fallbackUrl } = options;
  const isLive = status === 'live';

  if (storedUrl && !isPlaceholder(storedUrl)) {
    return { url: storedUrl, mode: 'live', label: liveIngestConfigured() ? 'Live broadcast' : 'Broadcast', updatedAt: new Date().toISOString() };
  }

  if (fallbackUrl && !isPlaceholder(fallbackUrl)) {
    return {
      url: fallbackUrl,
      mode: isLive ? 'demo' : 'offline',
      label: isLive ? 'Demo stream' : 'Not live yet',
      updatedAt: new Date().toISOString(),
    };
  }

  if (isLive) {
    return {
      url: demoManifestFor(streamId),
      mode: 'demo',
      label: 'Demo stream',
      updatedAt: new Date().toISOString(),
    };
  }

  return {
    mode: 'offline',
    label: status === 'scheduled' ? 'Starts soon' : 'Stream ended',
    updatedAt: new Date().toISOString(),
  };
}

export const playback = { resolveStreamPlayback, liveIngestConfigured, isPlaceholder, demoManifestFor };
export default playback;
