/**
 * MoneyMart web — session token storage.
 *
 * Kept in its own module so `lib/api.ts` can read the token without importing
 * the Zustand store, which itself calls `api`. Sharing the store would create a
 * cycle — the failure mode is a `undefined` binding at module-evaluation time,
 * which surfaces as a confusing runtime error rather than a build failure.
 *
 * Persistence is `localStorage` so a refresh does not sign the user out. That is
 * a deliberate trade: any script on the origin could read the token, which is the
 * same exposure as the session cookie this app does not yet use. The migration
 * path is an httpOnly cookie once the API and web share an origin in every
 * environment.
 */
const STORAGE_KEY = 'mm:token';
const EXPIRY_KEY = 'mm:tokenExpiry';

let token: string | null = null;
let hydrated = false;

/** Subscribers are notified when the token is cleared, so the UI can react. */
type Listener = (token: string | null) => void;
const listeners = new Set<Listener>();

function readStored(): string | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const expiry = Number(window.localStorage.getItem(EXPIRY_KEY) ?? 0);
    // Treat an expired token as absent rather than sending it and eating a 401
    // on every request until something clears it.
    if (stored && expiry && Date.now() > expiry) {
      clearToken();
      return null;
    }
    return stored;
  } catch {
    // Storage can be unavailable (private mode, disabled cookies).
    return null;
  }
}

export function getToken(): string | null {
  if (!hydrated) {
    token = readStored();
    hydrated = true;
  }
  return token;
}

export function setToken(next: string, expiresAt?: string): void {
  token = next;
  hydrated = true;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
    if (expiresAt) {
      const expiry = Date.parse(expiresAt);
      if (Number.isFinite(expiry)) window.localStorage.setItem(EXPIRY_KEY, String(expiry));
    }
  } catch {
    /* in-memory only; the session still works for this page life */
  }
  listeners.forEach((listener) => listener(next));
}

export function clearToken(): void {
  token = null;
  hydrated = true;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(EXPIRY_KEY);
  } catch {
    /* nothing to clear */
  }
  listeners.forEach((listener) => listener(null));
}

export function onTokenChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Headers every request should carry. */
export function authHeaders(): Record<string, string> {
  const current = getToken();
  return current ? { authorization: `Bearer ${current}` } : {};
}
