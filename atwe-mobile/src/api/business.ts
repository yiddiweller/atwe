import { useQuery } from '@tanstack/react-query';
import { api } from './client';

/**
 * A business, from the outside: what people said, and when it is open.
 */

export interface Reviewer {
  id: number;
  name: string;
  username: string | null;
  avatar: string | null;
  verified: boolean;
}

export interface Review {
  id: number;
  rating: number;
  body: string;
  /** The business's own reply, underneath. */
  response: string | null;
  createdAt: string;
  /** It came from a real dealing — an order, a stay, a finished appointment —
   *  which is what separates a review with weight from one without. */
  verified: boolean;
  forWhat: string | null;
  mine: boolean;
  reviewer: Reviewer;
}

export interface ReviewSummary { count: number; average: number }

export function useReviews(businessId: number | undefined) {
  return useQuery({
    queryKey: ['reviews', businessId],
    queryFn: () => api.get<{ reviews: Review[]; summary: ReviewSummary }>(
      `/api/business/${businessId}/reviews`,
    ),
    enabled: businessId != null,
  });
}

/** One review per person per business — writing again replaces the old one,
 *  which is why the form opens with what you said last time. */
export async function writeReview(businessId: number, rating: number, body: string): Promise<void> {
  await api.post(`/api/business/${businessId}/reviews`, { rating, body });
}

export async function deleteReview(id: number): Promise<void> {
  await api.del(`/api/business/reviews/${id}`);
}

/* ── Opening hours ─────────────────────────────────────────────────────────── */

export type DayHours = { closed: true } | { open: string; close: string };

const MIN = (t: string) => {
  const [h, m] = String(t).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/**
 * Open right now?
 *
 * Deliberately computed from the READER'S clock, the same way the web does it:
 * the hours are stored as plain wall-clock times with no timezone, so the only
 * honest reading is "the local time where this is happening". A traveller
 * checking a shop in another country will see it wrong, and that is a known
 * limit of how the hours are stored, not something the phone can fix.
 *
 * An overnight span (open 18:00, close 02:00) wraps, so it counts the small
 * hours of the NEXT day as still open.
 */
export function openNow(hours: DayHours[] | null | undefined): boolean | null {
  if (!Array.isArray(hours) || hours.length < 7) return null;
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  // The stored week starts on Monday; JS's starts on Sunday.
  const idx = (now.getDay() + 6) % 7;
  const today = hours[idx];
  if (today && !('closed' in today)) {
    const o = MIN(today.open), c = MIN(today.close);
    if (c > o ? mins >= o && mins < c : mins >= o) return true;
  }
  // Still inside yesterday's overnight span?
  const yest = hours[(idx + 6) % 7];
  if (yest && !('closed' in yest)) {
    const o = MIN(yest.open), c = MIN(yest.close);
    if (c <= o && mins < c) return true;
  }
  return false;
}

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** "9:00 – 17:00", or "Closed". */
export function hoursLabel(d: DayHours | undefined): string {
  if (!d || 'closed' in d) return 'Closed';
  return `${d.open} – ${d.close}`;
}

/** Which row is today, so it can be picked out. */
export function todayIndex(): number {
  return (new Date().getDay() + 6) % 7;
}
