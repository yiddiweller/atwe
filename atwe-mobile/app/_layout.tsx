import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
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
import { WelcomeSplash } from '@/components/WelcomeSplash';
import { AppReadyProvider, useAppReady } from '@/lib/appReady';
import { ConnectionProvider } from '@/lib/connection';
import { OfflineBanner } from '@/components/OfflineBanner';
import { registerForPush } from '@/api/push';
import { routeForUrl } from '@/lib/deeplinks';
import { loadHapticPref } from '@/lib/haptics';
import * as Notifications from 'expo-notifications';
import * as Linking from 'expo-linking';

SplashScreen.preventAutoHideAsync().catch(() => {});

/* How the app should FEEL is read once, at launch, before anything on screen
   can be tapped — so somebody who turned haptics off never gets one buzz on
   the way in while the preference is still loading. */
void loadHapticPref();

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

/**
 * Everything that only makes sense once somebody is signed in: asking about
 * notifications, following a link that opened the app, and following a
 * notification that was tapped.
 */
function useSignedInEffects(signedIn: boolean) {
  const router = useRouter();
  // Ask about notifications AFTER sign-in, never on the very first launch —
  // a permission prompt before somebody knows what the app is gets refused.
  useEffect(() => {
    if (!signedIn) return;
    const t = setTimeout(() => { void registerForPush(); }, 2500);
    return () => clearTimeout(t);
  }, [signedIn]);

  // A tapped notification goes where it is about.
  useEffect(() => {
    if (!signedIn) return;
    const sub = Notifications.addNotificationResponseReceivedListener((res) => {
      const data = (res?.notification?.request?.content?.data ?? {}) as { url?: string; path?: string };
      const to = data.url ? routeForUrl(data.url) : (data.path ?? null);
      if (to) router.push(to as never);
    });
    return () => sub.remove();
  }, [signedIn, router]);

  // A link from outside — shared, or from the web — opens the right screen,
  // both when the app was already running and when the link launched it.
  useEffect(() => {
    if (!signedIn) return;
    const go = (url: string | null) => {
      if (!url) return;
      const to = routeForUrl(url);
      if (to) setTimeout(() => router.push(to as never), 200);
    };
    Linking.getInitialURL().then(go).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => go(e.url));
    return () => sub.remove();
  }, [signedIn, router]);
}

function RootNavigator() {
  const { loading, signedIn, welcome, clearWelcome } = useAuth();
  const { c, name } = useTheme();
  const { feedReady } = useAppReady();
  const [splashDone, setSplashDone] = useState(false);
  useNoFocusRingOnWeb();
  useProtectedRoute(signedIn, loading);
  useSignedInEffects(signedIn);

  // Hand off from the native splash to our animated one immediately on mount:
  // both are the same white logo on pure black, so the swap is invisible and the
  // animated mark takes over while auth + the feed bootstrap underneath.
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  /* The mark holds on black until the app is truly ready — auth resolved AND, for
     a signed-in user, the Home feed's first page has settled — then it zoom-reveals
     straight into the posts. Signed-out users reveal as soon as auth resolves.

     But `feedReady` is set by the HOME SCREEN, and Home does not always mount:
     open the app on a push notification about an order, or a shared listing
     link, and the router lands on that screen instead — so nothing ever says the
     feed is ready and the splash sits over the app for good. Caught by looking
     at the screens rather than by any test. So the wait is capped: after
     SPLASH_MAX_WAIT the reveal happens regardless. The normal launch is
     unchanged, because the feed settles long before that. */
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), SPLASH_MAX_WAIT);
    return () => clearTimeout(t);
  }, []);
  const appReady = !loading && (!signedIn || feedReady || waited);
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
          <Stack.Screen name="group/[id]" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="me/[section]" />
          <Stack.Screen name="settings/[page]" />
          <Stack.Screen name="feedback" />
          <Stack.Screen name="marketplace" />
          <Stack.Screen name="listing/[id]" />
          <Stack.Screen name="wallet" />
          <Stack.Screen name="wallet-send" options={{ presentation: 'modal' }} />
          <Stack.Screen name="wallet-topup" options={{ presentation: 'modal' }} />
          <Stack.Screen name="wallet-cashout" options={{ presentation: 'modal' }} />
          <Stack.Screen name="wallet-requests" />
          <Stack.Screen name="orders" />
          <Stack.Screen name="addresses" />
          <Stack.Screen name="cart" />
          <Stack.Screen name="sell" />
          <Stack.Screen name="sales" />
          <Stack.Screen name="appointments" />
          <Stack.Screen name="jobs" />
          <Stack.Screen name="job/[id]" />
          <Stack.Screen name="applicants/[id]" />
          <Stack.Screen name="post-job" options={{ presentation: 'modal' }} />
          <Stack.Screen name="workers" />
          <Stack.Screen name="events" />
          <Stack.Screen name="event/[id]" />
          <Stack.Screen name="new-event" options={{ presentation: 'modal' }} />
          <Stack.Screen name="services" />
          <Stack.Screen name="service/[id]" />
          <Stack.Screen name="offer-service" options={{ presentation: 'modal' }} />
          <Stack.Screen name="businesses" />
          <Stack.Screen name="showcase" />
          <Stack.Screen name="showcase/[id]" />
          <Stack.Screen name="newsletters" />
          <Stack.Screen name="newsletter/[id]" />
          <Stack.Screen name="newsletter/issue/[id]" />
          <Stack.Screen name="communities" />
          <Stack.Screen name="community/[id]" />
          <Stack.Screen name="courses" />
          <Stack.Screen name="course/[id]" />
          <Stack.Screen name="course/lesson/[id]" />
          <Stack.Screen name="ai-shop" />
          <Stack.Screen name="gift-cards" />
          <Stack.Screen name="invoices" />
          <Stack.Screen name="invoice/[id]" />
          <Stack.Screen name="quotes" />
          <Stack.Screen name="quote/[id]" />
          <Stack.Screen name="rewards" />
          <Stack.Screen name="referrals" />
          <Stack.Screen name="splits" />
          <Stack.Screen name="split/[id]" />
          <Stack.Screen name="pools" />
          <Stack.Screen name="pool/[id]" />
          <Stack.Screen name="scheduled-payments" />
          <Stack.Screen name="payment-links" />
          <Stack.Screen name="subscriptions" />
          <Stack.Screen name="store" />
          <Stack.Screen name="coupons" />
          <Stack.Screen name="bundles" />
          <Stack.Screen name="bundle/[id]" />
          <Stack.Screen name="offers" />
          <Stack.Screen name="offer/[id]" />
          <Stack.Screen name="business-analytics" />
          <Stack.Screen name="team" />
          <Stack.Screen name="auto-messages" />
          <Stack.Screen name="cart-recovery" />
          <Stack.Screen name="starred" />
          <Stack.Screen name="message-search" />
          <Stack.Screen name="broadcasts" />
          <Stack.Screen name="broadcast/[id]" />
          <Stack.Screen name="scheduled-messages" />
          <Stack.Screen name="chat-labels" />
          <Stack.Screen name="locked-chats" />
          <Stack.Screen name="lists" />
          <Stack.Screen name="list/[id]" />
          <Stack.Screen name="close-friends" />
          <Stack.Screen name="highlight/[id]" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
          <Stack.Screen name="reviews/[id]" />
          <Stack.Screen name="shop/[id]" />
          <Stack.Screen name="edit-profile" options={{ presentation: 'modal' }} />
          <Stack.Screen name="order/[id]" />
          <Stack.Screen name="search" />
          <Stack.Screen name="story/[userId]" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
          <Stack.Screen name="compose" options={{ presentation: 'modal' }} />
          <Stack.Screen name="add-story" options={{ presentation: 'modal' }} />
        </Stack>
      )}
      <OfflineBanner />
      {/* Never both at once: the boot splash owns the screen until it clears,
          and a sign-in that happens under it would otherwise play its welcome
          behind a black sheet and be missed entirely. */}
      {!showSplash && !!welcome && (
        <WelcomeSplash avatar={welcome.avatar} onDone={clearWelcome} />
      )}
      {showSplash && <AnimatedSplash appReady={appReady} onDone={() => setSplashDone(true)} />}
    </>
  );
}

/**
 * A text field must never draw a focus ring.
 *
 * That is the app's own law — a bright outline around a box reads as a bug —
 * and on a phone it holds for free: a React Native TextInput is a native field
 * with no outline to draw. On the WEB it does not, because react-native-web
 * renders it as a real `<input>` and the browser paints its own ring
 * (`outline-style: auto`, which is exactly what showed up as a yellow box in a
 * screenshot). The web build exists so the screens can be looked at during
 * development, so what it shows has to be what a phone shows.
 *
 * One stylesheet, injected once, on web only. Focus is still visible where it
 * should be — a real button keeps its ring; only text fields lose theirs.
 */
function useNoFocusRingOnWeb() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const id = 'atwe-no-input-ring';
    if (document.getElementById(id)) return;
    const el = document.createElement('style');
    el.id = id;
    el.textContent = 'input:focus,textarea:focus{outline:none!important;box-shadow:none!important;}';
    document.head.appendChild(el);
  }, []);
}

/** How long the opening mark may wait for the feed before revealing anyway.
 *  Long enough that a normal launch always reveals on the feed settling, short
 *  enough that a deep link into another screen is not left staring at a logo. */
const SPLASH_MAX_WAIT = 2500;

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <AuthProvider>
              <ConnectionProvider>
                <AppReadyProvider>
                  <RootNavigator />
                </AppReadyProvider>
              </ConnectionProvider>
            </AuthProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
