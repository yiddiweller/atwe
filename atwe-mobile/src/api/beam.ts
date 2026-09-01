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

/** userId -> emoji. The server keeps one reaction per person, so this is a map
 *  rather than a list; counting is `Object.values(...)` grouped by emoji. */
export type Reactions = Record<string, string>;

export interface DmMessage {
  id: number;
  body: string | null;
  image: string | null;
  images: string[];
  /** A voice note / video / file, as a signed media path (see mediaUri). */
  media: string | null;
  media_kind: string | null;
  media_name: string | null;
  /** Length of a voice note, as the sender's recorder measured it. */
  duration_sec: number | null;
  created_at: string;
  mine: boolean;
  read_at: string | null;
  clientId: string | null;
  deleted: boolean;
  hidden: boolean;
  edited?: boolean;
  reply_to: number | null;
  reactions: Reactions;
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

/** Anything that can ride along with (or instead of) the text of a message.
 *  An options object rather than more positional arguments: `send(id, '', cid,
 *  undefined, undefined, 12)` is exactly how a photo ends up sent as a voice
 *  note. */
export interface Attachment {
  /** A photo, as a data URL. */
  image?: string;
  /** A voice note / video / file, as a data URL. */
  media?: string;
  mediaKind?: 'audio' | 'video' | 'image' | 'file';
  /** Seconds — only meaningful for audio and video. */
  durationSec?: number;
  /** The id of the message this one answers. */
  replyTo?: number;
}

/** Send a message to a peer (idempotent via clientId). */
export async function sendDm(
  peerId: number, body: string, clientId: string, att: Attachment = {},
): Promise<void> {
  await api.post(`/api/atchat/with/${peerId}`, { body, clientId, ...att });
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

/** Who wrote a group message. It is a nested object on the wire — NOT the flat
 *  sender_id / sender_name / sender_avatar this once assumed. Getting that wrong
 *  is silent: names and faces simply never render, and run-grouping compares
 *  undefined to undefined, so a whole group reads as one unbroken run. */
export interface GroupSender {
  id: number;
  name: string | null;
  username: string | null;
  avatar: string | null;
  verified: boolean;
}

export interface GroupMessage {
  id: number;
  body: string | null;
  image: string | null;
  images: string[];
  media: string | null;
  media_kind: string | null;
  media_name: string | null;
  duration_sec: number | null;
  created_at: string;
  mine: boolean;
  sender: GroupSender;
  deleted: boolean;
  hidden: boolean;
  edited: boolean;
  /** The message this one answers, by id. */
  reply_to: number | null;
  /** userId -> emoji. One reaction per person, as the server enforces. */
  reactions: Reactions;
  clientId: string | null;
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
  att: Attachment = {},
): Promise<void> {
  await api.post(`/api/atchat/groups/${groupId}/messages`, { body, clientId, ...att });
}

/* ── Acting on one message ────────────────────────────────────────────────────
 * React, and delete. Both exist for DMs and for groups against different URLs
 * but identical semantics, so the screens call one pair of functions and pass a
 * groupId when they have one — rather than each screen learning two APIs.
 */

/** The six a phone keyboard reaches for. Sending the emoji already on a message
 *  clears it, which is what makes a tap on your own reaction remove it. */
export const REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🙏'] as const;

/** Send an emoji (or '' to clear). Returns the whole updated map. */
export async function react(
  target: { messageId: number; groupId?: number }, emoji: string,
): Promise<Reactions> {
  const path = target.groupId
    ? `/api/atchat/groups/${target.groupId}/messages/${target.messageId}/react`
    : `/api/atchat/message/${target.messageId}/react`;
  const r = await api.post<{ reactions: Reactions }>(path, { emoji });
  return r.reactions || {};
}

/** `everyone` leaves a tombstone both sides see and is sender-only (a group
 *  admin may also do it); `me` just hides it from your own copy. */
export async function deleteMessage(
  target: { messageId: number; groupId?: number }, scope: 'me' | 'everyone',
): Promise<void> {
  const path = target.groupId
    ? `/api/atchat/groups/${target.groupId}/messages/${target.messageId}?scope=${scope}`
    : `/api/atchat/message/${target.messageId}?scope=${scope}`;
  await api.del(path);
}

/** Fold a reactions map into what actually gets drawn: one chip per distinct
 *  emoji with a count, and whether YOU are in it. */
export function reactionChips(
  reactions: Reactions | undefined, myId: number | undefined,
): { emoji: string; count: number; mine: boolean }[] {
  if (!reactions) return [];
  const by = new Map<string, { emoji: string; count: number; mine: boolean }>();
  for (const [uid, emoji] of Object.entries(reactions)) {
    if (!emoji) continue;
    const cur = by.get(emoji) || { emoji, count: 0, mine: false };
    cur.count += 1;
    if (myId != null && String(myId) === uid) cur.mine = true;
    by.set(emoji, cur);
  }
  return [...by.values()];
}

/* ── Who to talk to ───────────────────────────────────────────────────────── */

/** The shared person stub both the contacts list and the search return. */
export interface Person {
  id: number;
  name: string;
  username: string | null;
  avatar: string | null;
  verified: boolean;
  accountType: 'personal' | 'business';
}

/** People you have saved. The Contacts tab, and the New-chat sheet's resting state. */
export function useContacts() {
  return useQuery({
    queryKey: ['contacts'],
    queryFn: () => api.get<{ contacts: Person[] }>('/api/contacts'),
  });
}

/**
 * Find somebody to message. Reuses the mention search the composer uses — one
 * ranking, prefix-first and blocks-excluded, rather than a second one that would
 * drift from it.
 */
export function useFindPeople(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: ['find-people', term],
    queryFn: () => api.get<{ users: Person[] }>(`/api/social/mention-search?q=${encodeURIComponent(term)}`),
    enabled: term.length >= 1,
  });
}
