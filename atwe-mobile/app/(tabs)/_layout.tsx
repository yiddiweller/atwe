import { useEffect, useRef } from 'react';
import { Badge, Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';
import { useSegments } from 'expo-router';
import { NavMorphProvider } from '@/lib/navMorph';
import { useNotifCount } from '@/api/notifications';
import { haptics } from '@/lib/haptics';

/**
 * The five worlds, drawn by the SYSTEM.
 *
 * THIS IS THE CORRECTION TO THREE WRONG ATTEMPTS, and the mistake was not a
 * number — it was the whole approach. Liquid Glass is not a texture you paint
 * onto a view. Apple's own line is "if your app already uses native controls,
 * you get Liquid Glass automatically": it is what the SYSTEM draws, with a tint
 * derived from whatever is behind it, its own specular rim, its own scroll-edge
 * behaviour and its own morph. A custom pill with a GlassView inside it can
 * imitate the look and will never BE it, which is exactly what the founder kept
 * seeing and saying.
 *
 * The old comment here said the system bar "can't be reshaped, and we need it
 * to morph into a + ball on scroll". That trade was the error. Apple shipped
 * the morph themselves — `minimizeBehavior` is iOS 26's own shrink-on-scroll,
 * the very thing that was being hand-rolled at the cost of the material.
 *
 * `NativeTabs` renders a real UITabBarController. On iOS 26 that is Liquid
 * Glass, free and correct; on 18–25 it is the classic native bar, which is also
 * right for those phones and is not something any amount of drawing could
 * improve on.
 *
 * PAINT NOTHING. No `backgroundColor`, no `blurEffect`, no tint. Every one of
 * those replaces the material with our own fill, which is the same mistake in a
 * new place — the whole point is that the system decides, from the content.
 */
export default function TabsLayout() {
  const { data } = useNotifCount();
  const unread = data?.unread ?? 0;

  /* The one place in the app that did not tick. Every other choice in Atwe
     answers under the finger, and switching world — the most-used control there
     is — was silent, because the bar is drawn by UIKit and its press is not
     ours to hook. So the tick follows the RESULT instead: the focused tab
     changed, therefore something was chosen.
     Only while a tab IS what is on screen — pushing /wallet out of a tab also
     changes the segments, and buzzing for that would be a tick with no tap. */
  const segments = useSegments() as string[];
  const tab = segments[0] === '(tabs)' ? (segments[1] ?? 'index') : null;
  const lastTab = useRef<string | null>(null);
  useEffect(() => {
    if (!tab) return;
    if (lastTab.current !== null && lastTab.current !== tab) haptics.select();
    lastTab.current = tab;
  }, [tab]);

  return (
    /* Home still reports its scroll through this; nothing draws from it now
       that the bar minimizes itself, but the provider is cheap and removing it
       would mean editing the feed for no gain. */
    <NavMorphProvider>
      {/* `onScrollDown` IS iOS 26's own shrink-as-you-scroll, and it is the only
          lever there is: `automatic` / `never` / `onScrollDown` / `onScrollUp`
          are the whole list. There is deliberately no "slide the bar off the
          screen" — Apple's behaviour is to MINIMISE it into a small pill in
          place, and hand-rolling the slide is exactly the trade that cost this
          app the real material three times over. It needs iOS 26; on 18–25
          react-native-screens logs a warning and leaves the bar alone. */}
      <NativeTabs minimizeBehavior="onScrollDown">
        <NativeTabs.Trigger name="index">
          {/* No labels — the web's bar has none, and the founder's artwork is
              the identity. Their OWN icons, outline when the world is not the
              one you are in and solid when it is, exactly as before: UIKit
              renders a tab image as a template, so the white artwork takes the
              system tint and the pair still reads as off/on. */}
          <Label hidden />
          <Icon src={{
            default: require('../../assets/nav/home-off.png'),
            selected: require('../../assets/nav/home-on.png'),
          }} />
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="beam">
          <Label hidden />
          <Icon src={{
            default: require('../../assets/nav/beam-off.png'),
            selected: require('../../assets/nav/beam-on.png'),
          }} />
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="engine">
          <Label hidden />
          <Icon src={{
            default: require('../../assets/nav/engine-off.png'),
            selected: require('../../assets/nav/engine-on.png'),
          }} />
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="notifications">
          <Label hidden />
          <Icon src={{
            default: require('../../assets/nav/notifs-off.png'),
            selected: require('../../assets/nav/notifs-on.png'),
          }} />
          {/* The system's own badge, in the system's own place. */}
          {unread > 0 && <Badge>{unread > 99 ? '99+' : String(unread)}</Badge>}
        </NativeTabs.Trigger>

        <NativeTabs.Trigger name="profile">
          <Label hidden />
          <Icon src={{
            default: require('../../assets/nav/profile-off.png'),
            selected: require('../../assets/nav/profile-on.png'),
          }} />
        </NativeTabs.Trigger>

        {/* Atwe AI is not one of the five worlds — the same move the web made.
            `hidden` keeps /ai a real, routable screen (the Account hub, deep
            links and anything that pushes to it still work); it just has no
            seat in the bar. */}
        <NativeTabs.Trigger name="ai" hidden />
      </NativeTabs>
    </NavMorphProvider>
  );
}
