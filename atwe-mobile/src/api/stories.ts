import { useQuery } from '@tanstack/react-query';
import { api } from './client';

/**
 * Stories — mirrors the backend `GET /api/stories` (the tray) and
 * `GET /api/stories/:userId` (one person's items), plus the seen marker.
 * Shapes match `mapStory` + the tray row in server.js (~line 7247/7320).
 */

export interface StoryTrayUser {
  id: number;
  name: string;
  username: string | null;
  avatar: string | null;
  accountType: 'personal' | 'business';
  verified: boolean;
}
export interface StoryTrayEntry {
  user: StoryTrayUser;
  count: number;
  lastAt: string;
  hasUnseen: boolean;
  mine: boolean;
}

export interface Story {
  id: number;
  kind: 'image' | 'video' | 'text';
  media: string | null;
  caption: string | null;
  bg: string | null;
  createdAt: string;
  expiresAt: string;
  mine: boolean;
  seen: boolean;
  viewCount?: number;
  audience: 'all' | 'close';
}

/** The stories tray — people you follow (and you) with an active story. */
export function useStoryTray() {
  return useQuery({
    queryKey: ['storyTray'],
    queryFn: () => api.get<{ tray: StoryTrayEntry[] }>('/api/stories'),
    staleTime: 60_000,
  });
}

/** One user's active story items, in order (follow-gated server-side). */
export function useUserStories(userId: number | undefined) {
  return useQuery({
    queryKey: ['stories', userId],
    queryFn: () => api.get<{ stories: Story[] }>(`/api/stories/${userId}`),
    enabled: userId != null,
  });
}

/** Mark a story seen by me (own views don't count server-side). */
export async function markStorySeen(id: number): Promise<void> {
  try {
    await api.post(`/api/stories/${id}/view`);
  } catch {
    // best-effort — a missed seen mark is not worth surfacing
  }
}

/* ── Adding to your story ────────────────────────────────────────────────────
 * A photo, or words on a colour. Both expire on their own after 24 hours, which
 * is the whole point of a story and the reason nothing here is undoable.
 */

export type StoryAudience = 'all' | 'close';

export async function postStory(input: {
  kind: 'image' | 'text';
  /** A data URL, for an image story. */
  media?: string;
  caption?: string;
  /** One of the six preset ids ('g1'…'g6') — see src/lib/storyBg.ts. */
  bg?: string;
  audience?: StoryAudience;
}): Promise<void> {
  await api.post('/api/stories', {
    kind: input.kind,
    ...(input.media ? { media: input.media } : {}),
    ...(input.caption ? { caption: input.caption } : {}),
    ...(input.bg ? { bg: input.bg } : {}),
    audience: input.audience ?? 'all',
  });
}

/** Take one of yours down before it expires. */
export async function deleteStory(id: number): Promise<void> {
  await api.del(`/api/stories/${id}`);
}
