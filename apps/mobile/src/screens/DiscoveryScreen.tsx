/**
 * Discovery Tab — blueprint §5.2 Discovery.
 * Unified search, trending searches, recent searches, a 3-column category grid
 * with drill-down, and "Creators to Follow".
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { categories } from '@moneymart/tokens';
import { AuctionCard, StreamCard } from '@/components/auction';
import {
  Body,
  Button,
  Card,
  Display,
  EmptyState,
  Pill,
  SectionHeader,
} from '@/components/ui';
import { GavelIcon, SearchIcon, SparkIcon, TrendIcon } from '@/components/icons';
import { useAuctions, useStreams } from '@/lib/hooks';
import { formatMoney } from '@/lib/format';
import { colors, radii } from '@/theme';

const TRENDING = ['rolex datejust', 'air max 1', 'adire eleko', 'charizard psa 9', 'banksy print', 'kente cloth'];

export default function DiscoveryScreen({ navigation }: { navigation: any }) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [category, setCategory] = useState('');
  const [recent, setRecent] = useState<string[]>([]);

  const results = useAuctions({ q: submitted || undefined, category: category || undefined });
  const streams = useStreams();

  const lots = results.data?.items ?? [];
  const totalValue = useMemo(
    () => lots.reduce((sum, entry) => sum + (entry.currentBid || entry.startingPrice), 0),
    [lots],
  );

  const runSearch = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setQuery(trimmed);
    setSubmitted(trimmed);
    setRecent((current) => [trimmed, ...current.filter((entry) => entry !== trimmed)].slice(0, 6));
  };

  const searching = Boolean(submitted || category);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <Display size={26}>Discover</Display>
        <Body size={12.5} color={colors.ink3} style={styles.headerHint}>
          Search lots and creators, or browse by category.
        </Body>
      </View>

      {/* Search bar */}
      <View style={styles.searchRow}>
        <SearchIcon size={17} color={colors.ink3} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => runSearch(query)}
          returnKeyType="search"
          placeholder="Search lots, creators, categories…"
          placeholderTextColor={colors.ink3}
          style={styles.searchInput}
        />
        {query ? (
          <Pressable
            onPress={() => {
              setQuery('');
              setSubmitted('');
            }}
          >
            <Body size={11.5} color={colors.ink3}>
              Clear
            </Body>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 90 }]}
        showsVerticalScrollIndicator={false}
      >
        {searching ? (
          <>
            <View style={styles.resultsHead}>
              <View style={styles.flex1}>
                <Display size={18}>{submitted ? `“${submitted}”` : category}</Display>
                <Body size={12} color={colors.ink3} style={styles.resultsMeta}>
                  {lots.length} lots · {formatMoney(totalValue, 'USD', { compact: true })} combined value
                </Body>
              </View>
              <Button label="Clear" variant="ghost" size="sm" onPress={() => { setSubmitted(''); setCategory(''); setQuery(''); }} />
            </View>

            {lots.map((auction) => (
              <View key={auction.id} style={styles.stackGap}>
                <AuctionCard auction={auction} onPress={() => navigation.navigate('AuctionDetail', { id: auction.id })} />
              </View>
            ))}
            {!lots.length && !results.loading ? (
              <EmptyState title="No matches" body="Try a creator handle, a category, or a broader term." />
            ) : null}
          </>
        ) : (
          <>
            {/* Trending */}
            <Card style={styles.block}>
              <View style={styles.blockHead}>
                <TrendIcon size={15} color={colors.gold} />
                <Body size={13.5} weight="semibold" color={colors.ink}>
                  Trending searches
                </Body>
              </View>
              <View style={styles.chipWrap}>
                {TRENDING.map((entry) => (
                  <Pressable key={entry} onPress={() => runSearch(entry)} style={styles.searchChip}>
                    <Body size={12} color={colors.ink2}>
                      {entry}
                    </Body>
                  </Pressable>
                ))}
              </View>
            </Card>

            {recent.length ? (
              <Card style={styles.block}>
                <View style={styles.blockHead}>
                  <Body size={13.5} weight="semibold" color={colors.ink}>
                    Recent searches
                  </Body>
                  <Pressable onPress={() => setRecent([])}>
                    <Body size={11.5} color={colors.ink3}>
                      Clear all
                    </Body>
                  </Pressable>
                </View>
                <View style={styles.chipWrap}>
                  {recent.map((entry) => (
                    <Pressable key={entry} onPress={() => runSearch(entry)} style={styles.searchChip}>
                      <Body size={12} color={colors.ink2}>
                        {entry}
                      </Body>
                    </Pressable>
                  ))}
                </View>
              </Card>
            ) : null}

            {/* Category browser — 3-column icon grid with drill-down */}
            <View style={styles.section}>
              <SectionHeader eyebrow="Browse" title="Categories" />
              <View style={styles.categoryGrid}>
                {categories.map((entry) => (
                  <Pressable
                    key={entry.id}
                    onPress={() => setCategory(entry.id)}
                    style={styles.categoryCell}
                  >
                    <Card style={styles.categoryCard}>
                      <Body size={26}>{entry.emoji}</Body>
                      <Body size={11.5} weight="medium" color={colors.ink2} numberOfLines={2} style={styles.categoryLabel}>
                        {entry.label}
                      </Body>
                    </Card>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Creators to follow */}
            <View style={styles.section}>
              <SectionHeader
                eyebrow="Creators to follow"
                title="Popular shops"
                action={
                  <Pressable onPress={() => navigation.navigate('Home')}>
                    <Body size={12.5} weight="semibold" color={colors.gold}>
                      See all
                    </Body>
                  </Pressable>
                }
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
                {(streams.data?.items ?? []).map((stream) => (
                  <StreamCard
                    key={stream.id}
                    stream={stream}
                    width={272}
                    onPress={() => navigation.navigate('Stream', { id: stream.id })}
                  />
                ))}
              </ScrollView>
            </View>

            {/* Quick stats */}
            <View style={styles.statsRow}>
              <Pill tone="gold">
                <GavelIcon size={11} color={colors.gold} />
                <Body size={10.5} weight="semibold" color={colors.gold}>
                  {results.data ? `${results.data.total} lots indexed` : 'Indexing…'}
                </Body>
              </Pill>
              <Pill tone="green">
                <SparkIcon size={11} color={colors.green} />
                <Body size={10.5} weight="semibold" color={colors.green}>
                  Similarity recommendations
                </Body>
              </Pill>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex1: { flex: 1 },
  header: { paddingHorizontal: 16, marginBottom: 14 },
  headerHint: { marginTop: 6 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    height: 50,
    borderRadius: radii.md ,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 14,
  },
  searchInput: { flex: 1, color: colors.ink, fontSize: 14.5, paddingVertical: 0 },
  scrollContent: { paddingTop: 16 },
  block: { marginHorizontal: 16, marginBottom: 14 },
  blockHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  searchChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.035)',
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  section: { paddingHorizontal: 16, marginTop: 8, marginBottom: 22 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  categoryCell: { width: '31.5%' },
  categoryCard: { alignItems: 'center', paddingVertical: 18, paddingHorizontal: 8 },
  categoryLabel: { marginTop: 8, textAlign: 'center' },
  rail: { gap: 12, paddingRight: 16 },
  stackGap: { marginBottom: 14 },
  resultsHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, marginBottom: 14 },
  resultsMeta: { marginTop: 4 },
  statsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginTop: 4 },
});
