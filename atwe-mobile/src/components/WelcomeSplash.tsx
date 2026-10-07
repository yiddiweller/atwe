import { useEffect } from 'react';
import { View, StyleSheet, Image, AccessibilityInfo, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withDelay,
  interpolate, runOnJS, Easing, useReducedMotion,
} from 'react-native-reanimated';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * The welcome-back moment on sign-in — the web's `#welcomeSplash`, beat for
 * beat, because the founder asked for "the same effect we have when someone
 * logs in" and the phone had none at all.
 *
 * The Atwe mark ROLLS in see-through on the boot splash's own fast-then-slow
 * curve, so arriving at your account has the same rhythm as opening the app,
 * then dims away as the member's own photo zooms up THROUGH it at full colour
 * and holds. Three deliberate choices, all the owner's:
 *
 *   · the mark stays see-through, the photo does not. The photo used to top out
 *     at .32 and read as washed out — it is the person, so it lands solid.
 *   · the mark gets DARKER as it advances rather than cutting: 0 → .28 → 0.
 *   · the photo keeps growing slightly through the hold, so the moment moves
 *     forward instead of freezing before the app appears.
 *
 * Each keyframe track is one eased progress value that the styles read stops
 * off, rather than a chain of `withSequence` legs — a chain applies the easing
 * to every leg separately, which is not what a CSS `animation` with one timing
 * function does, and the roll would visibly stutter at each stop.
 */
const LOGO_MS = 1500;
const AVA_MS = 1250;
/** The web's `splashSpin` curve. */
const ROLL_EASE = Easing.bezier(0.7, 0, 0.3, 1);
const AVA_EASE = Easing.bezier(0.22, 1, 0.36, 1);
/* The photo starts WHILE the mark is still turning and has begun to dim (the
   mark's own fade-out runs from 56% of 1.5s = 840ms), so the two cross over
   instead of one ending and the next starting. It used to begin at 1000ms,
   after the hand-off was already over, which read as two separate beats. */
const AVA_START = 820;
/** `--wb-out` — its OWN number, not `--t-slow`: this is a one-off cinematic
    moment, and 350ms clears the screen faster than the eye wants after a 2.3s
    build-up. It must stay under the 560ms teardown. */
const OUT_MS = 480;

export function WelcomeSplash({ avatar, onDone }: { avatar?: string | null; onDone: () => void }) {
  const { c } = useTheme();
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();

  const roll = useSharedValue(0);   // 0 → 1 across the mark's 1.5s
  const rise = useSharedValue(0);   // 0 → 1 across the photo's 1.25s
  const out = useSharedValue(0);    // 0 while held, 1 once clearing

  const hasAva = !!avatar;

  useEffect(() => {
    roll.value = withTiming(1, { duration: reduced ? 700 : LOGO_MS, easing: reduced ? Easing.linear : ROLL_EASE });
    if (hasAva) {
      rise.value = withDelay(AVA_START,
        withTiming(1, { duration: reduced ? 500 : AVA_MS, easing: reduced ? Easing.linear : AVA_EASE }));
    }
    /* 820 + 1250 = 2070ms for the photo to finish, then a short beat at full
       colour. Without a photo there is nothing to hold on, so it goes sooner. */
    const hold = hasAva ? 2350 : 1500;
    const t = setTimeout(() => {
      out.value = withTiming(1, { duration: OUT_MS, easing: Easing.bezier(0.4, 0, 0.6, 1) },
        (fin) => { if (fin) runOnJS(onDone)(); });
    }, hold);
    AccessibilityInfo.announceForAccessibility?.('Signed in');
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sheet = useAnimatedStyle(() => ({ opacity: 1 - out.value }));
  /* The whole stage eases forward as the splash clears, so it reads as moving
     INTO the app rather than the app being switched on behind a curtain. */
  const stage = useAnimatedStyle(() => ({
    transform: [{ scale: reduced ? 1 : 1 + out.value * 0.07 }],
  }));
  const logo = useAnimatedStyle(() => {
    const p = roll.value;
    return {
      opacity: interpolate(p, [0, 0.2, 0.56, 1], [0, 0.28, 0.28, 0]),
      transform: reduced ? [] : [
        { rotate: `${p * 360}deg` },
        { scale: interpolate(p, [0, 0.56, 1], [0.84, 1, 1.1]) },
      ],
    };
  });
  const ava = useAnimatedStyle(() => {
    const q = rise.value;
    return {
      opacity: interpolate(q, [0, 0.6, 1], [0, 1, 1]),
      transform: reduced ? [] : [{ scale: interpolate(q, [0, 0.6, 1], [0.7, 1, 1.05]) }],
    };
  });

  return (
    <Animated.View pointerEvents="none"
      style={[styles.fill, { width, height, backgroundColor: c.bg }, sheet]}>
      <Animated.View style={[styles.stage, stage]}>
        {/* `.wb-logo` — the mark tinted to the theme's own text colour, the
            same `background:var(--t1)` the web paints its mask with. */}
        <Animated.Image
          source={require('../../assets/logo-mark.png')}
          style={[styles.logo, { tintColor: c.text }, logo]}
          resizeMode="contain"
        />
        {hasAva && (
          <Animated.View style={[styles.ava, { borderColor: c.s1 }, ava]}>
            <Image source={{ uri: avatar! }} style={styles.avaImg} />
          </Animated.View>
        )}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', left: 0, top: 0, alignItems: 'center', justifyContent: 'center', zIndex: 99 },
  stage: { width: 150, height: 150, alignItems: 'center', justifyContent: 'center' },
  logo: { position: 'absolute', width: 76, height: 76 },
  ava: {
    position: 'absolute', width: 124, height: 124, borderRadius: 62,
    borderWidth: 1, overflow: 'hidden',
  },
  avaImg: { width: '100%', height: '100%' },
});
