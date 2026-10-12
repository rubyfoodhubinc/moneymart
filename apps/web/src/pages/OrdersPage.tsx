/**
 * Orders — blueprint §5.2 Orders screen.
 * Buying tab (Pending Payment / Awaiting Shipment / Shipped / Complete / Disputed)
 * and Selling tab (Sold / Awaiting Shipment / Shipped / Paid Out), each linking to
 * order detail with shipping tracker integration.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { CheckIcon, GavelIcon, TrendIcon, TruckIcon, UsersIcon } from '@/components/icons';
import { api } from '@/lib/api';
import { EscrowPanel } from '@/components/escrow';
import { useOrders } from '@/lib/hooks';
import { formatAge, formatMoney } from '@/lib/format';
import { orderStatusLabel, statusTone } from '@/lib/labels';
import { useSession } from '@/store/session';

const BUYING_FILTERS = ['all', 'pending', 'processing', 'shipped', 'complete', 'disputed'] as const;
const SELLING_FILTERS = ['all', 'processing', 'shipped', 'complete'] as const;

export default function OrdersPage() {
  const orders = useOrders();
  const queryClient = useQueryClient();
  const user = useSession((state) => state.user);
  const [side, setSide] = useState<'buying' | 'selling'>('buying');
  const [filter, setFilter] = useState<string>('all');
  const [message, setMessage] = useState<string | null>(null);

  const advance = useMutation({
    mutationFn: ({ id, orderStatus }: { id: string; orderStatus: string }) =>
      api.updateOrder(id, { orderStatus, trackingNumber: `MM${Math.floor(Math.random() * 1e10)}`, courierName: 'DHL Express' }),
    onSuccess: () => {
      setMessage('Order updated and the buyer was notified.');
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  const list = side === 'buying' ? orders.data?.buying ?? [] : orders.data?.selling ?? [];
  const filtered = useMemo(
    () => (filter === 'all' ? list : list.filter((order) => order.orderStatus === filter)),
    [list, filter],
  );

  const spent = (orders.data?.buying ?? []).reduce((sum, order) => sum + order.totalAmount, 0);
  const earned = (orders.data?.selling ?? []).reduce((sum, order) => sum + order.hammerPrice, 0);

  return (
    <Section>
      <PageHeader
        eyebrow="Orders"
        title="Buying and selling, end to end"
        subtitle="Track payment, shipment and settlement on every order. Sellers see the payout schedule; buyers see the courier and tracking number."
        action={
          <div className="flex gap-2">
            {(['buying', 'selling'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setSide(mode);
                  setFilter('all');
                }}
                className="rounded-[11px] border px-4 py-2.5 text-[13px] font-semibold capitalize transition-all"
                style={{
                  borderColor: side === mode ? 'var(--mm-gold-line)' : 'rgba(255,255,255,0.1)',
                  background: side === mode ? 'rgba(245,166,35,0.12)' : 'transparent',
                  color: side === mode ? 'var(--mm-gold)' : 'rgba(255,255,255,0.65)',
                }}
              >
                {mode} ({(side === 'buying' ? orders.data?.buying : orders.data?.selling)?.length ?? 0})
              </button>
            ))}
          </div>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatBlock label="Buying orders" value={orders.data?.buying.length ?? 0} tone="gold" icon={<GavelIcon size={15} />} />
        <StatBlock label="Selling orders" value={orders.data?.selling.length ?? 0} tone="green" icon={<TrendIcon size={15} />} />
        <StatBlock label="Total spent" value={formatMoney(spent, 'USD', { compact: true })} />
        <StatBlock label="Total earned" value={formatMoney(earned, 'USD', { compact: true })} tone="green" />
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {(side === 'buying' ? BUYING_FILTERS : SELLING_FILTERS).map((entry) => (
          <CategoryChip key={entry} label={entry === 'all' ? 'All' : orderStatusLabel(entry)} selected={filter === entry} onClick={() => setFilter(entry)} />
        ))}
      </div>

      {orders.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      ) : !filtered.length ? (
        <EmptyState
          title={side === 'buying' ? 'No purchase orders in this filter' : 'No sales in this filter'}
          body={
            side === 'buying'
              ? 'Win a lot in a live room or buy from the marketplace and it will appear here.'
              : 'Publish a listing or run a stream and your sales will appear here.'
          }
          icon={<TruckIcon size={20} />}
          action={
            <Link to={side === 'buying' ? '/live' : '/sell'}>
              <Button variant="gold">{side === 'buying' ? 'Browse live rooms' : 'Create a listing'}</Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((order) => {
            const other = order.counterparty;
            const nextStatus =
              order.orderStatus === 'processing' ? 'shipped' : order.orderStatus === 'shipped' ? 'complete' : null;
            return (
              <Card key={order.id} className="p-4">
                <div className="flex flex-wrap items-start gap-4">
                  <img
                    src={order.auction?.item.images[0]}
                    alt=""
                    className="h-[86px] w-[104px] shrink-0 rounded-[11px] object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Pill tone={statusTone(order.orderStatus)}>{orderStatusLabel(order.orderStatus)}</Pill>
                      <Pill tone={order.paymentStatus === 'paid' ? 'green' : 'gold'}>{order.paymentStatus}</Pill>
                      <span className="data text-[11.5px] text-white/40">{order.id}</span>
                    </div>
                    <Link
                      to={order.auction ? `/auctions/${order.auction.id}` : '/auctions'}
                      className="clamp-1 block text-[14.5px] font-semibold text-white transition-colors hover:text-[var(--mm-gold)]"
                    >
                      {order.auction?.title ?? 'Order'}
                    </Link>
                    <p className="mt-1 text-[12.5px] text-white/55">
                      {side === 'buying' ? 'Seller' : 'Buyer'}: {other?.displayName} · placed {formatAge(order.createdAt)}
                    </p>
                    {order.trackingNumber ? (
                      <p className="data mt-1.5 text-[11.5px]" style={{ color: 'var(--mm-green)' }}>
                        {order.courierName} · {order.trackingNumber}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <span className="data text-[17px] font-bold" style={{ color: 'var(--mm-gold)' }}>
                      {formatMoney(order.totalAmount, order.currency as 'USD')}
                    </span>
                    <span className="text-[11.5px] text-white/45">
                      hammer {formatMoney(order.hammerPrice, order.currency as 'USD')}
                    </span>
                    {side === 'selling' && nextStatus ? (
                      <Button
                        size="sm"
                        variant="gold"
                        loading={advance.isPending}
                        onClick={() => advance.mutate({ id: order.id, orderStatus: nextStatus })}
                        icon={<CheckIcon size={13} />}
                      >
                        Mark {nextStatus}
                      </Button>
                    ) : (
                      <Button size="sm" variant="navy" icon={<UsersIcon size={13} />} onClick={() => setMessage(`Message thread with ${other?.displayName} opens here.`)}>
                        Message
                      </Button>
                    )}
                  </div>
                </div>

                <div className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-4" style={{ borderColor: 'var(--mm-divider)' }}>
                  <Line label="Hammer" value={formatMoney(order.hammerPrice, order.currency as 'USD')} />
                  <Line label="Buyer's premium" value={formatMoney(order.buyersPremium, order.currency as 'USD')} />
                  <Line label="Shipping" value={formatMoney(order.shipping, order.currency as 'USD')} />
                  <Line label="Tax & fees" value={formatMoney(order.tax, order.currency as 'USD')} />
                </div>

                {/* Escrow: pay into protection, confirm receipt to release. */}
                <div className="mt-4">
                  <EscrowPanel orderId={order.id} compact />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ToastStack>
        {message ? <Toast tone="green" title="Order" body={message} onDismiss={() => setMessage(null)} /> : null}
      </ToastStack>

      <p className="mt-8 text-[11.5px] text-white/35">
        Signed in as {user?.displayName ?? 'guest'} — switch identity from the account menu to see the other side of
        these orders.
      </p>
    </Section>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10.5px] uppercase tracking-wider text-white/40">{label}</p>
      <p className="data mt-0.5 text-[12.5px] font-semibold text-white/85">{value}</p>
    </div>
  );
}
