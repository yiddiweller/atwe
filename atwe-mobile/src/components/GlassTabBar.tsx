import { useEffect } from 'react';
import { View, Pressable, Image, StyleSheet, useWindowDimensions, type ImageSourcePropType } from 'react-native';
import Animated, {
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useNotifCount } from '@/api/notifications';
import { GlassView, GlassContainer, isLiquidGlassAvailable } from 'expo-glass-effect';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useTheme } from '@/theme/ThemeProvider';
import { useNavMorph } from '@/lib/navMorph';
import { haptics } from '@/lib/haptics';

/**
 * The five-world tab bar — a custom REAL Apple Liquid Glass bar (expo-glass-effect)
 * so it can morph: on the Home feed, scrolling down shrinks it to the right into a
 * white "+" ball (compose); scrolling up morphs it back to the full bar. Driven by
 * the `navMorph` shared value the Home screen updates on scroll. Degrades to a blur
 * bar on iOS < 26. Routing is standard expo-router Tabs (this only draws the bar).
 */
/* Every number here is the web's, because "look exactly like the Web app style"
   is the brief. From public/index.html:
     .bottom-nav  left/right/bottom: var(--nav-inset) = 23,  padding: 4,  radius: 999
     .bn-tab      height: 50            → shell height = 50 + 4 + 4 = 58
     --nv-size    34px                  → the icon, not the 26 this was drawing
   The bar was inset 14 (the CONTENT gutter), which is the one thing the web is
   explicit should NOT match: the bar sits deliberately INSIDE the cards. */
/* THE BAR'S INSET IS THE FOUNDER'S CALL, NOT THE WEB'S.

   The web uses --nav-inset 23 against a 14 content gutter, i.e. the bar sits 9px
   inside the cards on each side — deliberately, so the two lines read as a
   decision rather than a near-miss. Matching that exactly made the bar visibly
   NARROWER than the one they had been using, and they said so: "it looks a
   little narrow now".

   So the principle is kept and the amount is theirs: the bar is still inside the
   cards, by 4 rather than 9. On a 390pt phone that is a 354pt bar against 344 at
   the web's value and 362 if it simply matched the cards.

   This is the one number in the file that is NOT the web's, which is why it says
   so here rather than quietly reading a token. */
const CARD_GUTTER = 14;          // spacing.gutter — where the post cards start
const INSIDE_BY = 4;             // how far inside them the bar sits
const GUTTER = CARD_GUTTER + INSIDE_BY;   // 18
const TAB_H = 50;
const PAD = 4;
const BAR_H = TAB_H + PAD * 2;   // 58
const BALL = BAR_H;
const ICON = 34;

/* THE MATERIAL, and its history, because it has been wrong three times in three
   different ways and each fix caused the next.

   1. Real Liquid Glass with NO tint. Untinted glass takes its colour from
      whatever is behind it, so scrolling an orange photo under the bar turned
      the bar orange and muddy. The founder photographed it.
   2. So it was tinted hard — .72 dark / .66 light. That killed the bleed and
      also killed the glass: what came through was our own paint, and it read as
      "our design, but not Apple's".
   3. Backed off to .28 / .30. Still too much: the founder's verdict on the
      shipped build was "still far from good, it doesn't look like the real
      Apple liquid glass", beside a screenshot of Apple's own Phone tab bar —
      which you can plainly SEE the call list through.

   So the tint is now a whisper (.10), and the colour-bleed problem it was
   fighting is handled by the thing designed for it instead: `regular` Liquid
   Glass is Apple's ADAPTIVE material — it already reads what is behind it and
   holds its own contrast, which is why Apple's bars do not go orange over a
   photo. The heavy tint was solving a problem the material solves better.

   THE DRAWN BORDER IS GONE from the glass path. Liquid Glass renders its own
   specular rim; a 1px line painted on top of it turns the whole thing into an
   outlined pill, which is the single most "not glass" thing a glass surface can
   do. The fallback keeps its hairline, because a blur has no rim of its own. */
const GLASS_TINT_DARK = 'rgba(18,18,21,0.10)';
const GLASS_TINT_LIGHT = 'rgba(255,255,255,0.12)';
/* The iOS < 26 fallback is NOT Liquid Glass and never will be — it is what
   every iPhone below 26 sees, so it has to be good on its own terms.

   It used to be a hand-rolled blur (intensity 12) under a near-opaque
   rgba(18,18,21,.90) fill, which is a solid dark pill with extra steps: nothing
   showed through it at all. It now uses `systemChromeMaterial`, which is the
   exact material UIKit gives a real tab bar — translucent, adaptive, and
   already correct over a photo. No overlay on top of it: the material IS the
   look, and painting over it is what made the old one opaque. */
const FALLBACK_TINT_DARK = 'systemChromeMaterialDark' as const;
const FALLBACK_TINT_LIGHT = 'systemChromeMaterialLight' as const;
const HAIRLINE = 'rgba(255,255,255,0.05)';

// `require` on an image returns a number at runtime under Metro, but its type
// is unknown — which the Image source prop rightly refuses. Typed explicitly so
// a build does not fail on what is really a bundler detail.
// OUTLINE when the world is not the one you are in, SOLID when it is — the founder's
// own artwork, the same masks the web bar uses, at the three phone densities. Never
// hand-redraw these: they come out of tools/nav-icons/build.js.
const IMG: Record<string, { off: ImageSourcePropType; on: ImageSourcePropType }> = {
  index:         { off: require('../../assets/nav/home-off.png'),    on: require('../../assets/nav/home-on.png') },
  beam:          { off: require('../../assets/nav/beam-off.png'),    on: require('../../assets/nav/beam-on.png') },
  engine:        { off: require('../../assets/nav/engine-off.png'),  on: require('../../assets/nav/engine-on.png') },
  notifications: { off: require('../../assets/nav/notifs-off.png'),  on: require('../../assets/nav/notifs-on.png') },
  profile:       { off: require('../../assets/nav/profile-off.png'), on: require('../../assets/nav/profile-on.png') },
};
// The five worlds, in order. Anything else in the (tabs) group — Atwe AI, which left
// the bar — is simply not drawn, whatever the navigator reports, so a hidden route can
// never leak a seat back into the bar.
const TABS = ['index', 'beam', 'engine', 'notifications', 'profile'] as const;
// A route name is not a label a person would recognise ("index").
const LABEL: Record<string, string> = {
  index: 'Home', beam: 'Beam', engine: 'Engine', notifications: 'Notifications', profile: 'Account',
};

export function GlassTabBar({ state, navigation }: BottomTabBarProps) {
  const { c, name } = useTheme();
  // The unread dot moved off the Home header's bell and onto the Notifications tab —
  // the bell WAS the way in before there was a tab for it, and keeping both would have
  // put the same thing on screen twice.
  const { data: notifCount } = useNotifCount();
  const unread = notifCount?.unread ?? 0;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const morph = useNavMorph();
  const collapsed = morph?.collapsed;
  const isBall = morph?.ball ?? false;
  const glass = isLiquidGlassAvailable();
  const light = name === 'light';
  const fullW = width - GUTTER * 2;

  // Always show the full bar when we're not on Home (index).
  const focusedName = state.routes[state.index]?.name;
  useEffect(() => {
    if (focusedName !== 'index') {
      if (collapsed) collapsed.value = withTiming(0, { duration: 240 });
      morph?.setBall(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedName]);

  const shellStyle = useAnimatedStyle(() => ({
    width: interpolate(collapsed ? collapsed.value : 0, [0, 1], [fullW, BALL], Extrapolation.CLAMP),
  }));
  const rowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(collapsed ? collapsed.value : 0, [0, 0.4], [1, 0], Extrapolation.CLAMP),
  }));
  const whiteStyle = useAnimatedStyle(() => ({
    opacity: interpolate(collapsed ? collapsed.value : 0, [0.35, 1], [0, 0.92], Extrapolation.CLAMP),
  }));
  const plusStyle = useAnimatedStyle(() => ({
    opacity: interpolate(collapsed ? collapsed.value : 0, [0.6, 1], [0, 1], Extrapolation.CLAMP),
  }));

  const activeBg = light ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.14)';

  return (
    <View
      style={[styles.outer, { paddingBottom: Math.max(insets.bottom, 10), paddingHorizontal: GUTTER }]}
      pointerEvents="box-none"
    >
      <Animated.View style={[
        styles.shell,
        /* Only the fallback draws an edge — see the note on the material. */
        glass
          ? { borderWidth: 0 }
          : { borderWidth: StyleSheet.hairlineWidth, borderColor: light ? 'rgba(0,0,0,0.06)' : HAIRLINE },
        shellStyle,
      ]}>
       {/* Everything glass lives INSIDE one container, and that is the point of
           it: `spacing` is "the distance at which glass elements start
           affecting each other", so two GlassViews only merge when they are
           siblings in the same container. Wrapping just the background — which
           is what this did at first — puts the pill outside it and nothing
           merges at all. `box-none` so the container is purely a coordinator
           and never eats a tap meant for a tab. */}
       <GlassOrPlain glass={glass} light={light}>
        {/* Real glass background (blur fallback on iOS < 26).

            Three things were missing, and together they are most of what makes
            iOS 26 glass look like iOS 26 glass rather than a blurred rectangle:

            · isInteractive — the glass bends and highlights UNDER THE FINGER.
              It is off by default, and without it the bar is a static pane.
            · GlassContainer — Apple's GlassEffectContainer. Glass elements
              inside one MERGE into each other as they move; separate GlassViews
              just sit side by side. The bar and its active pill are one piece
              of glass now, which is the signature of the material.
            · a tint light enough to see through (see the constants above). */}
        {glass ? (
          <GlassView
            style={StyleSheet.absoluteFill}
            glassEffectStyle="regular"
            isInteractive
            tintColor={light ? GLASS_TINT_LIGHT : GLASS_TINT_DARK}
            colorScheme={light ? 'light' : 'dark'}
          />
        ) : (
          <BlurView
            /* Full strength. `systemChromeMaterial` is a named UIKit material,
               not a blur radius — the intensity is how much of it to apply, and
               anything less than all of it is a weaker version of the thing a
               real tab bar uses. */
            intensity={100}
            tint={light ? FALLBACK_TINT_LIGHT : FALLBACK_TINT_DARK}
            style={StyleSheet.absoluteFill}
          />
        )}
        {/* White fill that fades in as it becomes the ball */}
        <Animated.View style={[StyleSheet.absoluteFill, styles.white, whiteStyle]} pointerEvents="none" />

        {/* The five tabs (fixed width so they don't squish; clipped as the shell shrinks) */}
        <Animated.View style={[styles.row, { width: fullW }, rowStyle]} pointerEvents={isBall ? 'none' : 'auto'}>
          {state.routes
            .map((route, i) => ({ route, i }))
            .filter(({ route }) => TABS.includes(route.name as typeof TABS[number]))
            .sort((a, b) => TABS.indexOf(a.route.name as any) - TABS.indexOf(b.route.name as any))
            .map(({ route, i }) => {
            const focused = state.index === i;
            const onPress = () => {
              haptics.select();
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            };
            return (
              <Pressable
                key={route.key}
                onPress={onPress}
                style={styles.tab}
                accessibilityRole="button"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={LABEL[route.name] ?? route.name}
              >
                <View style={styles.pill}>
                  {/* The selected tab is its own piece of glass, which is what
                      lets it MERGE with the bar behind it rather than sitting
                      on it as a grey lozenge. Without real glass it falls back
                      to the flat fill it always had. */}
                  {focused && (glass ? (
                    <GlassView
                      style={[StyleSheet.absoluteFill, { borderRadius: TAB_H / 2 }]}
                      glassEffectStyle="regular"
                      isInteractive
                      /* Bright enough to read as the selected world, light
                         enough to still be glass — it MERGES with the bar
                         behind it (that is what GlassContainer is for), and a
                         heavy fill would just be a lozenge sitting on top. */
                      tintColor={light ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.22)'}
                      colorScheme={light ? 'light' : 'dark'}
                    />
                  ) : (
                    <View style={[StyleSheet.absoluteFill, {
                      backgroundColor: activeBg, borderRadius: TAB_H / 2,
                    }]} />
                  ))}
                  <Image
                    source={IMG[route.name][focused ? 'on' : 'off']}
                    resizeMode="contain"
                    style={[styles.icon, { tintColor: c.text }]}
                  />
                  {route.name === 'notifications' && unread > 0 && (
                    <View style={[styles.badge, { backgroundColor: c.accent, borderColor: c.bg }]} />
                  )}
                </View>
              </Pressable>
            );
          })}
        </Animated.View>

        {/* The "+" compose ball (revealed when collapsed) */}
        <Animated.View style={[StyleSheet.absoluteFill, styles.plusWrap, plusStyle]} pointerEvents={isBall ? 'auto' : 'none'}>
          <Pressable
            onPress={() => {
              haptics.tap();
              router.push('/compose');
            }}
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel="New post"
          >
            <View style={styles.plusInner}>
              <Ionicons name="add" size={28} color="#111" />
            </View>
          </Pressable>
        </Animated.View>
       </GlassOrPlain>
      </Animated.View>
    </View>
  );
}

/** One container when the glass is real, and nothing at all when it is not —
 *  a GlassContainer on iOS < 26 is a plain View that only adds a layer. */
function GlassOrPlain({ glass, light, children }: {
  glass: boolean; light: boolean; children: React.ReactNode;
}) {
  if (!glass) return <>{children}</>;
  return (
    <GlassContainer style={StyleSheet.absoluteFill} spacing={12} pointerEvents="box-none">
      {children}
    </GlassContainer>
  );
}

const styles = StyleSheet.create({
  outer: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'flex-end' },
  shell: {
    height: BAR_H,
    borderRadius: BAR_H / 2,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    /* No border here — the glass and the fallback each decide their own, above.
       The web's `border:1px solid rgba(255,255,255,.05)` is the fallback's. */
  },
  white: { backgroundColor: '#fff', borderRadius: BAR_H / 2 },
  row: { flexDirection: 'row', alignItems: 'center', height: BAR_H, paddingHorizontal: PAD },
  tab: { flex: 1, alignItems: 'stretch', justifyContent: 'center' },
  /* The web's .bn-indicator is sized to the WHOLE tab and fully round —
     rgba(255,255,255,.14) on dark, rgba(0,0,0,.06) on light, both of which this
     already matched. Only its shape was different: a 46x40 rounded rect where the
     web has a full-tab capsule. */
  pill: {
    alignSelf: 'stretch', height: TAB_H, borderRadius: TAB_H / 2,
    alignItems: 'center', justifyContent: 'center',
  },
  badge: {
    position: 'absolute', top: 6, right: 12,
    width: 9, height: 9, borderRadius: 5, borderWidth: 1.5,
  },
  /* The web's --nv-size, exactly: 34 in a 50pt tab. This drew 26, which is 24%
     smaller than the website's and is what the founder meant by "much bigger". */
  icon: { width: ICON, height: ICON },
  plusWrap: { alignItems: 'center', justifyContent: 'center' },
  plusInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
