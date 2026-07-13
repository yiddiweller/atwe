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
  runOnJS,
  Easing,
} from 'react-native-reanimated';

/**
 * The opening reveal — X-style. A small centered Atwe mark fades in on pure black
 * and gently "breathes" while the app boots + the Home feed loads underneath.
 * The moment the app is ready, the mark ZOOMS IN (scales up fast) as the black
 * lifts, revealing the feed behind it — so boot feels like one smooth "zoom
 * straight into the posts," never a logo followed by a second blank home screen.
 *
 * @param appReady  flips true once auth resolved AND the Home feed's first page
 *                  settled (or immediately, for signed-out → login).
 */
const MIN_MS = 700;   // show the mark at least this long, even if data is instant
const MAX_MS = 5000;  // safety: never hang on splash if a signal never arrives

export function AnimatedSplash({ appReady, onDone }: { appReady: boolean; onDone: () => void }) {
  const logoOpacity = useSharedValue(0);
  const scale = useSharedValue(0.82);
  const container = useSharedValue(1);

  const [minPassed, setMinPassed] = useState(false);
  const [forced, setForced] = useState(false);
  const revealed = useRef(false);

  // Intro + breathing (runs until the reveal cancels it).
  useEffect(() => {
    logoOpacity.value = withTiming(1, { duration: 460, easing: Easing.out(Easing.cubic) });
    scale.value = withSequence(
      withTiming(1, { duration: 460, easing: Easing.out(Easing.cubic) }),
      withRepeat(
        withSequence(
          withTiming(1.05, { duration: 900, easing: Easing.inOut(Easing.quad) }),
          withTiming(1.0, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      ),
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

    cancelAnimation(scale);
    // Tiny settle to 1, then the fast X-style zoom-in.
    scale.value = withSequence(
      withTiming(1, { duration: 90, easing: Easing.out(Easing.quad) }),
      withTiming(11, { duration: 520, easing: Easing.in(Easing.cubic) }),
    );
    // The mark fades out as it grows past the screen…
    logoOpacity.value = withDelay(230, withTiming(0, { duration: 340, easing: Easing.in(Easing.quad) }));
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
    opacity: logoOpacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[styles.fill, containerStyle]} pointerEvents="none">
      <View style={styles.center}>
        <Animated.Image
          source={require('../../assets/splash.png')}
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
  logo: { width: 104, height: 104 },
});
