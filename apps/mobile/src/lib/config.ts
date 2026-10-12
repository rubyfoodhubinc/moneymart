/**
 * MoneyMart mobile — API host resolution.
 *
 * The app previously read its host from `app.json` `extra.apiUrl`, which shipped
 * as `http://127.0.0.1:4317`. On a phone that address is the PHONE's own loopback,
 * not the developer's machine, so the shipped app could not reach any gateway —
 * every request failed and the product was unusable outside a simulator.
 *
 * Resolution order, most specific first:
 *
 *   1. A **runtime override** persisted on the device. This is what makes a
 *      physical phone usable against a LAN address or a staging gateway without a
 *      rebuild, and it is editable in the app's Diagnostics panel.
 *   2. **`extra.apiUrl`** from `app.json`, which is the value baked into a release
 *      build.
 *   3. A **platform-aware development default**: an Android emulator reaches its
 *      host at 10.0.2.2, not 127.0.0.1, which is the single most common reason a
 *      simulator works and an emulator does not.
 *
 * A loopback host is treated as a development convenience and never as a valid
 * production target: `assertReachable()` reports it so a misconfigured release
 * build fails loudly instead of silently sending every request nowhere.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const OVERRIDE_KEY = 'mm:apiOverride';

/** The development gateway port. */
const DEV_PORT = 4317;

/** Where a loopback host actually points, per platform. */
function loopbackFor(platform: string): string {
  // An Android emulator is a virtual machine: its own loopback is the guest, and
  // the host is reachable only at this alias.
  return platform === 'android' ? '10.0.2.2' : '127.0.0.1';
}

function normalise(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\/+$/, '');
  return trimmed ? trimmed : undefined;
}

/** True when the host cannot be reached from another device. */
export function isLoopback(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '10.0.2.2' || host === '::1';
  } catch {
    return false;
  }
}

function defaultFor(platform: string, configured?: string): string {
  if (configured) {
    /**
     * A configured loopback value is honoured but translated for the platform.
     * `app.json` ships one development value for every build; on Android it must
     * become the host alias or it points at the emulator itself.
     */
    if (isLoopback(configured)) {
      try {
        const url = new URL(configured);
        return `${url.protocol}//${loopbackFor(platform)}${url.port ? `:${url.port}` : ''}`.replace(/\/$/, '');
      } catch {
        return configured;
      }
    }
    return configured;
  }
  return `http://${loopbackFor(platform)}:${DEV_PORT}`;
}

let resolved: string | null = null;

/** The resolved host. Falls back to the platform default before configuration. */
export function apiBase(): string {
  if (resolved) return resolved;
  const configured = normalise((Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl);
  return defaultFor(Platform.OS, configured);
}

/**
 * Resolve the host from storage. Call once, before the first request.
 *
 * Safe to call repeatedly; the value is cached after the first success.
 */
export async function configureApi(): Promise<string> {
  try {
    const override = normalise(await AsyncStorage.getItem(OVERRIDE_KEY));
    if (override) {
      resolved = override;
      return resolved;
    }
  } catch {
    /* storage unavailable — fall through to the configured value */
  }
  const configured = normalise((Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl);
  resolved = defaultFor(Platform.OS, configured);
  return resolved;
}

/** Point this device at a different gateway, and persist it. */
export async function setApiOverride(url: string | null): Promise<string> {
  const clean = normalise(url);
  try {
    if (clean) await AsyncStorage.setItem(OVERRIDE_KEY, clean);
    else await AsyncStorage.removeItem(OVERRIDE_KEY);
  } catch {
    /* in-memory for this launch only */
  }
  const configured = normalise((Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl);
  resolved = clean ?? defaultFor(Platform.OS, configured);
  return resolved;
}

export async function getApiOverride(): Promise<string | null> {
  try {
    return normalise(await AsyncStorage.getItem(OVERRIDE_KEY)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Report whether the resolved host is usable.
 *
 * A release build pointed at a loopback address is a configuration error that
 * would otherwise surface as "the app does not work" with no explanation.
 */
export function assertReachable(): { ok: boolean; url: string; detail?: string } {
  const url = apiBase();
  if (!url) return { ok: false, url, detail: 'no_api_url' };
  try {
    // Throws on a malformed value, which is the other way this goes wrong.
    void new URL(url);
  } catch {
    return { ok: false, url, detail: 'malformed_url' };
  }
  if (isLoopback(url)) {
    return {
      ok: false,
      url,
      detail: 'loopback_host_unreachable_from_a_device',
    };
  }
  return { ok: true, url };
}

export const mobileConfig = { apiBase, configureApi, setApiOverride, getApiOverride, assertReachable, isLoopback };
export default mobileConfig;
