import { Tabs } from 'expo-router';
import { GlassTabBar } from '@/components/GlassTabBar';
import { WORLDS } from '@/constants/worlds';

/**
 * The five-world native tab bar: Home · Beam · Engine · Atwe AI · Profile.
 * Rendered by the custom Apple Liquid-Glass floating pill (GlassTabBar) — a
 * frosted, rounded bar that hovers above the home indicator with an active
 * accent chip. Content scrolls through the glass.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <GlassTabBar {...props} />}
    >
      {WORLDS.map((w) => (
        <Tabs.Screen key={w.route} name={w.route} options={{ title: w.label }} />
      ))}
    </Tabs>
  );
}
