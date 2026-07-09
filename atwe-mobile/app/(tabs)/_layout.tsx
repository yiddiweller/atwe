import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useTheme } from '@/theme/ThemeProvider';
import { WORLDS } from '@/constants/worlds';

/**
 * The five-world native tab bar: Home · Beam · Engine · Atwe AI · Profile.
 * Active tint = accent (identity blue). A translucent blur material sits behind
 * the bar on iOS (Liquid-Glass style); a light selection haptic fires on tap.
 */
export default function TabsLayout() {
  const { c, name } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.t3,
        tabBarStyle: {
          position: 'absolute',
          borderTopColor: c.border,
          backgroundColor: Platform.OS === 'ios' ? 'transparent' : c.bg,
        },
        tabBarBackground: () =>
          Platform.OS === 'ios' ? (
            <BlurView
              tint={name === 'light' ? 'light' : 'dark'}
              intensity={80}
              style={{ flex: 1 }}
            />
          ) : null,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
      }}
      screenListeners={{
        tabPress: () => {
          Haptics.selectionAsync().catch(() => {});
        },
      }}
    >
      {WORLDS.map((w) => (
        <Tabs.Screen
          key={w.route}
          name={w.route}
          options={{
            title: w.label,
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons name={focused ? w.iconActive : w.icon} size={size} color={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
