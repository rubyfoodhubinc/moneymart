/**
 * MoneyMart — runtime configuration.
 *
 * A single build must be deployable against different API origins: the Railway
 * gateway, a Vercel-hosted web app calling that gateway, a local API during
 * development, or a staging backend. Baking the origin in at build time means a
 * rebuild per environment and guarantees the wrong URL eventually ships (this
 * codebase already had that bug once, reading a Next-style `process.env` that
 * Vite inlined as a literal).
 *
 * Resolution order, first match wins:
 *
 *   1. `/mm-config.json` next to the deployed app — editable after build, which
 *      is what lets a static host be re-pointed without a rebuild.
 *   2. `?api=` query parameter, or a value kept in localStorage, so a tester can
 *      switch backends from the browser.
 *   3. `VITE_API_URL` at build time, when explicitly set.
 *   4. The page origin — the unified deployment, where one host serves both.
 *
 * Resolution is awaited once during boot, before the app renders, so no request
 * is ever issued against a stale origin.
 */

export interface AppConfig {
  /** Absolute API origin, or '' to use the page origin. */
  apiUrl: string;
  /** Public RevenueCat SDK keys for in-app entitlements. */
  revenueCat: { iosKey: string; androidKey: string };
  /** Payment providers the operator wants surfaced first. */
  preferredProviders: string[];
  /** HLS playback fallback when a stream has no manifest. */
  demoHlsUrl: string;
  /** Where this value came from — surfaced in the UI for diagnostics. */
  source: string;
}

const STORAGE_KEY = 'mm-api-override';

const DEFAULTS: Omit<AppConfig, 'source'> = {
  apiUrl: '',
  revenueCat: { iosKey: '', androidKey: '' },
  preferredProviders: [],
  demoHlsUrl: '',
};

/** A same-origin API path, used when the gateway shares the page's host. */
function sameOriginApi(): string {
  return '';
}

function buildTimeApi(): string {
  const value = import.meta.env.VITE_API_URL;
  return typeof value === 'string' ? value.trim() : '';
}

function overrideFromUrlOrStorage(): string {
  if (typeof window === 'undefined') return '';
  try {
    const fromQuery = new URLSearchParams(window.location.search).get('api');
    if (fromQuery) {
      window.localStorage.setItem(STORAGE_KEY, fromQuery);
      return fromQuery;
    }
    return window.localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

let resolved: AppConfig | null = null;

/** Configuration for the current session. Call `loadConfig()` first. */
export function config(): AppConfig {
  if (!resolved) {
    // Safe default if something reads config before boot completes.
    resolved = { ...DEFAULTS, apiUrl: buildTimeApi() || overrideFromUrlOrStorage(), source: 'unresolved' };
  }
  return resolved;
}

/**
 * The API origin to issue requests against.
 * Empty string means "same origin as the page".
 */
export function apiOrigin(): string {
  return config().apiUrl || (typeof window !== 'undefined' ? '' : 'http://127.0.0.1:4317');
}

/** Resolve configuration once. Safe to call repeatedly. */
export async function loadConfig(): Promise<AppConfig> {
  if (resolved) return resolved;

  const override = overrideFromUrlOrStorage();
  if (override) {
    resolved = { ...DEFAULTS, apiUrl: override, source: 'override' };
    return resolved;
  }

  const buildTime = buildTimeApi();
  if (buildTime) {
    resolved = { ...DEFAULTS, apiUrl: buildTime, source: 'build' };
    return resolved;
  }

  /**
   * Fetch the deployed config. Only attempted when the page is served over http
   * or https: a file:// or in-app WebView origin has no meaningful sibling file,
   * and the request would only add latency before the first paint.
   */
  if (typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol)) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const response = await fetch('/mm-config.json', { signal: controller.signal, cache: 'no-store' });
      clearTimeout(timer);
      if (response.ok) {
        const raw = (await response.json()) as Partial<AppConfig>;
        resolved = {
          ...DEFAULTS,
          ...raw,
          apiUrl: typeof raw.apiUrl === 'string' ? raw.apiUrl.trim() : '',
          revenueCat: { ...DEFAULTS.revenueCat, ...(raw.revenueCat ?? {}) },
          preferredProviders: Array.isArray(raw.preferredProviders) ? raw.preferredProviders : [],
          source: 'file',
        };
        return resolved;
      }
    } catch {
      /* no config file deployed — fall through to the page origin */
    }
  }

  resolved = { ...DEFAULTS, apiUrl: sameOriginApi(), source: 'origin' };
  return resolved;
}

/** Clear a stored override (used by the diagnostics panel). */
export function clearApiOverride(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
  resolved = null;
}
