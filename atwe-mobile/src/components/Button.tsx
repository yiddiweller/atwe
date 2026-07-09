import { Pressable, ActivityIndicator, StyleSheet, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { Text } from './Text';

type Kind = 'primary' | 'secondary' | 'danger';

interface Props {
  title: string;
  onPress: () => void;
  kind?: Kind;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

/**
 * The Atwe button system — "white acts, blue identifies":
 *   primary   → the single WHITE call-to-action per screen (label = onPrimary)
 *   secondary → grey-glass surface
 *   danger    → destructive red text on a tinted surface
 * A light haptic fires on press (iOS-native feel).
 */
export function Button({ title, onPress, kind = 'primary', loading, disabled, style }: Props) {
  const { c, radius } = useTheme();

  const bg =
    kind === 'primary' ? c.primary : kind === 'danger' ? 'rgba(244,33,46,0.12)' : c.s2;
  const fg = kind === 'primary' ? c.onPrimary : kind === 'danger' ? c.danger : c.text;

  const handle = () => {
    if (disabled || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onPress();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      onPress={handle}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: bg, borderRadius: radius.pill, opacity: disabled ? 0.5 : 1 },
        pressed && styles.pressed,
        style,
      ]}
      hitSlop={6}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text variant="headline" style={{ color: fg }}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 50,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { transform: [{ scale: 0.97 }], opacity: 0.92 },
});
