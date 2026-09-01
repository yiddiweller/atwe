import { useEffect, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  withDelay,
  cancelAnimation,
  interpolateColor,
  runOnJS,
  Easing,
} from 'react-native-reanimated';

/**
 * The opening reveal. The Atwe mark ROLLS on black while the app boots, then the
 * black lifts to the feed behind it.
 *
 * It used to fade in and "breathe", then ZOOM past the screen — and the founder
 * spotted it straight away as the old animation: the web's own splash spins the
 * mark (`splashSpin`, 2.4s, cubic-bezier(.7,0,.3,1), continuous) while it
 * pulses, and the welcome-on-login moment rolls it a full turn on that same
 * curve. Three places showing the brand, and one of them was doing something
 * else. They all roll now, on the same curve.
 *
 * The pulse is the web's `splashPulse` too, and it is a COLOUR sweep, not a
 * dim: the mark's fill runs from a resting dark grey up to full white at the
 * peak of each turn and back down, breathing very slightly (.94 → 1.06) as it
 * goes. It is what makes the mark look like it lights up as it rolls rather
 * than like a spinner. It works here because `logo-mark.png` is white on
 * transparent, so `tintColor` repaints it — the same trick the web's CSS mask
 * pulls with `background-color`.
 *
 * @param appReady  flips true once auth resolved AND the Home feed's first page
 *                  settled (or immediately, for signed-out → login).
 */
const MIN_MS = 700;   // show the mark at least this long, even if data is instant
const MAX_MS = 5000;  // safety: never hang on splash if a signal never arrives
/** The web's `splashSpin` curve, and the same one the welcome roll uses. */
const SPLASH_EASE = Easing.bezier(0.7, 0, 0.3, 1);
/** `.splash-mark` — 62px, and 2.4s a turn against a 2s pulse, so the two drift
    against each other instead of locking into one beat. */
const MARK = 62;
const SPIN_MS = 2400;
const PULSE_MS = 2000;
/** `@keyframes splashPulse` — resting grey at the ends, full white at the peak. */
const REST = '#303034';
const PEAK = '#ffffff';

export function AnimatedSplash({ appReady, onDone }: { appReady: boolean; onDone: () => void }) {
  const logoOpacity = useSharedValue(0);
  const scale = useSharedValue(0.82);
  const spin = useSharedValue(0);
  /** 0 at the resting grey, 1 at the white peak — drives colour, opacity and
      the breath together, so they can never fall out of step. */
  const pulse = useSharedValue(0);
  const container = useSharedValue(1);

  const [minPassed, setMinPassed] = useState(false);
  const [forced, setForced] = useState(false);
  const revealed = useRef(false);

  // The roll, and the pulse that rides on it. Both run until the reveal cancels.
  useEffect(() => {
    logoOpacity.value = withTiming(1, { duration: 460, easing: Easing.out(Easing.cubic) });
    scale.value = withTiming(1, { duration: 460, easing: Easing.out(Easing.cubic) });
    /* One full turn every 2.4s, forever, on the web's own splash curve — fast
       through the middle and easing at each end, which is what makes it read as
       a roll rather than a motor. */
    spin.value = withRepeat(
      withTiming(360, { duration: SPIN_MS, easing: SPLASH_EASE }),
      -1,
      false,
    );
    /* Grey → white → grey across each 2s, easing at both ends. A mark that only
       rotates at a constant rate looks like a loading spinner; this is what
       makes it the brand waiting rather than the app thinking. */
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: PULSE_MS / 2, easing: Easing.inOut(Easing.quad) }),
        withTiming(0, { duration: PULSE_MS / 2, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    const t1 = setTimeout(() => setMinPassed(true), MIN_MS);
    const t2 = setTimeout(() => setForced(true), MAX_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the app is ready (and the mark has shown its minimum), zoom-reveal.
  useEffect(() => {
    if (revealed.current) return;
    if (!((appReady && minPassed) || forced)) return;
    revealed.current = true;

    cancelAnimation(spin);
    cancelAnimation(pulse);
    /* Finish the turn it is in rather than stopping dead — a roll that halts
       mid-rotation reads as a hang, which is the last thing boot should look
       like. It carries on to the next whole turn and eases out of it. */
    const from = spin.value % 360;
    spin.value = from;
    spin.value = withTiming(360, { duration: 420, easing: Easing.out(Easing.cubic) });
    /* Leave on the white peak, never mid-grey — the last thing seen should be
       the mark at full strength. */
    pulse.value = withTiming(1, { duration: 200 });
    /* A small lift as the black goes, so it recedes INTO the app rather than
       being switched off. Nothing like the old 11x zoom past the screen. */
    scale.value = withTiming(1.08, { duration: 460, easing: Easing.in(Easing.quad) });
    logoOpacity.value = withDelay(180, withTiming(0, { duration: 340, easing: Easing.in(Easing.quad) }));
    // …while the black lifts to reveal the feed behind it.
    container.value = withDelay(
      120,
      withTiming(0, { duration: 460, easing: Easing.in(Easing.quad) }, (fin) => {
        if (fin) runOnJS(onDone)();
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appReady, minPassed, forced]);

  const containerStyle = useAnimatedStyle(() => ({ opacity: container.value }));
  const logoStyle = useAnimatedStyle(() => ({
    // .85 → 1 and .94 → 1.06, the keyframes' own numbers.
    opacity: logoOpacity.value * (0.85 + pulse.value * 0.15),
    tintColor: interpolateColor(pulse.value, [0, 1], [REST, PEAK]),
    transform: [
      { rotate: `${spin.value}deg` },
      { scale: scale.value * (0.94 + pulse.value * 0.12) },
    ],
  }));

  return (
    <Animated.View style={[styles.fill, containerStyle]} pointerEvents="none">
      <View style={styles.center}>
        <Animated.Image
          source={require('../../assets/logo-mark.png')}
          style={[styles.logo, logoStyle]}
          resizeMode="contain"
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000000', zIndex: 100 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logo: { width: MARK, height: MARK },
});
