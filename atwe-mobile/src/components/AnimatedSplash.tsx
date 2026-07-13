import { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  withDelay,
  runOnJS,
  Easing,
} from 'react-native-reanimated';

/**
 * The opening logo reveal — a small, centered Atwe mark on pure black that fades
 * in, settles, and gently "breathes" (a calm ChatGPT-style pulse), then fades the
 * whole screen out to reveal the app. Continues seamlessly from the native splash
 * (same black bg + same logo), so boot feels like one smooth reveal.
 */
export function AnimatedSplash({ onDone }: { onDone: () => void }) {
  const logoOpacity = useSharedValue(0);
  const scale = useSharedValue(0.8);
  const container = useSharedValue(1);

  useEffect(() => {
    logoOpacity.value = withTiming(1, { duration: 480, easing: Easing.out(Easing.cubic) });
    scale.value = withSequence(
      withTiming(1, { duration: 480, easing: Easing.out(Easing.cubic) }),
      // gentle breathing pulse
      withRepeat(
        withSequence(
          withTiming(1.06, { duration: 820, easing: Easing.inOut(Easing.quad) }),
          withTiming(1.0, { duration: 820, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );
    // Hold, then fade the whole reveal out and finish.
    container.value = withDelay(
      1550,
      withTiming(0, { duration: 440, easing: Easing.in(Easing.cubic) }, (fin) => {
        if (fin) runOnJS(onDone)();
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
