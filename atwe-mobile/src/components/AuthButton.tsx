import { Pressable, View, StyleSheet, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { haptics } from '@/lib/haptics';
import { Text } from './Text';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * The sign-in button, matched to the web's `.auth-btn` exactly: 56 tall, a 30
 * corner, an icon and a label centred together with an 11 gap, 16px at weight
 * 700.
 *
 * Two kinds, and the difference is the colour law, not decoration. The ONE
 * primary action per screen is a solid WHITE pill with a dark label
 * (`--primary` / `--on-primary`); everything beside it is grey glass — a
 * translucent fill with a half-pixel inset hairline, never an outline-only
 * button, which rule 3 forbids.
 */
export function AuthButton({ label, icon, primary, onPress, disabled, style }: {
  label: string;
  icon?: React.ReactNode;
  primary?: boolean;
  onPress: () => void;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const { c, name } = useTheme();
  // The grey-glass fill is a translucent WHITE on the dark theme and a
  // translucent BLACK on the light one — the same fill the web uses, read from
  // the theme rather than sniffed from a colour value.
  const glass = name === 'light' ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)';
  return (
    <Pressable
      // Down, not up — see Button. The sign-in screen is the first thing anyone
      // touches, so it is the first thing that has to feel like a real button.
      onPressIn={() => { if (!disabled) haptics.tap(); }}
      onPress={() => { if (!disabled) onPress(); }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.btn,
        primary
          ? { backgroundColor: c.primary }
          : { backgroundColor: glass,
              borderWidth: StyleSheet.hairlineWidth, borderColor: c.border },
        disabled && { opacity: 0.4 },
        pressed && !disabled && { opacity: 0.88 },
        style,
      ]}
    >
      {!!icon && <View style={styles.ic}>{icon}</View>}
      <Text style={[styles.label, { color: primary ? c.onPrimary : c.text }]}>{label}</Text>
    </Pressable>
  );
}

/** The @ / envelope / brand glyphs, at the web's 22px icon size. */
export function AuthIcon({ name, color }: {
  name: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
}) {
  return <Ionicons name={name} size={21} color={color} />;
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 11,
    width: '100%',
    height: 56,
    borderRadius: 30,
  },
  ic: { width: 22, alignItems: 'center' },
  label: { fontSize: 16, fontWeight: '700' },
});
