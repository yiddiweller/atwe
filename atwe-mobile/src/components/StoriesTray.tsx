import { View, FlatList, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { useTheme } from '@/theme/ThemeProvider';
import { useStoryTray, type StoryTrayEntry } from '@/api/stories';

/**
 * The stories tray — a horizontal row of rings across the top of Home, matching
 * the web `acRenderStoryTray`: an accent ring when there's something unseen, a
 * muted ring once seen. Tap a ring → the full-screen viewer (app/story/[userId]).
 * Renders nothing when no one you follow has an active story.
 */
export function StoriesTray() {
  const { c } = useTheme();
  const { data } = useStoryTray();
  const tray = data?.tray ?? [];
  if (!tray.length) return null;

  return (
    <View style={[styles.wrap, { borderBottomColor: c.border }]}>
      <FlatList
        data={tray}
        keyExtractor={(t) => String(t.user.id)}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        renderItem={({ item }) => <Ring entry={item} />}
      />
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
});
