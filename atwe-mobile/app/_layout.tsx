import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { QueryClientProvider } from '@tanstack/react-query';

import { queryClient } from '@/lib/queryClient';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { AnimatedSplash } from '@/components/AnimatedSplash';

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
  const [splashDone, setSplashDone] = useState(false);
  useProtectedRoute(signedIn, loading);

  // Hand off from the native splash to our animated one immediately on mount:
  // both are the same white logo on pure black, so the swap is invisible and the
  // ChatGPT-style breathing reveal takes over while auth bootstraps underneath.
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  // The animated splash covers the screen until BOTH its reveal has finished and
  // auth has resolved — so the app is never seen half-rendered behind it.
  const showSplash = !splashDone || loading;

  return (
    <>
      <StatusBar style={name === 'light' ? 'dark' : 'light'} />
      {!loading && (
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
          <Stack.Screen name="user/[username]" />
          <Stack.Screen name="chat/[peer]" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="wallet" />
          <Stack.Screen name="wallet-send" options={{ presentation: 'modal' }} />
          <Stack.Screen name="story/[userId]" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
          <Stack.Screen name="compose" options={{ presentation: 'modal' }} />
        </Stack>
      )}
      {showSplash && <AnimatedSplash onDone={() => setSplashDone(true)} />}
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
