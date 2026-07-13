import { View, Pressable, Image, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Text } from './Text';
import { useTheme } from '@/theme/ThemeProvider';
import { WORLDS } from '@/constants/worlds';

/**
 * Apple "Liquid Glass" tab bar — a FLOATING, rounded, frosted-glass pill that
 * hovers above the home indicator (like the iOS 26 App Store bar). The active
 * world sits in a highlighted accent chip; content scrolls through the glass.
 * Replaces the flat default bar.
 */
export function GlassTabBar({ state, navigation }: BottomTabBarProps) {
  const { c, name } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: Math.max(insets.bottom, 10) }]}
    >
      <BlurView
        tint={name === 'light' ? 'systemChromeMaterialLight' : 'systemChromeMaterialDark'}
        intensity={90}
        style={[styles.bar, { borderColor: c.border }]}
      >
        {state.routes.map((route, i) => {
          const world = WORLDS.find((w) => w.route === route.name);
          if (!world) return null;
          const focused = state.index === i;
          const color = focused ? c.accent : c.t3;

          const onPress = () => {
            Haptics.selectionAsync().catch(() => {});
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              style={styles.tab}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={world.label}
            >
              <View style={[styles.chip, focused && { backgroundColor: c.accentDim }]}>
                {world.image ? (
                  <Image
                    source={world.image}
                    style={{ width: 23, height: 23, tintColor: color }}
                    resizeMode="contain"
                  />
                ) : (
                  <Ionicons
                    name={focused ? world.iconActive : world.icon}
                    size={23}
                    color={color}
                  />
                )}
              </View>
              <Text style={[styles.label, { color }]}>{world.label}</Text>
            </Pressable>
          );
        })}
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 14,
    right: 14,
    alignItems: 'center',
  },
  bar: {
    flexDirection: 'row',
    width: '100%',
    borderRadius: 30,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 5,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 10, fontWeight: '600', marginTop: 3 },
});
