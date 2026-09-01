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
  /* View-once. The BYTES are deliberately absent from the thread payload — a
     placeholder is all that is sent, and `POST /api/atchat/message/:id/view`
     hands them over exactly once. So a view-once photo cannot be recovered by
     re-reading the thread, which is the whole point of it. */
  viewOnce?: boolean;
  /** True once the recipient has opened it. Both sides see this. */
  viewed?: boolean;
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
  /** Send it so the recipient can open it exactly once. */
  viewOnce?: boolean;
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

/* ── Disappearing messages ────────────────────────────────────────────────── */

/**
 * Off / 24h / 7d / 90d — the server's own `DISAPPEAR_OPTS`, and it validates
 * against exactly this list, so offering a fifth would just produce a refusal.
 */
export const DISAPPEAR_OPTS = [
  { seconds: 0, label: 'Off' },
  { seconds: 86400, label: '24 hours' },
  { seconds: 604800, label: '7 days' },
  { seconds: 7776000, label: '90 days' },
] as const;

export function disappearLabel(seconds: number): string {
  return DISAPPEAR_OPTS.find((o) => o.seconds === seconds)?.label ?? 'Off';
}

function disappearPath(kind: 'dm' | 'group', id: number) {
  return kind === 'group'
    ? `/api/atchat/groups/${id}/disappearing`
    : `/api/atchat/with/${id}/disappearing`;
}

export function useDisappearing(kind: 'dm' | 'group', id: number | undefined) {
  return useQuery({
    queryKey: ['disappearing', kind, id],
    queryFn: () => api.get<{ seconds: number }>(disappearPath(kind, id!)),
    enabled: id != null,
  });
}
export function setDisappearing(kind: 'dm' | 'group', id: number, seconds: number) {
  return api.put<{ ok: true; seconds: number }>(disappearPath(kind, id), { seconds });
}

/* ── Starred, and searching what was said ─────────────────────────────────── */

/** One hit — from a DM or a group, which is what `scope` says. */
export interface MessageHit {
  id: number;
  scope: 'dm' | 'group';
  body: string | null;
  created_at: string;
  mine: boolean;
  threadId: number | null;
  /** On a DM hit. */
  peer?: { id: number; name: string; username: string | null; avatar: string | null };
  /** On a group hit. */
  group?: { id: number; name: string; avatar?: string | null };
}

export interface StarredItem extends MessageHit {
  /** Starred rows say whether there WAS an image, not what it was. */
  image: boolean;
  mediaKind: string | null;
  meta: unknown | null;
}

export function useStarred() {
  return useQuery({
    queryKey: ['starred'],
    queryFn: () => api.get<{ items: StarredItem[] }>('/api/atchat/starred'),
  });
}

/**
 * Search the TEXT of your own messages. Mirrors the read routes' visibility
 * rules server-side, so a deleted, cleared or expired message can never come
 * back through here.
 */
export function useMessageSearch(q: string, scope?: { peer?: number; group?: number }) {
  const term = q.trim();
  const qs = new URLSearchParams({ q: term });
  if (scope?.peer) qs.set('peer', String(scope.peer));
  if (scope?.group) qs.set('group', String(scope.group));
  return useQuery({
    queryKey: ['msg-search', term, scope?.peer ?? 0, scope?.group ?? 0],
    queryFn: () => api.get<{ items: MessageHit[] }>(`/api/atchat/messages/search?${qs}`),
    enabled: term.length >= 2,
  });
}

export function starMessage(kind: 'dm' | 'group', id: number, messageId: number) {
  return api.post<{ ok: true }>(
    kind === 'group'
      ? `/api/atchat/groups/${id}/messages/${messageId}/star`
      : `/api/atchat/message/${messageId}/star`,
    {},
  );
}

/* ── Labels (folders) ─────────────────────────────────────────────────────── */

export interface ChatLabel {
  id: number;
  name: string;
  color: string;
  position: number;
  items: { kind: 'dm' | 'group'; targetId: number }[];
  count: number;
}

export function useChatLabels() {
  return useQuery({
    queryKey: ['chat-labels'],
    queryFn: () => api.get<{ labels: ChatLabel[] }>('/api/atchat/labels'),
  });
}
export function createChatLabel(name: string, color?: string) {
  return api.post<{ label: ChatLabel }>('/api/atchat/labels', { name, color });
}
export function deleteChatLabel(id: number) {
  return api.del(`/api/atchat/labels/${id}`);
}
export function assignChatLabel(labelId: number, kind: 'dm' | 'group', targetId: number, on: boolean) {
  return api.post<{ ok: true }>(`/api/atchat/labels/${labelId}/assign`, { kind, targetId, on });
}

/* ── Scheduled messages ───────────────────────────────────────────────────── */

export interface ScheduledMessage {
  id: number;
  kind: 'dm' | 'group';
  body: string;
  sendAt: string;
  peer: { id: number; name: string; username: string | null; avatar: string | null } | null;
  group: { id: number; name: string } | null;
}

export function useScheduledMessages() {
  return useQuery({
    queryKey: ['scheduled-messages'],
    queryFn: () => api.get<{ scheduled: ScheduledMessage[] }>('/api/atchat/scheduled'),
  });
}
export function scheduleMessage(body: { kind: 'dm' | 'group'; to: number; body: string; sendAt: string }) {
  return api.post<{ ok: true; id: number; sendAt: string }>('/api/atchat/schedule', body);
}
export function cancelScheduledMessage(id: number) {
  return api.del(`/api/atchat/scheduled/${id}`);
}

/* ── Broadcast lists ──────────────────────────────────────────────────────── */

/**
 * One message, sent to many people as SEPARATE private DMs — each replies to you
 * alone and nobody sees anybody else. Not a group.
 *
 * NB creating one takes `members`, NOT `memberIds`. The wrong name does not
 * fail; the list is simply created empty.
 */
export interface BroadcastList {
  id: number;
  name: string;
  count: number;
}

export interface BroadcastDetail {
  id: number;
  name: string;
  members: Person[];
}

export function useBroadcasts() {
  return useQuery({
    queryKey: ['broadcasts'],
    queryFn: () => api.get<{ lists: BroadcastList[] }>('/api/atchat/broadcasts'),
  });
}
export function useBroadcast(id: number | undefined) {
  return useQuery({
    queryKey: ['broadcast', id],
    queryFn: () => api.get<BroadcastDetail>(`/api/atchat/broadcasts/${id}`),
    enabled: id != null,
  });
}
export function createBroadcast(name: string, members: number[]) {
  return api.post<{ id: number; name: string; count: number }>('/api/atchat/broadcasts', { name, members });
}
export function updateBroadcast(id: number, body: { name?: string; members?: number[] }) {
  return api.patch(`/api/atchat/broadcasts/${id}`, body);
}
export function deleteBroadcast(id: number) {
  return api.del(`/api/atchat/broadcasts/${id}`);
}
export function sendBroadcast(id: number, body: string) {
  return api.post<{ ok: true; sent: number }>(`/api/atchat/broadcasts/${id}/send`, { body });
}

/* ── Locked chats ─────────────────────────────────────────────────────────── */

/**
 * Chats hidden behind a passcode. They are absent from the list until the
 * passcode is entered, and the server decides that — the phone never filters a
 * locked chat out of a list it was given, because then the list would have
 * contained it.
 */
export interface ChatPrefs {
  pins: string[];
  archived: string[];
  muted: string[];
  muteUntil: Record<string, string>;
  unreadOnly: boolean;
  locked: string[];
  hasLockPin: boolean;
  themes: Record<string, string>;
  noExport: string[];
}

export function useChatPrefs() {
  return useQuery({
    queryKey: ['chat-prefs'],
    queryFn: () => api.get<ChatPrefs>('/api/atchat/prefs'),
  });
}
export function setLockPin(pin: string, current?: string) {
  return api.post<{ ok: true; hasPin: boolean }>('/api/atchat/lock/pin', { pin, current });
}
export function unlockChats(pin: string) {
  return api.post<{ ok: true; locked: string[] }>('/api/atchat/lock/unlock', { pin });
}
export function setChatLocked(key: string, lock: boolean) {
  return api.post<{ ok: true }>('/api/atchat/lock/thread', { key, lock });
}

/** The key a thread is known by in every one of these lists. */
export function threadKey(kind: 'dm' | 'group', id: number): string {
  return `${kind === 'group' ? 'g' : 'd'}${id}`;
}


/* ── View-once media ──────────────────────────────────────────────────────── */

export interface ViewOnceMedia {
  id: number;
  image: string | null;
  images: string[];
  media: string | null;
  media_kind: string | null;
  media_name: string | null;
}

/**
 * Open a view-once photo. It answers ONCE — a second call is a 410, which is
 * not an error to hide but the thing working, so the caller says so plainly.
 */
export function openViewOnce(messageId: number) {
  return api.post<ViewOnceMedia>(`/api/atchat/message/${messageId}/view`, {});
}


/* ── The call log ─────────────────────────────────────────────────────────── */

export interface CallLog {
  id: number;
  /** Which way it went, from YOUR side of the log. */
  direction: 'in' | 'out';
  media: 'audio' | 'video';
  missed: boolean;
  /** Silenced by "silence unknown callers" — a record without a ring. It is a
   *  DIFFERENT thing from missed and must not be painted red: nothing went
   *  wrong, the setting did its job. */
  silenced: boolean;
  /** Seconds. 0 means it never connected. */
  duration: number;
  created_at: string;
  peer: { id: number; name: string; username: string | null; avatar: string | null };
}

/** Recent calls, newest first — the Calls tab. */
export function useCalls() {
  return useQuery({
    queryKey: ['calls'],
    queryFn: () => api.get<{ calls: CallLog[] }>('/api/calls'),
  });
}

/** "Missed", "Silenced", or how long it lasted. */
export function callSubtitle(c: CallLog): string {
  if (c.silenced) return 'Silenced';
  if (c.missed || !c.duration) return c.direction === 'in' ? 'Missed' : 'No answer';
  const m = Math.floor(c.duration / 60);
  const s = c.duration % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}
