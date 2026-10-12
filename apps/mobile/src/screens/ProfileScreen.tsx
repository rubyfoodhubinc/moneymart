/**
 * Profile & Account — blueprint §5.2 Profile & Account Screens.
 * Public profile summary, private dashboard (30-day earnings), wallet snapshot,
 * orders, watchlist and the demo identity switcher.
 */
import { useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Avatar,
  Body,
  Button,
  Card,
  Data,
  Display,
  EmptyState,
  Pill,
  SectionHeader,
  StatBlock,
  VerifiedBadge,
  styles as ui,
} from '@/components/ui';
import {
  BellIcon,
  ChartIcon,
  CheckIcon,
  GavelIcon,
  GlobeIcon,
  ShieldIcon,
  StoreIcon,
  TrendIcon,
  TruckIcon,
  UsersIcon,
  WalletIcon,
} from '@/components/icons';
import { useEarnings, useNotifications, useOrders, useStreams, useWallet } from '@/lib/hooks';
import { formatAge, formatMoney, formatViewers, pct } from '@/lib/format';
import { colors } from '@/theme';
import { useSession } from '@/store/session';
import { apiBase, getApiOverride, setApiOverride, isLoopback } from '@/lib/config';
import { MONETIZATION } from '@moneymart/tokens';

export default function ProfileScreen({ navigation }: { navigation: any }) {
  const insets = useSafeAreaInsets();
  const user = useSession((state) => state.user);
  const profile = useSession((state) => state.profile);
  const users = useSession((state) => state.users);
  const switchUser = useSession((state) => state.switchUser);

  const earnings = useEarnings();
  const wallet = useWallet();
  const orders = useOrders();
  const notifications = useNotifications();
  const streams = useStreams();

  const [refreshing, setRefreshing] = useState(false);
  /**
   * The gateway field.
   *
   * Seeded from the persisted override, so the panel shows what is actually in use
   * rather than an empty box the user has to guess at.
   */
  const [gateway, setGateway] = useState<{ draft: string; notice: string | null }>({ draft: '', notice: null });

  useEffect(() => {
    void (async () => {
      const override = await getApiOverride();
      setGateway({ draft: override ?? apiBase(), notice: null });
    })();
  }, []);
  const [tab, setTab] = useState<'dashboard' | 'orders' | 'wallet'>('dashboard');

  const series = earnings.data?.series ?? [];
  const maxValue = Math.max(1, ...series.map((point) => point.value));
  const buying = orders.data?.buying ?? [];
  const selling = orders.data?.selling ?? [];
  const myStreams = (streams.data?.items ?? []).filter((stream) => stream.creatorId === user?.id);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([earnings.reload(), wallet.reload(), orders.reload(), notifications.reload()]);
    setRefreshing(false);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 90 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.gold} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Display size={25}>Account</Display>
          <Pill tone="gold">
            <BellIcon size={11} color={colors.gold} />
            <Body size={10} weight="semibold" color={colors.gold}>
              {notifications.data?.unread ?? 0} unread
            </Body>
          </Pill>
        </View>

        {/*
          Diagnostics: the gateway this device talks to.

          A physical phone cannot reach the development loopback address, so without
          a runtime override the only way to point a device at a LAN or staging
          gateway would be to rebuild the app. Shown always, because "which server
          is this app talking to" is the first question when anything looks wrong.
        */}
        <Card style={styles.identityCard}>
          <View style={styles.row}>
            <GlobeIcon size={14} color={colors.gold} />
            <Body size={12} weight="semibold" color={colors.ink2} style={styles.ml8}>
              Gateway
            </Body>
          </View>
          <Data size={11} color={colors.ink3} style={styles.gatewayUrl}>
            {gateway.draft || apiBase()}
          </Data>
          {isLoopback(gateway.draft || apiBase()) ? (
            <Body size={11} color={colors.warning} style={styles.ml8}>
              This is a loopback address. A phone cannot reach it — set your computer&apos;s LAN
              address instead.
            </Body>
          ) : null}
          <TextInput
            value={gateway.draft}
            onChangeText={(value) => setGateway((state) => ({ ...state, draft: value, notice: null }))}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://moneymart-production.up.railway.app"
            placeholderTextColor={colors.ink3}
            style={styles.gatewayInput}
          />
          <View style={styles.row}>
            <Button
              label="Use this gateway"
              variant="ghost"
              onPress={() => {
                void (async () => {
                  const applied = await setApiOverride(gateway.draft);
                  setGateway({ draft: applied, notice: 'Saved. Restart the app to reconnect.' });
                })();
              }}
            />
            <Button
              label="Reset"
              variant="ghost"
              onPress={() => {
                void (async () => {
                  const applied = await setApiOverride(null);
                  setGateway({ draft: applied, notice: 'Reset to the built-in gateway.' });
                })();
              }}
            />
          </View>
          {gateway.notice ? (
            <Body size={11} color={colors.gold} style={styles.ml8}>
              {gateway.notice}
            </Body>
          ) : null}
        </Card>

        {/* Identity card */}
        <Card style={styles.identityCard}>
          <View style={styles.identityTop}>
            <Avatar
              name={profile?.displayName ?? 'Guest'}
              src={profile?.avatarUrl}
              size={58}
              isLive={myStreams.some((stream) => stream.status === 'live')}
              isVerified={profile?.isVerified}
            />
            <View style={styles.flex1}>
              <View style={styles.row}>
                <Display size={18}>{profile?.displayName ?? 'Guest'}</Display>
                {profile?.isVerified ? <VerifiedBadge /> : null}
              </View>
              <Data size={12} color={colors.ink3} style={styles.handle}>
                @{profile?.handle ?? 'guest'}
              </Data>
              <View style={styles.chipRow}>
                <Pill>{user?.role ?? 'buyer'}</Pill>
                {user?.isPro ? <Pill tone="gold">PRO</Pill> : null}
                <Pill>
                  <GlobeIcon size={10} color={colors.ink2} />
                  <Body size={10} weight="semibold" color={colors.ink2}>
                    {user?.currencyCode ?? 'USD'}
                  </Body>
                </Pill>
              </View>
            </View>
          </View>

          {profile?.bio ? (
            <Body size={12.5} color={colors.ink3} style={styles.bio}>
              {profile.bio}
            </Body>
          ) : null}

          <View style={styles.metrics}>
            <Metric label="Sales" value={String(profile?.totalSales ?? 0)} />
            <Metric label="Followers" value={formatViewers(profile?.followersCount ?? 0)} />
            <Metric label="Rating" value={`${(profile?.rating ?? 0).toFixed(1)} ★`} />
            <Metric label="Response" value={`${profile?.responseTimeMinutes ?? 0}m`} />
          </View>
        </Card>

        {/* Segment */}
        <View style={styles.segment}>
          {(['dashboard', 'orders', 'wallet'] as const).map((entry) => {
            const active = tab === entry;
            return (
              <Pressable key={entry} onPress={() => setTab(entry)} style={[styles.segmentItem, active ? styles.segmentActive : null]}>
                <Body size={12.5} weight="semibold" color={active ? colors.gold : colors.ink3} style={styles.capitalize}>
                  {entry}
                </Body>
              </Pressable>
            );
          })}
        </View>

        {/* ── Dashboard ──────────────────────────────────────────────── */}
        {tab === 'dashboard' ? (
          <>
            <View style={styles.statRow}>
              <StatBlock
                label="30-day GMV"
                value={formatMoney(earnings.data?.gmv ?? 0, 'USD', { compact: true })}
                tone="gold"
                hint={`${earnings.data?.itemsSold ?? 0} sold`}
              />
              <StatBlock
                label="Creator share"
                value={formatMoney(earnings.data?.creatorShare ?? 0, 'USD', { compact: true })}
                tone="green"
                hint={pct(MONETIZATION.creatorShare)}
              />
            </View>

            <Card style={styles.chartCard}>
              <View style={styles.chartHead}>
                <View style={styles.row}>
                  <ChartIcon size={15} color={colors.gold} />
                  <Body size={13.5} weight="semibold" color={colors.ink}>
                    30-day earnings
                  </Body>
                </View>
                <Pill tone="green">
                  <TrendIcon size={11} color={colors.green} />
                  <Body size={10} weight="semibold" color={colors.green}>
                    live
                  </Body>
                </Pill>
              </View>

              <View style={styles.chart}>
                {series.slice(-30).map((point, index) => (
                  <View
                    key={`${point.label}-${index}`}
                    style={[
                      styles.bar,
                      { height: Math.max(4, (point.value / maxValue) * 96) },
                    ]}
                  />
                ))}
              </View>
              <View style={styles.chartFooter}>
                <Body size={10.5} color={colors.ink3}>
                  {series[0]?.label} – {series[series.length - 1]?.label}
                </Body>
                <Body size={11} color={colors.ink3}>
                  avg {formatMoney(earnings.data?.avgSalePrice ?? 0, 'USD')}
                </Body>
              </View>
            </Card>

            {/* Upcoming streams */}
            <View style={styles.section}>
              <SectionHeader
                eyebrow={`${myStreams.length} rooms`}
                title="My streams"
                action={
                  <Pill tone="gold">
                    <StoreIcon size={11} color={colors.gold} />
                    <Body size={10} weight="semibold" color={colors.gold}>
                      Studio on web
                    </Body>
                  </Pill>
                }
              />
              {myStreams.length ? (
                myStreams.map((stream) => (
                  <Pressable
                    key={stream.id}
                    onPress={() => navigation.navigate('Stream', { id: stream.id })}
                    style={styles.streamRow}
                  >
                    <Image source={{ uri: stream.posterUrl }} style={styles.streamThumb} />
                    <View style={styles.flex1}>
                      <Body size={13} weight="medium" color={colors.ink} numberOfLines={1}>
                        {stream.title}
                      </Body>
                      <Body size={11} color={colors.ink3}>
                        {stream.status === 'live'
                          ? `${formatViewers(stream.viewerCount)} watching`
                          : new Date(stream.scheduledStartTime).toLocaleString()}
                      </Body>
                    </View>
                    <Pill tone={stream.status === 'live' ? 'green' : 'neutral'}>{stream.status}</Pill>
                  </Pressable>
                ))
              ) : (
                <EmptyState
                  title="No rooms from this identity"
                  body="Switch to a creator account below to run a live room in this demo."
                />
              )}
            </View>
          </>
        ) : null}

        {/* ── Orders ─────────────────────────────────────────────────── */}
        {tab === 'orders' ? (
          <>
            <View style={styles.statRow}>
              <StatBlock label="Buying" value={String(buying.length)} tone="gold" />
              <StatBlock label="Selling" value={String(selling.length)} tone="green" />
            </View>
            <SectionHeader eyebrow="Buying" title="Your purchases" />
            {buying.length ? (
              buying.map((order) => (
                <Card key={order.id} style={styles.orderCard}>
                  <Image source={{ uri: order.auction?.item.images[0] }} style={styles.orderImage} />
                  <View style={styles.flex1}>
                    <Body size={12.5} weight="medium" color={colors.ink} numberOfLines={2}>
                      {order.auction?.title ?? order.id}
                    </Body>
                    <Body size={11} color={colors.ink3} style={styles.orderMeta}>
                      {order.counterparty?.displayName} · {formatAge(order.createdAt)}
                    </Body>
                    {order.trackingNumber ? (
                      <Data size={10.5} color={colors.green} style={styles.tracking}>
                        {order.courierName} · {order.trackingNumber}
                      </Data>
                    ) : null}
                  </View>
                  <View style={styles.alignEnd}>
                    <Data size={14} color={colors.gold}>
                      {formatMoney(order.totalAmount, order.currency as 'USD')}
                    </Data>
                    <Pill tone={order.orderStatus === 'shipped' || order.orderStatus === 'complete' ? 'green' : 'gold'}>
                      {order.orderStatus}
                    </Pill>
                  </View>
                </Card>
              ))
            ) : (
              <EmptyState title="No purchases yet" body="Win a lot in a live room and it appears here." />
            )}

            <SectionHeader eyebrow="Selling" title="Your sales" />
            {selling.length ? (
              selling.map((order) => (
                <Card key={order.id} style={styles.orderCard}>
                  <Image source={{ uri: order.auction?.item.images[0] }} style={styles.orderImage} />
                  <View style={styles.flex1}>
                    <Body size={12.5} weight="medium" color={colors.ink} numberOfLines={2}>
                      {order.auction?.title ?? order.id}
                    </Body>
                    <Body size={11} color={colors.ink3} style={styles.orderMeta}>
                      Buyer {order.counterparty?.displayName}
                    </Body>
                  </View>
                  <View style={styles.alignEnd}>
                    <Data size={14} color={colors.green}>
                      {formatMoney(order.hammerPrice * 0.9, order.currency as 'USD')}
                    </Data>
                    <Body size={10} color={colors.ink3}>
                      after 10% fee
                    </Body>
                  </View>
                </Card>
              ))
            ) : (
              <EmptyState title="No sales yet" body="Publish a listing from the Sell tab to get started." />
            )}
          </>
        ) : null}

        {/* ── Wallet ─────────────────────────────────────────────────── */}
        {tab === 'wallet' ? (
          <>
            <Card style={styles.walletCard}>
              <Body size={10.5} weight="semibold" color={colors.ink3} style={ui.uppercase}>
                Available balance
              </Body>
              <Data size={34} color={colors.green} style={styles.balance}>
                {formatMoney(wallet.data?.available ?? 0, (wallet.data?.currency ?? 'USD') as 'USD')}
              </Data>
              <View style={styles.walletMeta}>
                <Body size={11.5} color={colors.ink3}>
                  Pending {formatMoney(wallet.data?.pending ?? 0, 'USD')}
                </Body>
                <Body size={11.5} color={colors.ink3}>
                  Lifetime {formatMoney(wallet.data?.lifetimeGross ?? 0, 'USD', { compact: true })}
                </Body>
              </View>
              <View style={styles.walletActions}>
                <Button label="Add funds" variant="gold" size="sm" style={styles.flex1} />
                <Button label="Withdraw" variant="navy" size="sm" style={styles.flex1} />
              </View>
            </Card>

            <SectionHeader eyebrow="Recent activity" title="Transactions" />
            {(wallet.data?.transactions ?? []).slice(0, 8).map((entry) => (
              <View key={entry.id} style={styles.txRow}>
                <View
                  style={[
                    styles.txIcon,
                    { backgroundColor: entry.type === 'sale' ? colors.greenSoft : colors.goldSoft },
                  ]}
                >
                  <Data size={12} color={entry.type === 'sale' ? colors.green : colors.gold}>
                    {entry.type === 'sale' ? '↑' : '↓'}
                  </Data>
                </View>
                <View style={styles.flex1}>
                  <Body size={12.5} color={colors.ink}>
                    {entry.label}
                  </Body>
                  <Body size={11} color={colors.ink3}>
                    {formatAge(entry.at)}
                  </Body>
                </View>
                <Data size={13} color={entry.amount >= 0 ? colors.green : '#FF9A9A'}>
                  {entry.amount >= 0 ? '+' : '−'}
                  {formatMoney(Math.abs(entry.amount), entry.currency as 'USD')}
                </Data>
              </View>
            ))}
            {!(wallet.data?.transactions ?? []).length ? (
              <EmptyState title="No transactions" body="Sales and purchases appear here once they settle." />
            ) : null}
          </>
        ) : null}

        {/* KYC + settings shortcuts */}
        <Card style={styles.kycCard}>
          <ShieldIcon size={16} color={colors.gold} />
          <View style={styles.flex1}>
            <Body size={12.5} weight="semibold" color={colors.ink}>
              Identity verification — level {user?.kycLevel ?? 0}
            </Body>
            <Body size={11.5} color={colors.ink3} style={styles.kycHint}>
              {user?.verificationStatus === 'verified'
                ? 'Verified. High-value lots and payouts are enabled.'
                : 'Required for high-value lots and payouts above threshold.'}
            </Body>
          </View>
          {user?.verificationStatus === 'verified' ? <CheckIcon size={16} color={colors.green} /> : <Pill tone="gold">Start</Pill>}
        </Card>

        <View style={styles.shortcuts}>
          <Shortcut icon={<WalletIcon size={16} color={colors.gold} />} label="Wallet & payouts" onPress={() => setTab('wallet')} />
          <Shortcut icon={<TruckIcon size={16} color={colors.gold} />} label="Orders" onPress={() => setTab('orders')} />
          <Shortcut icon={<GavelIcon size={16} color={colors.gold} />} label="Sell a lot" onPress={() => navigation.navigate('Sell')} />
          <Shortcut icon={<UsersIcon size={16} color={colors.gold} />} label="Live rooms" onPress={() => navigation.navigate('Live')} />
        </View>

        {/* Demo identity switcher */}
        <Card style={styles.switcherCard}>
          <Body size={10.5} weight="semibold" color={colors.ink3} style={ui.uppercase}>
            Demo identity
          </Body>
          <Body size={11.5} color={colors.ink3} style={styles.switcherHint}>
            Switch between buyer, creator and admin accounts to explore every flow against the same live data.
          </Body>
          <View style={styles.switcherWrap}>
            {users.map((entry) => {
              const active = entry.id === user?.id;
              return (
                <Pressable
                  key={entry.id}
                  onPress={() => void switchUser(entry.id)}
                  style={[styles.switcherChip, active ? styles.switcherActive : null]}
                >
                  <Avatar name={entry.displayName} src={entry.avatarUrl} size={20} />
                  <Body size={11.5} weight="medium" color={active ? colors.gold : colors.ink2}>
                    {entry.displayName.split(' ')[0]}
                  </Body>
                </Pressable>
              );
            })}
          </View>
        </Card>

        <Body size={11} color={colors.ink3} style={styles.footnote}>
          MoneyMart v2.0 · “Bid. Stream. Win.” · Escrow protected · NDPR, CCPA, UK GDPR and PIPEDA compliant
          architecture.
        </Body>
      </ScrollView>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Data size={13.5} color={colors.ink}>
        {value}
      </Data>
      <Body size={9.5} color={colors.ink3} style={ui.uppercase}>
        {label}
      </Body>
    </View>
  );
}

function Shortcut({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.shortcut}>
      {icon}
      <Body size={11.5} color={colors.ink2} style={styles.shortcutLabel}>
        {label}
      </Body>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  gatewayUrl: { marginTop: 4, marginBottom: 8 },
  gatewayInput: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 11,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: colors.ink,
    fontSize: 13,
    marginBottom: 8,
  },
  ml8: { marginLeft: 8 },
  root: { flex: 1, backgroundColor: colors.surface },
  flex1: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  alignEnd: { alignItems: 'flex-end', gap: 5 },
  capitalize: { textTransform: 'capitalize' },
  content: { paddingHorizontal: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },

  identityCard: { padding: 16 },
  identityTop: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  handle: { marginTop: 4 },
  chipRow: { flexDirection: 'row', gap: 6, marginTop: 9, flexWrap: 'wrap' },
  bio: { marginTop: 12, lineHeight: 18 },
  metrics: { flexDirection: 'row', gap: 8, marginTop: 14 },
  metric: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.025)',
    paddingVertical: 9,
    gap: 3,
  },

  segment: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    marginTop: 16,
    marginBottom: 16,
  },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 8 },
  segmentActive: { backgroundColor: colors.goldSoft },

  statRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  chartCard: { padding: 16, marginBottom: 22 },
  chartHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 100, marginTop: 16 },
  bar: { flex: 1, borderRadius: 2, backgroundColor: colors.gold, minWidth: 3 },
  chartFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },

  section: { marginBottom: 22 },
  streamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.02)',
    marginBottom: 9,
  },
  streamThumb: { width: 50, height: 50, borderRadius: 10 },

  orderCard: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 10 },
  orderImage: { width: 62, height: 62, borderRadius: 10 },
  orderMeta: { marginTop: 4 },
  tracking: { marginTop: 5 },

  walletCard: { padding: 16 },
  balance: { marginTop: 8 },
  walletMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  walletActions: { flexDirection: 'row', gap: 10, marginTop: 16 },

  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  txIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },

  kycCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20 },
  kycHint: { marginTop: 4, lineHeight: 16 },

  shortcuts: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  shortcut: {
    width: '47%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.02)',
    padding: 13,
  },
  shortcutLabel: { flex: 1 },

  switcherCard: { marginTop: 18 },
  switcherHint: { marginTop: 8, lineHeight: 17 },
  switcherWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  switcherChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  switcherActive: { borderColor: colors.goldLine, backgroundColor: colors.goldSoft },

  footnote: { marginTop: 22, textAlign: 'center', lineHeight: 17 },
});
