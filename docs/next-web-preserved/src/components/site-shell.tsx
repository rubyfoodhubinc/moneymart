'use client';

/**
 * MoneyMart site shell — header, footer and mobile tab bar (§8.3 breakpoints).
 * Mobile: bottom tab bar. Tablet: side rail. Desktop/wide: full top navigation.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Avatar, Button, Pill } from '@/components/ui';
import {
  BellIcon,
  CompassIcon,
  GavelIcon,
  HomeIcon,
  MoneyMartMark,
  SearchIcon,
  StoreIcon,
  UserIcon,
  WalletIcon,
} from '@/components/icons';
import { useNotifications } from '@/lib/hooks';
import { useSession } from '@/store/session';
import { formatAge } from '@/lib/format';

const NAV_LINKS = [
  { href: '/live', label: 'Live' },
  { href: '/auctions', label: 'Auctions' },
  { href: '/marketplace', label: 'Marketplace' },
  { href: '/creators', label: 'Creators' },
  { href: '/sell', label: 'Sell' },
  { href: '/studio', label: 'Studio' },
];

/* ── Header ────────────────────────────────────────────────────────────── */

export function SiteHeader() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const { user, profile, users, switchUser } = useSession();
  const notifications = useNotifications();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    setBellOpen(false);
  }, [pathname]);

  const unread = notifications.data?.unread ?? 0;

  return (
    <header
      className="sticky top-0 z-[500] transition-all duration-300"
      style={{
        background: scrolled ? 'rgba(9,18,29,0.86)' : 'transparent',
        backdropFilter: scrolled ? 'blur(18px) saturate(140%)' : undefined,
        borderBottom: scrolled ? '1px solid rgba(255,255,255,0.07)' : '1px solid transparent',
      }}
    >
      <div className="mm-container flex h-[72px] items-center gap-4">
        <Link href="/" className="shrink-0" aria-label="MoneyMart home">
          <MoneyMartMark size={34} withWordmark tagline />
        </Link>

        <nav className="ml-4 hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className="relative rounded-[10px] px-3.5 py-2 text-[13.5px] font-medium transition-colors"
                style={{ color: active ? 'var(--mm-gold)' : 'rgba(255,255,255,0.72)' }}
              >
                {link.label}
                {active ? (
                  <span
                    className="absolute inset-x-3 -bottom-[1px] h-[2px] rounded-full"
                    style={{ background: 'var(--mm-gradient-gold)' }}
                  />
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/search"
            className="hidden h-10 items-center gap-2 rounded-[11px] border border-white/10 bg-white/[0.035] px-3.5 text-[13px] text-white/50 transition-colors hover:border-[var(--mm-gold-line)] hover:text-white/80 md:flex"
          >
            <SearchIcon size={15} />
            <span className="w-[150px] text-left">Search lots, creators…</span>
          </Link>

          <div className="relative">
            <button
              type="button"
              onClick={() => setBellOpen((value) => !value)}
              className="relative grid h-10 w-10 place-items-center rounded-[11px] border border-white/10 bg-white/[0.035] text-white/70 transition-colors hover:border-[var(--mm-gold-line)] hover:text-white"
              aria-label="Notifications"
            >
              <BellIcon size={17} />
              {unread > 0 ? (
                <span
                  className="data absolute -right-1 -top-1 grid h-[19px] min-w-[19px] place-items-center rounded-full px-1 text-[10px] font-bold text-[#0D1B2A]"
                  style={{ background: 'var(--mm-gradient-gold)' }}
                >
                  {unread}
                </span>
              ) : null}
            </button>

            {bellOpen ? (
              <div className="animate-scale-in glass absolute right-0 top-[50px] w-[min(92vw,372px)] rounded-[16px] p-2 shadow-[0_28px_70px_rgba(0,0,0,0.55)]">
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-[13px] font-semibold text-white">Notifications</span>
                  <button
                    type="button"
                    onClick={() => notifications.refetch()}
                    className="text-[11px] font-semibold uppercase tracking-wider text-white/45 hover:text-white"
                  >
                    Refresh
                  </button>
                </div>
                <div className="max-h-[340px] overflow-y-auto">
                  {(notifications.data?.items ?? []).slice(0, 6).map((item) => (
                    <Link
                      key={item.id}
                      href={item.href}
                      className="block rounded-[11px] px-3 py-2.5 transition-colors hover:bg-white/[0.05]"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: item.read ? 'rgba(255,255,255,0.25)' : 'var(--mm-gold)' }}
                        />
                        <span className="flex-1 truncate text-[13px] font-medium text-white/90">{item.title}</span>
                        <span className="text-[11px] text-white/35">{formatAge(item.createdAt)}</span>
                      </div>
                      <p className="clamp-2 mt-1 pl-3.5 text-[12px] text-white/55">{item.body}</p>
                    </Link>
                  ))}
                  {!notifications.data?.items.length ? (
                    <p className="px-3 py-6 text-center text-[12.5px] text-white/45">
                      No notifications yet — bid on something.
                    </p>
                  ) : null}
                </div>
                <Link
                  href="/notifications"
                  className="mt-1 block rounded-[11px] px-3 py-2.5 text-center text-[12.5px] font-semibold"
                  style={{ color: 'var(--mm-gold)' }}
                >
                  View all notifications
                </Link>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            className="flex items-center gap-2 rounded-[11px] border border-white/10 bg-white/[0.035] py-1.5 pl-1.5 pr-3 transition-colors hover:border-[var(--mm-gold-line)]"
          >
            <Avatar
              name={profile?.displayName ?? 'Guest'}
              src={profile?.avatarUrl}
              size={28}
              isVerified={profile?.isVerified}
              ring={false}
            />
            <span className="hidden text-[12.5px] font-medium text-white/85 sm:block">
              {profile?.displayName?.split(' ')[0] ?? 'Sign in'}
            </span>
            {user?.isPro ? <Pill tone="gold">PRO</Pill> : null}
          </button>
        </div>
      </div>

      {menuOpen ? (
        <div className="mm-container">
          <div className="animate-scale-in glass mb-4 rounded-[16px] p-3 shadow-[0_28px_70px_rgba(0,0,0,0.55)]">
            <div className="grid gap-1 sm:grid-cols-2">
              <AccountLink href="/account" icon={<UserIcon size={16} />} label="My account" />
              <AccountLink href="/account/wallet" icon={<WalletIcon size={16} />} label="Wallet & payouts" />
              <AccountLink href="/account/selling" icon={<StoreIcon size={16} />} label="Selling dashboard" />
              <AccountLink href="/account/settings" icon={<CompassIcon size={16} />} label="Settings" />
              <AccountLink href="/sell" icon={<GavelIcon size={16} />} label="Create a listing" />
              <AccountLink href="/studio" icon={<HomeIcon size={16} />} label="Storefront Studio" />
            </div>

            <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--mm-divider)' }}>
              <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">
                Demo identity — switch bidder
              </p>
              <div className="flex flex-wrap gap-2">
                {users.slice(0, 6).map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => void switchUser(candidate.id)}
                    className="flex items-center gap-2 rounded-full border px-2.5 py-1.5 text-[12px] transition-colors"
                    style={{
                      borderColor: candidate.id === user?.id ? 'var(--mm-gold-line)' : 'rgba(255,255,255,0.1)',
                      background: candidate.id === user?.id ? 'rgba(245,166,35,0.12)' : 'transparent',
                      color: candidate.id === user?.id ? 'var(--mm-gold)' : 'rgba(255,255,255,0.75)',
                    }}
                  >
                    <Avatar name={candidate.displayName} src={candidate.avatarUrl} size={20} ring={false} />
                    {candidate.displayName.split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function AccountLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 rounded-[11px] px-3 py-2.5 text-[13px] text-white/80 transition-colors hover:bg-white/[0.06] hover:text-white"
    >
      <span style={{ color: 'var(--mm-gold)' }}>{icon}</span>
      {label}
    </Link>
  );
}

/* ── Mobile tab bar (§8.3: 5 tabs) ─────────────────────────────────────── */

const TABS = [
  { href: '/', label: 'Home', icon: HomeIcon },
  { href: '/live', label: 'Live', icon: GavelIcon },
  { href: '/auctions', label: 'Browse', icon: CompassIcon },
  { href: '/sell', label: 'Sell', icon: StoreIcon },
  { href: '/account', label: 'Account', icon: UserIcon },
];

export function MobileTabBar() {
  const pathname = usePathname();
  const isStreamPage = pathname.startsWith('/stream/');

  if (isStreamPage) return null;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-[500] md:hidden"
      style={{
        background: 'rgba(9,18,29,0.94)',
        backdropFilter: 'blur(18px)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div className="flex items-stretch justify-around">
        {TABS.map((tab) => {
          const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="flex flex-1 flex-col items-center gap-1 py-2.5"
              style={{ color: active ? 'var(--mm-gold)' : 'rgba(255,255,255,0.5)' }}
            >
              <Icon size={20} />
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em]">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/* ── Footer ────────────────────────────────────────────────────────────── */

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t" style={{ borderColor: 'var(--mm-divider)' }}>
      <div className="mm-container py-14">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <MoneyMartMark size={36} withWordmark tagline />
            <p className="mt-4 max-w-xs text-[13px] leading-relaxed text-white/55">
              The hybrid live-commerce and auction platform. Real-time bidding, creator-led streams, and
              expert-catalogued auction house sales — with multi-currency settlement across Nigeria, the USA,
              the UK, Canada and beyond.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Pill tone="green">LIVE 24/7</Pill>
              <Pill tone="gold">MV Verified</Pill>
              <Pill>Escrow protected</Pill>
            </div>
          </div>

          <FooterColumn
            title="Bid"
            links={[
              { href: '/live', label: 'Live now' },
              { href: '/auctions', label: 'All auctions' },
              { href: '/auctions?status=ending', label: 'Ending soon' },
              { href: '/marketplace', label: 'Marketplace' },
            ]}
          />
          <FooterColumn
            title="Sell"
            links={[
              { href: '/sell', label: 'Start selling' },
              { href: '/sell/traditional', label: 'Traditional consignment' },
              { href: '/studio', label: 'Storefront studio' },
              { href: '/fees', label: 'Fees & payouts' },
            ]}
          />
          <FooterColumn
            title="Account"
            links={[
              { href: '/account', label: 'Dashboard' },
              { href: '/account/wallet', label: 'Wallet' },
              { href: '/account/orders', label: 'Orders' },
              { href: '/account/settings', label: 'Settings' },
            ]}
          />
          <FooterColumn
            title="Company"
            links={[
              { href: '/admin', label: 'Admin console' },
              { href: '/trust', label: 'Trust & authenticity' },
              { href: '/compliance', label: 'Compliance' },
              { href: '/help', label: 'Help centre' },
            ]}
          />
        </div>

        <div
          className="mt-12 flex flex-col gap-4 border-t pt-6 text-[12px] text-white/40 md:flex-row md:items-center md:justify-between"
          style={{ borderColor: 'var(--mm-divider)' }}
        >
          <span>© {new Date().getFullYear()} MoneyMart. All rights reserved. “Bid. Stream. Win.”</span>
          <span className="flex flex-wrap items-center gap-4">
            <span>NDPR · CCPA · UK GDPR · PIPEDA compliant architecture</span>
            <span className="data">v2.0</span>
          </span>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: 'var(--mm-gold)' }}>
        {title}
      </p>
      <ul className="space-y-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="text-[13px] text-white/60 transition-colors hover:text-white">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Section({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <section className={`mm-container py-10 ${className}`}>{children}</section>;
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow ? (
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--mm-gold)' }}>
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-[clamp(26px,3.6vw,44px)] text-white">{title}</h1>
        {subtitle ? <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-white/60">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export { Button };
