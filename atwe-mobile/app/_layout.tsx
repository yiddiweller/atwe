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
import { AppReadyProvider, useAppReady } from '@/lib/appReady';

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
  const { feedReady } = useAppReady();
  const [splashDone, setSplashDone] = useState(false);
  useProtectedRoute(signedIn, loading);

  // Hand off from the native splash to our animated one immediately on mount:
  // both are the same white logo on pure black, so the swap is invisible and the
  // animated mark takes over while auth + the feed bootstrap underneath.
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  // The mark holds on black until the app is truly ready — auth resolved AND, for
  // a signed-in user, the Home feed's first page has settled — then it zoom-reveals
  // straight into the posts. Signed-out users reveal to login as soon as auth resolves.
  const appReady = !loading && (!signedIn || feedReady);
  const showSplash = !splashDone;

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
          <Stack.Screen name="settings" />
          <Stack.Screen name="marketplace" />
          <Stack.Screen name="listing/[id]" />
          <Stack.Screen name="wallet" />
          <Stack.Screen name="wallet-send" options={{ presentation: 'modal' }} />
          <Stack.Screen name="story/[userId]" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
          <Stack.Screen name="compose" options={{ presentation: 'modal' }} />
        </Stack>
      )}
      {showSplash && <AnimatedSplash appReady={appReady} onDone={() => setSplashDone(true)} />}
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
              <AppReadyProvider>
                <RootNavigator />
              </AppReadyProvider>
            </AuthProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
