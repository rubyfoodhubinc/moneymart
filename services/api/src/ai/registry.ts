/**
 * The settings the Owner (and, by proposal, President Ore) can change without a code change.
 *
 * Ported from President Eteka (`settings.ts`: a typed registry, each value checked by its own rule, and
 * `PRESIDENT_LOCKED` — settings the President may never propose) with President Ruby's never-allowed list
 * (sign-in, team, keys, security and the President's own approvals stay the Owner's own hand).
 *
 * Values live in the store's `settings` collection, so they survive restarts and apply within the next request.
 */
import { settings } from '../store.js';
import { isCategory } from '@moneymart/tokens';

type Check = (value: unknown) => string | null;

export interface SettingDef {
  key: string;
  label: string;
  group: 'features' | 'shows' | 'home' | 'notifications' | 'president' | 'ai' | 'security' | 'pricing';
  defaultValue: unknown;
  check: Check;
}

const bool: Check = (v) => (typeof v === 'boolean' ? null : 'must be on or off');
const int = (min: number, max: number): Check => (v) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? null : `must be a whole number from ${min} to ${max}`);
const text = (max: number): Check => (v) => (typeof v === 'string' && v.length <= max ? null : `must be text up to ${max} characters`);
const categoryList: Check = (v) => (Array.isArray(v) && v.length <= 12 && v.every(isCategory) ? null : 'must be up to 12 category ids');
const objectValue: Check = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? null : 'must be an object');

export const SETTINGS: SettingDef[] = [
  { key: 'features.live_shows', label: 'Live shows open to sellers', group: 'features', defaultValue: true, check: bool },
  { key: 'features.buy_now', label: 'Buy It Now', group: 'features', defaultValue: true, check: bool },
  { key: 'features.ore', label: 'Ore assistant in the app', group: 'features', defaultValue: true, check: bool },
  { key: 'home.banner', label: 'Home banner message', group: 'home', defaultValue: '', check: text(140) },
  { key: 'home.featured_categories', label: 'Featured categories on Home', group: 'home', defaultValue: [], check: categoryList },
  { key: 'shows.default_timer', label: 'Default item timer (seconds)', group: 'shows', defaultValue: 15, check: int(5, 120) },
  { key: 'notifications.show_starting', label: 'Tell saved viewers when a show starts', group: 'notifications', defaultValue: true, check: bool },
  { key: 'notifications.daily_tips', label: 'Daily tips to members', group: 'notifications', defaultValue: false, check: bool },
  { key: 'ore.voice_id', label: 'Ore voice (Cartesia voice id)', group: 'features', defaultValue: '9626c31c-bec5-4cca-baa8-f8ba9e84c8bc', check: text(64) },
  { key: 'president.name', label: "President's name", group: 'president', defaultValue: 'Ore', check: text(30) },
  { key: 'president.brief_hour_utc', label: 'Daily briefing hour (UTC)', group: 'president', defaultValue: 12, check: int(0, 23) },
  { key: 'ai.seats', label: 'AI model per role', group: 'ai', defaultValue: {}, check: objectValue },
  { key: 'ai.prices', label: 'AI prices (USD per million tokens)', group: 'ai', defaultValue: {}, check: objectValue },
  { key: 'ai.budgets', label: 'AI daily call budgets', group: 'ai', defaultValue: {}, check: objectValue },
];

/**
 * Settings President Ore may never propose: AI configuration (her own models and budgets), security, the team,
 * pricing and fees, and anything about live video providers. These stay the Owner's own hand.
 */
export const PRESIDENT_LOCKED = /^(admin\.|access\.|security\.|owner\.|ai\.|pricing\.|fees\.|liveVideo|president\.approvals)/;

export const defOf = (key: string) => SETTINGS.find((d) => d.key === key);

export function valueOf<T = unknown>(key: string): T {
  const d = defOf(key);
  const stored = settings.get<T>(key);
  return (stored === undefined ? d?.defaultValue : stored) as T;
}

/** Checked change list for a proposal: from → to for each, or an error that refuses the whole set. */
export function checkChanges(changes: { key: string; value: unknown }[], byPresident: boolean): { key: string; label: string; from: unknown; to: unknown }[] | { error: string } {
  if (!changes.length) return { error: 'no changes' };
  const out: { key: string; label: string; from: unknown; to: unknown }[] = [];
  for (const change of changes) {
    const d = defOf(change.key);
    if (!d) return { error: `unknown setting ${change.key}` };
    if (byPresident && PRESIDENT_LOCKED.test(change.key)) return { error: `${change.key} is the Owner's own setting` };
    const problem = d.check(change.value);
    if (problem) return { error: `${d.label}: ${problem}` };
    out.push({ key: d.key, label: d.label, from: valueOf(d.key), to: change.value });
  }
  return out;
}

export function applyChanges(changes: { key: string; to: unknown }[]): void {
  for (const c of changes) settings.set(c.key, c.to);
}
