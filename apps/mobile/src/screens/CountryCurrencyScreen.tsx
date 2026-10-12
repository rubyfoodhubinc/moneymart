/**
 * Country & Currency Selection — blueprint §5.2.
 * Flag grid of the primary markets with the currency symbol previewed beside
 * each, geo-detected default, and a search field for other markets.
 */
import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { currencies, currencyMetaList } from '@/lib/currencies';
import { Body, Button, Card, Data, Display, Pill } from '@/components/ui';
import { CheckIcon, GlobeIcon, SearchIcon } from '@/components/icons';
import { colors, radii } from '@/theme';
import { useSession } from '@/store/session';

export default function CountryCurrencyScreen({ navigation }: { navigation: any }) {
  const insets = useSafeAreaInsets();
  const user = useSession((state) => state.user);
  const [selected, setSelected] = useState(user?.currencyCode ?? 'USD');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query) return currencyMetaList;
    const needle = query.toLowerCase();
    return currencyMetaList.filter(
      (entry) => entry.country.toLowerCase().includes(needle) || entry.code.toLowerCase().includes(needle),
    );
  }, [query]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 16 }]}>
      <Display size={30}>Where are you{'\n'}bidding from?</Display>
      <Body size={13.5} color={colors.ink2} style={styles.subtitle}>
        We default your currency and payment rails from your region. You can change this any time in settings.
      </Body>

      <View style={styles.searchRow}>
        <SearchIcon size={16} color={colors.ink3} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search a country or currency"
          placeholderTextColor={colors.ink3}
          style={styles.searchInput}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.code}
        numColumns={2}
        columnWrapperStyle={styles.column}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const active = selected === item.code;
          return (
            <Pressable onPress={() => setSelected(item.code)} style={styles.cell}>
              <Card style={[styles.countryCard, active ? styles.countryActive : null]}>
                <View style={styles.countryTop}>
                  <Body size={22}>{item.flag}</Body>
                  {active ? <CheckIcon size={15} color={colors.gold} strokeWidth={2.6} /> : null}
                </View>
                <Body size={13} weight="semibold" color={colors.ink} style={styles.countryName}>
                  {item.country}
                </Body>
                <View style={styles.currencyRow}>
                  <Data size={13} color={active ? colors.gold : colors.ink2}>
                    {item.symbol}
                  </Data>
                  <Body size={11} color={colors.ink3}>
                    {item.code}
                  </Body>
                </View>
                <Body size={10.5} color={colors.ink3} numberOfLines={2} style={styles.rails}>
                  {item.rails}
                </Body>
              </Card>
            </Pressable>
          );
        }}
        ListFooterComponent={
          <View style={styles.footerNote}>
            <Pill>
              <GlobeIcon size={11} color={colors.ink2} />
              <Body size={10.5} weight="semibold" color={colors.ink2}>
                50+ languages supported
              </Body>
            </Pill>
            <Body size={11.5} color={colors.ink3} style={styles.footerText}>
              Cross-border purchases show duties and VAT before you confirm. Phase 3 adds Kenya, Ghana and South
              Africa.
            </Body>
          </View>
        }
      />

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Button label="Continue" variant="gold" size="lg" full onPress={() => navigation.navigate('Auth')} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: 20 },
  subtitle: { marginTop: 12, marginBottom: 20, lineHeight: 21 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    borderRadius: radii.md ,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 14,
    marginBottom: 16,
  },
  searchInput: { flex: 1, color: colors.ink, fontSize: 14, paddingVertical: 0 },
  list: { paddingBottom: 12 },
  column: { gap: 12 },
  cell: { flex: 1, marginBottom: 12 },
  countryCard: { padding: 14 },
  countryActive: { borderColor: colors.goldLine, backgroundColor: colors.goldSoft },
  countryTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  countryName: { marginTop: 10 },
  currencyRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 4 },
  rails: { marginTop: 8, lineHeight: 14 },
  footerNote: { paddingTop: 8, gap: 10, alignItems: 'flex-start' },
  footerText: { lineHeight: 18 },
  footer: { paddingTop: 12 },
});
