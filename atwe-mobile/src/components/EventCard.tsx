import { View, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { VerifiedBadge } from './VerifiedBadge';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { whenLabel, crowdLabel, ticketLabel, type AtweEvent } from '@/api/events';
import { mediaUri } from '@/lib/media';

/**
 * One event, as a card. What a person decides on is: when, where, who's hosting,
 * and whether there's room — so those are the four things above the fold, in
 * that order. The cover photo leads only when there is one; an event without a
 * picture should not get a grey rectangle where a picture would be.
 */
export function EventCard({ event }: { event: AtweEvent }) {
  const { c, radius } = useTheme();
  const router = useRouter();
  const h = event.host;
  const crowd = crowdLabel(event);
  const cover = mediaUri(event.cover);

  return (
    <Pressable
      onPress={() => router.push(`/event/${event.id}`)}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: c.s1, borderRadius: radius.card, borderColor: c.border },
        pressed && { opacity: 0.9 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${event.title}, ${whenLabel(event.startsAt)}`}
    >
      {!!cover && (
        <Image
          source={{ uri: cover }}
          style={[styles.cover, { backgroundColor: c.s2 }]}
          contentFit="cover"
          transition={120}
        />
      )}

      <View style={styles.body}>
        {/* When — the single most useful line, so it leads and it's accent-coloured */}
        <View style={styles.whenRow}>
          <Text variant="callout" weight="700" style={{ color: c.accent }}>
            {whenLabel(event.startsAt)}
          </Text>
          {event.cancelled && (
            <View style={[styles.pill, { backgroundColor: c.s2 }]}>
              <Text variant="micro" style={{ color: c.danger }}>Cancelled</Text>
            </View>
          )}
        </View>

        <Text variant="headline" numberOfLines={2} style={{ marginTop: 2 }}>
          {event.title}
        </Text>

        <View style={styles.factRow}>
          <Fact
            icon={event.online ? 'videocam-outline' : 'location-outline'}
            text={event.online ? 'Online' : (event.location || 'In person')}
          />
          {event.priceCents > 0 && <Fact icon="pricetag-outline" text={ticketLabel(event)} />}
        </View>

        {/* Host */}
        <View style={styles.host}>
          <Avatar name={h.name} avatar={h.avatar} biz={h.business} size={22} />
          <Text variant="caption" tone="t2" numberOfLines={1} style={{ flexShrink: 1 }}>
            {h.name}
          </Text>
          {h.verified && <VerifiedBadge size={12} />}
          {!!crowd && (
            <Text variant="micro" tone="t3" style={{ marginLeft: 'auto' }}>{crowd}</Text>
          )}
        </View>

        {/* Where you stand, when you stand somewhere */}
        {!!event.myRsvp && (
          <View style={[styles.pill, styles.mine, { backgroundColor: c.s2 }]}>
            <Text variant="micro" style={{
              color: event.myRsvp === 'going' ? c.success : c.t2,
            }}>
              {event.myRsvp === 'going' ? "You're going"
                : event.myRsvp === 'interested' ? 'Interested'
                : 'On the waiting list'}
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

function Fact({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }) {
  const { c } = useTheme();
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={13} color={c.t3} />
      <Text variant="caption" tone="t3" numberOfLines={1}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.gutter,
    marginBottom: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  cover: { width: '100%', aspectRatio: 2 },
  body: { padding: 12, gap: 6 },
  whenRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  factRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 2 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%' },
  host: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  pill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  mine: { alignSelf: 'flex-start', marginTop: 4 },
});
