/**
 * MoneyMart iconography (§2.5).
 * Custom gavel set plus live pulse indicators, drawn as inline SVG so they
 * inherit currentColor and stay crisp at every size.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...props,
  };
}

/** Primary gavel mark — also the crossbar motif of the MM monogram. */
export function GavelIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M13.4 3.6l7 7-2.3 2.3-7-7z" />
      <path d="M11.1 5.9L5.3 11.7a1.6 1.6 0 000 2.3l2.6 2.6a1.6 1.6 0 002.3 0l5.8-5.8" />
      <path d="M4 21h9" />
      <path d="M8.5 17.5L6 20" />
    </svg>
  );
}

/** Mini gavel for inline status and chips. */
export function MiniGavelIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12.8 4.2l6 6-1.9 1.9-6-6z" />
      <path d="M10.9 6.1L6 11a1.4 1.4 0 000 2l2.1 2.1a1.4 1.4 0 002 0l4.9-4.9" />
      <path d="M5 20h8" />
    </svg>
  );
}

/** Falling hammer — used for auction-end states. */
export function HammerIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 3.8l6.2 6.2-2 2-6.2-6.2z" />
      <path d="M12.2 5.6l-3.4 3.4 6.2 6.2 3.4-3.4" />
      <path d="M9.4 13.2L3.6 19" />
    </svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 10.6L12 3.6l8.5 7v9a1.4 1.4 0 01-1.4 1.4H4.9a1.4 1.4 0 01-1.4-1.4z" />
      <path d="M9.4 21v-6.4h5.2V21" />
    </svg>
  );
}

export function CompassIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M15.4 8.6l-2 4.8-4.8 2 2-4.8z" />
    </svg>
  );
}

export function StoreIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.8 9.4L5.4 4.6h13.2l1.6 4.8" />
      <path d="M4.6 9.4v10a1 1 0 001 1h12.8a1 1 0 001-1v-10" />
      <path d="M3.8 9.4a2.6 2.6 0 005.2 0 2.6 2.6 0 005.2 0 2.6 2.6 0 005.2 0" />
      <path d="M9.6 20.4v-5h4.8v5" />
    </svg>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8.4" r="3.8" />
      <path d="M4.6 20.4c0-3.7 3.3-6.2 7.4-6.2s7.4 2.5 7.4 6.2" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="11" cy="11" r="6.6" />
      <path d="M16 16l4.4 4.4" />
    </svg>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M18 15.4V10a6 6 0 10-12 0v5.4L4.4 18h15.2z" />
      <path d="M10 20.6a2.2 2.2 0 004 0" />
    </svg>
  );
}

export function WalletIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="6.4" width="18" height="12" rx="2.4" />
      <path d="M3 10.4h18" />
      <circle cx="16.6" cy="14.6" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function HeartIcon({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  return (
    <svg {...base(props)} fill={filled ? 'currentColor' : 'none'}>
      <path d="M12 20s-7.4-4.4-7.4-9.4A4.3 4.3 0 0112 7.8a4.3 4.3 0 017.4 2.8c0 5-7.4 9.4-7.4 9.4z" />
    </svg>
  );
}

export function ShareIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="17.6" cy="6" r="2.6" />
      <circle cx="6.4" cy="12" r="2.6" />
      <circle cx="17.6" cy="18" r="2.6" />
      <path d="M8.8 10.8l6.4-3.4M8.8 13.2l6.4 3.4" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.6 12.6l4.8 4.8L19.4 7" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9.4 5.6l6.4 6.4-6.4 6.4" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M5.6 9.4l6.4 6.4 6.4-6.4" />
    </svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <svg {...base(props)} fill="currentColor" stroke="none">
      <path d="M7.6 5.2l11 6.8-11 6.8z" />
    </svg>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="9.4" cy="8.6" r="3.2" />
      <path d="M3.4 19.6c0-3.1 2.7-5.2 6-5.2s6 2.1 6 5.2" />
      <path d="M16 6.2a3 3 0 010 5.6M17.6 19.6c0-2.2-.7-3.9-1.9-5" />
    </svg>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.4l1.9 5 5 1.9-5 1.9-1.9 5-1.9-5-5-1.9 5-1.9z" />
    </svg>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.4l7 2.6v5.4c0 4.3-2.9 7.9-7 9.2-4.1-1.3-7-4.9-7-9.2V6z" />
      <path d="M9 12.2l2.2 2.2 4-4.4" />
    </svg>
  );
}

export function TruckIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2.6" y="7" width="11.4" height="9" rx="1.4" />
      <path d="M14 10h3.6l3.4 3.4V16H14z" />
      <circle cx="7" cy="18" r="1.8" />
      <circle cx="17.4" cy="18" r="1.8" />
    </svg>
  );
}

export function TrendIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.6 16.6l5.2-5.2 3.4 3.4 6.4-6.4" />
      <path d="M14.4 8.4h4.2v4.2" />
    </svg>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M3.6 12h16.8" />
      <path d="M12 3.4c2.4 2.4 3.6 5.4 3.6 8.6s-1.2 6.2-3.6 8.6c-2.4-2.4-3.6-5.4-3.6-8.6S9.6 5.8 12 3.4z" />
    </svg>
  );
}

export function CameraIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.4 8.6h3.2l1.4-2.2h8l1.4 2.2h3.2v9.4H3.4z" />
      <circle cx="12" cy="13" r="3.1" />
    </svg>
  );
}

export function ChartIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.4 19.6V4.4" />
      <path d="M4.4 19.6H20" />
      <path d="M8 16.4v-4M12 16.4V8.4M16 16.4v-6.6" />
    </svg>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="2.9" />
      <path d="M19.2 14.6a1.6 1.6 0 00.3 1.8l.1.1a1.9 1.9 0 11-2.7 2.7l-.1-.1a1.6 1.6 0 00-2.7 1.1v.3a1.9 1.9 0 11-3.8 0v-.1a1.6 1.6 0 00-2.8-1.1l-.1.1a1.9 1.9 0 11-2.7-2.7l.1-.1a1.6 1.6 0 00-1.1-2.7h-.2a1.9 1.9 0 010-3.8h.1a1.6 1.6 0 001.1-2.8l-.1-.1a1.9 1.9 0 112.7-2.7l.1.1a1.6 1.6 0 002.7-1.1V3.4a1.9 1.9 0 013.8 0v.1a1.6 1.6 0 002.8 1.1l.1-.1a1.9 1.9 0 112.7 2.7l-.1.1a1.6 1.6 0 001.1 2.7h.2a1.9 1.9 0 010 3.8h-.1a1.6 1.6 0 00-1.5 1z" />
    </svg>
  );
}

export function LiveDot({ size = 8, label }: { size?: number; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative inline-flex" style={{ width: size, height: size }}>
        <span className="absolute inset-0 rounded-full" style={{ background: 'var(--mm-green)' }} />
        <span className="pulse-ring" />
      </span>
      {label ? (
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.16em]"
          style={{ color: 'var(--mm-green)' }}
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}

/** MoneyMart monogram — MM with the gavel crossbar and the green pulse line. */
export function MoneyMartMark({ size = 40, withWordmark = false, tagline = false }: { size?: number; withWordmark?: boolean; tagline?: boolean }) {
  const height = size;
  const width = size * 0.98;
  return (
    <span className="inline-flex items-center gap-[10px]">
      <svg width={width} height={height + 4} viewBox="0 0 44 48" fill="none" aria-hidden>
        <defs>
          <linearGradient id="mm-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FFD88A" />
            <stop offset="46%" stopColor="#F5A623" />
            <stop offset="100%" stopColor="#D98A0F" />
          </linearGradient>
        </defs>
        {/* Two geometric M letterforms */}
        <path d="M2 30V12l9 10 9-10v18" stroke="url(#mm-gold)" strokeWidth="4.4" strokeLinecap="square" fill="none" />
        <path d="M22 30V12l9 10 9-10v18" stroke="url(#mm-gold)" strokeWidth="4.4" strokeLinecap="square" fill="none" />
        {/* Gavel handle integrated into the second crossbar */}
        <path d="M31 20.4h9.6" stroke="#00D4A1" strokeWidth="3" strokeLinecap="round" />
        {/* Electric Green pulse line */}
        <path
          d="M2 39h8l3-5 3.4 10L20 39h6l2.4-3.4L31 39h11"
          stroke="#00D4A1"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
      {withWordmark ? (
        <span className="flex flex-col leading-none">
          <span className="font-display text-[19px] font-bold tracking-[-0.02em] text-white">
            Money<span className="gold-text">Mart</span>
          </span>
          {tagline ? (
            <span
              className="mt-[3px] text-[9px] font-semibold uppercase tracking-[0.26em]"
              style={{ color: 'var(--mm-gold)' }}
            >
              Bid. Stream. Win.
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
