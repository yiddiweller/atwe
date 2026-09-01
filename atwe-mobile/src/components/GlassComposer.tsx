import { View, TextInput, Pressable, StyleSheet, Platform } from 'react-native';
import { useEffect } from 'react';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';
import { Text } from './Text';
import { HapticInput } from '@/components/HapticInput';
import { haptics } from '@/lib/haptics';

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
  attachment,
  onRemoveAttachment,
  recording,
  recordSeconds = 0,
  onStartRecord,
  onCancelRecord,
  onSendRecord,
}: {
  value: string;
  onChangeText: (t: string) => void;
  onSend: () => void;
  placeholder?: string;
  sending?: boolean;
  onPlus?: () => void;
  autoFocus?: boolean;
  editable?: boolean;
  /** A photo waiting to be sent, as a data URL. Shown above the input. */
  attachment?: string | null;
  onRemoveAttachment?: () => void;
  /** Voice notes. Passing `onStartRecord` is what turns the send button into a
   *  mic when there is nothing typed — a composer without it is unchanged. */
  recording?: boolean;
  recordSeconds?: number;
  onStartRecord?: () => void;
  onCancelRecord?: () => void;
  onSendRecord?: () => void;
}) {
  const { c, name } = useTheme();
  const insets = useSafeAreaInsets();
  const focused = useSharedValue(0);
  const glass = isLiquidGlassAvailable();
  // A photo with no caption IS a message — requiring text as well would mean you
  // could attach one and then not be allowed to send it.
  const canSend = editable && (!!value.trim() || !!attachment) && !sending;
  // Nothing to send and a recorder wired up: the round button is a microphone,
  // which is what a messaging composer does rather than showing a dead arrow.
  const micMode = !!onStartRecord && !canSend && editable && !sending;

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

  const recBar = (
    <View style={styles.recRow}>
      <Pressable onPress={onCancelRecord} hitSlop={8} style={styles.recX}
        accessibilityRole="button" accessibilityLabel="Cancel recording">
        <Ionicons name="trash-outline" size={20} color={c.danger} />
      </Pressable>
      <RecDot color={c.danger} />
      <Text style={[styles.recTime, { color: c.text }]}>{fmtSec(recordSeconds)}</Text>
      <Text style={[styles.recHint, { color: c.t3 }]} numberOfLines={1}>Recording…</Text>
      <Pressable
        onPress={onSendRecord}
        style={[styles.send, { backgroundColor: c.accent }]}
        accessibilityRole="button"
        accessibilityLabel="Send voice note"
      >
        <Ionicons name="arrow-up" size={20} color="#fff" />
      </Pressable>
    </View>
  );

  const inner = recording ? recBar : (
    <>
      {!!attachment && (
        <View style={styles.attachWrap}>
          <Image source={{ uri: attachment }} style={styles.attachImg} contentFit="cover" />
          {!!onRemoveAttachment && (
            <Pressable onPress={onRemoveAttachment} hitSlop={8}
              style={[styles.attachX, { backgroundColor: c.bg }]}
              accessibilityRole="button" accessibilityLabel="Remove photo">
              <Ionicons name="close" size={14} color={c.text} />
            </Pressable>
          )}
        </View>
      )}
      {!!onPlus && (
        <Pressable onPress={onPlus} hitSlop={8} style={styles.plus} accessibilityLabel="Add attachment">
          <Ionicons name="add" size={26} color={c.t2} />
        </Pressable>
      )}
      <HapticInput
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
          if (micMode) {
            haptics.press();
            onStartRecord?.();
            return;
          }
          if (!canSend) return;
          haptics.tap();
          onSend();
        }}
        disabled={!canSend && !micMode}
        style={[styles.send, { backgroundColor: canSend ? c.accent : c.s2 }]}
        accessibilityRole="button"
        accessibilityLabel={micMode ? 'Record a voice note' : 'Send'}
      >
        <Ionicons
          name={micMode ? 'mic' : 'arrow-up'}
          size={20}
          color={canSend ? '#fff' : micMode ? c.t2 : c.t3}
        />
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

/* A red dot that breathes while recording — the one thing that says "this is
   live" without a word, and the same cue the phone's own recorder uses. */
function RecDot({ color }: { color: string }) {
  const v = useSharedValue(1);
  useEffect(() => {
    v.value = withRepeat(withTiming(0.25, { duration: 700 }), -1, true);
  }, [v]);
  const st = useAnimatedStyle(() => ({ opacity: v.value }));
  return <Animated.View style={[styles.recDot, { backgroundColor: color }, st]} />;
}

function fmtSec(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  wrap: { borderRadius: 26 },
  recRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 2 },
  recX: { width: 34, height: 38, alignItems: 'center', justifyContent: 'center' },
  recDot: { width: 9, height: 9, borderRadius: 5 },
  recTime: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'], minWidth: 42 },
  recHint: { flex: 1, fontSize: 14 },
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
  attachWrap: { position: 'relative', marginRight: 8 },
  attachImg: { width: 40, height: 40, borderRadius: 10 },
  attachX: {
    position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
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
