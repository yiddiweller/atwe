import { Stack } from 'expo-router';
import { useTheme } from '@/theme/ThemeProvider';

export default function AuthLayout() {
  const { c } = useTheme();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
      <Stack.Screen name="login" />
    </Stack>
  );
}
