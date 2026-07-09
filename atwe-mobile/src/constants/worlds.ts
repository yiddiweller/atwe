import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

/**
 * The five Atwe worlds — the exact information architecture from the web app.
 * Internal route names stay stable; only labels are user-facing.
 *   Home · Beam · Engine · Atwe AI · Profile
 */
export interface World {
  /** expo-router route segment (file name in app/(tabs)/). */
  route: string;
  label: string;
  icon: IoniconName;
  iconActive: IoniconName;
}

export const WORLDS: World[] = [
  { route: 'index', label: 'Home', icon: 'home-outline', iconActive: 'home' },
  { route: 'beam', label: 'Beam', icon: 'chatbubbles-outline', iconActive: 'chatbubbles' },
  { route: 'engine', label: 'Engine', icon: 'search-outline', iconActive: 'search' },
  { route: 'ai', label: 'Atwe AI', icon: 'sparkles-outline', iconActive: 'sparkles' },
  { route: 'profile', label: 'Profile', icon: 'person-outline', iconActive: 'person' },
];
