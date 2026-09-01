import { View, Modal, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from './Text';
import { useTheme } from '@/theme/ThemeProvider';
import { haptics } from '@/lib/haptics';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const TOOLS: { icon: IconName; label: string; sub: string; to: string }[] = [
  { icon: 'search-outline', label: 'Search messages', sub: 'Find something that was said', to: '/message-search' },
  { icon: 'star-outline', label: 'Starred', sub: 'Messages you kept', to: '/starred' },
  { icon: 'time-outline', label: 'Scheduled', sub: 'Waiting to be sent', to: '/scheduled-messages' },
  { icon: 'megaphone-outline', label: 'Broadcast lists', sub: 'One message, many private chats', to: '/broadcasts' },
  { icon: 'bookmarks-outline', label: 'Labels', sub: 'Folders for your conversations', to: '/chat-labels' },
  { icon: 'lock-closed-outline', label: 'Locked chats', sub: 'Hidden behind a passcode', to: '/locked-chats' },
];

/**
 * Everything Beam can do that is not "open a conversation". Six destinations is
 * too many for a header, and each is used rarely — a menu is where rarely-used
 * things belong, rather than a row of icons nobody can tell apart.
 */
export function BeamToolsMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { c, radius } = useTheme();
  const router = useRouter();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, {
        backgroundColor: c.s1, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
      }]}>
        <View style={[styles.grab, { backgroundColor: c.t4 }]} />
        <ScrollView bounces={false}>
          {TOOLS.map((t) => (
            <Pressable
              key={t.to}
              onPress={() => { haptics.tap(); onClose(); router.push(t.to); }}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.s2 }]}
              accessibilityRole="button"
              accessibilityLabel={t.label}
            >
              <Ionicons name={t.icon} size={20} color={c.t2} />
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text variant="body">{t.label}</Text>
                <Text variant="micro" tone="t3" style={{ marginTop: 2 }}>{t.sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={17} color={c.t4} />
            </Pressable>
          ))}
          <Pressable
            onPress={() => { haptics.tap(); onClose(); }}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.s2 }]}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Ionicons name="close-outline" size={20} color={c.t2} />
            <Text variant="body" style={{ flex: 1, marginLeft: 14 }}>Cancel</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    maxHeight: '76%', paddingBottom: 34, paddingTop: 8,
  },
  grab: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, opacity: 0.6, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 15, minHeight: 55 },
});
