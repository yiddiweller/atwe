import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { api } from './client';

/**
 * Social feed — mirrors the backend `GET /api/social/feed?scope=` and the
 * `mapPost` shape exactly (see server.js). The app is the consumer, so field
 * names match the API (note `created_at` is snake_case from the row).
 */

export type FeedScope = 'foryou' | 'following';

export interface PostAuthor {
  id: number;
  name: string;
  username: string | null;
  avatar: string | null;
  verified: boolean;
  accountType: 'personal' | 'business';
}

export interface Post {
  id: number;
  body: string;
  image: string | null;
  images: string[];
  created_at: string;
  editedAt: string | null;
  promoted: boolean;
  likes: number;
  replies: number;
  liked: boolean;
  mine: boolean;
  reposts: number;
  reposted: boolean;
  views: number;
  bookmarked: boolean;
  locked?: boolean;
  subscribersOnly?: boolean;
  ppvCents?: number;
  author: PostAuthor;
}

interface FeedResponse {
  posts: Post[];
  hasMore: boolean;
}

/** Load a feed scope (React Query cached; pull-to-refresh calls refetch). */
export function useFeed(scope: FeedScope) {
  return useQuery({
    queryKey: ['feed', scope],
    queryFn: () => api.get<FeedResponse>(`/api/social/feed?scope=${scope}`),
  });
}

/**
 * Infinite feed — each "load more" sends the ids we already have (`seen`) so the
 * server returns the NEXT unseen batch (mirrors the web's infinite scroll).
 */
export function useInfiniteFeed(scope: FeedScope) {
  return useInfiniteQuery({
    queryKey: ['feed-inf', scope],
    queryFn: ({ pageParam }) => {
      const seen = (pageParam as number[]) ?? [];
      const q = seen.length ? `&seen=${seen.join(',')}` : '';
      return api.get<FeedResponse>(`/api/social/feed?scope=${scope}${q}`);
    },
    initialPageParam: [] as number[],
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore || !lastPage.posts.length) return undefined;
      // The full set of ids seen so far becomes the next page's exclude list.
      return allPages.flatMap((p) => p.posts.map((x) => x.id)).slice(-200);
    },
  });
}

/** Like / unlike a post (mirrors POST/DELETE /api/social/posts/:id/like). */
export async function likePost(id: number, on: boolean): Promise<void> {
  if (on) await api.post(`/api/social/posts/${id}/like`);
  else await api.del(`/api/social/posts/${id}/like`);
}

/** Repost / undo (mirrors POST/DELETE /api/social/posts/:id/repost). */
export async function repostPost(id: number, on: boolean): Promise<void> {
  if (on) await api.post(`/api/social/posts/${id}/repost`);
  else await api.del(`/api/social/posts/${id}/repost`);
}

/** Bookmark / un-bookmark (mirrors POST/DELETE /api/social/posts/:id/bookmark). */
export async function bookmarkPost(id: number, on: boolean): Promise<void> {
  if (on) await api.post(`/api/social/posts/${id}/bookmark`);
  else await api.del(`/api/social/posts/${id}/bookmark`);
}

/** A post plus its replies — `GET /api/social/posts/:id`. */
export interface PostWithMeta extends Post {
  canReply?: boolean;
  replyScope?: string;
}
export interface PostDetail {
  post: PostWithMeta;
  replies: Post[];
}

/** Load one post + its replies (React Query cached; keyed by id). */
export function usePost(id: string | number) {
  return useQuery({
    queryKey: ['post', String(id)],
    queryFn: () => api.get<PostDetail>(`/api/social/posts/${id}`),
    enabled: id != null && id !== '',
  });
}

/** Create a post, or a reply when `parentId` is given. Returns the new post. */
export async function createPost(input: {
  body: string;
  parentId?: number;
}): Promise<{ post: Post }> {
  return api.post<{ post: Post }>('/api/social/posts', {
    body: input.body,
    ...(input.parentId != null ? { parentId: input.parentId } : {}),
  });
}

/**
 * A user's public profile — mirrors `GET /api/social/profile/:username`
 * (see server.js line ~8079). Only the fields the native profile screen needs
 * are typed; the payload carries more (skills, experience, recommendations, …)
 * for later phases.
 */
export interface ProfileUser {
  id: number;
  name: string;
  username: string | null;
  avatar: string | null;
  banner: string | null;
  bio: string | null;
  location: string | null;
  website: string | null;
  headline: string | null;
  verified: boolean;
  accountType: 'personal' | 'business';
  joinedAt: string | null;
}
export interface Profile {
  user: ProfileUser;
  counts: { followers: number; following: number; posts: number; connections: number | null };
  connectionState: 'self' | 'connected' | 'pending_out' | 'pending_in' | 'none';
  isFollowing: boolean;
  isMe: boolean;
  posts: Post[];
  replies: Post[];
}

/** Load a user's profile by @handle (React Query cached; keyed by username). */
export function useProfile(username: string | undefined) {
  return useQuery({
    queryKey: ['profile', username],
    queryFn: () => api.get<Profile>(`/api/social/profile/${encodeURIComponent(username!)}`),
    enabled: !!username,
  });
}

/** Follow / unfollow a user by id (mirrors POST/DELETE /api/social/follow/:id). */
export async function followUser(id: number, on: boolean): Promise<void> {
  if (on) await api.post(`/api/social/follow/${id}`);
  else await api.del(`/api/social/follow/${id}`);
}

/** A trending hashtag — `GET /api/social/trending` → `{ trends: [{tag,count}] }`. */
export interface Trend {
  tag: string;
  count: number;
}
export function useTrending() {
  return useQuery({
    queryKey: ['trending'],
    queryFn: () => api.get<{ trends: Trend[] }>('/api/social/trending'),
    staleTime: 60_000,
  });
}

/** A "who to follow" suggestion — `GET /api/social/suggestions` (mapSuggestUser). */
export interface SuggestUser {
  id: number;
  name: string;
  username: string | null;
  avatar: string | null;
  verified: boolean;
  headline: string | null;
  accountType: 'personal' | 'business';
  followers: number;
  mutuals: number;
}
export function useSuggestions() {
  return useQuery({
    queryKey: ['suggestions'],
    queryFn: () => api.get<{ users: SuggestUser[] }>('/api/social/suggestions'),
    staleTime: 60_000,
  });
}

/** A person search result — `GET /api/search?scope=people&q=` (mapSearchUser). */
export interface SearchUser {
  id: number;
  name: string;
  username: string | null;
  avatar: string | null;
  verified: boolean;
  accountType: 'personal' | 'business';
  headline: string | null;
}
export function useSearchPeople(q: string) {
  const query = q.trim();
  return useQuery({
    queryKey: ['search-people', query],
    queryFn: () =>
      api.get<{ users: SearchUser[] }>(`/api/search?scope=people&q=${encodeURIComponent(query)}`),
    enabled: query.length >= 1,
    staleTime: 30_000,
  });
}
