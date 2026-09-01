import { useState } from 'react';
import {
  View, ScrollView, Pressable, ActivityIndicator, Alert, Linking, StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Text';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { VerifiedBadge } from '@/components/VerifiedBadge';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import {
  useEvent, useAttendees, rsvp, unrsvp, cancelEvent, deleteEvent,
  whenLabel, ticketLabel, crowdLabel, type RsvpStatus,
} from '@/api/events';
import { mediaUri } from '@/lib/media';
import { haptics } from '@/lib/haptics';

/**
 * One event — `GET /api/events/:id`.
 *
 * The decision on this screen is "am I going", so everything above the fold
 * serves it: when, where, what it costs, whether there is still room. The RSVP
 * has three possible answers from the server and all three are handled: done, a
 * Stripe URL for a ticketed event, or a refusal because the seat cap filled.
 */
export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { c, radius, spacing: sp } = useTheme();
  const router = useRouter();
  const { data, isLoading, isError, refetch } = useEvent(id);
  const e = data?.event;
  const [busy, setBusy] = useState<RsvpStatus | null>(null);
  const [showList, setShowList] = useState(false);
  const attendees = useAttendees(id, showList);

  const answer = async (status: RsvpStatus) => {
    if (!e) return;
    // Tapping the answer you already gave takes it back, the way a toggle should.
    if (e.myRsvp === status) {
      setBusy(status);
      try { await unrsvp(e.id); haptics.select(); await refetch(); }
      catch (err) { haptics.error(); Alert.alert('Events', (err as Error).message); }
      finally { setBusy(null); }
      return;
    }
    setBusy(status);
    try {
      const r = await rsvp(e.id, status);
      /* A ticketed event with Stripe configured answers with a checkout URL —
         paying happens in the browser, because Apple's rules and Stripe's flow
         both live there. */
      if (r.url) { await Linking.openURL(r.url); return; }
      haptics.success();
      await refetch();
    } catch (err) {
      haptics.error();
      Alert.alert('Events', (err as Error).message);
    } finally { setBusy(null); }
  };

  const host = e?.host;
  const pay = e && e.priceCents > 0;
  const crowd = e ? crowdLabel(e) : '';

  const scrap = (what: 'cancel' | 'delete') => {
    if (!e) return;
    const cancelling = what === 'cancel';
    Alert.alert(
      cancelling ? 'Cancel this event' : 'Delete this event',
      cancelling
        ? 'Everybody who said they were going is told. The event stays visible, marked cancelled.'
        : 'This removes it for good.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: cancelling ? 'Cancel it' : 'Delete', style: 'destructive',
          onPress: async () => {
            haptics.warning();
            try {
              if (cancelling) { await cancelEvent(e.id); await refetch(); }
              else { await deleteEvent(e.id); router.back(); }
            } catch (err) { haptics.error(); Alert.alert('Events', (err as Error).message); }
          },
        },
      ],
    );
  };

  return (
    <Screen edges={['top']}>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.icon} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={c.text} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <View style={styles.icon} />
      </View>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={c.accent} /></View>
      ) : isError || !e ? (
        <View style={styles.center}>
          <Text variant="body" tone="t2">That event is no longer available.</Text>
          <View style={{ height: 14 }} />
          <Button title="Try again" kind="secondary" onPress={() => refetch()} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 48 }} showsVerticalScrollIndicator={false}>
          {!!mediaUri(e.cover) && (
            <Image
              source={{ uri: mediaUri(e.cover) }}
              style={[styles.cover, { backgroundColor: c.s2 }]}
              contentFit="cover"
              transition={120}
            />
          )}

          <View style={{ padding: sp.lg }}>
            <Text variant="callout" weight="700" style={{ color: c.accent }}>
              {whenLabel(e.startsAt)}
              {!!e.endsAt && ` – ${new Date(e.endsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`}
            </Text>
            <Text variant="display" weight="800" style={{ marginTop: 4 }}>{e.title}</Text>

            {e.cancelled && (
              <View style={[styles.banner, { backgroundColor: c.s1, borderRadius: radius.card }]}>
                <Ionicons name="close-circle" size={18} color={c.danger} />
                <Text variant="callout" style={{ color: c.danger, flex: 1 }}>
                  This event was cancelled.
                </Text>
              </View>
            )}

            {/* Who's hosting */}
            {!!host && (
              <Pressable
                onPress={() => host.username && router.push(`/user/${host.username}`)}
                style={[styles.host, { backgroundColor: c.s1, borderRadius: radius.card }]}
                accessibilityRole="button"
                accessibilityLabel={`View ${host.name}`}
              >
                <Avatar name={host.name} avatar={host.avatar} biz={host.business} size={40} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <View style={styles.nameLine}>
                    <Text variant="headline" numberOfLines={1}>{host.name}</Text>
                    {host.verified && <VerifiedBadge size={14} />}
                  </View>
                  <Text variant="caption" tone="t3">Host</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={c.t3} />
              </Pressable>
            )}

            <View style={styles.facts}>
              <Fact
                icon={e.online ? 'videocam-outline' : 'location-outline'}
                text={e.online ? (e.location || 'Online') : (e.location || 'In person')}
              />
              <Fact icon="pricetag-outline" text={ticketLabel(e)} strong={pay} />
              {!!crowd && <Fact icon="people-outline" text={crowd} />}
            </View>

            {!!e.description && (
              <Text variant="body" tone="t2" style={{ marginTop: 18, lineHeight: 23 }}>
                {e.description}
              </Text>
            )}

            {/* Are you going */}
            <View style={{ marginTop: 24, gap: 10 }}>
              {e.mine ? (
                <>
                  <Button
                    title={showList ? 'Hide who’s coming' : `Who’s coming${e.going ? ` (${e.going})` : ''}`}
                    kind="primary"
                    onPress={() => { haptics.tap(); setShowList((v) => !v); }}
                  />
                  {!e.cancelled && (
                    <Button title="Cancel this event" kind="secondary" onPress={() => scrap('cancel')} />
                  )}
                  <Button title="Delete" kind="danger" onPress={() => scrap('delete')} />
                </>
              ) : e.cancelled ? null : (
                <>
                  <Button
                    title={
                      e.myRsvp === 'going' ? 'You’re going'
                      : e.full ? 'Join the waiting list'
                      : pay && !e.myPaid ? `Get a ticket · ${ticketLabel(e)}`
                      : 'I’m going'
                    }
                    kind="primary"
                    loading={busy === 'going' || busy === 'waitlist'}
                    onPress={() => answer(e.full && e.myRsvp !== 'going' ? 'waitlist' : 'going')}
                  />
                  <Button
                    title={e.myRsvp === 'interested' ? 'Interested ✓' : 'Interested'}
                    kind="secondary"
                    loading={busy === 'interested'}
                    onPress={() => answer('interested')}
                  />
                  {!!host && (
                    <Button
                      title="Message the host"
                      kind="secondary"
                      onPress={() => router.push(`/chat/${host.id}`)}
                    />
                  )}
                </>
              )}
            </View>

            {/* Who's coming — the host's list */}
            {showList && (
              <View style={{ marginTop: 22 }}>
                {attendees.isLoading ? (
                  <ActivityIndicator color={c.accent} />
                ) : (
                  (attendees.data?.attendees ?? []).map((a) => (
                    <Pressable
                      key={a.id}
                      onPress={() => a.username && router.push(`/user/${a.username}`)}
                      style={styles.attendee}
                      accessibilityRole="button"
                      accessibilityLabel={a.name}
                    >
                      <Avatar name={a.name} avatar={a.avatar} size={38} />
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <View style={styles.nameLine}>
                          <Text variant="callout" weight="700" numberOfLines={1}>{a.name}</Text>
                          {a.verified && <VerifiedBadge size={13} />}
                        </View>
                        {!!a.headline && (
                          <Text variant="caption" tone="t3" numberOfLines={1}>{a.headline}</Text>
                        )}
                      </View>
                      <Text variant="micro" tone={a.status === 'going' ? undefined : 't3'}
                        style={a.status === 'going' ? { color: c.success } : undefined}>
                        {a.status === 'going' ? 'Going' : a.status === 'interested' ? 'Interested' : 'Waiting'}
                      </Text>
                    </Pressable>
                  ))
                )}
              </View>
            )}
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}

function Fact({ icon, text, strong }: {
  icon: React.ComponentProps<typeof Ionicons>['name']; text: string; strong?: boolean;
}) {
  const { c } = useTheme();
  return (
    <View style={styles.factRow}>
      <Ionicons name={icon} size={17} color={c.t3} />
      <Text variant={strong ? 'headline' : 'body'} tone={strong ? undefined : 't2'} style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 8 },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  cover: { width: '100%', aspectRatio: 2 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, marginTop: 14 },
  host: { flexDirection: 'row', alignItems: 'center', padding: 12, marginTop: 16 },
  nameLine: { flexDirection: 'row', alignItems: 'center' },
  facts: { marginTop: 18, gap: 10 },
  factRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  attendee: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
});
