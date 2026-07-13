import { useEffect } from 'react';
import { View, Pressable, Image, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useTheme } from '@/theme/ThemeProvider';
import { useNavMorph } from '@/lib/navMorph';

/**
 * The five-world tab bar — a custom REAL Apple Liquid Glass bar (expo-glass-effect)
 * so it can morph: on the Home feed, scrolling down shrinks it to the right into a
 * white "+" ball (compose); scrolling up morphs it back to the full bar. Driven by
 * the `navMorph` shared value the Home screen updates on scroll. Degrades to a blur
 * bar on iOS < 26. Routing is standard expo-router Tabs (this only draws the bar).
 */
const GUTTER = 14;
const BAR_H = 56;
const BALL = 56;

const IMG: Record<string, ReturnType<typeof require>> = {
  index: require('../../assets/nav/home.png'),
  beam: require('../../assets/nav/beam.png'),
  engine: require('../../assets/nav/engine.png'),
  ai: require('../../assets/nav/ai.png'),
};

export function GlassTabBar({ state, navigation }: BottomTabBarProps) {
  const { c, name } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const morph = useNavMorph();
  const collapsed = morph?.collapsed;
  const isBall = morph?.ball ?? false;
  const glass = isLiquidGlassAvailable();
  const light = name === 'light';
  const fullW = width - GUTTER * 2;

  // Always show the full bar when we're not on Home (index).
  const focusedName = state.routes[state.index]?.name;
  useEffect(() => {
    if (focusedName !== 'index') {
      if (collapsed) collapsed.value = withTiming(0, { duration: 240 });
      morph?.setBall(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedName]);

  const shellStyle = useAnimatedStyle(() => ({
    width: interpolate(collapsed ? collapsed.value : 0, [0, 1], [fullW, BALL], Extrapolation.CLAMP),
  }));
  const rowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(collapsed ? collapsed.value : 0, [0, 0.4], [1, 0], Extrapolation.CLAMP),
  }));
  const whiteStyle = useAnimatedStyle(() => ({
    opacity: interpolate(collapsed ? collapsed.value : 0, [0.35, 1], [0, 0.92], Extrapolation.CLAMP),
  }));
  const plusStyle = useAnimatedStyle(() => ({
    opacity: interpolate(collapsed ? collapsed.value : 0, [0.6, 1], [0, 1], Extrapolation.CLAMP),
  }));

  const activeBg = light ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.14)';

  return (
    <View
      style={[styles.outer, { paddingBottom: Math.max(insets.bottom, 10), paddingHorizontal: GUTTER }]}
      pointerEvents="box-none"
    >
      <Animated.View style={[styles.shell, shellStyle]}>
        {/* Real glass background (blur fallback on iOS < 26) */}
        {glass ? (
          <GlassView
            style={StyleSheet.absoluteFill}
            glassEffectStyle="regular"
            colorScheme={light ? 'light' : 'dark'}
          />
        ) : (
          <BlurView
            intensity={40}
            tint={light ? 'light' : 'dark'}
            style={[StyleSheet.absoluteFill, { backgroundColor: c.s1 + 'cc' }]}
          />
        )}
        {/* White fill that fades in as it becomes the ball */}
        <Animated.View style={[StyleSheet.absoluteFill, styles.white, whiteStyle]} pointerEvents="none" />

        {/* The five tabs (fixed width so they don't squish; clipped as the shell shrinks) */}
        <Animated.View style={[styles.row, { width: fullW }, rowStyle]} pointerEvents={isBall ? 'none' : 'auto'}>
          {state.routes.map((route, i) => {
            const focused = state.index === i;
            const onPress = () => {
              Haptics.selectionAsync().catch(() => {});
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            };
            return (
              <Pressable
                key={route.key}
                onPress={onPress}
                style={styles.tab}
                accessibilityRole="button"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={route.name}
              >
                <View style={[styles.pill, focused && { backgroundColor: activeBg }]}>
                  {route.name === 'profile' ? (
                    <Ionicons name="person" size={22} color={c.text} />
                  ) : (
                    <Image source={IMG[route.name]} resizeMode="contain" style={[styles.icon, { tintColor: c.text }]} />
                  )}
                </View>
              </Pressable>
            );
          })}
        </Animated.View>

        {/* The "+" compose ball (revealed when collapsed) */}
        <Animated.View style={[StyleSheet.absoluteFill, styles.plusWrap, plusStyle]} pointerEvents={isBall ? 'auto' : 'none'}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              router.push('/compose');
            }}
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel="New post"
          >
            <View style={styles.plusInner}>
              <Ionicons name="add" size={28} color="#111" />
            </View>
          </Pressable>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'flex-end' },
  shell: {
    height: BAR_H,
    borderRadius: BAR_H / 2,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
  },
  white: { backgroundColor: '#fff', borderRadius: BAR_H / 2 },
  row: { flexDirection: 'row', alignItems: 'center', height: BAR_H, paddingHorizontal: 4 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pill: { width: 46, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  icon: { width: 21, height: 21 },
  plusWrap: { alignItems: 'center', justifyContent: 'center' },
  plusInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
