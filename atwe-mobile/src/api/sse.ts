import { API_URL } from './config';
import { api } from './client';

/**
 * Realtime client for the Atwe SSE stream.
 *
 * The backend never accepts the 30-day bearer in a URL: you first mint a
 * short-lived stream token (`GET /api/rt/token`) then connect to
 * `GET /api/rt/stream?token=...`. React Native has no native EventSource, so
 * this uses XMLHttpRequest incremental streaming (supported by RN's networking
 * layer) and parses the SSE wire format by hand.
 *
 * It also handles the iOS reality that a backgrounded socket dies silently:
 * call `reconnect()` from an AppState 'active' / NetInfo 'online' listener to
 * force a fresh connection (mirrors the web app's `rtResync`).
 *
 * For production you may swap the transport for `react-native-sse`; the public
 * surface here (connect/close/on) is intentionally minimal so that's a drop-in.
 */

export type RtEvent =
  | 'msg' | 'read' | 'read-self' | 'typing'
  | 'presence' | 'presence-init'
  | 'dm_edited' | 'dm_reaction' | 'dm_deleted' | 'metaupd'
  | 'call' | 'group-call' | 'live' | 'cloud' | 'order' | 'wallet'
  | 'notif' | 'pin' | 'disappearing' | 'story' | 'liveloc' | 'stage';

type Handler = (data: unknown, event: RtEvent) => void;

export class RealtimeClient {
  private xhr: XMLHttpRequest | null = null;
  private buffer = '';
  private handlers = new Map<RtEvent | '*', Set<Handler>>();
  private closed = false;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  /** Subscribe to a named event, or '*' for all. Returns an unsubscribe fn. */
  on(event: RtEvent | '*', handler: Handler): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(handler);
    return () => set!.delete(handler);
  }

  async connect(): Promise<void> {
    this.closed = false;
    try {
      const { token } = await api.get<{ token: string }>('/api/rt/token');
      if (this.closed) return;
      this.openStream(token);
    } catch {
      this.scheduleReconnect();
    }
  }

  /** Force a fresh connection (bind to AppState 'active' / NetInfo online). */
  reconnect(): void {
    this.teardownXhr();
    this.connect();
  }

  close(): void {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.teardownXhr();
  }

  // ── internals ──────────────────────────────────────────────────────────

  private openStream(token: string) {
    const xhr = new XMLHttpRequest();
    this.xhr = xhr;
    this.buffer = '';
    xhr.open('GET', `${API_URL}/api/rt/stream?token=${encodeURIComponent(token)}`);
    xhr.setRequestHeader('Accept', 'text/event-stream');

    let lastIndex = 0;
    xhr.onreadystatechange = () => {
      // readyState 3 = LOADING (streaming chunks arrive here)
      if (xhr.readyState >= 3 && xhr.status === 200) {
        const chunk = xhr.responseText.slice(lastIndex);
        lastIndex = xhr.responseText.length;
        this.feed(chunk);
        this.retry = 0;
      }
      if (xhr.readyState === 4) {
        if (!this.closed) this.scheduleReconnect();
      }
    };
    xhr.onerror = () => {
      if (!this.closed) this.scheduleReconnect();
    };
    xhr.send();
  }

  /** Parse SSE frames: blocks separated by \n\n, lines "event:" / "data:". */
  private feed(chunk: string) {
    this.buffer += chunk;
    let sep: number;
    while ((sep = this.buffer.indexOf('\n\n')) !== -1) {
      const raw = this.buffer.slice(0, sep);
      this.buffer = this.buffer.slice(sep + 2);
      this.dispatch(raw);
    }
  }

  private dispatch(frame: string) {
    let event: RtEvent = 'msg';
    const dataLines: string[] = [];
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim() as RtEvent;
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) return;
    let payload: unknown = dataLines.join('\n');
    try {
      payload = JSON.parse(payload as string);
    } catch {
      /* keep raw string */
    }
    this.handlers.get(event)?.forEach((h) => h(payload, event));
    this.handlers.get('*')?.forEach((h) => h(payload, event));
  }

  private scheduleReconnect() {
    this.teardownXhr();
    if (this.closed) return;
    this.retry = Math.min(this.retry + 1, 6);
    const delay = Math.min(1000 * 2 ** this.retry, 30_000);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private teardownXhr() {
    if (this.xhr) {
      try {
        this.xhr.abort();
      } catch {
        /* noop */
      }
      this.xhr = null;
    }
  }
}

/** App-wide singleton. */
export const realtime = new RealtimeClient();
