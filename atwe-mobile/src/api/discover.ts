import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import type { Listing } from './marketplace';

/**
 * The rest of what the Engine discovers — Showcase, Newsletters, Communities,
 * Courses, and shopping with Atwe AI. One module because they share nothing but
 * a home, and five one-type files would be five places to look.
 *
 * Every shape here mirrors its `map*` on the server exactly.
 */

/* ── Showcase ─────────────────────────────────────────────────────────────── */

export interface ShowcaseAuthor {
  id: number; name: string; username: string | null; avatar: string | null;
  accountType: 'personal' | 'business'; verified: boolean;
}

export interface Showcase {
  id: number;
  title: string;
  description: string | null;
  images: string[];
  link: string | null;
  productId: number | null;
  category: string | null;
  createdAt: string;
  likes: number;
  liked: boolean;
  comments: number;
  mine: boolean;
  author: ShowcaseAuthor;
}

export function useShowcases(username?: string) {
  const qs = username ? `?username=${encodeURIComponent(username)}` : '?scope=discover';
  return useQuery({
    queryKey: ['showcases', username ?? 'discover'],
    queryFn: () => api.get<{ showcases: Showcase[] }>(`/api/showcases${qs}`),
  });
}
export function useShowcase(id: number | string) {
  return useQuery({
    queryKey: ['showcase', String(id)],
    queryFn: () => api.get<{ showcase: Showcase }>(`/api/showcases/${id}`),
    enabled: id != null && id !== '',
  });
}
export async function likeShowcase(id: number, on: boolean): Promise<void> {
  if (on) await api.post(`/api/showcases/${id}/like`, {});
  else await api.del(`/api/showcases/${id}/like`);
}

/* ── Newsletters ──────────────────────────────────────────────────────────── */

export interface Newsletter {
  id: number;
  title: string;
  description: string;
  cover: string | null;
  createdAt: string;
  subscribers: number;
  issues: number;
  subscribed: boolean;
  mine: boolean;
  priceCents: number;
  paid: boolean;
  /** A paid newsletter you have not paid for: the issues will not open. */
  locked: boolean;
  owner: {
    id: number; name: string; username: string | null; avatar: string | null;
    verified: boolean; business: boolean;
  };
}

export type NewsletterScope = 'discover' | 'subscribed' | 'mine';

export function useNewsletters(scope: NewsletterScope) {
  return useQuery({
    queryKey: ['newsletters', scope],
    queryFn: () => api.get<{ newsletters: Newsletter[] }>(`/api/newsletters?scope=${scope}`),
  });
}
export function useNewsletter(id: number | string) {
  return useQuery({
    queryKey: ['newsletter', String(id)],
    queryFn: () => api.get<{
      newsletter: Newsletter;
      issues: { id: number; title: string; excerpt: string; createdAt: string }[];
    }>(`/api/newsletters/${id}`),
    enabled: id != null && id !== '',
  });
}
/** Subscribing to a PAID newsletter answers with a Stripe URL instead of a flag,
 *  exactly like a ticketed event — so the caller must handle both. */
export function subscribeNewsletter(id: number, subscribe: boolean) {
  return api.post<{ ok?: boolean; subscribed?: boolean; url?: string }>(
    `/api/newsletters/${id}/subscribe`, { subscribe });
}

export function useNewsletterIssue(id: number | string) {
  return useQuery({
    queryKey: ['nl-issue', String(id)],
    queryFn: () => api.get<{
      issue: { id: number; title: string; body: string; createdAt: string; newsletterTitle?: string };
    }>(`/api/newsletters/issues/${id}`),
    enabled: id != null && id !== '',
  });
}

/* ── Communities ──────────────────────────────────────────────────────────── */

export interface Community {
  id: number;
  name: string;
  description: string | null;
  avatar: string | null;
  announceGroupId: number | null;
  members?: number;
  groups?: number;
  isAdmin: boolean;
  isMember: boolean;
  created_at: string;
}

export function useCommunities(scope: 'discover' | 'mine') {
  return useQuery({
    queryKey: ['communities', scope],
    queryFn: () => api.get<{ communities: Community[] }>(`/api/communities?scope=${scope}`),
  });
}
export function useCommunity(id: number | string) {
  return useQuery({
    queryKey: ['community', String(id)],
    queryFn: () => api.get<{
      community: Community;
      groups: { id: number; name: string; avatar: string | null; members: number; isMember: boolean }[];
    }>(`/api/communities/${id}`),
    enabled: id != null && id !== '',
  });
}
export async function joinCommunity(id: number, join: boolean): Promise<void> {
  if (join) await api.post(`/api/communities/${id}/join`, {});
  else await api.del(`/api/communities/${id}/join`);
}
export async function joinCommunityGroup(id: number, gid: number): Promise<void> {
  await api.post(`/api/communities/${id}/groups/${gid}/join`, {});
}

/* ── Courses ──────────────────────────────────────────────────────────────── */

export interface Course {
  id: number;
  title: string;
  description: string;
  cover: string | null;
  priceCents: number;
  published: boolean;
  createdAt: string;
  lessonCount: number;
  studentCount: number;
  mine: boolean;
  creator: {
    id: number; name: string; username: string | null; avatar: string | null;
    verified: boolean; business: boolean;
  };
  /** Only on the detail read. */
  enrolled?: boolean;
  progress?: number;
  lessons?: Lesson[];
}

export interface Lesson {
  id: number;
  section: string | null;
  title: string;
  position: number;
  /** Withheld unless you are the creator or enrolled — hence optional, not null. */
  content?: string;
  videoUrl?: string | null;
  locked: boolean;
  done?: boolean;
}

export type CourseScope = 'discover' | 'enrolled' | 'teaching';

export function useCourses(scope: CourseScope) {
  return useQuery({
    queryKey: ['courses', scope],
    queryFn: () => api.get<{ courses: Course[] }>(`/api/courses?scope=${scope}`),
  });
}
export function useCourse(id: number | string) {
  return useQuery({
    queryKey: ['course', String(id)],
    queryFn: () => api.get<{ course: Course }>(`/api/courses/${id}`),
    enabled: id != null && id !== '',
  });
}
/** Free courses enrol instantly; a paid one is taken from the wallet balance,
 *  so it can fail for want of funds rather than redirecting to a card. */
export function enrolCourse(id: number) {
  return api.post<{ ok?: boolean; enrolled?: boolean }>(`/api/courses/${id}/enroll`, {});
}
export function completeLesson(courseId: number, lessonId: number, done: boolean) {
  return api.post<{ doneCount: number; progress: number }>(
    `/api/courses/${courseId}/lessons/${lessonId}/complete`, { done });
}

/* ── Shopping with Atwe AI ────────────────────────────────────────────────── */

export interface AiShopResult {
  items: { listing: Listing; reason: string | null }[];
  summary: string | null;
  /** False when there is no AI key — the server still answers, with plain
   *  retrieval rather than a ranked shortlist. Worth saying so on screen. */
  ai: boolean;
}
export function aiShop(query: string) {
  return api.post<AiShopResult>('/api/ai/shop', { query });
}

/** "$45.00", or "Free" at zero — the price line these worlds share. */
export function priceOrFree(cents: number): string {
  return cents > 0 ? `$${(cents / 100).toFixed(2)}` : 'Free';
}
