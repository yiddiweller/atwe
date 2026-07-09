import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './Text';
import { Screen } from './Screen';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Branded placeholder for a world that will be built out in a later phase.
 * Honest about status while staying on-brand (accent disc, Atwe type).
 */
export function WorldPlaceholder({
  title,
  subtitle,
  icon,
  phase,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  phase: string;
}) {
  const { c, radius, spacing } = useTheme();
  return (
    <Screen>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
        <View
          style={{
            width: 84,
            height: 84,
            borderRadius: radius.xl,
            backgroundColor: c.accentDim,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: spacing.lg,
          }}
        >
          <Ionicons name={icon} size={38} color={c.accent} />
        </View>
        <Text variant="title">{title}</Text>
        <Text variant="body" tone="t2" style={{ textAlign: 'center', marginTop: 8, maxWidth: 300 }}>
          {subtitle}
        </Text>
        <View
          style={{
            marginTop: spacing.lg,
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderRadius: radius.pill,
            backgroundColor: c.s2,
          }}
        >
          <Text variant="micro" tone="t3">
            {phase}
          </Text>
        </View>
      </View>
    </Screen>
  );
}
