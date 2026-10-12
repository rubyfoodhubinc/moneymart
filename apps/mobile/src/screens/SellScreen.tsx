/**
 * Selling Flow — blueprint §5.2 (5 steps).
 * Step 1 item type · Step 2 details · Step 3 photos · Step 4 pricing & duration
 * with a live fee calculator · Step 5 review & publish.
 */
import { useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MONETIZATION, categories, conditionGrades, currency as currencyMeta } from '@moneymart/tokens';
import {
  Body,
  Button,
  Card,
  Data,
  Display,
  Pill,
  StatBlock,
  styles as ui,
} from '@/components/ui';
import * as ImagePicker from 'expo-image-picker';
import { CameraIcon, CheckIcon, GavelIcon, GlobeIcon, ShieldIcon, SparkIcon, StoreIcon, TrendIcon } from '@/components/icons';
import { api } from '@/lib/api';
import { canAddImage, prepareImage } from '@/lib/images';
import { buyersPremiumRate, formatMoney, pct, round2 } from '@/lib/format';
import { colors, radii } from '@/theme';
import { useSession } from '@/store/session';

const TRACKS = [
  { id: 'live_stream', title: 'Live Stream Listing', body: 'Drop it during a scheduled stream.', fee: '15% platform share', icon: <SparkIcon size={18} color={colors.green} /> },
  { id: 'traditional', title: 'Traditional Auction', body: 'Expert-catalogued consignment with provenance.', fee: "15–20% buyer's premium", icon: <GavelIcon size={18} color={colors.gold} /> },
  { id: 'buy_now', title: 'Buy Now', body: 'Fixed price, instant checkout.', fee: '10% seller fee', icon: <StoreIcon size={18} color={colors.gold} /> },
  { id: 'make_offer', title: 'Make an Offer', body: 'Accept, decline or counter within 48 hours.', fee: '10% seller fee', icon: <GlobeIcon size={18} color={colors.green} /> },
] as const;

const STEPS = ['Type', 'Details', 'Photos', 'Pricing', 'Review'];
const DURATIONS = [1, 3, 5, 7, 10, 14];

export default function SellScreen({ navigation }: { navigation: any }) {
  const insets = useSafeAreaInsets();
  const user = useSession((state) => state.user);

  const [step, setStep] = useState(1);
  const [track, setTrack] = useState<string>('live_stream');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('watches');
  const [condition, setCondition] = useState('good');
  const [photos, setPhotos] = useState<string[]>([]);
  const [startingPrice, setStartingPrice] = useState('500');
  const [reservePrice, setReservePrice] = useState('');
  const [buyItNow, setBuyItNow] = useState('');
  const [duration, setDuration] = useState(7);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const currency = user?.currencyCode ?? 'USD';
  const premiumRate = useMemo(() => buyersPremiumRate(categoryId, false), [categoryId]);
  const sellerFeeRate = track === 'live_stream' ? MONETIZATION.creatorPlatformShare : 0.1;
  const price = Number(startingPrice) || 0;

  const feeTable = useMemo(
    () =>
      [1, 2, 5, 10].map((multiplier) => {
        const salePrice = Math.max(1, Math.round(price * multiplier));
        const fee = round2(salePrice * sellerFeeRate);
        return { salePrice, fee, net: round2(salePrice - fee), premium: round2(salePrice * premiumRate) };
      }),
    [price, sellerFeeRate, premiumRate],
  );

  const canAdvance =
    step === 1 ||
    (step === 2 && title.trim().length >= 4 && description.trim().length >= 10) ||
    (step === 3 && photos.length > 0) ||
    (step === 4 && price > 0) ||
    step === 5;

  /**
   * Take or choose a real photograph.
   *
   * This used to FABRICATE an SVG placeholder — a gradient with a number in the
   * corner — and attach that as the listing image. Two things were wrong with it.
   * It was not a photograph of anything, and the API refuses SVG outright, so
   * every publish from the app failed with `invalid_images`. The mobile seller
   * flow could not create a listing at all, and the placeholder made that look
   * like a deliberate demo rather than a fault.
   *
   * Images are downscaled and compressed before encoding: a modern phone camera
   * produces several megabytes, and the API accepts 3 MB of RAW bytes per image,
   * which is roughly 4 MB once base64 adds its third.
   */
  const addPhoto = async (source: 'library' | 'camera') => {
    setNotice(null);
    try {
      const permission =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setNotice(
          source === 'camera'
            ? 'Camera access is needed to photograph your item. You can enable it in Settings.'
            : 'Photo access is needed to choose images. You can enable it in Settings.',
        );
        return;
      }

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({
              mediaTypes: ['images'],
              quality: 0.7,
              allowsEditing: true,
              aspect: [4, 3],
              // base64 so the upload is a self-contained data URI: the API accepts
              // those, and it avoids a second round trip to a storage service that
              // is not configured.
              base64: true,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              quality: 0.7,
              allowsMultipleSelection: false,
              base64: true,
              exif: false,
            });

      if (result.canceled || !result.assets?.length) return;

      /**
       * The asset-to-data-URI conversion is shared with the account setup screen
       * and tested against the real API. It is where the failures actually happen:
       * a mismatched MIME type, `image/jpg`, or base64 pushing a file over the
       * ceiling.
       */
      const prepared = prepareImage(result.assets[0]);
      if (!prepared.ok) {
        setNotice(prepared.reason);
        return;
      }

      if (!canAddImage(photos.length)) {
        setNotice('A listing can carry twenty photographs.');
        return;
      }

      setPhotos((current) => [...current, prepared.value]);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Could not open the photo library.');
    }
  };

  const publish = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await api.createListing({
        title,
        description,
        categoryId,
        condition,
        auctionType: track,
        startingPrice: price,
        reservePrice: reservePrice ? Number(reservePrice) : undefined,
        buyItNowPrice: buyItNow ? Number(buyItNow) : undefined,
        durationDays: duration,
        images: photos,
        sellerId: user?.id,
      });
      navigation.navigate('AuctionDetail', { id: result.auction.id });
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Could not publish the listing');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <Display size={25}>Sell a lot</Display>
        <Body size={12.5} color={colors.ink3} style={styles.subtitle}>
          Five steps to publish. Live-stream lots go on the block immediately.
        </Body>
      </View>

      {/* Step rail */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stepRail}>
        {STEPS.map((label, index) => {
          const number = index + 1;
          const active = step === number;
          const done = step > number;
          return (
            <Pressable
              key={label}
              onPress={() => setStep(number)}
              style={[styles.stepChip, active ? styles.stepActive : done ? styles.stepDone : null]}
            >
              <Data size={11} color={active ? colors.gold : done ? colors.green : colors.ink3}>
                {done ? '✓' : number}
              </Data>
              <Body size={12} weight="medium" color={active ? colors.gold : done ? colors.green : colors.ink3}>
                {label}
              </Body>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 110 }]} showsVerticalScrollIndicator={false}>
        {/* Step 1 — item type */}
        {step === 1
          ? TRACKS.map((entry) => {
              const selected = track === entry.id;
              return (
                <Pressable
                  key={entry.id}
                  onPress={() => {
                    setTrack(entry.id);
                    setStep(2);
                  }}
                  style={[styles.trackCard, selected ? styles.trackSelected : null]}
                >
                  <View style={styles.trackIcon}>{entry.icon}</View>
                  <View style={styles.flex1}>
                    <Display size={15}>{entry.title}</Display>
                    <Body size={12} color={colors.ink3} style={styles.trackBody}>
                      {entry.body}
                    </Body>
                    <Body size={11} weight="semibold" color={colors.gold} style={styles.trackFee}>
                      {entry.fee}
                    </Body>
                  </View>
                </Pressable>
              );
            })
          : null}

        {/* Step 2 — details */}
        {step === 2 ? (
          <>
            <Body size={10.5} weight="semibold" color={colors.ink3} style={styles.label}>
              CATEGORY
            </Body>
            <View style={styles.chipWrap}>
              {categories.map((entry) => {
                const active = categoryId === entry.id;
                return (
                  <Pressable
                    key={entry.id}
                    onPress={() => setCategoryId(entry.id)}
                    style={[styles.chip, active ? styles.chipActive : null]}
                  >
                    <Body size={13}>{entry.emoji}</Body>
                    <Body size={12} weight="medium" color={active ? colors.navy : colors.ink2}>
                      {entry.label}
                    </Body>
                  </Pressable>
                );
              })}
            </View>

            <Body size={10.5} weight="semibold" color={colors.ink3} style={[styles.label, styles.labelSpaced]}>
              TITLE — {title.length}/80
            </Body>
            <TextInput
              value={title}
              onChangeText={setTitle}
              maxLength={80}
              placeholder="e.g. Rolex Datejust 36 — 2016, Full Set"
              placeholderTextColor={colors.ink3}
              style={styles.input}
            />

            <Body size={10.5} weight="semibold" color={colors.ink3} style={[styles.label, styles.labelSpaced]}>
              DESCRIPTION — {description.length}/2000
            </Body>
            <TextInput
              value={description}
              onChangeText={setDescription}
              maxLength={2000}
              multiline
              numberOfLines={5}
              placeholder="Maker, period, materials, provenance, what is included, any flaws."
              placeholderTextColor={colors.ink3}
              style={[styles.input, styles.textarea]}
            />

            <Body size={10.5} weight="semibold" color={colors.ink3} style={[styles.label, styles.labelSpaced]}>
              CONDITION
            </Body>
            <View style={styles.chipWrap}>
              {conditionGrades.map((grade) => {
                const active = condition === grade.value;
                return (
                  <Pressable
                    key={grade.value}
                    onPress={() => setCondition(grade.value)}
                    style={[styles.chip, active ? styles.chipActive : null]}
                  >
                    <Body size={12} weight="medium" color={active ? colors.navy : colors.ink2}>
                      {grade.label}
                    </Body>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {/* Step 3 — photos */}
        {step === 3 ? (
          <>
            <Body size={12.5} color={colors.ink3} style={styles.stepHint}>
              Up to 20 images. Clean white or light grey backgrounds only for item listings. The first image is the
              cover.
            </Body>
            <View style={styles.photoGrid}>
              {photos.map((uri, index) => (
                <View key={uri.slice(-18) + index} style={styles.photoCell}>
                  <Image source={{ uri }} style={styles.photo} />
                  {index === 0 ? (
                    <View style={styles.coverTag}>
                      <Body size={9} weight="bold" color={colors.navy}>
                        COVER
                      </Body>
                    </View>
                  ) : null}
                  <Pressable
                    onPress={() => setPhotos((current) => current.filter((_, i) => i !== index))}
                    style={styles.removePhoto}
                  >
                    <Body size={11} color="#FF8080">
                      ✕
                    </Body>
                  </Pressable>
                </View>
              ))}
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable onPress={() => void addPhoto('camera')} style={[styles.photoCell, styles.photoAdd]}>
                    <CameraIcon size={18} color={colors.ink3} />
                    <Body size={10.5} color={colors.ink3} style={styles.photoAddLabel}>
                      Camera
                    </Body>
                  </Pressable>
                  <Pressable onPress={() => void addPhoto('library')} style={[styles.photoCell, styles.photoAdd]}>
                    <SparkIcon size={18} color={colors.ink3} />
                    <Body size={10.5} color={colors.ink3} style={styles.photoAddLabel}>
                      Gallery
                    </Body>
                  </Pressable>
                </View>
              </View>
            <Body size={11} color={colors.ink3} style={styles.stepHint}>
              {photos.length} of 20 added, up to 3 MB each. A clear photograph against a plain background sells fastest.
            </Body>
          </>
        ) : null}

        {/* Step 4 — pricing */}
        {step === 4 ? (
          <>
            <Body size={10.5} weight="semibold" color={colors.ink3} style={styles.label}>
              STARTING PRICE ({currency})
            </Body>
            <TextInput
              value={startingPrice}
              onChangeText={(text) => setStartingPrice(text.replace(/[^\d]/g, ''))}
              keyboardType="number-pad"
              style={[styles.input, styles.priceInput]}
            />

            <View style={styles.twoUp}>
              <View style={styles.flex1}>
                <Body size={10.5} weight="semibold" color={colors.ink3} style={styles.label}>
                  RESERVE (OPTIONAL)
                </Body>
                <TextInput
                  value={reservePrice}
                  onChangeText={(text) => setReservePrice(text.replace(/[^\d]/g, ''))}
                  keyboardType="number-pad"
                  placeholder="Confidential"
                  placeholderTextColor={colors.ink3}
                  style={styles.input}
                />
              </View>
              <View style={styles.flex1}>
                <Body size={10.5} weight="semibold" color={colors.ink3} style={styles.label}>
                  BUY IT NOW (OPTIONAL)
                </Body>
                <TextInput
                  value={buyItNow}
                  onChangeText={(text) => setBuyItNow(text.replace(/[^\d]/g, ''))}
                  keyboardType="number-pad"
                  placeholder="Instant price"
                  placeholderTextColor={colors.ink3}
                  style={styles.input}
                />
              </View>
            </View>

            <Body size={10.5} weight="semibold" color={colors.ink3} style={[styles.label, styles.labelSpaced]}>
              DURATION
            </Body>
            <View style={styles.chipWrap}>
              {DURATIONS.map((days) => {
                const active = duration === days;
                return (
                  <Pressable key={days} onPress={() => setDuration(days)} style={[styles.chip, active ? styles.chipActive : null]}>
                    <Body size={12} weight="medium" color={active ? colors.navy : colors.ink2}>
                      {days}d
                    </Body>
                  </Pressable>
                );
              })}
            </View>

            <Body size={10.5} weight="semibold" color={colors.ink3} style={[styles.label, styles.labelSpaced]}>
              FEE CALCULATOR
            </Body>
            <Card padded={false} style={styles.feeTable}>
              <View style={styles.feeHead}>
                <Body size={10} weight="semibold" color={colors.ink3} style={styles.flex1}>
                  SALE
                </Body>
                <Body size={10} weight="semibold" color={colors.ink3} style={styles.feeCell}>
                  FEE
                </Body>
                <Body size={10} weight="semibold" color={colors.ink3} style={styles.feeCell}>
                  YOU GET
                </Body>
              </View>
              {feeTable.map((row) => (
                <View key={row.salePrice} style={styles.feeRow}>
                  <Data size={12} color={colors.ink2} style={styles.flex1}>
                    {formatMoney(row.salePrice, currency as 'USD')}
                  </Data>
                  <Data size={12} color={colors.ink3} style={styles.feeCell}>
                    −{formatMoney(row.fee, currency as 'USD')}
                  </Data>
                  <Data size={12} color={colors.green} style={styles.feeCell}>
                    {formatMoney(row.net, currency as 'USD')}
                  </Data>
                </View>
              ))}
            </Card>
            <Body size={11} color={colors.ink3} style={styles.stepHint}>
              {track === 'live_stream'
                ? `Live stream: platform retains ${pct(MONETIZATION.creatorPlatformShare)}, you keep ${pct(MONETIZATION.creatorShare)}.`
                : `Fixed format: ${pct(sellerFeeRate)} seller fee.`}{' '}
              Buyer’s premium on traditional sales is {pct(premiumRate)} for this category.
            </Body>
          </>
        ) : null}

        {/* Step 5 — review */}
        {step === 5 ? (
          <>
            <View style={styles.reviewRow}>
              {photos[0] ? (
                <Image source={{ uri: photos[0] }} style={styles.reviewImage} />
              ) : (
                <View style={[styles.reviewImage, styles.reviewPlaceholder]}>
                  <Body size={11} color={colors.ink3}>
                    No photo
                  </Body>
                </View>
              )}
              <View style={styles.flex1}>
                <View style={styles.chipWrap}>
                  <Pill tone="gold">{TRACKS.find((entry) => entry.id === track)?.title}</Pill>
                  <Pill>{categoryId}</Pill>
                </View>
                <Display size={14} numberOfLines={2} style={styles.reviewTitle}>
                  {title || 'Untitled lot'}
                </Display>
                <Body size={11.5} color={colors.ink3} numberOfLines={2}>
                  {description || 'No description yet.'}
                </Body>
              </View>
            </View>

            <Card style={styles.reviewCard}>
              <ReviewLine label="Starting price" value={formatMoney(price, currency as 'USD')} />
              {reservePrice ? <ReviewLine label="Reserve (private)" value={formatMoney(Number(reservePrice), currency as 'USD')} /> : null}
              {buyItNow ? <ReviewLine label="Buy It Now" value={formatMoney(Number(buyItNow), currency as 'USD')} /> : null}
              <ReviewLine label="Duration" value={`${duration} days`} />
              <ReviewLine label="Platform fee" value={pct(sellerFeeRate)} />
              <ReviewLine
                label="Estimated net at starting price"
                value={formatMoney(round2(price * (1 - sellerFeeRate)), currency as 'USD')}
                strong
              />
            </Card>

            {track === 'traditional' ? (
              <Card style={styles.complianceCard}>
                <ShieldIcon size={15} color={colors.gold} />
                <Body size={12} color={colors.ink2} style={styles.flex1}>
                  Traditional consignment enters expert review (3–5 business days). We produce the catalogue entry,
                  valuation range and condition report before your lot goes live.
                </Body>
              </Card>
            ) : null}

            <View style={styles.statsRow}>
              <StatBlock label="Creator share" value={pct(MONETIZATION.creatorShare)} tone="green" />
              <StatBlock label="Payout" value="7–10d" hint="After confirmation" />
            </View>
          </>
        ) : null}

        {notice ? (
          <Card style={styles.noticeCard}>
            <Body size={12} color="#FF8080">
              {notice}
            </Body>
          </Card>
        ) : null}
      </ScrollView>

      {/* Action bar */}
      <View style={[styles.actionBar, { paddingBottom: insets.bottom + 10 }]}>
        {step > 1 ? <Button label="Back" variant="navy" onPress={() => setStep((value) => value - 1)} style={styles.backButton} /> : null}
        {step < 5 ? (
          <Button
            label="Continue"
            variant="gold"
            disabled={!canAdvance}
            onPress={() => setStep((value) => value + 1)}
            style={styles.flex1}
          />
        ) : (
          <Button
            label={track === 'traditional' ? 'Submit for review' : 'Publish listing'}
            variant="gold"
            loading={busy}
            icon={<CheckIcon size={15} color={colors.navy} />}
            onPress={() => void publish()}
            style={styles.flex1}
          />
        )}
      </View>
    </View>
  );
}

function ReviewLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.reviewLine}>
      <Body size={12.5} color={strong ? colors.ink : colors.ink3}>
        {label}
      </Body>
      <Data size={strong ? 15 : 13} color={strong ? colors.green : colors.ink2}>
        {value}
      </Data>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex1: { flex: 1 },
  header: { paddingHorizontal: 16, marginBottom: 14 },
  subtitle: { marginTop: 6 },
  stepRail: { gap: 8, paddingHorizontal: 16, paddingBottom: 14 },
  stepChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  stepActive: { borderColor: colors.goldLine, backgroundColor: colors.goldSoft },
  stepDone: { borderColor: 'rgba(0,212,161,0.4)', backgroundColor: colors.greenSoft },
  content: { paddingHorizontal: 16 },

  trackCard: {
    flexDirection: 'row',
    gap: 14,
    padding: 16,
    borderRadius: radii.lg ,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: colors.card,
    marginBottom: 12,
  },
  trackSelected: { borderColor: colors.goldLine },
  trackIcon: {
    width: 44,
    height: 44,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackBody: { marginTop: 5, lineHeight: 17 },
  trackFee: { marginTop: 8 },

  label: { letterSpacing: 1.4, marginBottom: 8 },
  labelSpaced: { marginTop: 20 },
  input: {
    borderRadius: radii.md ,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: colors.ink,
    fontSize: 14,
  },
  textarea: { minHeight: 108, textAlignVertical: 'top', lineHeight: 20 },
  priceInput: { fontSize: 20, color: colors.gold },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.035)',
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  chipActive: { backgroundColor: colors.gold, borderColor: 'transparent' },
  twoUp: { flexDirection: 'row', gap: 12, marginTop: 18 },
  stepHint: { marginTop: 14, lineHeight: 18 },

  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  photoCell: { width: '31%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden', position: 'relative' },
  photo: { width: '100%', height: '100%' },
  photoAdd: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  photoAddLabel: { marginTop: 6 },
  coverTag: { position: 'absolute', left: 5, top: 5, backgroundColor: colors.gold, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  removePhoto: { position: 'absolute', right: 5, top: 5, backgroundColor: 'rgba(7,15,24,0.8)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },

  feeTable: { overflow: 'hidden' },
  feeHead: { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: 'rgba(255,255,255,0.04)' },
  feeRow: { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: 1, borderTopColor: colors.divider },
  feeCell: { width: 92, textAlign: 'right' },

  reviewRow: { flexDirection: 'row', gap: 14 },
  reviewImage: { width: 108, height: 108, borderRadius: 12 },
  reviewPlaceholder: { backgroundColor: 'rgba(255,255,255,0.04)', alignItems: 'center', justifyContent: 'center' },
  reviewTitle: { marginTop: 8, marginBottom: 4 },
  reviewCard: { marginTop: 18, gap: 11 },
  reviewLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  complianceCard: { flexDirection: 'row', gap: 10, marginTop: 14, borderColor: colors.border, backgroundColor: 'rgba(245,166,35,0.08)' },
  statsRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  noticeCard: { marginTop: 16, borderColor: 'rgba(229,62,62,0.4)', backgroundColor: 'rgba(229,62,62,0.1)' },

  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: 'rgba(9,18,29,0.97)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  backButton: { width: 96 },
});
