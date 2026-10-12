/**
 * Auto-bid modal route — blueprint §5.2 "Auto-bid modal (accessed via long-press
 * on Bid Button)". Presented as a bottom sheet from the lot or stream screen.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Body, Button, Data, Display, Pill, styles as ui } from '@/components/ui';
import { BellIcon, CloseIcon, GavelIcon, ShieldIcon } from '@/components/icons';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { colors, fonts, radii } from '@/theme';
import { useSession } from '@/store/session';

export default function AutoBidScreen({ route, navigation }: { route: any; navigation: any }) {
  const insets = useSafeAreaInsets();
  const user = useSession((state) => state.user);
  const params = route.params ?? {};

  const auctionId: string = params.auctionId ?? '';
  const currentBid: number = params.currentBid ?? 0;
  const minimum: number = params.minimum ?? currentBid;
  const currency: string = params.currency ?? 'USD';
  const step = Math.max(1, Math.round(minimum - currentBid) || 1);

  const [maxAmount, setMaxAmount] = useState(String(Math.round(minimum * 1.25)));
  const [increment, setIncrement] = useState(step);
  const [aggressive, setAggressive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const activate = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await api.setAutoBid(auctionId, {
        maxAmount: Number(maxAmount) || minimum,
        increment,
        aggressive,
        bidderId: user?.id,
      });
      navigation.goBack();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Auto-bid rejected');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
      <View style={styles.header}>
        <View style={styles.flex1}>
          <Display size={22}>Auto-bid</Display>
          <Body size={12.5} color={colors.ink3} style={styles.subtitle}>
            Set your ceiling. MoneyMart bids only what is needed to keep you ahead.
          </Body>
        </View>
        <Pressable onPress={() => navigation.goBack()} style={styles.close} hitSlop={10}>
          <CloseIcon size={17} color={colors.ink2} />
        </Pressable>
      </View>

      <View style={styles.currentRow}>
        <View>
          <Body size={10} weight="semibold" color={colors.ink3} style={ui.uppercase}>
            Current bid
          </Body>
          <Data size={20} color={colors.ink2}>
            {formatMoney(currentBid, currency as 'USD')}
          </Data>
        </View>
        <View style={styles.alignEnd}>
          <Body size={10} weight="semibold" color={colors.ink3} style={ui.uppercase}>
            Next bid
          </Body>
          <Data size={20} color={colors.gold}>
            {formatMoney(minimum, currency as 'USD')}
          </Data>
        </View>
      </View>

      <Body size={10.5} weight="semibold" color={colors.ink3} style={styles.label}>
        MAXIMUM BID
      </Body>
      <View style={styles.inputRow}>
        <Data size={17} color={colors.ink3}>
          {formatMoney(0, currency as 'USD').replace(/[\d.,]/g, '')}
        </Data>
        <TextInput
          value={maxAmount}
          onChangeText={(text) => setMaxAmount(text.replace(/[^\d]/g, ''))}
          keyboardType="number-pad"
          style={styles.input}
          placeholder="0"
          placeholderTextColor={colors.ink3}
        />
      </View>

      <Body size={10.5} weight="semibold" color={colors.ink3} style={styles.label}>
        INCREMENT SIZE
      </Body>
      <View style={styles.options}>
        {[
          { label: 'Minimum', value: step },
          { label: 'Mid', value: step * 2 },
          { label: 'Aggressive', value: step * 5 },
        ].map((option) => {
          const selected = increment === option.value;
          return (
            <Pressable
              key={option.label}
              onPress={() => setIncrement(option.value)}
              style={[styles.option, selected ? styles.optionSelected : null]}
            >
              <Body size={9.5} weight="semibold" color={colors.ink3} style={ui.uppercase}>
                {option.label}
              </Body>
              <Data size={14} color={selected ? colors.gold : colors.ink2}>
                +{option.value}
              </Data>
            </Pressable>
          );
        })}
      </View>

      <Pressable onPress={() => setAggressive((value) => !value)} style={[styles.toggle, aggressive ? styles.toggleOn : null]}>
        <Body size={12.5} color={colors.ink}>
          Aggressive mode — jump the ladder faster
        </Body>
        <View style={[styles.track, aggressive ? styles.trackOn : null]}>
          <View style={[styles.knob, aggressive ? styles.knobOn : null]} />
        </View>
      </Pressable>

      <View style={styles.assurance}>
        <BellIcon size={14} color={colors.gold} />
        <Body size={11.5} color={colors.ink2} style={styles.flex1}>
          You will be notified within 1 second of being outbid. Your maximum is never exposed to the room.
        </Body>
      </View>

      <View style={styles.trustRow}>
        <Pill tone="green">
          <ShieldIcon size={11} color={colors.green} />
          <Body size={10} weight="semibold" color={colors.green}>
            85% creator share
          </Body>
        </Pill>
        <Pill tone="gold">
          <GavelIcon size={11} color={colors.gold} />
          <Body size={10} weight="semibold" color={colors.gold}>
            Anti-snipe armed
          </Body>
        </Pill>
      </View>

      {notice ? (
        <Body size={12} color="#FF8080" style={styles.notice}>
          {notice}
        </Body>
      ) : null}

      <View style={styles.actions}>
        <Button label="Cancel" variant="navy" onPress={() => navigation.goBack()} style={styles.flex1} />
        <Button
          label="Activate auto-bid"
          variant="gold"
          loading={busy}
          icon={<GavelIcon size={15} color={colors.navy} />}
          onPress={() => void activate()}
          style={styles.flex1}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: 20 },
  flex1: { flex: 1 },
  alignEnd: { alignItems: 'flex-end' },
  header: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  subtitle: { marginTop: 8, lineHeight: 18 },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  currentRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  label: { letterSpacing: 1.4, marginBottom: 8, marginTop: 6 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 56,
    borderRadius: radii.md ,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 15,
  },
  input: { flex: 1, fontFamily: fonts.data, fontSize: 21, color: colors.ink, textAlign: 'right', paddingVertical: 0 },
  options: { flexDirection: 'row', gap: 9, marginBottom: 6 },
  option: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: radii.md ,
    padding: 11,
  },
  optionSelected: { borderColor: colors.goldLine, backgroundColor: colors.goldSoft },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.025)',
    borderRadius: radii.md ,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  toggleOn: { borderColor: 'rgba(0,212,161,0.4)' },
  track: { width: 40, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.14)', justifyContent: 'center' },
  trackOn: { backgroundColor: colors.green },
  knob: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff', marginLeft: 3 },
  knobOn: { marginLeft: 21 },
  assurance: { flexDirection: 'row', gap: 9, marginTop: 18, alignItems: 'flex-start' },
  trustRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  notice: { marginTop: 14 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 'auto' },
});
