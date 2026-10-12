/**
 * MoneyMart mobile — auction surfaces (§5.3 component library).
 * CountdownTimer, StreamCard, AuctionCard, BidHistory, BidButton, AutoBidModal —
 * the same semantics as web, laid out for a thumb.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import type { AuctionWithRelations, Bid, StreamWithRelations } from '@moneymart/types';
import { colors, fonts, gradients, radii } from '@/theme';
import { anonymiseBidder, formatAge, formatCountdown, formatMoney, formatViewers, minimumIncrement } from '@/lib/format';
import { Avatar, Body, Button, Card, Data, Display, GlassCard, LiveBadge, Pill, VerifiedBadge, styles as ui } from './ui';
import { CheckIcon, GavelIcon, PlayIcon, UsersIcon } from './icons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

/* ── Countdown ─────────────────────────────────────────────────────────── */

export function useCountdown(endTime?: string) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const remainingMs = endTime ? Math.max(0, Date.parse(endTime) - now) : 0;
  return {
    remainingMs,
    expired: remainingMs <= 0,
    urgent: remainingMs > 0 && remainingMs < 3_600_000,
    critical: remainingMs > 0 && remainingMs < 10_000,
  };
}

export function CountdownTimer({
  endTime,
  size = 15,
  label,
}: {
  endTime: string;
  size?: number;
  label?: boolean;
}) {
  const { remainingMs, expired, urgent } = useCountdown(endTime);
  const color = expired ? colors.ink3 : remainingMs < 600_000 ? '#FF7A7A' : urgent ? '#FFB454' : colors.ink;

  return (
    <View style={styles.row}>
      {label ? (
        <Body size={10} weight="semibold" color={colors.ink3} style={ui.uppercase}>
          {expired ? 'Closed' : 'Ends in'}
        </Body>
      ) : null}
      <Data size={size} color={color}>
        {expired ? '00:00' : formatCountdown(remainingMs)}
      </Data>
    </View>
  );
}

/* ── Auction card ──────────────────────────────────────────────────────── */

export function AuctionCard({
  auction,
  width = SCREEN_WIDTH - 32,
  onPress,
  compact = false,
}: {
  auction: AuctionWithRelations;
  width?: number;
  onPress: () => void;
  compact?: boolean;
}) {
  const { remainingMs } = useCountdown(auction.endTime);
  const price = auction.currentBid || auction.startingPrice;
  const isBuyNow = auction.auctionType === 'buy_now';
  const endingSoon = remainingMs > 0 && remainingMs < 3_600_000;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ width }, pressed ? styles.pressed : null]}>
      <Card padded={false} style={styles.auctionCard}>
        <View style={styles.auctionImageWrap}>
          <Image source={{ uri: auction.item.images[0] }} style={styles.auctionImage} />
          <LinearGradient colors={gradients.heroScrim} style={StyleSheet.absoluteFill} />

          <View style={styles.auctionTopRow}>
            <View style={styles.row}>
              {auction.isLive ? <LiveBadge /> : null}
              {endingSoon ? <Pill tone="error">Ending soon</Pill> : null}
            </View>
            {auction.item.isVerified ? <VerifiedBadge compact /> : null}
          </View>

          <View style={styles.auctionBottom}>
            <View>
              <Body size={9.5} weight="semibold" color={colors.ink3} style={ui.uppercase}>
                {isBuyNow ? 'Buy now' : auction.bidCount ? 'Current bid' : 'Starting bid'}
              </Body>
              <Data size={compact ? 17 : 20} color={isBuyNow ? colors.green : colors.gold}>
                {formatMoney(price, auction.currency as 'USD')}
              </Data>
            </View>
            <CountdownTimer endTime={auction.endTime} size={13} />
          </View>
        </View>

        <View style={styles.auctionBody}>
          <Body size={10.5} weight="semibold" color={colors.ink3} style={ui.uppercase}>
            {auction.item.categoryId}
            {auction.lotNumber ? ` · ${auction.lotNumber}` : ''}
          </Body>
          <Display size={compact ? 13.5 : 15} numberOfLines={2} style={styles.auctionTitle}>
            {auction.item.title}
          </Display>
          <View style={styles.auctionMeta}>
            <View style={styles.row}>
              <Avatar name={auction.seller.displayName} src={auction.seller.avatarUrl} size={22} isLive={auction.seller.isLive} />
              <Body size={11.5} color={colors.ink3} numberOfLines={1} style={styles.sellerName}>
                {auction.seller.displayName}
              </Body>
            </View>
            <Data size={11} color={colors.ink3}>
              {auction.bidCount > 0 ? `${auction.bidCount} bids` : 'No bids'}
            </Data>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

/* ── Stream card ───────────────────────────────────────────────────────── */

export function StreamCard({
  stream,
  width = SCREEN_WIDTH - 32,
  onPress,
}: {
  stream: StreamWithRelations;
  width?: number;
  onPress: () => void;
}) {
  const isLive = stream.status === 'live';
  const active = stream.activeAuction;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ width }, pressed ? styles.pressed : null]}>
      <Card padded={false} style={styles.auctionCard}>
        <View style={styles.streamImageWrap}>
          <Image source={{ uri: active?.item.images[0] ?? stream.posterUrl }} style={styles.auctionImage} />
          <LinearGradient colors={gradients.heroScrim} style={StyleSheet.absoluteFill} />

          <View style={styles.auctionTopRow}>
            {isLive ? <LiveBadge viewers={stream.viewerCount} /> : <Pill>Scheduled</Pill>}
            {isLive ? (
              <GlassCard style={styles.viewerChip}>
                <UsersIcon size={12} color={colors.ink} />
                <Data size={11} color={colors.ink}>
                  {formatViewers(stream.viewerCount)}
                </Data>
              </GlassCard>
            ) : null}
          </View>

          <View style={styles.streamOverlay}>
            <Avatar
              name={stream.creator.displayName}
              src={stream.creator.avatarUrl}
              size={34}
              isLive={isLive}
              isVerified={stream.creator.isVerified}
            />
            <View style={styles.flex1}>
              <Display size={14} numberOfLines={1}>
                {stream.creator.displayName}
              </Display>
              <Body size={11} color={colors.ink2} numberOfLines={1}>
                {stream.title}
              </Body>
            </View>
            {isLive ? (
              <View style={styles.playButton}>
                <PlayIcon size={16} color={colors.navy} />
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.auctionBody}>
          {active ? (
            <>
              <Body size={12.5} color={colors.ink} numberOfLines={1}>
                {active.item.title}
              </Body>
              <View style={styles.streamMeta}>
                <Data size={14} color={colors.gold}>
                  {formatMoney(active.currentBid || active.startingPrice, active.currency as 'USD')}
                </Data>
                {isLive ? <CountdownTimer endTime={active.endTime} size={12} /> : null}
              </View>
            </>
          ) : (
            <Body size={12} color={colors.ink3}>
              {stream.status === 'scheduled'
                ? `Starts ${new Date(stream.scheduledStartTime).toLocaleString()}`
                : 'Stream ended'}
            </Body>
          )}
        </View>
      </Card>
    </Pressable>
  );
}

/* ── Bid history ───────────────────────────────────────────────────────── */

export function BidHistory({
  bids,
  currentUserId,
  maxVisible = 6,
}: {
  bids: Bid[];
  currentUserId?: string;
  maxVisible?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? bids : bids.slice(0, maxVisible);

  if (!bids.length) {
    return (
      <Body size={12.5} color={colors.ink3} style={styles.historyEmpty}>
        No bids yet — be the first to open this lot.
      </Body>
    );
  }

  return (
    <View>
      {visible.map((bid, index) => {
        const isYou = currentUserId && bid.bidderId === currentUserId;
        const isTop = index === 0;
        return (
          <View key={bid.id} style={styles.historyRow}>
            <View style={styles.row}>
              <View style={[styles.rankBadge, isTop ? styles.rankTop : null]}>
                <Data size={10} color={isTop ? colors.gold : colors.ink3}>
                  {index + 1}
                </Data>
              </View>
              <View>
                <Body size={12.5} color={colors.ink}>
                  {isYou ? 'You' : anonymiseBidder(bid.bidderId, index)}
                </Body>
                <Body size={10.5} color={colors.ink3}>
                  {formatAge(bid.timestamp)}
                  {bid.isAutoBid ? ' · auto-bid' : ''}
                </Body>
              </View>
            </View>
            <View style={styles.row}>
              {isTop ? <Pill tone="gold">High</Pill> : null}
              <Data size={13.5} color={isTop ? colors.gold : colors.ink2}>
                {formatMoney(bid.amount, bid.currency as 'USD')}
              </Data>
            </View>
          </View>
        );
      })}
      {bids.length > maxVisible ? (
        <Pressable onPress={() => setExpanded((value) => !value)} style={styles.showMore}>
          <Body size={12} weight="semibold" color={colors.gold}>
            {expanded ? 'Show less' : `Show all ${bids.length} bids`}
          </Body>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ── Bid button (with pulse + long-press auto-bid) ─────────────────────── */

export function BidButton({
  amount,
  currency,
  isActive,
  disabled,
  loading,
  onPress,
  onLongPress,
}: {
  amount: number;
  currency: string;
  isActive: boolean;
  disabled?: boolean;
  loading?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isActive) return;
    Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 420, useNativeDriver: true }),
    ]).start();
  }, [isActive, pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Button
        label={`Bid ${formatMoney(amount, currency as 'USD')}`}
        variant="green"
        size="lg"
        full
        loading={loading}
        disabled={disabled}
        icon={<GavelIcon size={18} color={colors.navy} />}
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onPress();
        }}
        onLongPress={onLongPress}
        delayLongPress={480}
      />
    </Animated.View>
  );
}

/* ── Auto-bid modal ────────────────────────────────────────────────────── */

export function AutoBidModal({
  visible,
  currentBid,
  minimum,
  currency,
  onConfirm,
  onDismiss,
}: {
  visible: boolean;
  currentBid: number;
  minimum: number;
  currency: string;
  onConfirm: (payload: { maxAmount: number; increment: number; aggressive: boolean }) => void;
  onDismiss: () => void;
}) {
  const base = Math.max(1, Math.round(minimum - currentBid || minimumIncrement(currentBid)));
  const [maxAmount, setMaxAmount] = useState(Math.round(minimum * 1.25));
  const [increment, setIncrement] = useState(base);
  const [aggressive, setAggressive] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setMaxAmount(Math.round(minimum * 1.25));
    setIncrement(base);
    setAggressive(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, minimum]);

  const options = useMemo(
    () => [
      { label: 'Minimum', value: base },
      { label: 'Mid', value: base * 2 },
      { label: 'Aggressive', value: base * 5 },
    ],
    [base],
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.modalScrim} onPress={onDismiss}>
        <Pressable style={styles.modalSheet} onPress={(event) => event.stopPropagation()}>
          <Display size={19}>Auto-bid</Display>
          <Body size={12.5} color={colors.ink3} style={styles.modalHint}>
            Set your ceiling. MoneyMart bids the smallest amount needed to keep you ahead — your maximum is never
            exposed to the room.
          </Body>

          <Body size={10.5} weight="semibold" color={colors.ink3} style={[ui.uppercase, styles.modalLabel]}>
            Maximum bid
          </Body>
          <View style={styles.inputRow}>
            <Data size={15} color={colors.ink3}>
              {formatMoney(0, currency as 'USD').replace(/[\d.,]/g, '')}
            </Data>
            <TextInput
              value={String(maxAmount)}
              onChangeText={(text) => setMaxAmount(Number(text.replace(/\D/g, '')) || 0)}
              keyboardType="number-pad"
              style={styles.input}
              placeholderTextColor={colors.ink3}
            />
          </View>

          <Body size={10.5} weight="semibold" color={colors.ink3} style={[ui.uppercase, styles.modalLabel]}>
            Increment
          </Body>
          <View style={styles.row}>
            {options.map((option) => {
              const selected = increment === option.value;
              return (
                <Pressable
                  key={option.label}
                  onPress={() => setIncrement(option.value)}
                  style={[styles.optionChip, selected ? styles.optionSelected : null]}
                >
                  <Body size={9.5} weight="semibold" color={colors.ink3} style={ui.uppercase}>
                    {option.label}
                  </Body>
                  <Data size={13.5} color={selected ? colors.gold : colors.ink2}>
                    +{option.value}
                  </Data>
                </Pressable>
              );
            })}
          </View>

          <Pressable
            onPress={() => setAggressive((value) => !value)}
            style={[styles.toggleRow, aggressive ? styles.toggleOn : null]}
          >
            <Body size={12.5} color={colors.ink}>
              Aggressive mode
            </Body>
            <View style={[styles.toggleTrack, aggressive ? styles.toggleTrackOn : null]}>
              <View style={[styles.toggleKnob, aggressive ? styles.toggleKnobOn : null]} />
            </View>
          </Pressable>

          <View style={styles.modalActions}>
            <Button label="Cancel" variant="navy" onPress={onDismiss} style={styles.flex1} />
            <Button
              label="Activate"
              variant="gold"
              icon={<GavelIcon size={15} color={colors.navy} />}
              onPress={() => onConfirm({ maxAmount, increment, aggressive })}
              style={styles.flex1}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ── Watch button ──────────────────────────────────────────────────────── */

export function WatchButton({ watching, onToggle }: { watching: boolean; onToggle: () => void }) {
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        onToggle();
      }}
      style={[styles.watchButton, watching ? styles.watchActive : null]}
    >
      <CheckIcon size={14} color={watching ? colors.gold : colors.ink2} />
      <Body size={12.5} weight="semibold" color={watching ? colors.gold : colors.ink2}>
        {watching ? 'Watching' : 'Watch'}
      </Body>
    </Pressable>
  );
}

/* ── Styles ────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex1: { flex: 1 },
  pressed: { opacity: 0.9 },
  sellerName: { maxWidth: 120 },
  showMore: { paddingTop: 10 },

  auctionCard: { overflow: 'hidden' },
  auctionImageWrap: { height: 190, position: 'relative' },
  auctionImage: { width: '100%', height: '100%' },
  auctionTopRow: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  auctionBottom: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  auctionBody: { padding: 14 },
  auctionTitle: { marginTop: 5 },
  auctionMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },

  streamImageWrap: { height: 200, position: 'relative' },
  viewerChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5 },
  streamOverlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  playButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  streamMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },

  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  historyEmpty: { paddingVertical: 18, textAlign: 'center' },
  rankBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  rankTop: { backgroundColor: colors.goldSoft },

  modalScrim: { flex: 1, backgroundColor: 'rgba(7,15,24,0.86)', justifyContent: 'center', padding: 20 },
  modalSheet: {
    backgroundColor: colors.card,
    borderRadius: radii.xl ,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
  },
  modalHint: { marginTop: 8, marginBottom: 4 },
  modalLabel: { marginTop: 18, marginBottom: 8 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: radii.md ,
    paddingHorizontal: 14,
    height: 52,
  },
  input: { flex: 1, fontFamily: fonts.data, fontSize: 19, color: colors.ink, textAlign: 'right' },
  optionChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: radii.md ,
    padding: 10,
  },
  optionSelected: { borderColor: colors.goldLine, backgroundColor: colors.goldSoft },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.025)',
    borderRadius: radii.md ,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  toggleOn: { borderColor: 'rgba(0,212,161,0.4)' },
  toggleTrack: { width: 40, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.14)', justifyContent: 'center' },
  toggleTrackOn: { backgroundColor: colors.green },
  toggleKnob: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff', marginLeft: 3 },
  toggleKnobOn: { marginLeft: 21 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 22 },

  watchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: radii.md ,
    paddingHorizontal: 14,
    height: 44,
  },
  watchActive: { borderColor: colors.goldLine, backgroundColor: colors.goldSoft },
});
