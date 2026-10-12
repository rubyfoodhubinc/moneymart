/**
 * Live screen — blueprint §5.2 "Live Now" (full-screen horizontal carousel) and
 * the §8.2 stream grid. Reachable from Home and the tab bar.
 */
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StreamCard } from '@/components/auction';
import { Body, Display, EmptyState, Pill, SectionHeader, StatBlock } from '@/components/ui';
import { ChevronRightIcon, LiveDot, UsersIcon } from '@/components/icons';
import { useStreams } from '@/lib/hooks';
import { formatViewers } from '@/lib/format';
import { colors } from '@/theme';

export default function LiveScreen({ navigation }: { navigation: any }) {
  const insets = useSafeAreaInsets();
  const { data, loading } = useStreams();
  const [filter, setFilter] = useState<'live' | 'scheduled' | 'all'>('live');

  const items = data?.items ?? [];
  const live = items.filter((stream) => stream.status === 'live');
  const scheduled = items.filter((stream) => stream.status === 'scheduled');
  const shown = filter === 'live' ? live : filter === 'scheduled' ? scheduled : items;
  const totalViewers = live.reduce((sum, stream) => sum + stream.viewerCount, 0);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 10 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.back} hitSlop={12}>
          <ChevronRightIcon size={18} color={colors.ink} />
        </Pressable>
        <View style={styles.flex1}>
          <Display size={24}>Live now</Display>
          <Body size={12.5} color={colors.ink3} style={styles.subtitle}>
            {live.length} rooms · {formatViewers(totalViewers)} watching
          </Body>
        </View>
      </View>

      <View style={styles.stats}>
        <StatBlock label="Live rooms" value={String(live.length)} tone="green" />
        <StatBlock label="Scheduled" value={String(scheduled.length)} />
        <StatBlock label="Total viewers" value={formatViewers(totalViewers)} tone="gold" />
      </View>

      <View style={styles.filters}>
        {(['live', 'scheduled', 'all'] as const).map((entry) => {
          const active = filter === entry;
          return (
            <Pressable key={entry} onPress={() => setFilter(entry)} style={[styles.filter, active ? styles.filterActive : null]}>
              {entry === 'live' ? <LiveDot size={7} /> : null}
              <Body size={12.5} weight="semibold" color={active ? colors.navy : colors.ink2} style={styles.capitalize}>
                {entry}
              </Body>
            </Pressable>
          );
        })}
      </View>

      {shown.length ? (
        <FlatList
          data={shown}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
          renderItem={({ item }) => (
            <View style={styles.listItem}>
              <StreamCard stream={item} onPress={() => navigation.navigate('Stream', { id: item.id })} />
            </View>
          )}
          ListFooterComponent={
            <Pill tone="neutral" style={styles.footerPill}>
              <UsersIcon size={11} color={colors.ink3} />
              <Body size={10.5} weight="semibold" color={colors.ink3}>
                Viewer counts update in real time
              </Body>
            </Pill>
          }
        />
      ) : (
        <View style={styles.emptyWrap}>
          <EmptyState
            title={loading ? 'Loading rooms…' : 'No rooms in this filter'}
            body="Creators stream on a schedule. Switch to Scheduled to see what is next."
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex1: { flex: 1 },
  capitalize: { textTransform: 'capitalize' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, marginBottom: 16 },
  back: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', transform: [{ rotate: '180deg' }] },
  subtitle: { marginTop: 5 },
  stats: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 16 },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 14 },
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.035)',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  filterActive: { backgroundColor: colors.gold, borderColor: 'transparent' },
  list: { paddingHorizontal: 16 },
  listItem: { marginBottom: 14 },
  footerPill: { alignSelf: 'center', marginTop: 8 },
  emptyWrap: { paddingHorizontal: 16 },
});
