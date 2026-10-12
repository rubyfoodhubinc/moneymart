/**
 * MoneyMart UI primitives.
 * The design-system layer: every surface composes these instead of styling raw
 * markup, which is what keeps the premium look consistent (§2 Brand Identity).
 */
import { Link } from 'react-router-dom';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { CheckIcon, LiveDot, MiniGavelIcon, ShieldIcon, UsersIcon } from './icons';

/* ── Button ────────────────────────────────────────────────────────────── */

type ButtonVariant = 'gold' | 'green' | 'navy' | 'ghost' | 'outline' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  gold: 'text-[#0D1B2A] font-semibold shadow-[0_10px_34px_rgba(245,166,35,0.30)] hover:brightness-[1.08]',
  green: 'text-[#06231C] font-semibold shadow-[0_10px_34px_rgba(0,212,161,0.26)] hover:brightness-[1.08]',
  navy: 'text-white font-semibold border border-white/10 bg-white/[0.04] hover:bg-white/[0.09]',
  ghost: 'text-white/80 font-medium hover:text-white hover:bg-white/[0.06]',
  outline:
    'font-semibold border bg-transparent hover:bg-[rgba(245,166,35,0.10)]',
  danger: 'text-white font-semibold bg-[#E53E3E] hover:brightness-110',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-[13px] gap-1.5 rounded-[10px]',
  md: 'h-11 px-5 text-[14px] gap-2 rounded-[12px]',
  lg: 'h-14 px-7 text-[15px] gap-2.5 rounded-[14px]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  full?: boolean;
}

export function Button({
  variant = 'gold',
  size = 'md',
  loading = false,
  icon,
  full = false,
  className = '',
  children,
  disabled,
  style,
  ...props
}: ButtonProps) {
  const isBare = variant === 'ghost';
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`inline-flex select-none items-center justify-center whitespace-nowrap transition-all duration-200 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-45 ${BUTTON_SIZES[size]} ${BUTTON_VARIANTS[variant]} ${full ? 'w-full' : ''} ${className}`}
      style={{
        background:
          variant === 'gold'
            ? 'var(--mm-gradient-gold)'
            : variant === 'green'
              ? 'var(--mm-gradient-live)'
              : variant === 'navy'
                ? undefined
                : isBare
                  ? undefined
                  : undefined,
        borderColor: variant === 'outline' ? 'var(--mm-gold-line)' : undefined,
        color: variant === 'outline' ? 'var(--mm-gold)' : undefined,
        ...style,
      }}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent"
      style={{ width: size, height: size, opacity: 0.85 }}
    />
  );
}

/* ── Pill / Badge / Chip ───────────────────────────────────────────────── */

export function Pill({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'gold' | 'green' | 'error' | 'navy';
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'border-white/12 text-white/70 bg-white/[0.05]',
    gold: 'border-[rgba(245,166,35,0.38)] text-[var(--mm-gold)] bg-[rgba(245,166,35,0.12)]',
    green: 'border-[rgba(0,212,161,0.4)] text-[var(--mm-green)] bg-[rgba(0,212,161,0.12)]',
    error: 'border-[rgba(229,62,62,0.42)] text-[#FF8080] bg-[rgba(229,62,62,0.14)]',
    navy: 'border-white/10 text-white/80 bg-[#0D1B2A]',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[5px] text-[11px] font-semibold tracking-[0.01em] ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function LiveBadge({ viewers }: { viewers?: number }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(0,212,161,0.4)] bg-[rgba(0,212,161,0.14)] px-2.5 py-[5px] text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--mm-green)] backdrop-blur-md">
      <LiveDot size={7} />
      Live
      {viewers !== undefined ? <span className="data font-semibold tracking-normal">{formatShort(viewers)}</span> : null}
    </span>
  );
}

export function VerifiedBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-[rgba(0,212,161,0.34)] bg-[rgba(0,212,161,0.1)] px-2 py-[3px] text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--mm-green)]"
      title="MoneyMart Verified — authenticity and provenance reviewed"
    >
      <ShieldIcon size={11} />
      {compact ? 'MV' : 'MV Verified'}
    </span>
  );
}

export function CategoryChip({
  label,
  emoji,
  selected = false,
  onClick,
  href,
}: {
  label: string;
  emoji?: string;
  selected?: boolean;
  onClick?: () => void;
  href?: string;
}) {
  const className = `inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-medium transition-all duration-200 ${
    selected
      ? 'border-transparent text-[#0D1B2A] shadow-[0_8px_24px_rgba(245,166,35,0.24)]'
      : 'border-white/10 text-white/72 hover:border-[var(--mm-gold-line)] hover:text-white'
  }`;
  const style = selected ? { background: 'var(--mm-gradient-gold)' } : { background: 'rgba(255,255,255,0.035)' };
  const content = (
    <>
      {emoji ? <span aria-hidden>{emoji}</span> : null}
      {label}
    </>
  );
  if (href) {
    return (
      <Link to={href} className={className} style={style}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className} style={style}>
      {content}
    </button>
  );
}

/* ── Layout ────────────────────────────────────────────────────────────── */

export function SectionHeader({
  eyebrow,
  title,
  action,
  subtitle,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        {eyebrow ? (
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--mm-gold)' }}>
            {eyebrow}
          </p>
        ) : null}
        <h2 className="text-[clamp(21px,2.4vw,30px)] text-white">{title}</h2>
        {subtitle ? <p className="mt-1 max-w-2xl text-[13.5px] text-white/60">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Card({
  children,
  className = '',
  interactive = false,
  glow = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  glow?: boolean;
}) {
  return (
    <div
      className={`card-surface ${interactive ? 'transition-all duration-300 hover:-translate-y-[3px] hover:border-[var(--mm-gold-line)]' : ''} ${className}`}
      style={glow ? { boxShadow: '0 18px 48px rgba(0,0,0,0.46)' } : undefined}
    >
      {children}
    </div>
  );
}

export function StatBlock({
  label,
  value,
  hint,
  tone = 'default',
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'default' | 'gold' | 'green';
  icon?: ReactNode;
}) {
  const color = tone === 'gold' ? 'var(--mm-gold)' : tone === 'green' ? 'var(--mm-green)' : 'white';
  return (
    <div className="card-surface p-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/50">{label}</span>
        {icon ? <span style={{ color }}>{icon}</span> : null}
      </div>
      <div className="data text-[26px] font-bold leading-none" style={{ color }}>
        {value}
      </div>
      {hint ? <p className="mt-2 text-[12px] text-white/50">{hint}</p> : null}
    </div>
  );
}

/* ── Avatar ────────────────────────────────────────────────────────────── */

export function Avatar({
  name,
  src,
  size = 40,
  isLive = false,
  isVerified = false,
  ring = true,
}: {
  name: string;
  src?: string;
  size?: number;
  isLive?: boolean;
  isVerified?: boolean;
  ring?: boolean;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        className="grid place-items-center overflow-hidden rounded-full"
        style={{
          width: size,
          height: size,
          background: 'linear-gradient(140deg, #16294280, #0D1B2A)',
          border: ring ? `2px solid ${isLive ? 'var(--mm-green)' : 'rgba(245,166,35,0.42)'}` : 'none',
        }}
      >
        {src ? (
          <img src={src} alt={name} width={size} height={size} className="h-full w-full object-cover" />
        ) : (
          <span className="font-display font-bold text-white/90" style={{ fontSize: size * 0.38 }}>
            {initials}
          </span>
        )}
      </span>
      {isLive ? (
        <span
          className="absolute -bottom-0.5 -right-0.5 rounded-full border-2"
          style={{ width: size * 0.3, height: size * 0.3, background: 'var(--mm-green)', borderColor: '#070F18' }}
        />
      ) : null}
      {isVerified && !isLive ? (
        <span
          className="absolute -bottom-0.5 -right-0.5 grid place-items-center rounded-full border-2 text-[#06231C]"
          style={{
            width: size * 0.34,
            height: size * 0.34,
            background: 'var(--mm-green)',
            borderColor: '#070F18',
          }}
        >
          <CheckIcon size={Math.max(8, size * 0.2)} strokeWidth={3} />
        </span>
      ) : null}
    </span>
  );
}

/* ── Data display ──────────────────────────────────────────────────────── */

export function PriceTag({
  amount,
  formatted,
  label,
  size = 'md',
  tone = 'current',
  highlight = false,
}: {
  amount?: number;
  formatted: string;
  label?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  tone?: 'current' | 'starting' | 'buyNow' | 'muted';
  highlight?: boolean;
}) {
  const sizes = {
    sm: 'text-[15px]',
    md: 'text-[20px]',
    lg: 'text-[28px]',
    xl: 'text-[38px]',
  } as const;
  const colors = {
    current: 'var(--mm-gold)',
    starting: 'rgba(255,255,255,0.82)',
    buyNow: 'var(--mm-green)',
    muted: 'rgba(255,255,255,0.55)',
  } as const;
  return (
    <span className="flex flex-col leading-none">
      {label ? (
        <span className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">{label}</span>
      ) : null}
      <span
        className={`data font-bold ${sizes[size]} ${highlight ? 'animate-bid-flash rounded-md' : ''}`}
        style={{ color: colors[tone] }}
      >
        {formatted}
      </span>
    </span>
  );
}

export function ProgressBar({ value, tone = 'gold' }: { value: number; tone?: 'gold' | 'green' | 'error' }) {
  const clamped = Math.max(0, Math.min(100, value));
  const background =
    tone === 'green' ? 'var(--mm-green)' : tone === 'error' ? 'var(--mm-error)' : 'var(--mm-gold)';
  return (
    <span className="block h-[5px] w-full overflow-hidden rounded-full bg-white/10">
      <span
        className="block h-full rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${clamped}%`, background }}
      />
    </span>
  );
}

export function MetaRow({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-white/55">
      {icon}
      {children}
    </span>
  );
}

export function LiveViewers({ count }: { count: number }) {
  return (
    <MetaRow icon={<UsersIcon size={13} />}>
      <span className="data">{formatShort(count)}</span> watching
    </MetaRow>
  );
}

export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="card-surface grid place-items-center px-6 py-14 text-center">
      <div
        className="mb-4 grid h-14 w-14 place-items-center rounded-full"
        style={{ background: 'rgba(245,166,35,0.12)', color: 'var(--mm-gold)' }}
      >
        {icon ?? <MiniGavelIcon size={24} />}
      </div>
      <h3 className="text-[18px] text-white">{title}</h3>
      {body ? <p className="mt-2 max-w-sm text-[13.5px] text-white/55">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <span className={`skeleton block rounded-[10px] ${className}`} />;
}

export function formatShort(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return String(count);
}

/* ── Confetti (§2.5 win celebration — 1.2s, GPU accelerated) ───────────── */

export function ConfettiBlast({ active, colors }: { active: boolean; colors?: string[] }) {
  if (!active) return null;
  const palette = colors ?? ['#F5A623', '#00D4A1', '#FFFFFF', '#FFC85C'];
  const pieces = Array.from({ length: 90 }, (_, index) => {
    const drift = (Math.random() - 0.5) * 260;
    return {
      id: index,
      left: `${Math.random() * 100}%`,
      delay: `${(Math.random() * 0.5).toFixed(2)}s`,
      duration: `${(0.85 + Math.random() * 0.45).toFixed(2)}s`,
      drift: `${drift.toFixed(0)}px`,
      color: palette[index % palette.length],
      size: 5 + Math.random() * 7,
      rotate: Math.random() * 360,
      round: index % 5 === 0,
    };
  });
  return (
    <div
      className="pointer-events-none fixed inset-0 overflow-hidden"
      style={{ zIndex: 1100 }}
      aria-hidden
    >
      {pieces.map((piece) => (
        <span
          key={piece.id}
          style={{
            position: 'absolute',
            top: 0,
            left: piece.left,
            width: piece.size,
            height: piece.size * (piece.round ? 1 : 0.45),
            background: piece.color,
            borderRadius: piece.round ? '50%' : '2px',
            transform: `rotate(${piece.rotate}deg)`,
            animation: `mm-confetti-fall ${piece.duration} linear ${piece.delay} forwards`,
            ['--drift' as string]: piece.drift,
          }}
        />
      ))}
    </div>
  );
}

/* ── Toast ─────────────────────────────────────────────────────────────── */

export function Toast({
  tone = 'gold',
  title,
  body,
  onDismiss,
  action,
}: {
  tone?: 'gold' | 'green' | 'error';
  title: string;
  body?: string;
  onDismiss?: () => void;
  action?: ReactNode;
}) {
  const accent = tone === 'green' ? 'var(--mm-green)' : tone === 'error' ? 'var(--mm-error)' : 'var(--mm-gold)';
  return (
    <div
      className="animate-scale-in glass pointer-events-auto flex w-[min(92vw,380px)] items-start gap-3 rounded-[14px] p-4"
      style={{ boxShadow: '0 18px 48px rgba(0,0,0,0.5)', borderColor: `${accent}55` }}
    >
      <span className="mt-[3px] h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accent }} />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold text-white">{title}</p>
        {body ? <p className="mt-1 text-[12.5px] leading-snug text-white/65">{body}</p> : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="text-[11px] font-semibold uppercase tracking-wider text-white/40 hover:text-white/80"
        >
          Close
        </button>
      ) : null}
    </div>
  );
}

export function ToastStack({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-[1000] flex flex-col items-end gap-3">{children}</div>
  );
}
