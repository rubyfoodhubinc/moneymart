'use client';

/**
 * EscrowPanel — the buyer-facing surface of the payments service (§9.1).
 *
 * Renders the escrow state honestly and offers exactly the action the state
 * machine permits: Pay → (seller ships) → Confirm receipt → funds release.
 * A dispute is always available while funds are held.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EscrowState } from '@moneymart/types';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { Button, Card, Pill, Toast, ToastStack } from '@/components/ui';
import { CheckIcon, GavelIcon, ShieldIcon, TrendIcon, TruckIcon, WalletIcon } from '@/components/icons';

/** Plain-language state, because "in_escrow" means nothing to a buyer. */
const STATE_COPY: Record<
  EscrowState,
  { label: string; tone: 'gold' | 'green' | 'neutral' | 'error'; blurb: string }
> = {
  requires_payment: {
    label: 'Payment due',
    tone: 'gold',
    blurb: 'Your invoice is open. Once paid, MoneyMart holds the funds until you confirm delivery.',
  },
  processing: { label: 'Processing', tone: 'gold', blurb: 'Contacting the payment rail…' },
  in_escrow: {
    label: 'Held in escrow',
    tone: 'green',
    blurb: 'MoneyMart is holding your funds safely. The seller is preparing to ship.',
  },
  releasing: { label: 'Releasing', tone: 'green', blurb: 'Releasing your funds to the seller now.' },
  released: {
    label: 'Released to seller',
    tone: 'green',
    blurb: 'You confirmed receipt and the seller has been paid.',
  },
  disputed: { label: 'In dispute', tone: 'error', blurb: 'Funds are frozen while our team reviews your case.' },
  refunded: { label: 'Refunded', tone: 'neutral', blurb: 'Your money has been returned in full.' },
  failed: {
    label: 'Payment failed',
    tone: 'error',
    blurb: 'The rail declined the charge. Your order is still reserved — you can try again.',
  },
  cancelled: { label: 'Cancelled', tone: 'neutral', blurb: 'This escrow was cancelled.' },
};

const LABEL_CLASS = 'text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40';

export function useEscrow(orderId: string) {
  return useQuery({ queryKey: ['escrow', orderId], queryFn: () => api.escrow(orderId), enabled: Boolean(orderId) });
}

export function EscrowPanel({ orderId, compact = false }: { orderId: string; compact?: boolean }) {
  const queryClient = useQueryClient();
  const escrow = useEscrow(orderId);
  const [notice, setNotice] = useState<{ tone: 'green' | 'gold' | 'error'; title: string; body?: string } | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['escrow', orderId] });
    void queryClient.invalidateQueries({ queryKey: ['orders'] });
    void queryClient.invalidateQueries({ queryKey: ['wallet'] });
  };

  const pay = useMutation({
    mutationFn: () => api.payOrder(orderId),
    onSuccess: (result) => {
      if (result.escrow.state === 'in_escrow') {
        setNotice({
          tone: 'green',
          title: 'Payment held in escrow',
          body: `${formatMoney(result.escrow.heldAmount, result.escrow.currency as 'USD')} is protected until you confirm delivery.`,
        });
      } else {
        setNotice({
          tone: 'error',
          title: 'Payment declined',
          body: `${result.intent.failureReason ?? 'The rail declined the charge'}. Your order is still reserved — try again.`,
        });
      }
      invalidate();
    },
    onError: (error: unknown) =>
      setNotice({ tone: 'error', title: 'Payment failed', body: error instanceof Error ? error.message : undefined }),
  });

  const confirm = useMutation({
    mutationFn: () => api.confirmReceipt(orderId),
    onSuccess: (result) => {
      setNotice({
        tone: 'green',
        title: 'Funds released',
        body: result.payoutAmount
          ? `${formatMoney(result.payoutAmount, result.escrow.currency as 'USD')} released to the seller. Thanks for confirming.`
          : 'The seller has been paid.',
      });
      invalidate();
    },
    onError: (error: unknown) =>
      setNotice({ tone: 'error', title: 'Could not confirm', body: error instanceof Error ? error.message : undefined }),
  });

  const dispute = useMutation({
    mutationFn: () => api.disputeOrder(orderId, 'Buyer raised a concern from the orders page'),
    onSuccess: () => {
      setNotice({ tone: 'gold', title: 'Dispute opened', body: 'Funds are frozen while our team reviews your case.' });
      invalidate();
    },
    onError: (error: unknown) =>
      setNotice({
        tone: 'error',
        title: 'Could not open a dispute',
        body: error instanceof Error ? error.message : undefined,
      }),
  });

  if (escrow.isLoading) {
    return (
      <Card className={compact ? 'p-4' : 'p-5'}>
        <p className="text-[12.5px] text-white/45">Loading escrow…</p>
      </Card>
    );
  }

  const record = escrow.data?.escrow;
  const summary = escrow.data?.summary;
  if (!record || !summary) return null;

  const copy = STATE_COPY[record.state];
  const currency = record.currency as 'USD';

  return (
    <>
      <Card className={compact ? 'p-4' : 'p-5'}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2">
            <ShieldIcon size={15} />
            <span className="text-[13.5px] font-semibold text-white">Escrow</span>
            <Pill tone={copy.tone}>{copy.label}</Pill>
          </span>
          <span className="text-[11.5px] text-white/40">via {record.provider}</span>
        </div>

        <p className="text-[12.5px] leading-relaxed text-white/65">{copy.blurb}</p>

        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          <div>
            <p className={LABEL_CLASS}>Collected</p>
            <p className="data mt-1 text-[17px] font-bold text-white">{formatMoney(record.heldAmount, currency)}</p>
          </div>
          <div>
            <p className={LABEL_CLASS}>Released</p>
            <p className="data mt-1 text-[17px] font-bold" style={{ color: 'var(--mm-green)' }}>
              {formatMoney(record.releasedAmount, currency)}
            </p>
          </div>
          <div>
            <p className={LABEL_CLASS}>{record.refundedAmount > 0 ? 'Refunded' : 'Seller receives'}</p>
            <p
              className="data mt-1 text-[17px] font-bold"
              style={{ color: record.refundedAmount > 0 ? 'var(--mm-gold)' : 'rgba(255,255,255,0.8)' }}
            >
              {record.refundedAmount > 0
                ? formatMoney(record.refundedAmount, currency)
                : formatMoney(escrow.data?.sellerNet ?? 0, currency)}
            </p>
          </div>
        </dl>

        {/* Only the transitions the state machine permits are offered. */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {summary.canPay ? (
            <Button
              variant="gold"
              loading={pay.isPending}
              onClick={() => pay.mutate()}
              icon={<WalletIcon size={15} />}
            >
              Pay {formatMoney(escrow.data?.amountDue ?? 0, currency)}
            </Button>
          ) : null}

          {summary.canConfirmReceipt ? (
            <Button
              variant="green"
              loading={confirm.isPending}
              onClick={() => confirm.mutate()}
              icon={<CheckIcon size={15} />}
            >
              Confirm receipt &amp; release funds
            </Button>
          ) : null}

          {summary.canDispute ? (
            <Button variant="ghost" loading={dispute.isPending} onClick={() => dispute.mutate()}>
              Report a problem
            </Button>
          ) : null}

          {record.payoutId ? (
            <Pill tone="green">
              <TrendIcon size={11} />
              Payout {record.payoutId}
            </Pill>
          ) : null}
        </div>

        {record.state === 'requires_payment' ? (
          <p className="mt-3 inline-flex items-start gap-2 text-[11.5px] leading-relaxed text-white/40">
            <TruckIcon size={13} />
            The seller is only paid after you confirm the item arrived as described. If something is wrong, report a
            problem and the funds stay frozen.
          </p>
        ) : null}

        {/* Audit trail — every transition, in order. */}
        <details className="mt-4">
          <summary className="cursor-pointer text-[11.5px] font-semibold text-white/40">
            Escrow history ({record.history.length})
          </summary>
          <ul className="mt-2 space-y-1.5">
            {record.history
              .slice()
              .reverse()
              .map((event, index) => (
                <li
                  key={`${event.at}-${index}`}
                  className="flex items-start justify-between gap-3 text-[11.5px]"
                >
                  <span className="text-white/55">
                    <span className="data text-white/35">{event.state}</span>
                    {event.note ? ` · ${event.note}` : ''}
                  </span>
                  <span className="data shrink-0 text-white/35">
                    {new Date(event.at).toLocaleTimeString()}
                  </span>
                </li>
              ))}
          </ul>
        </details>
      </Card>

      <ToastStack>
        {notice ? (
          <Toast tone={notice.tone} title={notice.title} body={notice.body} onDismiss={() => setNotice(null)} />
        ) : null}
      </ToastStack>
    </>
  );
}

/** Platform-wide view of funds MoneyMart is holding on sellers' behalf. */
export function EscrowLedgerSummary() {
  const ledger = useQuery({ queryKey: ['escrow-ledger'], queryFn: () => api.escrowLedger() });
  if (!ledger.data) return null;

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <GavelIcon size={15} />
        <span className="text-[13.5px] font-semibold text-white">Held in escrow platform-wide</span>
      </div>
      <p className="data text-[26px] font-bold" style={{ color: 'var(--mm-green)' }}>
        {formatMoney(ledger.data.totalHeld, 'USD')}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {Object.entries(ledger.data.byState).map(([state, count]) => (
          <Pill key={state} tone={state === 'in_escrow' ? 'green' : state === 'disputed' ? 'error' : 'neutral'}>
            {state} · {count}
          </Pill>
        ))}
      </div>
    </Card>
  );
}

export default EscrowPanel;
