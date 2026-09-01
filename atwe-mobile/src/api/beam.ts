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
    // The live stream is what actually delivers a message now (see the chat
    // screen). This slow poll stays as a safety net for the case iOS quietly
    // kills the connection in the background and the reconnect has not landed
    // yet — without it a thread could sit silently stale.
    refetchInterval: 25_000,
  });
}

/** Send a text message to a peer (idempotent via clientId). */
export async function sendDm(
  peerId: number, body: string, clientId: string, image?: string,
): Promise<void> {
  await api.post(`/api/atchat/with/${peerId}`, { body, clientId, image });
}

/* ── Groups ───────────────────────────────────────────────────────────────────
 * The same three shapes as a DM, against the group routes:
 *   GET  /api/atchat/groups          the groups you are in
 *   GET  /api/atchat/groups/:id      one group (members + messages)
 *   POST /api/atchat/groups/:id/messages
 * A group message carries a SENDER, which a DM does not — a thread with several
 * people in it is unreadable without one, so the shape is a superset rather than
 * a reuse of DmMessage.
 */

/** One row in the Groups list. */
export interface Group {
  id: number;
  name: string;
  username: string | null;
  avatar: string | null;
  broadcast: boolean;      // a "channel": only admins post
  muted: boolean;
  members: number;
  last_body: string | null;
  last_image: boolean;
  last_media_kind: string | null;
  last_meta: string | null;
  last_at: string | null;
  last_sender: string | null;
  last_mine: boolean;
  unread: number;
  mentioned: boolean;      // you were @mentioned since you last read
}

export function useGroups() {
  return useQuery({
    queryKey: ['groups'],
    queryFn: () => api.get<{ groups: Group[] }>('/api/atchat/groups'),
    staleTime: 15_000,
  });
}

/** The list-row preview. Unlike a DM it names the sender, because in a group
 *  "Photo" without a name tells you nothing about who you are hearing from. */
export function groupPreview(g: Group): string {
  let s: string;
  if (g.last_meta) s = '📎 Attachment';
  else if (g.last_media_kind === 'audio') s = '🎤 Voice message';
  else if (g.last_media_kind === 'video') s = '🎬 Video';
  else if (g.last_image) s = '📷 Photo';
  else s = g.last_body || '';
  if (!s) return '';
  if (g.last_mine) return `You: ${s}`;
  const who = (g.last_sender || '').split(' ')[0];
  return who ? `${who}: ${s}` : s;
}

export interface GroupMessage {
  id: number;
  body: string | null;
  image: string | null;
  media_kind: string | null;
  created_at: string;
  mine: boolean;
  sender_id: number;
  sender_name: string | null;
  sender_avatar: string | null;
  deleted_all?: boolean;
}

export interface GroupMember {
  id: number;
  name: string;
  username: string | null;
  avatar: string | null;
  verified: boolean;
  isOwner: boolean;
  isAdmin: boolean;
}

export interface GroupThreadData {
  group: {
    id: number; name: string; username: string | null; avatar: string | null;
    createdBy: number; broadcast: boolean; muted: boolean; iAmAdmin: boolean;
    description: string | null;
  };
  members: GroupMember[];
  messages: GroupMessage[];
}

export function useGroupThread(groupId: number | undefined) {
  return useQuery({
    queryKey: ['group', groupId],
    queryFn: () => api.get<GroupThreadData>(`/api/atchat/groups/${groupId}`),
    enabled: !!groupId,
    // A safety net only: the live SSE stream is what actually keeps this current.
    refetchInterval: 25_000,
  });
}

/** clientId is what makes a double-tap or a retry land ONCE — the server has a
 *  unique index on (group, sender, client_id) and returns the existing row. */
export async function sendGroupMessage(
  groupId: number,
  body: string,
  clientId: string,
  image?: string,
): Promise<void> {
  await api.post(`/api/atchat/groups/${groupId}/messages`, { body, clientId, image });
}
