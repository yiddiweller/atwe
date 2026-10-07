import { api } from './client';

/**
 * Atwe AI — the assistant chat. Mirrors `POST /api/chat` (requireAuth): send the
 * Anthropic-format conversation array `{role, content}` and get back `{content}`.
 * The server owns the model + the brand-safe "Atwe AI" system prompt, so the
 * client only carries the turn-by-turn messages.
 */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function sendChat(messages: ChatMessage[]): Promise<string> {
  const r = await api.post<{ content: string }>('/api/chat', { messages });
  return (r.content || '').trim();
}

/* ─── "Do it for me" ───────────────────────────────────────────────────────
   The assistant can DO things, not only answer. The server never carries an
   action out on its own: it works out what was meant and hands back a
   description, which is shown as a card the person confirms. Only then does
   the app call the ordinary, authenticated route that does the work.

   That shape is the whole safety story — nothing happens because a model
   decided it should, only because somebody read it and agreed. */
export type AgentTool = 'create_event' | 'draft_invoice' | 'schedule_post' | 'draft_reply';

export interface AgentAction {
  tool: AgentTool;
  label: string;
  input: Record<string, unknown>;
}
export interface AgentReply {
  text?: string;
  action?: AgentAction;
}

export async function askAgent(message: string): Promise<AgentReply> {
  return api.post<AgentReply>('/api/ai/agent', { message });
}

/** Carry out a confirmed action, through the same route the app itself uses. */
export async function runAgentAction(a: AgentAction): Promise<string> {
  const i = a.input as Record<string, string | number | undefined>;
  switch (a.tool) {
    case 'create_event':
      await api.post('/api/events', {
        title: i.title, description: i.description,
        startsAt: i.startsAt, online: true, location: i.location,
      });
      return 'Event created.';
    case 'schedule_post':
      await api.post('/api/social/posts', { body: i.body, scheduledAt: i.scheduledAt });
      return i.scheduledAt ? 'Post scheduled.' : 'Posted.';
    case 'draft_invoice': {
      // The assistant knows a handle; the invoice route needs the account it
      // belongs to, so that is looked up here rather than guessed at.
      const handle = String(i.to || i.username || '').replace(/^@/, '');
      if (!handle) throw new Error('Who is the invoice for?');
      const who = await api.get<{ id: number }>(`/api/social/profile/${encodeURIComponent(handle)}`);
      await api.post('/api/invoices', {
        customerId: who.id, title: i.title,
        amountCents: typeof i.amountCents === 'number' ? i.amountCents : undefined,
        note: i.note,
      });
      return 'Invoice sent.';
    }
    case 'draft_reply':
      // Text only — there is nothing to carry out, it is for copying.
      return String(i.body ?? '');
    default:
      throw new Error('That is not something I can do yet.');
  }
}

/** What to show on the confirmation card, in plain words. */
export function agentSummary(a: AgentAction): { title: string; lines: string[]; confirm: string } {
  const i = a.input as Record<string, string | number | undefined>;
  const when = (v: unknown) => {
    try { return new Date(String(v)).toLocaleString(); } catch { return String(v ?? ''); }
  };
  switch (a.tool) {
    case 'create_event':
      return {
        title: 'Create this event?',
        lines: [String(i.title ?? ''), when(i.startsAt), String(i.location ?? '')].filter(Boolean),
        confirm: 'Create it',
      };
    case 'schedule_post':
      return {
        title: i.scheduledAt ? 'Schedule this post?' : 'Post this?',
        lines: [String(i.body ?? ''), i.scheduledAt ? when(i.scheduledAt) : ''].filter(Boolean),
        confirm: i.scheduledAt ? 'Schedule it' : 'Post it',
      };
    case 'draft_invoice':
      return {
        title: 'Send this invoice?',
        lines: [
          String(i.title ?? ''),
          i.amountCents ? `£${(Number(i.amountCents) / 100).toFixed(2)}` : '',
          i.to ? `to @${String(i.to).replace(/^@/, '')}` : '',
        ].filter(Boolean),
        confirm: 'Send it',
      };
    default:
      return { title: a.label || 'Do this?', lines: [], confirm: 'Do it' };
  }
}
