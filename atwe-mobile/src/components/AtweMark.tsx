import { useEffect } from 'react';
import { Image, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing,
} from 'react-native-reanimated';

/**
 * The Atwe swirl, turning slowly — the same 75-second rotation the web's
 * `.auth-lm` has. Slow enough that it reads as alive rather than as something
 * loading, which is the whole point: a fast spinner on a sign-in screen says
 * "wait", and this says "here you are".
 *
 * Held still under reduced motion, where a permanently moving thing is exactly
 * what that setting is asking not to see.
 */
export function AtweMark({ size = 66, still }: { size?: number; still?: boolean }) {
  const spin = useSharedValue(0);
  useEffect(() => {
    if (still) return;
    spin.value = withRepeat(
      withTiming(360, { duration: 75000, easing: Easing.linear }),
      -1,
      false,
    );
  }, [spin, still]);
  const st = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value}deg` }] }));
  return (
    <Animated.View style={[{ width: size, height: size }, st]}>
      <Image
        source={require('../../assets/splash.png')}
        style={[StyleSheet.absoluteFill, { width: size, height: size }]}
        resizeMode="contain"
      />
    </Animated.View>
  );
}
