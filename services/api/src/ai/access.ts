/**
 * Who may open the Owner console and what they may do.
 *
 * Ported from President Eteka (`access.ts`: owners by email, a ranked team with per-tab grants, "only manage people
 * below you, only give tabs you have") with President Ava's audit log (`admin_audit`). The President and the
 * boardroom are owner-only, always.
 *
 * - Owners: emails in `MM_OWNER_EMAILS` (comma separated, set on Railway), or accounts with role `owner`.
 *   Outside production the seeded house account (role `admin`) also counts, so the console can be developed.
 * - Team: setting `admin.staff` — { email, role: executive | manager | support | analyst, tabs, active }.
 * - Every admin action is written to the audit log with who did it.
 */
import type { User } from '@moneymart/types';
import { audit, settings, store } from '../store.js';

export const ROLES = ['owner', 'executive', 'manager', 'support', 'analyst'] as const;
export type AdminRole = (typeof ROLES)[number];
export const rank = (r: AdminRole) => ROLES.indexOf(r);

export const TABS = [
  'overview', 'revenue', 'costs', 'users', 'sellers', 'approvals', 'orders', 'shows', 'tickets',
  'notifications', 'providers', 'settings', 'team', 'audit', 'president',
] as const;
export type Tab = (typeof TABS)[number];

/** Tabs that only owners ever get, whatever their grants say. */
const OWNER_ONLY: Tab[] = ['president', 'team', 'audit', 'providers'];

export interface StaffGrant {
  email: string;
  role: Exclude<AdminRole, 'owner'>;
  tabs: Tab[];
  active: boolean;
  addedBy: string;
  addedAt: string;
}

export interface Access {
  role: AdminRole;
  tabs: Tab[];
  email: string;
}

export const ownerEmails = () =>
  (process.env.MM_OWNER_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export const staffList = (): StaffGrant[] => settings.get<StaffGrant[]>('admin.staff') ?? [];

/** Pure: what this account may open in the console, or null. */
export function accessFor(user: Pick<User, 'id' | 'email' | 'role'> | undefined, owners = ownerEmails(), staff = staffList(), production = process.env.NODE_ENV === 'production'): Access | null {
  if (!user) return null;
  const email = (user.email ?? '').toLowerCase();
  const isOwner = (email && owners.includes(email)) || (user.role as string) === 'owner' || (!production && user.role === 'admin');
  if (isOwner) return { role: 'owner', tabs: [...TABS], email };
  const grant = staff.find((s) => s.active && s.email.toLowerCase() === email);
  if (!grant) return null;
  return { role: grant.role, tabs: grant.tabs.filter((t) => TABS.includes(t) && !OWNER_ONLY.includes(t)), email };
}

/** Pure: may `actor` add or change `target`? Returns a reason when not. */
export function mayManage(actor: Access, target: { role: AdminRole; tabs: Tab[] }, existing?: { role: AdminRole }): string | null {
  if (actor.role !== 'owner' && !actor.tabs.includes('team')) return "You can't manage the team.";
  if (target.role === 'owner') return 'Owners are set on the server (MM_OWNER_EMAILS), not from the console.';
  if (actor.role !== 'owner' && rank(target.role) <= rank(actor.role)) return `Only someone above a ${actor.role} can give the ${target.role} role.`;
  if (existing && actor.role !== 'owner' && rank(existing.role) <= rank(actor.role)) return 'You can only change people below your own level.';
  const extra = target.tabs.filter((t) => !actor.tabs.includes(t));
  if (extra.length) return `You can only give tabs you have yourself (not ${extra.join(', ')}).`;
  return null;
}

/** Record one admin or AI action. Never throws. */
export function writeAudit(actor: string, action: string, target: string, detail: Record<string, unknown> = {}): void {
  try {
    audit.add({ id: store.nextId('aud'), at: store.iso(), actor, action, target, detail });
  } catch {
    /* auditing must never break the action */
  }
}
