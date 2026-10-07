import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ForceTheme } from '@/theme/ThemeProvider';
import { black } from '@/theme/tokens';

/**
 * Signing in is a black brand moment in every theme — the same call the web
 * makes ("First-run auth is a black brand moment in EVERY theme, like the app
 * icon"). It is not a preference: the Atwe mark is white, so on Light it was
 * simply invisible on the landing, and the gate should read like the app icon
 * rather than like a settings page. The account's real theme takes over the
 * moment they are through.
 */
export default function AuthLayout() {
  return (
    <ForceTheme name="black">
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: black.bg } }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="signup" />
      </Stack>
    </ForceTheme>
  );
}
