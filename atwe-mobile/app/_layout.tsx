import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { QueryClientProvider } from '@tanstack/react-query';

import { queryClient } from '@/lib/queryClient';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';

SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * Redirect based on auth state (official expo-router guard pattern): signed-out
 * users are pushed to the auth group; signed-in users out of it.
 */
function useProtectedRoute(signedIn: boolean, loading: boolean) {
  const segments = useSegments();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    const inAuth = segments[0] === '(auth)';
    if (!signedIn && !inAuth) router.replace('/(auth)/login');
    else if (signedIn && inAuth) router.replace('/(tabs)');
  }, [signedIn, loading, segments, router]);
}

function RootNavigator() {
  const { loading, signedIn } = useAuth();
  const { c, name } = useTheme();
  useProtectedRoute(signedIn, loading);

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync().catch(() => {});
  }, [loading]);

  if (loading) return null; // keep the native splash up during bootstrap

  return (
    <>
      <StatusBar style={name === 'light' ? 'dark' : 'light'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: c.bg },
          animation: 'slide_from_right', // native iOS push
          gestureEnabled: true, // edge-swipe back
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
        <Stack.Screen name="post/[id]" />
        <Stack.Screen name="compose" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <AuthProvider>
              <RootNavigator />
            </AuthProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
