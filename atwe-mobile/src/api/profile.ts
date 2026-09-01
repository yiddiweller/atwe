import { api } from './client';
import type { User } from './types';

/**
 * Editing your own profile.
 *
 * `PUT /api/auth/profile` updates only the keys PRESENT in the body — but name
 * and username are the exception: it refuses a body without a name, and treats a
 * missing username as clearing it. So both are always sent, whether or not they
 * changed. That is the route's documented trap and the reason this wrapper takes
 * them as required.
 *
 * Photos follow a third rule: **absent leaves it alone, empty removes it, a data
 * URL sets it.** So `avatar` is only included when the person actually picked or
 * removed one — the stored value comes back as a signed URL rather than the
 * original bytes, and sending that back would try to save a URL as an image.
 */
export interface ProfileInput {
  name: string;
  username: string;
  headline?: string;
  bio?: string;
  location?: string;
  website?: string;
  /** Omit to leave unchanged; '' to remove; a data URL to set. */
  avatar?: string | null;
  banner?: string | null;
}

export async function saveProfile(v: ProfileInput): Promise<User> {
  const r = await api.put<{ user: User }>('/api/auth/profile', v);
  return r.user;
}
