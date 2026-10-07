import { View, FlatList, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { useTheme } from '@/theme/ThemeProvider';
import { useStoryTray, type StoryTrayEntry } from '@/api/stories';
import { useAuth } from '@/auth/AuthProvider';

/**
 * The stories tray — a horizontal row of rings across the top of Home, matching
 * the web `acRenderStoryTray`: an accent ring when there's something unseen, a
 * muted ring once seen. Tap a ring → the full-screen viewer (app/story/[userId]).
 *
 * YOU come first, always — with a + when you have nothing up, and your own ring
 * once you do. Without it the tray was watch-only: you could see everyone
 * else's story and had no way at all to add one. It is why the tray now renders
 * even when nobody you follow has posted; an empty row that lets you start is
 * more use than no row.
 */
export function StoriesTray() {
  const { c } = useTheme();
  const { user } = useAuth();
  const { data } = useStoryTray();
  const tray = data?.tray ?? [];
  // The server puts you in the tray only once you HAVE a story; the rest of the
  // time your slot is the add button, so it is rendered separately either way.
  const mine = tray.find((t) => t.mine);
  const others = tray.filter((t) => !t.mine);
  // Someone with no username cannot post at all (the route requires a handle),
  // so offering them the button would only produce an error.
  if (!others.length && !mine && !user?.username) return null;

  return (
    <View style={styles.wrap}>
      <FlatList
        data={others}
        keyExtractor={(t) => String(t.user.id)}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        ListHeaderComponent={<YourStory mine={mine} />}
        renderItem={({ item }) => <Ring entry={item} />}
      />
    </View>
  );
}

/** Your own slot: the ring when you have one up, a + when you do not. Tapping
 *  your ring watches it; the + adds. */
function YourStory({ mine }: { mine?: StoryTrayEntry }) {
  const { c } = useTheme();
  const router = useRouter();
  const { user } = useAuth();
  if (!user?.username) return null;
  const biz = user.accountType === 'business';

  return (
    <View style={styles.item}>
      <Pressable
        onPress={() => (mine ? router.push(`/story/${user.id}`) : router.push('/add-story'))}
        accessibilityRole="button"
        accessibilityLabel={mine ? 'Your story' : 'Add to your story'}
      >
        <View style={[styles.ring, {
          borderColor: mine?.hasUnseen ? c.accent : mine ? c.border : 'transparent',
          backgroundColor: c.bg,
          borderRadius: RING_R,
        }]}>
          <Avatar name={user.name} avatar={user.avatar} biz={biz} size={AVA} />
        </View>
        <Pressable
          onPress={() => router.push('/add-story')}
          hitSlop={8}
          style={[styles.plus, { backgroundColor: c.accent, borderColor: c.bg }]}
          accessibilityRole="button"
          accessibilityLabel="Add to your story"
        >
          <Ionicons name="add" size={15} color={c.accentTint} />
        </Pressable>
      </Pressable>
      <Text variant="micro" tone="t2" numberOfLines={1} style={styles.label}>You</Text>
    </View>
  );
}

/**
 * The ring takes the SHAPE of what it is ringing.
 *
 * A business avatar is an app-shaped rounded square — the one visual tell that
 * an account is a business, and it holds everywhere the avatar appears. Drawing
 * a circle around it put a box inside a circle, which the founder spotted at
 * once: the corners collide and it reads as a mistake rather than as a
 * deliberate shape. So the ring is a circle for a person and the same rounded
 * square for a business.
 *
 * The numbers are derived, not picked: the ring is the avatar plus its own gap
 * on each side, and its radius is the avatar's radius PLUS that gap — the same
 * concentric rule the web's card corners follow. Equal radii would leave the
 * gap 1.41× wider at the corner than along the sides.
 */
const AVA = 58;
const RING_GAP = 5;          // between the avatar and the ring, all the way round
const RING = AVA + RING_GAP * 2;

/** A circle for a person; the app shape, grown by the gap, for a business. */
/* The ring follows the avatar, and the avatar is a circle now for EVERYBODY —
   see Avatar. It used to bend around the business square, and took a `biz` flag
   to do it; the flag is gone because there is nothing left for it to decide. */
const RING_R = RING / 2;

function Ring({ entry }: { entry: StoryTrayEntry }) {
  const { c } = useTheme();
  const router = useRouter();
  const biz = entry.user.accountType === 'business';
  const ringColor = entry.hasUnseen ? c.accent : c.border;

  return (
    <Pressable
      style={styles.item}
      onPress={() => router.push(`/story/${entry.user.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${entry.mine ? 'Your' : entry.user.name + '’s'} story`}
    >
      <View style={[styles.ring, {
        borderColor: ringColor, backgroundColor: c.bg, borderRadius: RING_R,
      }]}>
        <Avatar name={entry.user.name} avatar={entry.user.avatar} biz={biz} size={AVA} />
      </View>
      <Text variant="micro" tone="t2" numberOfLines={1} style={styles.label}>
        {entry.mine ? 'You' : entry.user.name}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /* NO line under the Dailies. The web removed it at the founder's request —
     the gap and the post card's own fill are the separation now, the same
     reason the divider between posts went when the card arrived. */
  wrap: {},
  row: { paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  item: { alignItems: 'center', width: 72 },
  ring: {
    // Size and corner come from the avatar it holds — see ringRadius above.
    width: RING,
    height: RING,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { marginTop: 4, maxWidth: RING, textAlign: 'center' },
  plus: {
    position: 'absolute', right: 0, bottom: 0,
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
});
