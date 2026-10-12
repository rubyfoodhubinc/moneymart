/**
 * Live Stream Screen — blueprint §5.2 "Live Stream Screen — Core Experience".
 *
 * Mobile layout per §4.1 Step 3: video feed occupies the top ~70% of the
 * viewport; the bid panel is anchored to the bottom, with a tab switcher for
 * bid panel / chat / queue. Chat auto-pauses while bidding so nothing is missed.
 */
import { useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
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
  GlassCard,
  LiveBadge,
  Pill,
  VerifiedBadge,
  styles as ui,
} from '@/components/ui';
import { CheckIcon, GavelIcon, SparkIcon, UsersIcon } from '@/components/icons';
import { useAuctionRoom, useAutoBid, usePlaceBid, useStream, useStreamRoom, useWatchlist } from '@/lib/hooks';
import { formatAge, formatMoney, formatViewers, minimumNextBid, pct } from '@/lib/format';
import { colors, gradients } from '@/theme';
import { HlsVideo } from '@/components/HlsVideo';
import { useSession } from '@/store/session';

const TABS = ['Bid', 'Chat', 'Queue'] as const;

export default function StreamScreen({ route, navigation }: { route: any; navigation: any }) {
  const insets = useSafeAreaInsets();
  const streamId: string = route.params?.id;
  const loaded = useStream(streamId);
  const stream = loaded.data?.stream;
  const queue = loaded.data?.queue ?? [];

  const room = useStreamRoom(streamId, {
    viewerCount: stream?.viewerCount,
    messages: loaded.data?.chat,
  });

  const activeAuctionId = room.activeAuctionId ?? stream?.activeAuctionId;
  const activeAuction = useMemo(
    () => queue.find((entry) => entry.id === activeAuctionId) ?? stream?.activeAuction ?? queue[0] ?? null,
    [queue, activeAuctionId, stream?.activeAuction],
  );

  const auctionRoom = useAuctionRoom(activeAuction?.id, { auction: activeAuction });
  const liveAuction = auctionRoom.auction ?? activeAuction;

  const { place, pending, error: bidError, clearError } = usePlaceBid(liveAuction?.id ?? '');
  const autoBid = useAutoBid(liveAuction?.id ?? '');
  const watchlist = useWatchlist();
  const user = useSession((state) => state.user);

  const [tab, setTab] = useState<(typeof TABS)[number]>('Bid');
  const [autoOpen, setAutoOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const chatRef = useRef<FlatList<any> | null>(null);

  const minimum = liveAuction
    ? minimumNextBid(liveAuction.startingPrice, liveAuction.currentBid, liveAuction.bidCount)
    : 0;

  const { expired } = useCountdown(liveAuction?.endTime);
  const isLeading = Boolean(user && liveAuction?.currentBidderId === user.id);

  const onBid = async () => {
    if (!liveAuction) return;
    setNotice(null);
    clearError();
    // §5.2: chat auto-pauses on bid interaction to prevent accidental misses.
    setTab('Bid');
    try {
      await place(minimum);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Bid rejected');
    }
  };

  if (loaded.loading && !stream) {
    return (
      <View style={[styles.root, styles.centered]}>
        <Data size={14} color={colors.ink3}>
          Joining the room…
        </Data>
      </View>
    );
  }

  if (!stream) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 30, paddingHorizontal: 16 }]}>
        <EmptyState
          title="Stream unavailable"
          body="The room may have ended or the creator went offline."
          action={<Button label="Back to live rooms" variant="gold" onPress={() => navigation.navigate('Live')} />}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* ── Video area (top 70%) ──────────────────────────────────────── */}
      <View style={styles.video}>
        {/**
          * Real HLS, using the source the server resolved — the same `playback`
          * object web and TV consume. This previously rendered the lot's poster
          * inside an `Image`, so on mobile the room could only ever show a still
          * while the other surfaces played video.
          *
          * The poster is still the fallback: an offline or scheduled room resolves
          * to no URL, and a manifest that fails to load falls back rather than
          * showing a black rectangle.
          */}
        <HlsVideo
          playback={stream.playback}
          posterUrl={liveAuction?.item.images[0] ?? stream.posterUrl}
        />
        <LinearGradient colors={['rgba(7,15,24,0.6)', 'transparent', 'rgba(7,15,24,0.92)']} style={StyleSheet.absoluteFill} />

        {/* Overlaid top bar */}
        <View style={[styles.videoTop, { paddingTop: insets.top + 8 }]}>
          <Pressable onPress={() => navigation.goBack()} style={styles.closeButton} hitSlop={10}>
            <Body size={17} color={colors.ink}>
              ✕
            </Body>
          </Pressable>

          <GlassCard style={styles.creatorChip}>
            <Avatar
              name={stream.creator.displayName}
              src={stream.creator.avatarUrl}
              size={32}
              isLive
              isVerified={stream.creator.isVerified}
            />
            <View style={styles.flex1}>
              <View style={styles.row}>
                <Display size={13} numberOfLines={1}>
                  {stream.creator.displayName}
                </Display>
                {stream.creator.isVerified ? <VerifiedBadge compact /> : null}
              </View>
              <Body size={10.5} color={colors.ink3} numberOfLines={1}>
                {stream.title}
              </Body>
            </View>
          </GlassCard>

          <View style={styles.videoTopRight}>
            <LiveBadge viewers={room.viewerCount || stream.viewerCount} />
            {/**
              * Report the ROOM's connection, and only claim a fault when there is one.
              *
              * This read `auctionRoom.connected`. A room between lots has no active
              * auction, so that hook is handed no id, never connects, and the badge sat
              * on "Reconnecting" indefinitely on a room whose realtime connection was
              * perfectly healthy — it read as a fault while nothing was wrong.
              *
              * With nothing live to bid on there is also nothing to say about realtime,
              * so the badge states the actual situation instead.
              */}
            {activeAuction ? (
              <Pill tone={room.connected ? 'green' : 'neutral'}>
                <Body size={9.5} weight="semibold" color={room.connected ? colors.green : colors.ink2}>
                  {room.connected ? 'Realtime' : 'Connecting'}
                </Body>
              </Pill>
            ) : (
              <Pill tone="neutral">
                <Body size={9.5} weight="semibold" color={colors.ink2}>
                  Between lots
                </Body>
              </Pill>
            )}
          </View>
        </View>

        {/* Current item overlay */}
        <View style={styles.videoBottom}>
          <GlassCard style={styles.itemChip}>
            <Body size={9.5} weight="bold" color={colors.gold} style={ui.uppercase}>
              Now dropping
            </Body>
            <Body size={13.5} weight="semibold" color={colors.ink} numberOfLines={2} style={styles.itemTitle}>
              {liveAuction?.item.title ?? 'Waiting for the next drop'}
            </Body>
            {liveAuction ? (
              <View style={styles.itemMeta}>
                <Data size={17} color={colors.gold}>
                  {formatMoney(liveAuction.currentBid || liveAuction.startingPrice, liveAuction.currency as 'USD')}
                </Data>
                <CountdownTimer endTime={liveAuction.endTime} size={14} label />
              </View>
            ) : null}
          </GlassCard>
        </View>
      </View>

      {/* ── Bottom panel (bid / chat / queue) ─────────────────────────── */}
      <View style={[styles.panel, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.tabs}>
          {TABS.map((entry) => {
            const active = tab === entry;
            return (
              <Pressable key={entry} onPress={() => setTab(entry)} style={[styles.tab, active ? styles.tabActive : null]}>
                <Body size={12.5} weight="semibold" color={active ? colors.gold : colors.ink3}>
                  {entry === 'Queue' ? `Queue (${queue.length})` : entry}
                </Body>
              </Pressable>
            );
          })}
        </View>

        {notice || bidError ? (
          <View style={styles.noticeBar}>
            <Body size={11.5} color="#FF8080">
              {notice ?? bidError}
            </Body>
          </View>
        ) : null}

        {auctionRoom.outbidNotice ? (
          <View style={styles.outbidBar}>
            <SparkIcon size={13} color={colors.gold} />
            <Body size={11.5} color={colors.gold}>
              You were outbid
            </Body>
          </View>
        ) : null}

        {/* Bid tab */}
        {tab === 'Bid' && liveAuction ? (
          <ScrollView style={styles.panelScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.bidHead}>
              <View>
                <Body size={9.5} weight="semibold" color={colors.ink3} style={ui.uppercase}>
                  Current
                </Body>
                <Data size={22} color={colors.gold}>
                  {formatMoney(liveAuction.currentBid || liveAuction.startingPrice, liveAuction.currency as 'USD')}
                </Data>
              </View>
              <View style={styles.alignEnd}>
                <Body size={9.5} weight="semibold" color={colors.ink3} style={ui.uppercase}>
                  Next bid
                </Body>
                <Data size={22} color={colors.ink}>
                  {formatMoney(minimum, liveAuction.currency as 'USD')}
                </Data>
              </View>
            </View>

            <View style={styles.bidMeta}>
              <Pill tone="gold">{liveAuction.bidCount} bids</Pill>
              <Pill tone={liveAuction.reserveMet ? 'green' : 'neutral'}>
                {liveAuction.reserveMet ? 'Reserve met' : 'Reserve not met'}
              </Pill>
              <CountdownTimer endTime={liveAuction.endTime} size={14} label />
            </View>

            <View style={styles.totalRow}>
              <Body size={12} color={colors.ink3}>
                Total if you win ({pct(liveAuction.buyersPremiumRate)} premium)
              </Body>
              <Data size={14} color={colors.green}>
                {formatMoney(minimum * (1 + liveAuction.buyersPremiumRate), liveAuction.currency as 'USD')}
              </Data>
            </View>

            <BidButton
              amount={minimum}
              currency={liveAuction.currency}
              isActive={false}
              disabled={expired || isLeading}
              loading={pending}
              onPress={() => void onBid()}
              onLongPress={() => setAutoOpen(true)}
            />

            <View style={styles.bidSecondary}>
              <Button
                label="Auto-bid"
                variant="outline"
                size="sm"
                style={styles.flex1}
                icon={<GavelIcon size={14} color={colors.gold} />}
                onPress={() => setAutoOpen(true)}
              />
              <WatchButton watching={watchlist.has(liveAuction.id)} onToggle={() => watchlist.toggle(liveAuction.id)} />
            </View>

            <View style={styles.latestBids}>
              <Body size={10} weight="semibold" color={colors.ink3} style={ui.uppercase}>
                Latest bids
              </Body>
              <BidHistory bids={auctionRoom.bids.slice(0, 5)} currentUserId={user?.id} maxVisible={5} />
            </View>

            {liveAuction.item.provenance ? (
              <Card style={styles.provenanceCard}>
                <Body size={9.5} weight="bold" color={colors.gold} style={ui.uppercase}>
                  Provenance
                </Body>
                <Body size={11.5} color={colors.ink2} style={styles.provenanceBody}>
                  {liveAuction.item.provenance}
                </Body>
              </Card>
            ) : null}
          </ScrollView>
        ) : null}

        {/* Chat tab */}
        {tab === 'Chat' ? (
          <View style={styles.chatWrap}>
            {room.pinned ? (
              <View style={styles.pinned}>
                <Body size={9.5} weight="bold" color={colors.gold} style={ui.uppercase}>
                  Pinned
                </Body>
                <Body size={11.5} color={colors.ink} numberOfLines={2}>
                  {room.pinned.body}
                </Body>
              </View>
            ) : null}

            <FlatList
              ref={chatRef}
              data={room.messages}
              keyExtractor={(item) => item.id}
              style={styles.chatList}
              contentContainerStyle={styles.chatContent}
              onContentSizeChange={() => chatRef.current?.scrollToEnd({ animated: true })}
              renderItem={({ item }) => (
                <View style={styles.chatRow}>
                  <View
                    style={[
                      styles.chatDot,
                      { backgroundColor: item.isCreator ? colors.gold : item.userId === user?.id ? colors.green : 'rgba(255,255,255,0.4)' },
                    ]}
                  />
                  <Body size={12} color={colors.ink2} style={styles.flex1}>
                    <Body size={12} weight="semibold" color={item.isCreator ? colors.gold : colors.ink}>
                      {item.isCreator ? '★ ' : ''}
                      {item.displayName}
                    </Body>{' '}
                    {item.body}
                  </Body>
                </View>
              )}
              ListEmptyComponent={
                <Body size={12} color={colors.ink3} style={styles.chatEmpty}>
                  Chat is quiet. Say hello 👋
                </Body>
              }
            />

            <View style={styles.chatInputRow}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Say something…"
                placeholderTextColor={colors.ink3}
                style={styles.chatInput}
                onSubmitEditing={() => {
                  room.send(user, draft);
                  setDraft('');
                }}
              />
              <Pressable
                onPress={() => {
                  room.send(user, draft);
                  setDraft('');
                }}
                disabled={!draft.trim()}
              >
                <Body size={12} weight="bold" color={draft.trim() ? colors.gold : colors.ink3}>
                  SEND
                </Body>
              </Pressable>
            </View>

            <View style={styles.reactionRow}>
              {['🔥', '💛', '👏', '😮', '🚀', '💎', '🙌'].map((emoji) => (
                <Pressable key={emoji} onPress={() => room.send(user, emoji)} style={styles.reaction}>
                  <Body size={14}>{emoji}</Body>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {/* Queue tab */}
        {tab === 'Queue' ? (
          <FlatList
            data={queue}
            keyExtractor={(item) => item.id}
            style={styles.queueList}
            contentContainerStyle={styles.queueContent}
            renderItem={({ item, index }) => {
              const isActive = item.id === liveAuction?.id;
              return (
                <Pressable
                  onPress={() => setTab('Bid')}
                  style={[styles.queueRow, isActive ? styles.queueActive : null]}
                >
                  <Image source={{ uri: item.item.images[0] }} style={styles.queueImage} />
                  <View style={styles.flex1}>
                    <Body size={12.5} color={colors.ink} numberOfLines={1}>
                      {item.item.title}
                    </Body>
                    <Data size={12} color={colors.ink3} style={styles.queuePrice}>
                      {formatMoney(item.currentBid || item.startingPrice, item.currency as 'USD')}
                    </Data>
                  </View>
                  {isActive ? <Pill tone="green">Live</Pill> : <Data size={11} color={colors.ink3}>{`#${index + 1}`}</Data>}
                </Pressable>
              );
            }}
            ListEmptyComponent={<Body size={12.5} color={colors.ink3} style={styles.chatEmpty}>Queue finished for this stream.</Body>}
          />
        ) : null}

        <View style={styles.creatorStats}>
          <View style={styles.creatorStat}>
            <Data size={13} color={colors.ink}>
              {formatViewers(stream.peakViewerCount)}
            </Data>
            <Body size={9} color={colors.ink3} style={ui.uppercase}>
              Peak
            </Body>
          </View>
          <View style={styles.creatorStat}>
            <Data size={13} color={colors.green}>
              {formatMoney(stream.totalGMV, 'USD', { compact: true })}
            </Data>
            <Body size={9} color={colors.ink3} style={ui.uppercase}>
              Stream GMV
            </Body>
          </View>
          <View style={styles.creatorStat}>
            <Data size={13} color={colors.gold}>
              {queue.filter((entry) => entry.status === 'sold').length}
            </Data>
            <Body size={9} color={colors.ink3} style={ui.uppercase}>
              Sold
            </Body>
          </View>
          <Pressable onPress={() => navigation.navigate('AuctionDetail', { id: liveAuction?.id })} style={styles.creatorStat}>
            <UsersIcon size={14} color={colors.ink3} />
            <Body size={9} color={colors.ink3} style={ui.uppercase}>
              Details
            </Body>
          </Pressable>
        </View>
      </View>

      {liveAuction ? (
        <AutoBidModal
          visible={autoOpen}
          currentBid={liveAuction.currentBid || liveAuction.startingPrice}
          minimum={minimum}
          currency={liveAuction.currency}
          onDismiss={() => setAutoOpen(false)}
          onConfirm={async (payload) => {
            setAutoOpen(false);
            try {
              await autoBid.configure(payload);
              setNotice(`Auto-bid active up to ${formatMoney(payload.maxAmount, liveAuction.currency as 'USD')} — placed ${formatAge(new Date().toISOString())}.`);
            } catch (cause) {
              setNotice(cause instanceof Error ? cause.message : 'Auto-bid rejected');
            }
          }}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  centered: { alignItems: 'center', justifyContent: 'center' },
  flex1: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  alignEnd: { alignItems: 'flex-end' },

  video: { flex: 7, position: 'relative', backgroundColor: '#05090E' },
  videoImage: { width: '100%', height: '100%' },
  videoTop: {
    position: 'absolute',
    top: 0,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(7,15,24,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  creatorChip: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9, padding: 8 },
  videoTopRight: { alignItems: 'flex-end', gap: 6 },
  videoBottom: { position: 'absolute', left: 12, right: 12, bottom: 12 },
  itemChip: { padding: 12 },
  itemTitle: { marginTop: 5 },
  itemMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 9 },

  panel: {
    flex: 3,
    backgroundColor: 'rgba(9,18,29,0.98)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  tabs: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    marginBottom: 10,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  tabActive: { backgroundColor: colors.goldSoft },
  panelScroll: { flex: 1 },

  noticeBar: { borderRadius: 8, backgroundColor: 'rgba(229,62,62,0.12)', padding: 8, marginBottom: 8 },
  outbidBar: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 8, backgroundColor: colors.goldSoft, padding: 8, marginBottom: 8 },

  bidHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 10 },
  bidMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  bidSecondary: { flexDirection: 'row', gap: 9, marginTop: 10 },
  latestBids: { marginTop: 16 },
  provenanceCard: { marginTop: 14 },
  provenanceBody: { marginTop: 6, lineHeight: 17 },

  chatWrap: { flex: 1 },
  pinned: { borderWidth: 1, borderColor: colors.goldLine, backgroundColor: colors.goldSoft, borderRadius: 10, padding: 10, marginBottom: 8 },
  chatList: { flex: 1 },
  chatContent: { paddingBottom: 8 },
  chatRow: { flexDirection: 'row', gap: 7, marginBottom: 7 },
  chatDot: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  chatEmpty: { textAlign: 'center', paddingVertical: 20 },
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 11,
    paddingHorizontal: 12,
    height: 44,
  },
  chatInput: { flex: 1, color: colors.ink, fontSize: 13, paddingVertical: 0 },
  reactionRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  reaction: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },

  queueList: { flex: 1 },
  queueContent: { paddingBottom: 8 },
  queueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.02)',
    marginBottom: 8,
  },
  queueActive: { borderColor: colors.goldLine, backgroundColor: colors.goldSoft },
  queueImage: { width: 42, height: 42, borderRadius: 9 },
  queuePrice: { marginTop: 3 },

  creatorStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: 9,
    marginTop: 6,
  },
  creatorStat: { alignItems: 'center', gap: 3 },
});
