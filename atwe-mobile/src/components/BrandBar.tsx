import { useEffect } from 'react';
import { View, Image, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withSequence, Easing,
} from 'react-native-reanimated';
import { Text } from './Text';
import { Avatar } from './Avatar';
import { useTheme } from '@/theme/ThemeProvider';
import { spacing } from '@/theme/tokens';
import { useAuth } from '@/auth/AuthProvider';
import { haptics } from '@/lib/haptics';

/* The web's own numbers, from `.topbar.tb-solo .tb-brandrow`:
     --tb-brand-h      22  the wordmark's height
     --tb-brand-icon   28  the swirl's height (width = 0.979 of it)
     --tb-brand-circle 36  the three right-hand circles
   The row's TOP padding subtracts half the circle-vs-logo difference so the
   LOGO's top inset still equals the side gutter even though the taller circles
   set the row height — otherwise the lockup sits low by 7px. */
const BRAND_H = 22;
const ICON = 28;
const CIRCLE = 36;
const TOP_PAD = spacing.gutter - (CIRCLE - BRAND_H) / 2;

/** The web's flourish curve, and its duration. */
const ROLL_EASE = Easing.bezier(0.16, 0.72, 0.24, 1);
const ROLL_MS = 580;

export type World = 'home' | 'beam' | 'engine' | 'ai';

/** What the word beside the mark says. Home shows the wordmark IMAGE; the other
 *  three say their own name, so each world reads as its own page. */
const WORD: Record<Exclude<World, 'home'>, string> = {
  beam: 'Beam',
  engine: 'Engine',
  ai: 'Atwe AI',
};

/**
 * The top of every world: the Atwe mark and the world's name on the left, and
 * ＋ · ⋯ · your photo on the right. Straight from the web, which the phone had
 * none of — no brand, no name, and no way to reach compose, settings or the
 * account menu from a world's own screen.
 *
 * Arriving at a world ROLLS the mark and spits the word out from under it, the
 * same flourish the web plays. It fires on ARRIVAL only, never on a re-render,
 * or it twitches every time the screen updates.
 */
export function BrandBar({ world, onPlus, onMore }: {
  world: World;
  /** Omitted where there is nothing to compose — Engine and the AI page. */
  onPlus?: () => void;
  onMore?: () => void;
}) {
  const { c } = useTheme();
  const router = useRouter();
  const { user } = useAuth();

  const spin = useSharedValue(0);
  const wordX = useSharedValue(0);
  const wordFade = useSharedValue(1);

  useEffect(() => {
    /* Keyed on the world, so it plays when you ARRIVE somewhere and not when
       the screen re-renders underneath you. */
    spin.value = 0;
    spin.value = withTiming(360, { duration: ROLL_MS, easing: ROLL_EASE });
    wordX.value = -14;
    wordFade.value = 0;
    wordX.value = withTiming(0, { duration: ROLL_MS, easing: ROLL_EASE });
    wordFade.value = withSequence(
      withTiming(1, { duration: ROLL_MS * 0.55, easing: ROLL_EASE }),
      withTiming(1, { duration: 0 }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);

  const markStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }] }));
  const wordStyle = useAnimatedStyle(() => ({
    opacity: wordFade.value,
    transform: [{ translateX: wordX.value }],
  }));

  return (
    <View style={styles.row}>
      <Pressable
        style={styles.lockup}
        onPress={() => { haptics.tap(); router.push('/'); }}
        accessibilityRole="button"
        accessibilityLabel={world === 'home' ? 'Atwe' : WORD[world]}
      >
        <Animated.Image
          source={require('../../assets/logo-mark-tight.png')}
          style={[styles.mark, { tintColor: c.text }, markStyle]}
          resizeMode="contain"
        />
        <Animated.View style={wordStyle}>
          {world === 'home' ? (
            <Image
              source={require('../../assets/logo-word-tight.png')}
              style={styles.word}
              resizeMode="contain"
              /* The wordmark is a masked shape like the swirl, so it takes the
                 theme's ink rather than shipping two coloured copies. */
              tintColor={c.text}
            />
          ) : (
            <Text style={[styles.wordTxt, { color: c.text }]}>{WORD[world]}</Text>
          )}
        </Animated.View>
      </Pressable>

      <View style={styles.actions}>
        {!!onPlus && (
          <Circle label="New" onPress={onPlus}>
            <Ionicons name="add" size={22} color={c.text} />
          </Circle>
        )}
        {!!onMore && (
          <Circle label="More" onPress={onMore}>
            <Ionicons name="ellipsis-horizontal" size={19} color={c.text} />
          </Circle>
        )}
        <Circle
          label="Your account"
          onPress={() => { haptics.tap(); router.push('/profile'); }}
          bare
        >
          <Avatar
            name={user?.name}
            avatar={user?.avatar}
            biz={user?.accountType === 'business'}
            size={CIRCLE}
          />
        </Circle>
      </View>
    </View>
  );
}

/** One of the three. They share the bottom nav's exact material — the same dark
 *  tinted fill and the same thin hairline — so the top and bottom of the screen
 *  read as one family. */
function Circle({ children, label, onPress, bare }: {
  children: React.ReactNode;
  label: string;
  onPress: () => void;
  /** The avatar brings its own fill; a second one behind it would ring it. */
  bare?: boolean;
}) {
  const { c, name } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.circle,
        !bare && {
          backgroundColor: name === 'light' ? 'rgba(255,255,255,0.82)' : 'rgba(18,18,21,0.90)',
          borderWidth: 1,
          borderColor: name === 'light' ? c.border : 'rgba(255,255,255,0.05)',
        },
        pressed && { opacity: 0.7 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: TOP_PAD, paddingHorizontal: spacing.gutter, paddingBottom: 12,
  },
  /* The gap is derived from the wordmark height, exactly as the web derives it
     (`--tb-brand-h * 0.48`) — a hardcoded 10 would be half a pixel out. */
  lockup: { flexDirection: 'row', alignItems: 'center', gap: BRAND_H * 0.48, flexShrink: 0 },
  mark: { height: ICON, width: ICON * 0.979 },
  word: { height: BRAND_H, width: BRAND_H * (3815 / 1178) },
  /* Sized so its cap-height reads as the image wordmark's height. */
  wordTxt: { fontSize: 28, fontWeight: '700', letterSpacing: -0.56, lineHeight: 30 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 0 },
  circle: {
    width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
});
