/**
 * Wallet — blueprint §5.2 Wallet screen.
 * Available balance (Space Grotesk), pending balance, add funds / withdraw,
 * and a filterable transaction history.
 */

import { useMemo, useState } from 'react';
import { PageHeader, Section } from '@/components/site-shell';
import {
  Button,
  Card,
  CategoryChip,
  EmptyState,
  Pill,
  Skeleton,
  StatBlock,
  Toast,
  ToastStack,
} from '@/components/ui';
import { ChartIcon, PlusIcon, TrendIcon, WalletIcon } from '@/components/icons';
import { useWallet } from '@/lib/hooks';
import { EscrowLedgerSummary } from '@/components/escrow';
import { formatAge, formatMoney } from '@/lib/format';
import { useSession } from '@/store/session';

const FILTERS = [
  { value: 'all', label: 'All activity' },
  { value: 'sale', label: 'Sales' },
  { value: 'purchase', label: 'Purchases' },
] as const;

export default function WalletPage() {
  const wallet = useWallet();
  const profile = useSession((state) => state.profile);
  const [filter, setFilter] = useState<string>('all');
  const [message, setMessage] = useState<string | null>(null);

  const currency = (wallet.data?.currency ?? 'USD') as 'USD';
  const transactions = useMemo(() => {
    const list = wallet.data?.transactions ?? [];
    return filter === 'all' ? list : list.filter((entry) => entry.type === filter);
  }, [wallet.data, filter]);

  return (
    <Section>
      <PageHeader
        eyebrow="Wallet"
        title="Balances, payouts and history"
        subtitle="Escrow releases seller funds 7–10 days after buyer confirmation. Withdraw to bank, mobile money or hold as wallet balance."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="gold" icon={<PlusIcon size={15} />} onClick={() => setMessage('Add-funds sheet opens here (Stripe Payment Element / Paystack).')}>
              Add funds
            </Button>
            <Button variant="navy" icon={<WalletIcon size={15} />} onClick={() => setMessage('Withdrawal request queued — payout typically settles in 1–2 business days.')}>
              Withdraw
            </Button>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatBlock
          label="Available balance"
          value={wallet.isLoading ? '—' : formatMoney(wallet.data?.available ?? 0, currency)}
          tone="green"
          icon={<WalletIcon size={15} />}
        />
        <StatBlock
          label="Pending (escrow)"
          value={wallet.isLoading ? '—' : formatMoney(wallet.data?.pending ?? 0, currency)}
          hint="Releases after buyer confirmation"
          tone="gold"
        />
        <StatBlock
          label="Lifetime gross"
          value={wallet.isLoading ? '—' : formatMoney(wallet.data?.lifetimeGross ?? 0, currency, { compact: true })}
          icon={<TrendIcon size={15} />}
        />
        <StatBlock
          label="Payouts"
          value={wallet.data?.payouts.length ?? 0}
          hint="Bank · mobile money · wallet"
          icon={<ChartIcon size={15} />}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-[16px] text-white">Transaction history</h3>
            <div className="flex gap-2">
              {FILTERS.map((entry) => (
                <CategoryChip
                  key={entry.value}
                  label={entry.label}
                  selected={filter === entry.value}
                  onClick={() => setFilter(entry.value)}
                />
              ))}
            </div>
          </div>

          {wallet.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-14 w-full" />
              ))}
            </div>
          ) : !transactions.length ? (
            <EmptyState
              title="No transactions in this filter"
              body="Sales and purchases appear here as soon as they settle."
              icon={<WalletIcon size={20} />}
            />
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--mm-divider)' }}>
              {transactions.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 py-3">
                  <span className="flex min-w-0 items-center gap-3">
                    <span
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-bold"
                      style={{
                        background: entry.type === 'sale' ? 'rgba(0,212,161,0.14)' : 'rgba(245,166,35,0.14)',
                        color: entry.type === 'sale' ? 'var(--mm-green)' : 'var(--mm-gold)',
                      }}
                    >
                      {entry.type === 'sale' ? '↑' : '↓'}
                    </span>
                    <span className="min-w-0">
                      <span className="clamp-1 block text-[13px] font-medium text-white/90">{entry.label}</span>
                      <span className="block text-[11.5px] text-white/45">{formatAge(entry.at)}</span>
                    </span>
                  </span>
                  <span
                    className="data shrink-0 text-[14px] font-semibold"
                    style={{ color: entry.amount >= 0 ? 'var(--mm-green)' : '#FF9A9A' }}
                  >
                    {entry.amount >= 0 ? '+' : '−'}
                    {formatMoney(Math.abs(entry.amount), entry.currency as 'USD')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="flex flex-col gap-5">
          <Card className="p-5">
            <h3 className="mb-4 text-[16px] text-white">Payout history</h3>
            {wallet.data?.payouts.length ? (
              <ul className="space-y-2.5">
                {wallet.data.payouts.map((payout) => (
                  <li key={payout.id} className="rounded-[11px] border border-white/8 p-3" style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="data text-[12px] text-white/50">{payout.referenceId}</span>
                      <Pill tone={payout.status === 'paid' ? 'green' : 'gold'}>{payout.status}</Pill>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span className="text-[12.5px] capitalize text-white/70">
                        {payout.payoutMethod.replace('_', ' ')} · {payout.orderIds.length} order(s)
                      </span>
                      <span className="data text-[14px] font-semibold" style={{ color: 'var(--mm-green)' }}>
                        {formatMoney(payout.netAmount, payout.currency as 'USD')}
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11.5px] text-white/40">
                      Gross {formatMoney(payout.grossAmount, payout.currency as 'USD')} · platform fee{' '}
                      {formatMoney(payout.platformFee, payout.currency as 'USD')}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-white/50">No payouts yet. Your first sale will create one here.</p>
            )}
          </Card>

          <EscrowLedgerSummary />

          <Card className="p-5">
            <h3 className="mb-3 text-[16px] text-white">Payout destinations</h3>
            <ul className="space-y-2.5 text-[12.5px]">
              <DestinationRow label="Bank transfer" detail="Sterling · GTBank ****4821" active />
              <DestinationRow label="Mobile money" detail="M-Pesa / MTN MoMo — add a number" />
              <DestinationRow label="Wallet balance" detail="Hold funds for instant reuse at checkout" />
            </ul>
            <p className="mt-4 text-[11.5px] leading-relaxed text-white/45">
              {profile?.countryCode === 'NG'
                ? 'NGN payouts require BVN verification per CBN directive.'
                : 'Identity verification is required before your first withdrawal (Stripe Identity or local equivalent).'}
            </p>
          </Card>
        </div>
      </div>

      <ToastStack>
        {message ? <Toast tone="green" title="Wallet action" body={message} onDismiss={() => setMessage(null)} /> : null}
      </ToastStack>
    </Section>
  );
}

function DestinationRow({ label, detail, active = false }: { label: string; detail: string; active?: boolean }) {
  return (
    <li
      className="flex items-center justify-between gap-3 rounded-[11px] border p-3"
      style={{
        borderColor: active ? 'var(--mm-gold-line)' : 'rgba(255,255,255,0.08)',
        background: active ? 'rgba(245,166,35,0.08)' : 'rgba(255,255,255,0.02)',
      }}
    >
      <span>
        <span className="block text-[12.5px] font-semibold text-white/90">{label}</span>
        <span className="block text-[11.5px] text-white/45">{detail}</span>
      </span>
      {active ? <Pill tone="gold">Default</Pill> : <Button size="sm" variant="ghost">Set up</Button>}
    </li>
  );
}
