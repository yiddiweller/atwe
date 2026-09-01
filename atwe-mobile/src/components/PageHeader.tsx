import { View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from './Text';
import { ChromeBar } from './Chrome';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Back arrow · title · one optional action. Every inside page in the app wants
 * exactly this, and it had been copy-pasted into a dozen screens with the same
 * three styles each time — which is how the arrow ends up 2px off on one of them.
 *
 * The right-hand slot keeps its width even when empty, so the title stays
 * genuinely centred rather than sliding whenever a screen has no action.
 *
 * It FLOATS over the page (see `Chrome.tsx`): the content beneath it starts
 * below the bar and then scrolls under it, showing through blurred. The screen
 * must therefore not inset for the notch itself (`<Screen edges={[]}>`) and its
 * scrolling surface must carry `chromePad.header`.
 */
export function PageHeader({ title, action, below }: {
  title: string;
  action?: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    onPress: () => void;
  };
  /** A row that belongs to the bar rather than to the page — a filter shelf or
   *  a search field. It rides INSIDE the glass, so the content still scrolls
   *  under the whole thing rather than stopping at a second solid strip. */
  below?: React.ReactNode;
}) {
  const { c } = useTheme();
  const router = useRouter();
  return (
    <ChromeBar>
      <View style={styles.head}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.icon} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={c.text} />
        </Pressable>
        <Text variant="headline" numberOfLines={1} style={styles.title}>{title}</Text>
        {action ? (
          <Pressable onPress={action.onPress} hitSlop={10} style={styles.icon}
            accessibilityRole="button" accessibilityLabel={action.label}>
            <Ionicons name={action.icon} size={26} color={c.text} />
          </Pressable>
        ) : <View style={styles.icon} />}
      </View>
      {below}
    </ChromeBar>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 8 },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center' },
});
