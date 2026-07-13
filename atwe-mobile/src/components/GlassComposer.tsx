import { TextInput, Pressable, StyleSheet, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * GlassComposer — the ChatGPT-style chat input, in Atwe's design. A floating
 * rounded **real Apple Liquid Glass** pill (expo-glass-effect) at the bottom of
 * the screen. When the field is focused (keyboard up) it rises above the keyboard
 * and **widens** a touch toward the nav-bar width; when it blurs it settles back
 * into the floating pill above the home indicator. Used everywhere there's a chat
 * (Atwe AI, Beam DMs).
 *
 * It's a normal flex child at the bottom of the screen's KeyboardAvoidingView, so
 * the keyboard lift is handled by the parent; this component owns the glass, the
 * widen-on-focus, and the bottom-gap animation. Degrades to a blur pill on iOS < 26.
 */
const REST_MARGIN = 20; // side margin at rest (the "floating pill")
const FOCUS_MARGIN = 10; // wider when typing (~nav-bar width)
const REST_GAP = 8; // gap above the home indicator
const FOCUS_GAP = 8; // gap above the keyboard

export function GlassComposer({
  value,
  onChangeText,
  onSend,
  placeholder = 'Message',
  sending,
  onPlus,
  autoFocus,
  editable = true,
}: {
  value: string;
  onChangeText: (t: string) => void;
  onSend: () => void;
  placeholder?: string;
  sending?: boolean;
  onPlus?: () => void;
  autoFocus?: boolean;
  editable?: boolean;
}) {
  const { c, name } = useTheme();
  const insets = useSafeAreaInsets();
  const focused = useSharedValue(0);
  const glass = isLiquidGlassAvailable();
  const canSend = editable && !!value.trim() && !sending;

  const padStyle = useAnimatedStyle(() => ({
    paddingBottom: interpolate(
      focused.value,
      [0, 1],
      [insets.bottom + REST_GAP, FOCUS_GAP],
      Extrapolation.CLAMP,
    ),
  }));
  const wrapStyle = useAnimatedStyle(() => ({
    marginHorizontal: interpolate(focused.value, [0, 1], [REST_MARGIN, FOCUS_MARGIN]),
  }));

  const inner = (
    <>
      {!!onPlus && (
        <Pressable onPress={onPlus} hitSlop={8} style={styles.plus} accessibilityLabel="Add attachment">
          <Ionicons name="add" size={26} color={c.t2} />
        </Pressable>
      )}
      <TextInput
        style={[styles.input, { color: c.text }]}
        placeholder={placeholder}
        placeholderTextColor={c.t3}
        value={value}
        onChangeText={onChangeText}
        editable={editable}
        onFocus={() => {
          focused.value = withTiming(1, { duration: 220 });
        }}
        onBlur={() => {
          focused.value = withTiming(0, { duration: 220 });
        }}
        multiline
        autoFocus={autoFocus}
        accessibilityLabel={placeholder}
      />
      <Pressable
        onPress={() => {
          if (!canSend) return;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          onSend();
        }}
        disabled={!canSend}
        style={[styles.send, { backgroundColor: canSend ? c.accent : c.s2 }]}
        accessibilityLabel="Send"
      >
        <Ionicons name="arrow-up" size={20} color={canSend ? '#fff' : c.t3} />
      </Pressable>
    </>
  );

  return (
    <Animated.View style={padStyle}>
      <Animated.View style={[styles.wrap, wrapStyle]}>
        {glass ? (
          <GlassView
            style={[styles.pill, { borderColor: c.border }]}
            glassEffectStyle="regular"
            colorScheme={name === 'light' ? 'light' : 'dark'}
          >
            {inner}
          </GlassView>
        ) : (
          <BlurView
            intensity={40}
            tint={name === 'light' ? 'light' : 'dark'}
            style={[styles.pill, styles.fallback, { borderColor: c.border, backgroundColor: c.s1 + 'cc' }]}
          >
            {inner}
          </BlurView>
        )}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 26 },
  pill: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    minHeight: 52,
    borderRadius: 26,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  fallback: {},
  plus: { width: 34, height: 38, alignItems: 'center', justifyContent: 'center' },
  input: {
    flex: 1,
    fontSize: 16,
    maxHeight: 120,
    paddingHorizontal: 6,
    paddingTop: Platform.OS === 'ios' ? 10 : 6,
    paddingBottom: Platform.OS === 'ios' ? 10 : 6,
  },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
});
