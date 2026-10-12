/**
 * Profile Setup — blueprint §5.2 (final onboarding screen).
 * Display name (pre-filled from the session identity), avatar picker,
 * category-interest multi-select chips, and per-type notification opt-in.
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { categories } from '@moneymart/tokens';
import { Avatar, Body, Button, Card, Display, Pill } from '@/components/ui';
import { CameraIcon, CheckIcon, SparkIcon } from '@/components/icons';
import { colors, radii } from '@/theme';
import { useSession } from '@/store/session';

const NOTIFICATION_TYPES = [
  { key: 'outbid', label: 'Outbid alerts', hint: 'Within 1 second of being outbid' },
  { key: 'streams', label: 'Stream starts', hint: 'When a creator you follow goes live' },
  { key: 'orders', label: 'Order updates', hint: 'Payment, shipment and delivery' },
  { key: 'priceDrops', label: 'Price drops', hint: 'Marketplace listings you watched' },
];

export default function ProfileSetupScreen({ navigation, route }: { navigation: any; route: any }) {
  const insets = useSafeAreaInsets();
  const user = useSession((state) => state.user);
  const profile = useSession((state) => state.profile);

  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [interests, setInterests] = useState<string[]>(['watches', 'sneakers']);
  const [prefs, setPrefs] = useState<Record<string, boolean>>({
    outbid: true,
    streams: true,
    orders: true,
    priceDrops: false,
  });

  const finish = () => {
    const callback = route?.params?.onFinish;
    if (typeof callback === 'function') callback();
    else navigation.navigate('Tabs');
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 18 }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Display size={28}>Set up your profile</Display>
        <Body size={13.5} color={colors.ink2} style={styles.subtitle}>
          This is what other bidders and creators see. You can change everything later in settings.
        </Body>

        {/* Avatar */}
        <View style={styles.avatarRow}>
          <Avatar name={displayName || 'MoneyMart'} src={profile?.avatarUrl} size={76} isVerified={profile?.isVerified} />
          <View style={styles.avatarActions}>
            <Button
              label="Upload photo"
              variant="navy"
              size="sm"
              icon={<CameraIcon size={15} color={colors.ink} />}
              onPress={() => undefined}
            />
            <Body size={11} color={colors.ink3} style={styles.avatarHint}>
              Camera or gallery. Background removal is applied automatically.
            </Body>
          </View>
        </View>

        {/* Display name */}
        <Body size={10.5} weight="semibold" color={colors.ink3} style={styles.label}>
          DISPLAY NAME
        </Body>
        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="How should we address you?"
          placeholderTextColor={colors.ink3}
          style={styles.input}
          maxLength={40}
        />
        <Body size={11} color={colors.ink3} style={styles.helper}>
          {displayName.length}/40 · auto-suggested from your sign-in identity
        </Body>

        {/* Interests */}
        <View style={styles.sectionHead}>
          <Body size={10.5} weight="semibold" color={colors.ink3} style={styles.label}>
            WHAT ARE YOU INTO?
          </Body>
          <Pill tone="gold">
            <SparkIcon size={11} color={colors.gold} />
            <Body size={10} weight="semibold" color={colors.gold}>
              {interests.length} selected
            </Body>
          </Pill>
        </View>
        <View style={styles.chipWrap}>
          {categories.map((category) => {
            const active = interests.includes(category.id);
            return (
              <Pressable
                key={category.id}
                onPress={() =>
                  setInterests((current) =>
                    current.includes(category.id)
                      ? current.filter((value) => value !== category.id)
                      : [...current, category.id],
                  )
                }
                style={[styles.chip, active ? styles.chipActive : null]}
              >
                <Body size={14}>{category.emoji}</Body>
                <Body size={12.5} weight="medium" color={active ? colors.navy : colors.ink2}>
                  {category.label}
                </Body>
                {active ? <CheckIcon size={13} color={colors.navy} strokeWidth={2.6} /> : null}
              </Pressable>
            );
          })}
        </View>

        {/* Notifications */}
        <Body size={10.5} weight="semibold" color={colors.ink3} style={[styles.label, styles.notifLabel]}>
          NOTIFY ME ABOUT
        </Body>
        <Card padded={false} style={styles.prefCard}>
          {NOTIFICATION_TYPES.map((entry, index) => (
            <View
              key={entry.key}
              style={[styles.prefRow, index < NOTIFICATION_TYPES.length - 1 ? styles.prefDivider : null]}
            >
              <View style={styles.flex1}>
                <Body size={13} weight="medium" color={colors.ink}>
                  {entry.label}
                </Body>
                <Body size={11} color={colors.ink3}>
                  {entry.hint}
                </Body>
              </View>
              <Switch
                value={prefs[entry.key]}
                onValueChange={(value) => setPrefs((current) => ({ ...current, [entry.key]: value }))}
                trackColor={{ false: 'rgba(255,255,255,0.14)', true: colors.green }}
                thumbColor="#FFFFFF"
              />
            </View>
          ))}
        </Card>

        <Body size={11} color={colors.ink3} style={styles.footnote}>
          Push notifications are delivered through Firebase Cloud Messaging. You can mute any category without
          losing your bid history.
        </Body>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Button
          label={user ? 'Enter MoneyMart' : 'Continue'}
          variant="gold"
          size="lg"
          full
          onPress={finish}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: 22, paddingBottom: 20 },
  subtitle: { marginTop: 10, marginBottom: 22, lineHeight: 21 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 24 },
  avatarActions: { flex: 1, gap: 8 },
  avatarHint: { lineHeight: 15 },
  label: { letterSpacing: 1.4, marginBottom: 8 },
  input: {
    height: 52,
    borderRadius: radii.md ,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 15,
    color: colors.ink,
    fontSize: 15,
  },
  helper: { marginTop: 6 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radii.pill ,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.035)',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  chipActive: { borderColor: 'transparent', backgroundColor: colors.gold },
  notifLabel: { marginTop: 26 },
  prefCard: { overflow: 'hidden' },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 15,
    paddingVertical: 13,
  },
  prefDivider: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  flex1: { flex: 1 },
  footnote: { marginTop: 16, lineHeight: 17 },
  footer: { paddingHorizontal: 22, paddingTop: 12 },
});
