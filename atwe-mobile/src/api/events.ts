import { useQuery } from '@tanstack/react-query';
import { api } from './client';

/**
 * Events — mirrors `mapEvent` on the server exactly.
 *
 * An event is hosted by a person OR a business, is free or ticketed, may cap how
 * many can come, and people either say they're going or that they're interested.
 * All of that comes off one row, so the client never has to work anything out.
 */

export type EventScope = 'upcoming' | 'attending' | 'mine' | 'past';
export type RsvpStatus = 'going' | 'interested' | 'waitlist';

export interface EventHost {
  id: number;
  name: string;
  username: string | null;
  avatar: string | null;
  verified: boolean;
  /** NB the server spells this `business` (a boolean), not `accountType`. */
  business: boolean;
}

export interface AtweEvent {
  id: number;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string | null;
  online: boolean;
  location: string | null;
  cover: string | null;
  createdAt: string;
  priceCents: number;
  /** null = unlimited. */
  capacity: number | null;
  spotsLeft: number | null;
  full: boolean;
  cancelled: boolean;
  going: number;
  interested: number;
  waitlisted: number;
  myRsvp: RsvpStatus | null;
  myPaid: boolean;
  mine: boolean;
  host: EventHost;
}

export interface Attendee {
  id: number;
  name: string;
  username: string | null;
  avatar: string | null;
  verified: boolean;
  headline: string | null;
  status: RsvpStatus;
  checkedIn: boolean;
}

export interface EventComment {
  id: number;
  body: string;
  createdAt: string;
  mine: boolean;
  /** True when the reader is the host, who may delete anybody's comment. */
  hostCan: boolean;
  author: {
    id: number; name: string; username: string | null; avatar: string | null;
    verified: boolean; accountType: 'personal' | 'business'; isHost: boolean;
  };
}

export function useEvents(scope: EventScope) {
  return useQuery({
    queryKey: ['events', scope],
    queryFn: () => api.get<{ events: AtweEvent[] }>(`/api/events?scope=${scope}`),
  });
}

export function useEvent(id: number | string) {
  return useQuery({
    queryKey: ['event', String(id)],
    queryFn: () => api.get<{ event: AtweEvent }>(`/api/events/${id}`),
    enabled: id != null && id !== '',
  });
}

export function useAttendees(id: number | string, enabled = true) {
  return useQuery({
    queryKey: ['event-attendees', String(id)],
    queryFn: () => api.get<{ attendees: Attendee[] }>(`/api/events/${id}/attendees`),
    enabled: enabled && id != null && id !== '',
  });
}

export function useEventComments(id: number | string, enabled = true) {
  return useQuery({
    queryKey: ['event-comments', String(id)],
    queryFn: () => api.get<{ comments: EventComment[] }>(`/api/events/${id}/comments`),
    enabled: enabled && id != null && id !== '',
  });
}

export async function postEventComment(id: number, body: string): Promise<void> {
  await api.post(`/api/events/${id}/comments`, { body });
}
export async function deleteEventComment(commentId: number): Promise<void> {
  await api.del(`/api/events/comments/${commentId}`);
}

/**
 * RSVP.
 *
 * Three answers are possible and the caller must handle all of them:
 *   { ok, status }  — done
 *   { url }         — a ticketed event with Stripe configured; the price has to be
 *                     paid in a browser, so the caller opens it
 *   400 { full }    — the seat cap filled up; `canWaitlist` says a place in the
 *                     queue is still available
 */
export interface RsvpResult {
  ok?: boolean;
  status?: RsvpStatus;
  url?: string;
}
export function rsvp(id: number, status: RsvpStatus) {
  return api.post<RsvpResult>(`/api/events/${id}/rsvp`, { status });
}
export async function unrsvp(id: number): Promise<void> {
  await api.del(`/api/events/${id}/rsvp`);
}

export interface EventDraft {
  title: string;
  startsAt: string;
  endsAt?: string | null;
  online?: boolean;
  location?: string;
  description?: string;
  priceCents?: number;
  capacity?: number | null;
  cover?: string | null;
}

export function createEvent(d: EventDraft) {
  return api.post<{ event: AtweEvent }>('/api/events', d);
}
export function updateEvent(id: number, d: Partial<EventDraft>) {
  return api.patch<{ event: AtweEvent }>(`/api/events/${id}`, d);
}
export async function cancelEvent(id: number): Promise<void> {
  await api.post(`/api/events/${id}/cancel`, {});
}
export async function deleteEvent(id: number): Promise<void> {
  await api.del(`/api/events/${id}`);
}

/* ── display helpers ──────────────────────────────────────────────────────── */

/** "Free" or "$12.00" — an event's price, in the words shown on the button. */
export function ticketLabel(e: AtweEvent): string {
  return e.priceCents > 0 ? `$${(e.priceCents / 100).toFixed(2)}` : 'Free';
}

/** "Sat 4 Oct, 7:00 PM" — one line, the way an invitation reads. */
export function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit',
  });
}

/** Just the clock, for a card that already sits under a day heading. */
export function timeLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Just the day, for grouping a list: "Sat 4 Oct". */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (sameDay) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** What the room looks like: "12 going · 4 interested", or the cap when there is one. */
export function crowdLabel(e: AtweEvent): string {
  const bits: string[] = [];
  if (e.capacity != null) {
    bits.push(e.full ? 'Full' : `${e.spotsLeft} of ${e.capacity} left`);
  } else if (e.going) {
    bits.push(`${e.going} going`);
  }
  if (e.interested) bits.push(`${e.interested} interested`);
  return bits.join(' · ');
}
