import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';
import type { ImageSourcePropType } from 'react-native';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/**
 * The five Atwe worlds — the exact information architecture from the web app.
 * Internal route names stay stable; only labels are user-facing.
 *   Home · Beam · Engine · Atwe AI · Profile
 *
 * The first four carry the web app's EXACT custom nav glyphs (nav-narch /
 * nav-equals / nav-ring / nav-knot), recolored to a white template so the tab
 * bar can tint them active-accent / inactive-grey. Profile keeps the person
 * glyph the web uses there.
 */
export interface World {
  /** expo-router route segment (file name in app/(tabs)/). */
  route: string;
  label: string;
  icon: IoniconName;
  iconActive: IoniconName;
  /** The founder's own nav glyph, OUTLINE state (tinted). Overrides the Ionicons. */
  image?: ImageSourcePropType;
  /** ...and the SOLID state, drawn when this is the world you are in. */
  imageActive?: ImageSourcePropType;
}

/* NOTHING IMPORTS THIS. It is the old bar's definition, kept only as the written
   record of the five worlds — the bar itself is drawn by src/components/GlassTabBar.tsx,
   which owns the icons and the order. It is updated here anyway, because a stale list
   describing a bar that no longer exists is a trap: the next person edits this, sees no
   change, and goes looking for a bug that is not there.
   Atwe AI is deliberately NOT in the list any more — it left the bar (as it did on the
   web) and opens from elsewhere; Notifications took its seat. */
export const WORLDS: World[] = [
  { route: 'index', label: 'Home', icon: 'home-outline', iconActive: 'home',
    image: require('../../assets/nav/home-off.png'), imageActive: require('../../assets/nav/home-on.png') },
  { route: 'beam', label: 'Beam', icon: 'chatbubbles-outline', iconActive: 'chatbubbles',
    image: require('../../assets/nav/beam-off.png'), imageActive: require('../../assets/nav/beam-on.png') },
  { route: 'engine', label: 'Engine', icon: 'search-outline', iconActive: 'search',
    image: require('../../assets/nav/engine-off.png'), imageActive: require('../../assets/nav/engine-on.png') },
  { route: 'notifications', label: 'Notifications', icon: 'notifications-outline', iconActive: 'notifications',
    image: require('../../assets/nav/notifs-off.png'), imageActive: require('../../assets/nav/notifs-on.png') },
  { route: 'profile', label: 'Account', icon: 'person-outline', iconActive: 'person',
    image: require('../../assets/nav/profile-off.png'), imageActive: require('../../assets/nav/profile-on.png') },
];
