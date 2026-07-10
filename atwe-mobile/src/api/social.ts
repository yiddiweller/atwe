import { useQuery } from '@tanstack/react-query';
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

/** Like / unlike a post (mirrors POST/DELETE /api/social/posts/:id/like). */
export async function likePost(id: number, on: boolean): Promise<void> {
  if (on) await api.post(`/api/social/posts/${id}/like`);
  else await api.del(`/api/social/posts/${id}/like`);
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
