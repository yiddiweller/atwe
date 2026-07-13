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
  /** Custom web nav glyph (tinted). When set, it overrides the Ionicons. */
  image?: ImageSourcePropType;
}

export const WORLDS: World[] = [
  { route: 'index', label: 'Home', icon: 'home-outline', iconActive: 'home', image: require('../../assets/nav/home.png') },
  { route: 'beam', label: 'Beam', icon: 'chatbubbles-outline', iconActive: 'chatbubbles', image: require('../../assets/nav/beam.png') },
  { route: 'engine', label: 'Engine', icon: 'search-outline', iconActive: 'search', image: require('../../assets/nav/engine.png') },
  { route: 'ai', label: 'Atwe AI', icon: 'sparkles-outline', iconActive: 'sparkles', image: require('../../assets/nav/ai.png') },
  { route: 'profile', label: 'Profile', icon: 'person-outline', iconActive: 'person' },
];
