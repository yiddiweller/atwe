import { Pressable, ActivityIndicator, StyleSheet, type ViewStyle } from 'react-native';
import { haptics } from '@/lib/haptics';
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
 *
 * THE BUTTON OWNS ITS OWN HAPTIC, and it fires as the finger goes DOWN — a real
 * button clicks on the way in, not when you let go, and the difference between
 * those two moments is most of what separates "mechanical" from "laggy".
 * A `danger` button warns instead of clicking: the hand should know before the
 * eye reads the label.
 *
 * Callers must NOT add one of their own. Two generators on one gesture merge
 * into a single long buzz — the module coalesces them, but the second call is
 * still a mistake and reads as one in the code.
 */
export function Button({ title, onPress, kind = 'primary', loading, disabled, style }: Props) {
  const { c, radius } = useTheme();

  const bg =
    kind === 'primary' ? c.primary : kind === 'danger' ? 'rgba(244,33,46,0.12)' : c.s2;
  const fg = kind === 'primary' ? c.onPrimary : kind === 'danger' ? c.danger : c.text;

  /* On the way IN, so it clicks under the finger rather than after it.

     Safe inside a scrolling list: iOS's ScrollView holds a touch back
     (`delaysContentTouches`, on by default and never overridden in this app)
     until it knows the finger is not scrolling, so dragging the feed past a
     button does not fire this. A control that must NOT do it this way is one
     you can start a scroll from directly — the like/repost pills on a post card
     tick on release for exactly that reason. */
  const feel = () => {
    if (disabled || loading) return;
    if (kind === 'danger') haptics.warning();
    else haptics.tap();
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      onPressIn={feel}
      onPress={() => { if (!disabled && !loading) onPress(); }}
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
