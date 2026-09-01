import { useState } from 'react';
import {
  View, FlatList, ScrollView, Pressable, ActivityIndicator, RefreshControl, StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { ChromeBar, useFloatingChrome } from '@/components/Chrome';
import { Button } from '@/components/Button';
import { EventCard } from '@/components/EventCard';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useEvents, dayLabel, type EventScope, type AtweEvent } from '@/api/events';
import { haptics } from '@/lib/haptics';

const SCOPES: { key: EventScope; label: string }[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'attending', label: 'Going' },
  { key: 'mine', label: 'Hosting' },
  { key: 'past', label: 'Past' },
];

/**
 * Events — `GET /api/events`. Four shelves, and the list is grouped by DAY,
 * because the question a person is answering here is "what's on, and when", and
 * a flat list of thirty cards makes them work that out for themselves.
 */
export default function Events() {
  const { c } = useTheme();
  const router = useRouter();
  const [scope, setScope] = useState<EventScope>('upcoming');
  const { data, isLoading, isError, refetch, isRefetching } = useEvents(scope);
  const events = data?.events ?? [];

  /* Group into [day, events] runs. The server already sorts by start time, so a
     single pass is enough — and `past` comes back newest-first, which groups the
     same way without special-casing. */
  const days: { day: string; items: AtweEvent[] }[] = [];
  for (const e of events) {
    const d = dayLabel(e.startsAt);
    const last = days[days.length - 1];
    if (last && last.day === d) last.items.push(e);
    else days.push({ day: d, items: [e] });
  }

  const chrome = useFloatingChrome();

  return (
    <Screen edges={[]}>
      <ChromeBar onLayout={chrome.onLayout}>
        <View style={styles.head}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.icon} accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={26} color={c.text} />
          </Pressable>
          <Text variant="headline">Events</Text>
          <Pressable onPress={() => router.push('/new-event')} hitSlop={10} style={styles.icon}
            accessibilityRole="button" accessibilityLabel="Host an event">
            <Ionicons name="add" size={26} color={c.text} />
          </Pressable>
        </View>
      <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.strip}
          contentContainerStyle={styles.chipRow}
        >
          {SCOPES.map((s) => {
            const on = scope === s.key;
            return (
              <Pressable
                key={s.key}
                onPress={() => { haptics.select(); setScope(s.key); }}
                style={[styles.chip, { backgroundColor: on ? c.primary : c.s2 }]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={s.label}
              >
                <Text variant="callout" style={{ color: on ? c.onPrimary : c.t2 }}>{s.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </ChromeBar>


      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">Couldn't load events.</Text>
          <View style={{ height: 14 }} />
          <Button title="Try again" kind="secondary" onPress={() => refetch()} />
        </View>
      ) : (
        <FlatList
          data={days}
          keyExtractor={(d, i) => d.day + i}
          renderItem={({ item }) => (
            <View>
              <Text variant="callout" tone="t3" style={styles.day}>{item.day}</Text>
              {item.items.map((e) => <EventCard key={e.id} event={e} underDayHeading />)}
            </View>
          )}
          contentContainerStyle={[days.length ? { paddingBottom: 120 } : styles.emptyWrap, chrome.pad]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={c.t3} />}
          ListEmptyComponent={<Empty scope={scope} onHost={() => router.push('/new-event')} />}
        />
      )}
    </Screen>
  );
}

function Empty({ scope, onHost }: { scope: EventScope; onHost: () => void }) {
  const copy: Record<EventScope, { title: string; body: string }> = {
    upcoming: { title: 'Nothing coming up', body: 'When somebody hosts something, it shows here.' },
    attending: { title: 'Nothing in your diary', body: 'Events you say yes to appear here.' },
    mine: { title: 'You haven’t hosted one', body: 'A workshop, a class, a launch — it takes a minute to put up.' },
    past: { title: 'Nothing behind you yet', body: 'Events you went to end up here.' },
  };
  const { title, body } = copy[scope];
  return (
    <View style={styles.center}>
      <Text variant="title" tone="t2">{title}</Text>
      <Text variant="body" tone="t3" style={{ marginTop: 6, textAlign: 'center' }}>{body}</Text>
      {scope === 'mine' && (
        <>
          <View style={{ height: 18 }} />
          <Button title="Host an event" kind="primary" onPress={onHost} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingBottom: 8,
  },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  strip: { flexGrow: 0, flexShrink: 0 },
  chipRow: { paddingHorizontal: spacing.gutter, gap: 8, paddingBottom: 12 },
  chip: { paddingHorizontal: spacing.gutter, paddingVertical: 8, borderRadius: 999 },
  day: { paddingHorizontal: spacing.gutter, marginBottom: 8, marginTop: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyWrap: { flexGrow: 1 },
});
