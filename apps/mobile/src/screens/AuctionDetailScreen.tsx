/**
 * Auction Detail — blueprint §5.2.
 * Lot number + title in the display face, swipeable gallery, collapsible
 * description, tabbed detail panel (Description | Provenance | Condition),
 * live bid history, reserve indicator, increment selector, and a sticky bottom
 * CTA bar with the non-dismissable buyer's premium disclosure above it.
 */
import { useMemo, useState } from 'react';
import {
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AuctionWithRelations } from '@moneymart/types';
import {
  AutoBidModal,
  BidButton,
  BidHistory,
  CountdownTimer,
  WatchButton,
  useCountdown,
} from '@/components/auction';
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
  CheckIcon,
  ChevronRightIcon,
  GavelIcon,
  GlobeIcon,
  ShieldIcon,
  SparkIcon,
  UsersIcon,
} from '@/components/icons';
import { useAuction, useAuctionRoom, useAutoBid, usePlaceBid, useWatchlist } from '@/lib/hooks';
import { categoryLabel, conditionLabel, formatMoney, minimumNextBid, pct } from '@/lib/format';
import { colors, gradients } from '@/theme';
import { useSession } from '@/store/session';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const TABS = ['Description', 'Provenance', 'Condition'] as const;

export default function AuctionDetailScreen({ route, navigation }: { route: any; navigation: any }) {
  const insets = useSafeAreaInsets();
  const id: string = route.params?.id;
  const loaded = useAuction(id);
  const user = useSession((state) => state.user);
  const watchlist = useWatchlist();

  const room = useAuctionRoom(id, { auction: loaded.data?.auction ?? null, bids: loaded.data?.bids ?? [] });
  const auction = room.auction ?? loaded.data?.auction ?? null;

  const { place, pending } = usePlaceBid(id);
  const autoBid = useAutoBid(id);

  const [tab, setTab] = useState<(typeof TABS)[number]>('Description');
  const [gallery, setGallery] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const step = Math.max(
    1,
    Math.round(
      minimumNextBid(auction?.startingPrice ?? 0, auction?.currentBid ?? 0, auction?.bidCount ?? 0) -
        (auction?.currentBid || auction?.startingPrice || 0),
    ),
  );

  const minimum = useMemo(
    () => (auction ? minimumNextBid(auction.startingPrice, auction.currentBid, auction.bidCount) : 0),
    [auction],
  );

  const { expired } = useCountdown(auction?.endTime);
  const isLeading = Boolean(user && auction?.currentBidderId === user.id);
  const closed = expired || auction?.status === 'sold';
  const breakdown = loaded.data?.breakdown;
  const premiumTotal = breakdown ? minimum * (1 + breakdown.buyersPremiumRate) : 0;

  const onBid = async () => {
    if (!auction) return;
    setNotice(null);
    try {
      await place(minimum);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Bid rejected');
    }
  };

  if (loaded.loading && !auction) {
    return (
      <View style={[styles.root, styles.center]}>
        <Data size={14} color={colors.ink3}>
          Loading lot…
        </Data>
      </View>
    );
  }

  if (!auction) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 40, paddingHorizontal: 16 }]}>
        <EmptyState
          title="Lot not found"
          body="It may have been withdrawn or removed by moderation."
          action={<Button label="Back" variant="navy" onPress={() => navigation.goBack()} />}
        />
      </View>
    );
  }

  const { item, seller } = auction;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: 190 }} showsVerticalScrollIndicator={false}>
        {/* ── Gallery ───────────────────────────────────────────────── */}
        <View style={styles.gallery}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={(event) =>
              setGallery(Math.round(event.nativeEvent.contentOffset.x / SCREEN_WIDTH))
            }
            scrollEventThrottle={16}
          >
            {item.images.map((uri) => (
              <Image key={uri.slice(-24)} source={{ uri }} style={styles.galleryImage} />
            ))}
          </ScrollView>
          <LinearGradient colors={['rgba(7,15,24,0.5)', 'transparent', 'rgba(7,15,24,0.75)']} style={StyleSheet.absoluteFill} />

          <Pressable onPress={() => navigation.goBack()} style={[styles.backButton, { top: insets.top + 10 }]}>
            <ChevronRightIcon size={18} color={colors.ink} />
          </Pressable>

          <View style={[styles.galleryBadges, { top: insets.top + 10 }]}>
            {auction.isLive ? <Pill tone="green">Live now</Pill> : <Pill>{auction.status}</Pill>}
            {item.isVerified ? <VerifiedBadge /> : null}
            <Pill tone={auction.reserveMet ? 'green' : 'neutral'}>
              {auction.reserveMet ? 'Reserve met' : 'Reserve not met'}
            </Pill>
          </View>

          {item.images.length > 1 ? (
            <View style={styles.dots}>
              {item.images.map((uri, index) => (
                <View key={uri.slice(-24)} style={[styles.dot, index === gallery ? styles.dotActive : null]} />
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.body}>
          {/* Lot heading */}
          {auction.lotNumber ? (
            <Data size={11.5} color={colors.gold} style={styles.lotNumber}>
              {auction.lotNumber}
            </Data>
          ) : null}
          <Display size={23}>{item.title}</Display>

          <View style={styles.metaRow}>
            <Pill>{categoryLabel(item.categoryId)}</Pill>
            <Pill>{conditionLabel(item.condition)}</Pill>
            <Pill>
              <GlobeIcon size={10} color={colors.ink2} />
              <Body size={10} weight="semibold" color={colors.ink2}>
                {seller.countryCode}
              </Body>
            </Pill>
            <Pill>
              <UsersIcon size={10} color={colors.ink2} />
              <Body size={10} weight="semibold" color={colors.ink2}>
                {auction.watchers} watching
              </Body>
            </Pill>
          </View>

          {/* Price + countdown */}
          <Card style={styles.priceCard}>
            <View style={styles.priceRow}>
              <View>
                <Body size={10} weight="semibold" color={colors.ink3} style={ui.uppercase}>
                  {auction.bidCount ? `Current bid · ${auction.bidCount} bids` : 'Starting bid'}
                </Body>
                <Data size={32} color={colors.gold} style={styles.price}>
                  {formatMoney(auction.currentBid || auction.startingPrice, auction.currency as 'USD')}
                </Data>
              </View>
              <View style={styles.alignEnd}>
                <CountdownTimer endTime={auction.endTime} size={20} label />
                <Body size={10.5} color={colors.ink3} style={styles.antiSnipe}>
                  Anti-snipe armed
                </Body>
              </View>
            </View>

            {auction.reservePrice ? (
              <View style={styles.reserveWrap}>
                <View style={styles.reserveTrack}>
                  <View
                    style={[
                      styles.reserveFill,
                      {
                        width: `${Math.min(100, ((auction.currentBid || auction.startingPrice) / auction.reservePrice) * 100)}%`,
                        backgroundColor: auction.reserveMet ? colors.green : colors.gold,
                      },
                    ]}
                  />
                </View>
                <Body size={10.5} color={colors.ink3} style={styles.reserveHint}>
                  Reserve is confidential. Buyers see only whether it has been met.
                </Body>
              </View>
            ) : null}
          </Card>

          {/* Tabbed detail panel */}
          <Card style={styles.tabsCard}>
            <View style={styles.tabs}>
              {TABS.map((entry) => {
                const active = tab === entry;
                return (
                  <Pressable key={entry} onPress={() => setTab(entry)} style={[styles.tab, active ? styles.tabActive : null]}>
                    <Body size={12} weight="semibold" color={active ? colors.gold : colors.ink3}>
                      {entry}
                    </Body>
                  </Pressable>
                );
              })}
            </View>

            {tab === 'Description' ? (
              <View>
                <Body size={13.5} color={colors.ink2} numberOfLines={expanded ? undefined : 4} style={styles.tabBody}>
                  {item.description}
                </Body>
                {item.description.length > 160 ? (
                  <Pressable onPress={() => setExpanded((value) => !value)} style={styles.showMore}>
                    <Body size={12.5} weight="semibold" color={colors.gold}>
                      {expanded ? 'Show less' : 'Show more'}
                    </Body>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {tab === 'Provenance' ? (
              <View>
                <View style={styles.rowGap}>
                  <ShieldIcon size={15} color={colors.gold} />
                  <Body size={13} color={colors.ink2} style={styles.flex1}>
                    {item.provenance ?? 'Provenance research is in progress for this lot.'}
                  </Body>
                </View>
                <View style={styles.metaGrid}>
                  <StatBlock label="Authenticity" value={item.isVerified ? 'MV Verified' : 'Pending'} tone={item.isVerified ? 'green' : 'default'} />
                  <StatBlock label="Seller rating" value={`${seller.rating.toFixed(1)} ★`} />
                  <StatBlock label="Lifetime sales" value={String(seller.totalSales)} />
                  <StatBlock label="Response" value={`${seller.responseTimeMinutes}m`} />
                </View>
              </View>
            ) : null}

            {tab === 'Condition' ? (
              <View>
                <View style={styles.rowGap}>
                  <Pill tone="gold">{conditionLabel(item.condition)}</Pill>
                </View>
                <Body size={13.5} color={colors.ink2} style={styles.tabBody}>
                  {item.conditionReport ?? 'A conservator condition report will be published before the sale closes.'}
                </Body>
              </View>
            ) : null}
          </Card>

          {/* Seller */}
          <Card style={styles.sellerCard}>
            <Avatar name={seller.displayName} src={seller.avatarUrl} size={46} isLive={seller.isLive} isVerified={seller.isVerified} />
            <View style={styles.flex1}>
              <Display size={14.5}>{seller.displayName}</Display>
              <Body size={11.5} color={colors.ink3}>
                {seller.rating.toFixed(1)} ★ · {seller.totalSales} sales · {seller.followersCount.toLocaleString()} followers
              </Body>
            </View>
            <WatchButton watching={watchlist.has(auction.id)} onToggle={() => watchlist.toggle(auction.id)} />
          </Card>

          {/* Bid history */}
          <View style={styles.section}>
            <SectionHeader
              eyebrow={room.connected ? 'Live-updating' : 'Reconnecting…'}
              title="Bid history"
              action={
                <Pill>
                  <Body size={10} weight="semibold" color={colors.ink2}>
                    Anonymised
                  </Body>
                </Pill>
              }
            />
            <Card>
              <BidHistory bids={room.bids} currentUserId={user?.id} maxVisible={6} />
            </Card>
          </View>

          {/* Increment reference */}
          <Card style={styles.incrementCard}>
            <Body size={10.5} weight="semibold" color={colors.ink3} style={ui.uppercase}>
              Bid increments
            </Body>
            <View style={styles.incrementRow}>
              {['Minimum', 'Standard', 'Jump bid'].map((label, index) => {
                const multiplier = [1, 2, 5][index];
                return (
                  <View key={label} style={styles.incrementCell}>
                    <Body size={10} color={colors.ink3}>
                      {label}
                    </Body>
                    <Data size={14} color={index === 0 ? colors.gold : colors.ink2}>
                      +{formatMoney(step * multiplier, auction.currency as 'USD')}
                    </Data>
                  </View>
                );
              })}
            </View>
          </Card>

          {/* Related */}
          {loaded.data?.related?.length ? (
            <View style={styles.section}>
              <SectionHeader eyebrow="More like this" title="Related lots" />
              {loaded.data.related.slice(0, 3).map((related: AuctionWithRelations) => (
                <Pressable
                  key={related.id}
                  onPress={() => navigation.push('AuctionDetail', { id: related.id })}
                  style={styles.relatedRow}
                >
                  <Image source={{ uri: related.item.images[0] }} style={styles.relatedImage} />
                  <View style={styles.flex1}>
                    <Display size={13} numberOfLines={2}>
                      {related.item.title}
                    </Display>
                    <Data size={14} color={colors.gold} style={styles.relatedPrice}>
                      {formatMoney(related.currentBid || related.startingPrice, related.currency as 'USD')}
                    </Data>
                  </View>
                  <ChevronRightIcon size={16} color={colors.ink3} />
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* ── Sticky bottom CTA bar (§5.2) ───────────────────────────── */}
      <View style={[styles.ctaBar, { paddingBottom: insets.bottom + 12 }]}>
        {notice || room.rejectNotice ? (
          <View style={styles.noticeBar}>
            <Body size={11.5} color="#FF8080">
              {notice ?? room.rejectNotice}
            </Body>
          </View>
        ) : null}

        {room.outbidNotice ? (
          <View style={styles.outbidBar}>
            <SparkIcon size={13} color={colors.gold} />
            <Body size={11.5} color={colors.gold}>
              You were outbid — {formatMoney(auction.currentBid, auction.currency as 'USD')}
            </Body>
          </View>
        ) : null}

        <View style={styles.ctaRow}>
          <BidButton
            amount={minimum}
            currency={auction.currency}
            isActive={false}
            disabled={closed || isLeading}
            loading={pending}
            onPress={() => void onBid()}
            onLongPress={() => setAutoOpen(true)}
          />
        </View>

        <View style={styles.ctaSecondary}>
          <Button
            label={isLeading ? 'You lead' : 'Auto-bid'}
            variant="outline"
            size="sm"
            disabled={closed}
            icon={<GavelIcon size={14} color={colors.gold} />}
            onPress={() => setAutoOpen(true)}
            style={styles.flex1}
          />
          {auction.buyItNowPrice ? (
            <Button
              label={`Buy now ${formatMoney(auction.buyItNowPrice, auction.currency as 'USD')}`}
              variant="green"
              size="sm"
              style={styles.flex1}
              icon={<CheckIcon size={14} color={colors.navy} />}
              onPress={() => setNotice('Buy It Now checkout opens the payment sheet (Stripe / Paystack).')}
            />
          ) : null}
        </View>

        {breakdown ? (
          <Data size={10.5} color={colors.ink3} style={styles.ctaFootnote}>
            {formatMoney(minimum, auction.currency as 'USD')} + {pct(breakdown.buyersPremiumRate)} premium ≈{' '}
            {formatMoney(premiumTotal, auction.currency as 'USD')} total
          </Data>
        ) : null}
      </View>

      <AutoBidModal
        visible={autoOpen}
        currentBid={auction.currentBid || auction.startingPrice}
        minimum={minimum}
        currency={auction.currency}
        onDismiss={() => setAutoOpen(false)}
        onConfirm={async (payload) => {
          setAutoOpen(false);
          try {
            await autoBid.configure(payload);
            setNotice(`Auto-bid active up to ${formatMoney(payload.maxAmount, auction.currency as 'USD')}.`);
          } catch (cause) {
            setNotice(cause instanceof Error ? cause.message : 'Auto-bid rejected');
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { alignItems: 'center', justifyContent: 'center' },
  flex1: { flex: 1 },
  alignEnd: { alignItems: 'flex-end' },

  gallery: { height: 300, position: 'relative' },
  galleryImage: { width: SCREEN_WIDTH, height: 300 },
  backButton: {
    position: 'absolute',
    left: 14,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(7,15,24,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '180deg' }],
  },
  galleryBadges: { position: 'absolute', right: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' },
  dots: { position: 'absolute', bottom: 14, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 7, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  dotActive: { width: 22, backgroundColor: colors.gold },

  body: { padding: 16 },
  lotNumber: { letterSpacing: 2, marginBottom: 6 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },

  priceCard: { marginTop: 16 },
  priceRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  price: { marginTop: 6 },
  antiSnipe: { marginTop: 4 },
  reserveWrap: { marginTop: 14 },
  reserveTrack: { height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' },
  reserveFill: { height: 5, borderRadius: 3 },
  reserveHint: { marginTop: 7 },

  tabsCard: { marginTop: 14 },
  tabs: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 8 },
  tabActive: { backgroundColor: colors.goldSoft },
  tabBody: { marginTop: 14, lineHeight: 21 },
  showMore: { marginTop: 10 },
  rowGap: { flexDirection: 'row', gap: 9, marginTop: 14 },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },

  sellerCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },

  section: { marginTop: 24 },
  incrementCard: { marginTop: 14 },
  incrementRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  incrementCell: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.025)',
    borderRadius: 10,
    padding: 10,
  },

  relatedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  relatedImage: { width: 52, height: 52, borderRadius: 10 },
  relatedPrice: { marginTop: 4 },

  ctaBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: 'rgba(9,18,29,0.97)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    gap: 9,
  },
  ctaRow: {},
  ctaSecondary: { flexDirection: 'row', gap: 9 },
  ctaFootnote: { textAlign: 'center' },
  noticeBar: { borderRadius: 8, backgroundColor: 'rgba(229,62,62,0.12)', padding: 8 },
  outbidBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 8,
    backgroundColor: colors.goldSoft,
    padding: 8,
  },
});
