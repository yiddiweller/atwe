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
    <View style={[styles.wrap, { borderBottomColor: c.border }]}>
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
        }]}>
          <Avatar name={user.name} avatar={user.avatar} biz={biz} size={58} />
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
      <View style={[styles.ring, { borderColor: ringColor, backgroundColor: c.bg }]}>
        <Avatar name={entry.user.name} avatar={entry.user.avatar} biz={biz} size={58} />
      </View>
      <Text variant="micro" tone="t2" numberOfLines={1} style={styles.label}>
        {entry.mine ? 'You' : entry.user.name}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { borderBottomWidth: StyleSheet.hairlineWidth },
  row: { paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  item: { alignItems: 'center', width: 72 },
  ring: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { marginTop: 4, maxWidth: 68, textAlign: 'center' },
  plus: {
    position: 'absolute', right: 0, bottom: 0,
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
});
