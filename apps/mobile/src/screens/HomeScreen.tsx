/**
 * Home Tab — blueprint §5.2 (3 views) and §5.2 For You feed.
 *
 * Tabs: For You (personalised vertical scroll), Live Now (full-bleed horizontal
 * carousel of active streams), Ending Soon (grid of lots closing within 60 min).
 * Horizontal category filter chips sit at the top of every view.
 */
import { useMemo, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { categories } from '@moneymart/tokens';
import { AuctionCard, StreamCard, useCountdown } from '@/components/auction';
import { Avatar, Body, Card, Data, Display, EmptyState, LiveBadge, Pill, SectionHeader, styles as ui } from '@/components/ui';
import { BellIcon, LiveDot, MoneyMartMark, PlayIcon, SearchIcon, UsersIcon } from '@/components/icons';
import { useAuctions, useNotifications, useStreams } from '@/lib/hooks';
import { formatMoney, formatViewers } from '@/lib/format';
import { useSession } from '@/store/session';
import { colors, gradients } from '@/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const VIEWS = ['For You', 'Live Now', 'Ending Soon'] as const;

export default function HomeScreen({ navigation }: { navigation: any }) {
  const insets = useSafeAreaInsets();
  const profile = useSession((state) => state.profile);
  const [view, setView] = useState<(typeof VIEWS)[number]>('For You');
  const [category, setCategory] = useState<string>('');
  const [refreshing, setRefreshing] = useState(false);

  const streams = useStreams();
  const featured = useAuctions({ category: category || undefined, sort: 'ending', limit: 20 });
  const endingSoon = useAuctions({ status: 'ending', sort: 'ending', limit: 12 });
  const notifications = useNotifications();

  const liveStreams = useMemo(
    () => (streams.data?.items ?? []).filter((stream) => stream.status === 'live'),
    [streams.data],
  );
  const lots = featured.data?.items ?? [];
  const ending = endingSoon.data?.items ?? [];
  const unread = notifications.data?.unread ?? 0;

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([streams.reload(), featured.reload(), endingSoon.reload()]);
    setRefreshing(false);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <MoneyMartMark size={28} />
        <View style={styles.headerActions}>
          <Pressable style={styles.iconButton} onPress={() => navigation.navigate('Discovery')}>
            <SearchIcon size={17} color={colors.ink2} />
          </Pressable>
          <Pressable style={styles.iconButton} onPress={() => navigation.navigate('Profile')}>
            <BellIcon size={17} color={colors.ink2} />
            {unread > 0 ? (
              <View style={styles.badge}>
                <Data size={9} color={colors.navy}>
                  {unread}
                </Data>
              </View>
            ) : null}
          </Pressable>
          <Pressable onPress={() => navigation.navigate('Profile')}>
            <Avatar name={profile?.displayName ?? 'Guest'} src={profile?.avatarUrl} size={32} isVerified={profile?.isVerified} />
          </Pressable>
        </View>
      </View>

      {/* View switcher */}
      <View style={styles.viewTabs}>
        {VIEWS.map((entry) => {
          const active = view === entry;
          return (
            <Pressable key={entry} onPress={() => setView(entry)} style={styles.viewTab}>
              <Body size={13.5} weight={active ? 'semibold' : 'medium'} color={active ? colors.gold : colors.ink3}>
                {entry}
              </Body>
              {active ? <View style={styles.viewUnderline} /> : null}
            </Pressable>
          );
        })}
      </View>

      {/* Category rail */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categoryRail}
        style={styles.categoryScroll}
      >
        <Pressable onPress={() => setCategory('')} style={[styles.categoryChip, !category ? styles.categoryActive : null]}>
          <Body size={12.5} weight="medium" color={!category ? colors.navy : colors.ink2}>
            All
          </Body>
        </Pressable>
        {categories.map((entry) => {
          const active = category === entry.id;
          return (
            <Pressable
              key={entry.id}
              onPress={() => setCategory(active ? '' : entry.id)}
              style={[styles.categoryChip, active ? styles.categoryActive : null]}
            >
              <Body size={13}>{entry.emoji}</Body>
              <Body size={12.5} weight="medium" color={active ? colors.navy : colors.ink2}>
                {entry.label}
              </Body>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 90 }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.gold} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* ── For You ─────────────────────────────────────────────────── */}
        {view === 'For You' ? (
          <>
            {liveStreams.length ? (
              <View style={styles.section}>
                <SectionHeader
                  eyebrow="Happening now"
                  title="Live creators"
                  action={
                    <Pressable onPress={() => navigation.navigate('Live')}>
                      <Body size={12.5} weight="semibold" color={colors.gold}>
                        See all
                      </Body>
                    </Pressable>
                  }
                />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
                  {liveStreams.map((stream) => (
                    <StreamCard
                      key={stream.id}
                      stream={stream}
                      width={280}
                      onPress={() => navigation.navigate('Stream', { id: stream.id })}
                    />
                  ))}
                </ScrollView>
              </View>
            ) : null}

            <View style={styles.section}>
              <SectionHeader eyebrow="Closing within the hour" title="Ending soon" />
              {ending.length ? (
                ending.slice(0, 4).map((auction) => (
                  <View key={auction.id} style={styles.stackGap}>
                    <AuctionCard
                      auction={auction}
                      onPress={() => navigation.navigate('AuctionDetail', { id: auction.id })}
                    />
                  </View>
                ))
              ) : (
                <EmptyState title="Nothing closing right now" body="Live rooms above have lots running — jump in." />
              )}
            </View>

            <View style={styles.section}>
              <SectionHeader eyebrow={`${lots.length} lots`} title="Recommended for you" />
              {lots.map((auction) => (
                <View key={auction.id} style={styles.stackGap}>
                  <AuctionCard
                    auction={auction}
                    onPress={() => navigation.navigate('AuctionDetail', { id: auction.id })}
                  />
                </View>
              ))}
            </View>
          </>
        ) : null}

        {/* ── Live Now ────────────────────────────────────────────────── */}
        {view === 'Live Now' ? (
          <View style={styles.heroRail}>
            {liveStreams.length ? (
              <FlatList
                data={liveStreams}
                keyExtractor={(item) => item.id}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                renderItem={({ item }) => (
                  <Pressable onPress={() => navigation.navigate('Stream', { id: item.id })} style={styles.heroSlide}>
                    <View style={styles.heroCard}>
                      <Image
                        source={{ uri: item.activeAuction?.item.images[0] ?? item.posterUrl }}
                        style={styles.heroImage}
                      />
                      <LinearGradient colors={gradients.heroScrim} style={StyleSheet.absoluteFill} />

                      <View style={styles.heroTop}>
                        <LiveBadge viewers={item.viewerCount} />
                      </View>

                      <View style={styles.heroBottom}>
                        <View style={styles.heroCreator}>
                          <Avatar
                            name={item.creator.displayName}
                            src={item.creator.avatarUrl}
                            size={38}
                            isLive
                            isVerified={item.creator.isVerified}
                          />
                          <View style={styles.flex1}>
                            <Display size={15} numberOfLines={1}>
                              {item.creator.displayName}
                            </Display>
                            <Body size={12} color={colors.ink2} numberOfLines={1}>
                              {item.title}
                            </Body>
                          </View>
                        </View>

                        {item.activeAuction ? (
                          <Card style={styles.heroBidCard}>
                            <View style={styles.heroBidTop}>
                              <View>
                                <Body size={9.5} weight="semibold" color={colors.ink3} style={ui.uppercase}>
                                  {item.activeAuction.bidCount} bids
                                </Body>
                                <Data size={20} color={colors.gold}>
                                  {formatMoney(
                                    item.activeAuction.currentBid || item.activeAuction.startingPrice,
                                    item.activeAuction.currency as 'USD',
                                  )}
                                </Data>
                              </View>
                              <View style={styles.playCircle}>
                                <PlayIcon size={18} color={colors.navy} />
                              </View>
                            </View>
                            <Body size={12} color={colors.ink2} numberOfLines={1} style={styles.heroItemTitle}>
                              {item.activeAuction.item.title}
                            </Body>
                          </Card>
                        ) : null}
                      </View>
                    </View>
                  </Pressable>
                )}
              />
            ) : (
              <EmptyState title="No live rooms" body="Creators stream on schedule. Check back shortly." />
            )}
          </View>
        ) : null}

        {/* ── Ending Soon ─────────────────────────────────────────────── */}
        {view === 'Ending Soon' ? (
          <View style={styles.section}>
            <SectionHeader
              eyebrow="Animated countdowns in MM:SS"
              title="Closing in the next hour"
              action={
                <Pill tone="green">
                  <UsersIcon size={11} color={colors.green} />
                  <Body size={10} weight="semibold" color={colors.green}>
                    {ending.length} lots
                  </Body>
                </Pill>
              }
            />
            {ending.map((auction) => (
              <EndingRow
                key={auction.id}
                auction={auction}
                onPress={() => navigation.navigate('AuctionDetail', { id: auction.id })}
              />
            ))}
            {!ending.length ? <EmptyState title="Nothing ending soon" body="Widen your search in Discovery." /> : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** Compact closing-lot row with a live countdown driven by the server clock. */
function EndingRow({
  auction,
  onPress,
}: {
  auction: Parameters<typeof AuctionCard>[0]['auction'];
  onPress: () => void;
}) {
  const { remainingMs, critical } = useCountdown(auction.endTime);

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.endingRow, pressed ? styles.pressed : null]}>
      <Card padded={false} style={styles.endingCard}>
        <Image source={{ uri: auction.item.images[0] }} style={styles.endingImage} />
        <View style={styles.endingBody}>
          <View style={styles.endingTop}>
            {auction.isLive ? (
              <Pill tone="green">
                <LiveDot size={6} />
                <Body size={9.5} weight="semibold" color={colors.green}>
                  LIVE
                </Body>
              </Pill>
            ) : null}
            <CountdownTimerCompact endTime={auction.endTime} critical={critical} />
          </View>
          <Display size={13.5} numberOfLines={2} style={styles.endingTitle}>
            {auction.item.title}
          </Display>
          <View style={styles.endingMeta}>
            <Data size={15} color={colors.gold}>
              {formatMoney(auction.currentBid || auction.startingPrice, auction.currency as 'USD')}
            </Data>
            <Body size={11} color={colors.ink3}>
              {auction.bidCount} bids
            </Body>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

function CountdownTimerCompact({ endTime, critical }: { endTime: string; critical: boolean }) {
  const { remainingMs, expired } = useCountdown(endTime);
  return (
    <Data size={13} color={expired ? colors.ink3 : critical ? '#FF7A7A' : colors.ink}>
      {expired ? '00:00' : `${Math.floor(remainingMs / 60000)}:${String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, '0')}`}
    </Data>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex1: { flex: 1 },
  pressed: { opacity: 0.9 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.035)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    right: -3,
    top: -3,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  viewTabs: { flexDirection: 'row', paddingHorizontal: 16, gap: 22, marginTop: 4 },
  viewTab: { paddingVertical: 8 },
  viewUnderline: { height: 2, borderRadius: 1, backgroundColor: colors.gold, marginTop: 6 },
  categoryScroll: { maxHeight: 52, flexGrow: 0 },
  categoryRail: { paddingHorizontal: 16, gap: 8, alignItems: 'center' },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.035)',
    paddingHorizontal: 13,
    paddingVertical: 8,
    height: 38,
  },
  categoryActive: { backgroundColor: colors.gold, borderColor: 'transparent' },
  scrollContent: { paddingTop: 16 },
  section: { paddingHorizontal: 16, marginBottom: 26 },
  stackGap: { marginBottom: 14 },
  rail: { gap: 12, paddingRight: 16 },

  heroRail: { paddingHorizontal: 16 },
  heroSlide: { width: SCREEN_WIDTH - 32 },
  heroCard: { height: 420, borderRadius: 20, overflow: 'hidden', backgroundColor: colors.card },
  heroImage: { width: '100%', height: '100%' },
  heroTop: { position: 'absolute', top: 14, left: 14 },
  heroBottom: { position: 'absolute', left: 14, right: 14, bottom: 14, gap: 12 },
  heroCreator: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroBidCard: { padding: 12 },
  heroBidTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  playCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroItemTitle: { marginTop: 6 },

  endingRow: { marginBottom: 10 },
  endingCard: { flexDirection: 'row', padding: 10, gap: 12 },
  endingImage: { width: 76, height: 76, borderRadius: 12 },
  endingBody: { flex: 1 },
  endingTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  endingTitle: { marginTop: 6 },
  endingMeta: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 8 },
});
