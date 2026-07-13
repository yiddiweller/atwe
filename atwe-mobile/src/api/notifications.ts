import { useQuery } from '@tanstack/react-query';
import { api } from './client';

/**
 * Notifications — mirrors `GET /api/notifications` (+ `/count` and the mark-read
 * POST). Shapes match server.js (~19973). Each row carries the actor + the
 * target ids so a tap can deep-link (post / profile / chat / job).
 */
export interface NotifActor {
  id: number;
  name: string;
  username: string | null;
  avatar: string | null;
  accountType: 'personal' | 'business';
  verified: boolean;
}
export interface Notification {
  id: number;
  type: string;
  postId: number | null;
  groupId: number | null;
  jobId: number | null;
  productId: number | null;
  read: boolean;
  created_at: string;
  postBody: string | null;
  jobTitle: string | null;
  productName: string | null;
  actor: NotifActor;
}

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () =>
      api.get<{ unread: number; notifications: Notification[] }>('/api/notifications'),
  });
}

export function useNotifCount() {
  return useQuery({
    queryKey: ['notif-count'],
    queryFn: () => api.get<{ unread: number }>('/api/notifications/count'),
    refetchInterval: 30_000,
  });
}

export async function markAllNotificationsRead(): Promise<void> {
  await api.post('/api/notifications/read');
}

/** Human sentence for a notification verb (mirrors the web verb dictionary). */
export function notifText(n: Notification): string {
  const map: Record<string, string> = {
    like: 'liked your post',
    reply: 'replied to your post',
    repost: 'reposted your post',
    mention: 'mentioned you',
    follow: 'followed you',
    message: 'sent you a message',
    endorse: 'endorsed your skill',
    connection: 'wants to connect',
    connection_accepted: 'accepted your connection',
    comment: 'commented on your post',
    tip: 'sent you a tip',
    money_received: 'sent you money',
    order: 'placed an order',
    event_rsvp: 'is going to your event',
    rec_received: 'wrote you a recommendation',
    login: 'New sign-in to your account',
    quote_received: 'sent you a quote',
    invoice_paid: 'paid your invoice',
    showcase_like: 'appreciated your showcase',
    showcase_comment: 'commented on your showcase',
  };
  return map[n.type] || 'interacted with you';
}
