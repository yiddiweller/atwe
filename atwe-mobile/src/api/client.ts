import { API_URL, REQUEST_TIMEOUT } from './config';

/**
 * Thin, typed fetch wrapper around the Atwe REST API. Mirrors the web app's
 * `API` helper: attaches the bearer token, sends/receives JSON, throws a typed
 * error on non-2xx, and surfaces `status` + `body` so callers can branch (e.g.
 * the 2FA challenge returns `401 {twoFactorRequired:true}`).
 *
 * The token is injected via `setAuthTokenGetter` from the auth layer so this
 * module has no dependency on storage/React.
 */

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `Request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

type TokenGetter = () => string | null;
let getToken: TokenGetter = () => null;

/** Wire the auth layer's token source in once at app start. */
export function setAuthTokenGetter(fn: TokenGetter) {
  getToken = fn;
}

/** Optional hook the auth layer sets to react to a global 401 (e.g. force logout). */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Extra headers merged over the defaults. */
  headers?: Record<string, string>;
  /** Skip attaching the bearer token (for public endpoints). */
  noAuth?: boolean;
  signal?: AbortSignal;
}

export async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, noAuth = false, signal } = opts;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  // Chain an externally-provided signal.
  if (signal) signal.addEventListener('abort', () => controller.abort());

  const token = noAuth ? null : getToken();
  const finalHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...(body != null ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...headers,
  };

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: finalHeaders,
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if ((err as Error).name === 'AbortError') {
      throw new ApiError(0, null, 'The request timed out. Check your connection and try again.');
    }
    throw new ApiError(0, null, "Couldn't reach Atwe. Check your connection and try again.");
  }
  clearTimeout(timeout);

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    if (res.status === 401 && !noAuth) onUnauthorized?.();
    throw new ApiError(res.status, data, friendlyMessage(res.status, data));
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function friendlyMessage(status: number, body: unknown): string {
  const b = body as { error?: string; message?: string } | null;
  if (b?.error) return b.error;
  if (b?.message) return b.message;
  if (status === 401) return 'Please sign in again.';
  if (status === 403) return "You don't have access to that.";
  if (status === 429) return "You're going a little fast — try again in a moment.";
  if (status >= 500) return 'Atwe had a problem. Please try again.';
  return `Something went wrong (${status}).`;
}

/** Convenience verb helpers. */
export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method'>) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method'>) =>
    request<T>(path, { ...opts, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method'>) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  del: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'DELETE' }),
};
