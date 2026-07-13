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
