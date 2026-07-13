import { Tabs } from 'expo-router';
import { NavMorphProvider } from '@/lib/navMorph';
import { GlassTabBar } from '@/components/GlassTabBar';

/**
 * The five-world tab bar. Rendered by a CUSTOM real-Apple-Liquid-Glass bar
 * (`GlassTabBar`, expo-glass-effect) instead of the system tab bar — because the
 * system bar can't be reshaped, and we need it to morph into a "+" ball on scroll
 * (the same effect as the web). Routing stays standard file-based expo-router Tabs;
 * GlassTabBar only draws the bar + the scroll-morph. NavMorphProvider carries the
 * scroll → morph signal from the Home feed to the bar.
 */
export default function TabsLayout() {
  return (
    <NavMorphProvider>
      <Tabs
        tabBar={(props) => <GlassTabBar {...props} />}
        screenOptions={{ headerShown: false }}
      >
        <Tabs.Screen name="index" />
        <Tabs.Screen name="beam" />
        <Tabs.Screen name="engine" />
        <Tabs.Screen name="ai" />
        <Tabs.Screen name="profile" />
      </Tabs>
    </NavMorphProvider>
  );
}
