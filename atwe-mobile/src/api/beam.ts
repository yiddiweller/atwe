import { useQuery } from '@tanstack/react-query';
import { api } from './client';

/**
 * Beam (messaging) — mirrors the backend AtChat DM routes:
 *   GET  /api/atchat/conversations        the chat list
 *   GET  /api/atchat/with/:id[?thread=]    one conversation (messages + peer)
 *   POST /api/atchat/with/:id              send a message
 * Shapes match server.js (conversations rows ~4184, message map ~4539).
 */

/** One row in the chat list (a peer + thread, with last-message preview + unread). */
export interface Conversation {
  id: number;
  name: string;
  username: string | null;
  avatar: string | null;
  thread_id: number | null;
  thread_title: string | null;
  last_body: string | null;
  last_image: boolean;
  last_media_kind: string | null;
  last_meta: string | null;
  last_deleted: boolean;
  last_hidden: boolean;
  last_at: string | null;
  last_mine: boolean;
  unread: number;
}

export function useConversations() {
  return useQuery({
    queryKey: ['conversations'],
    queryFn: () => api.get<{ conversations: Conversation[] }>('/api/atchat/conversations'),
    staleTime: 15_000,
  });
}

/** A one-line preview of a conversation's last message for the list row. */
export function conversationPreview(c: Conversation): string {
  let s: string;
  if (c.last_deleted) s = 'Message deleted';
  else if (c.last_meta) s = '📎 Attachment';
  else if (c.last_media_kind === 'audio') s = '🎤 Voice message';
  else if (c.last_media_kind === 'video') s = '🎬 Video';
  else if (c.last_image) s = '📷 Photo';
  else s = c.last_body || '';
  if (c.last_mine && s) s = `You: ${s}`;
  return s;
}

export interface DmMessage {
  id: number;
  body: string | null;
  image: string | null;
  images: string[];
  media_kind: string | null;
  created_at: string;
  mine: boolean;
  read_at: string | null;
  clientId: string | null;
  deleted: boolean;
  hidden: boolean;
  meta: unknown | null;
}
export interface DmThreadData {
  peer: { id: number; name: string; username: string | null; avatar: string | null };
  canMessage: boolean;
  messages: DmMessage[];
}

/** Load a DM conversation with a peer (main thread). */
export function useThread(peerId: number | undefined) {
  return useQuery({
    queryKey: ['thread', peerId],
    queryFn: () => api.get<DmThreadData>(`/api/atchat/with/${peerId}`),
    enabled: peerId != null,
    refetchInterval: 5_000, // lightweight polling until the SSE stream is wired natively
  });
}

/** Send a text message to a peer (idempotent via clientId). */
export async function sendDm(peerId: number, body: string, clientId: string): Promise<void> {
  await api.post(`/api/atchat/with/${peerId}`, { body, clientId });
}
