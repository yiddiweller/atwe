import { api } from './client';

/**
 * Making an account, in three server steps — the same ones the web walks.
 *
 *   start  → we email a six-digit code (409 if that email already has an account)
 *   check  → is the code right? (asked before collecting anything else, so
 *            nobody fills in a whole form and is then told the email was wrong)
 *   finish → name, password, date of birth, handle → a real account and a token
 *
 * The older single-shot `/api/auth/signup` is NOT this: it returns
 * `{pending:true}` and emails a code, and it needs a date of birth. The phone
 * was posting to it without one and expecting a token, so signing up did not
 * work at all.
 */

export async function startSignup(email: string): Promise<void> {
  await api.post('/api/auth/signup/start', { email }, { noAuth: true });
}

export async function checkSignupCode(email: string, code: string): Promise<void> {
  await api.post('/api/auth/signup/check', { email, code }, { noAuth: true });
}

export async function resendSignupCode(email: string): Promise<void> {
  await api.post('/api/auth/signup/resend', { email }, { noAuth: true });
}
