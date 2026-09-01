import { View, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from './Text';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Back arrow · title · one optional action. Every inside page in the app wants
 * exactly this, and it had been copy-pasted into a dozen screens with the same
 * three styles each time — which is how the arrow ends up 2px off on one of them.
 *
 * The right-hand slot keeps its width even when empty, so the title stays
 * genuinely centred rather than sliding whenever a screen has no action.
 */
export function PageHeader({ title, action }: {
  title: string;
  action?: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    onPress: () => void;
  };
}) {
  const { c } = useTheme();
  const router = useRouter();
  return (
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
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 8 },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center' },
});
