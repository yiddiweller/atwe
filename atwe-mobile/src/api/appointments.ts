import { useQuery } from '@tanstack/react-query';
import { api } from './client';

/**
 * Appointments — booking a business, and running the book.
 *
 * The open times are generated from the business's own PROFILE HOURS, not from a
 * separate availability calendar, so a business that has filled in when it is
 * open can take bookings without setting anything else up. Booking one of those
 * published times is CONFIRMED straight away — publishing it was the approval.
 * Asking for a different time is a request the business still has to answer.
 */

export type ApptStatus = 'requested' | 'confirmed' | 'declined' | 'cancelled' | 'completed';

export interface Service {
  id: number;
  name: string;
  durationMin: number;
  /** Held from the customer's balance when they book, released when it is done. */
  depositCents: number;
  rating: number;
  reviewCount: number;
}

export interface ApptParty {
  id: number;
  name: string;
  username: string | null;
  avatar: string | null;
}

export interface Appointment {
  id: number;
  service: string;
  whenAt: string;
  note: string | null;
  status: ApptStatus;
  createdAt: string;
  depositCents: number;
  depositStatus: 'none' | 'held' | 'released' | 'refunded';
  business: ApptParty;
  customer: ApptParty;
}

export function useServices(businessId: number | undefined) {
  return useQuery({
    queryKey: ['services', businessId],
    queryFn: () => api.get<{ services: Service[] }>(`/api/business/${businessId}/services`),
    enabled: businessId != null,
  });
}

export interface SlotsResult {
  slots: string[];
  serviceId?: number;
  serviceName?: string;
  durationMin?: number;
  /** Why there is nothing to show: no service set up, or no opening hours. */
  reason?: 'no-service' | 'no-hours';
}

export function useSlots(businessId: number | undefined, serviceId: number | undefined) {
  return useQuery({
    queryKey: ['slots', businessId, serviceId],
    queryFn: () => api.get<SlotsResult>(
      `/api/business/${businessId}/slots?days=14${serviceId ? `&serviceId=${serviceId}` : ''}`,
    ),
    enabled: businessId != null,
    // Somebody else can take a time while this screen is open.
    staleTime: 20_000,
  });
}

/** Book. `slot: true` means it was one of the PUBLISHED times, which the server
 *  confirms immediately; anything else is a request the business answers.
 *
 *  **`serviceId` is not optional in practice.** The deposit is decided from the
 *  SERVICE ROW, and the server only looks it up when an id is given — send the
 *  name alone and a service with a deposit takes none, silently. The business
 *  would believe it was protected and it would not be. */
export async function bookAppointment(businessId: number, v: {
  serviceId: number;
  service: string;
  whenAt: string;
  note?: string;
  slot?: boolean;
}): Promise<void> {
  await api.post(`/api/business/${businessId}/appointments`, v);
}

export function useAppointments(scope: 'mine' | 'incoming') {
  return useQuery({
    queryKey: ['appointments', scope],
    queryFn: () => api.get<{ appointments: Appointment[] }>(`/api/appointments?scope=${scope}`),
  });
}

/** Confirm, decline and complete are the business's to make; either side may
 *  cancel. The server enforces that — the screen only decides what to offer. */
export async function setApptStatus(id: number, status: ApptStatus): Promise<void> {
  await api.patch(`/api/appointments/${id}`, { status });
}

export async function addService(v: {
  name: string; durationMin: number; depositCents?: number;
}): Promise<void> {
  await api.post('/api/business/services', v);
}

export async function deleteService(id: number): Promise<void> {
  await api.del(`/api/business/services/${id}`);
}

/** "Tomorrow, 2:30 pm" — a time you can read without doing arithmetic. */
export function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const days = Math.round((day.getTime() - today.getTime()) / 86400000);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  if (days > 1 && days < 7) return `${d.toLocaleDateString(undefined, { weekday: 'long' })}, ${time}`;
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`;
}

export function apptStatusLabel(a: Appointment, iAmBusiness: boolean): string {
  switch (a.status) {
    case 'requested': return iAmBusiness ? 'Waiting on you' : 'Waiting to be confirmed';
    case 'confirmed': return 'Confirmed';
    case 'declined': return 'Declined';
    case 'cancelled': return 'Cancelled';
    case 'completed': return 'Done';
    default: return a.status;
  }
}
