import { useQuery } from '@tanstack/react-query';
import { api } from './client';

/**
 * Jobs — the two-sided marketplace, mirroring `mapJob` on the server exactly.
 * Employers post roles; workers apply and list themselves as open to work.
 * Field names match the wire, never a tidier local spelling.
 */

export type SalaryPeriod = 'year' | 'month' | 'week' | 'day' | 'hour';
export type ApplicantStatus = 'applied' | 'reviewed' | 'shortlisted' | 'rejected' | 'hired';

export const APPLICANT_STATUSES: ApplicantStatus[] = [
  'applied', 'reviewed', 'shortlisted', 'rejected', 'hired',
];

export const JOB_TYPES = [
  'Full-time', 'Part-time', 'Contract', 'Internship', 'Temporary', 'Freelance',
] as const;

export interface JobPoster {
  id: number;
  name: string;
  username: string | null;
  avatar: string | null;
  accountType: 'personal' | 'business';
}

/** A screening question as the APPLICANT sees it — the knockout `expect` is
 *  stripped server-side, so it is deliberately absent from this type. */
export interface ScreeningQuestion {
  id: string;
  text: string;
  type: 'yesno' | 'number' | 'text';
  required: boolean;
}

export interface Job {
  id: number;
  title: string;
  company: string | null;
  location: string | null;
  industry: string | null;
  type: string | null;
  remote: boolean;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryPeriod: SalaryPeriod | null;
  hours: string | null;
  description: string | null;
  created_at: string;
  poster: JobPoster | null;
  verifiedEmployer: boolean;
  /** Only present on list/detail reads (the count subquery). */
  applicants?: number;
  /** Fewer than ten people have applied — "be an early applicant". */
  earlyApplicant?: boolean;
  applied: boolean;
  saved: boolean;
  mine: boolean;
  applicationStatus: ApplicantStatus | null;
  featured: boolean;
  closesAt: string | null;
  closed: boolean;
  screening: ScreeningQuestion[];
}

export interface JobsResponse { jobs: Job[]; types: string[] }

export interface JobFilters {
  q?: string;
  type?: string;
  remote?: boolean;
  /** Which shelf: everything, the ones I saved, the ones I applied to, mine. */
  scope?: 'all' | 'saved' | 'applied' | 'mine';
}

function jobsQuery(f: JobFilters): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.type) p.set('type', f.type);
  if (f.remote) p.set('remote', 'true');
  if (f.scope === 'saved') p.set('saved', 'true');
  if (f.scope === 'applied') p.set('applied', 'true');
  if (f.scope === 'mine') p.set('mine', 'true');
  const qs = p.toString();
  return `/api/jobs${qs ? `?${qs}` : ''}`;
}

export function useJobs(f: JobFilters) {
  return useQuery({
    queryKey: ['jobs', f.q ?? '', f.type ?? '', !!f.remote, f.scope ?? 'all'],
    queryFn: () => api.get<JobsResponse>(jobsQuery(f)),
  });
}

export function useJob(id: number | string) {
  return useQuery({
    queryKey: ['job', String(id)],
    queryFn: () => api.get<{ job: Job }>(`/api/jobs/${id}`),
    enabled: id != null && id !== '',
  });
}

export function useSimilarJobs(id: number | string) {
  return useQuery({
    queryKey: ['job-similar', String(id)],
    queryFn: () => api.get<{ jobs: Job[] }>(`/api/jobs/${id}/similar`),
    enabled: id != null && id !== '',
  });
}

/** Applying carries the cover note and any screening answers. */
export interface ApplyArgs {
  note?: string;
  answers?: Record<string, string>;
}

export async function applyToJob(id: number, args: ApplyArgs = {}): Promise<void> {
  await api.post(`/api/jobs/${id}/apply`, args);
}
export async function withdrawApplication(id: number): Promise<void> {
  await api.del(`/api/jobs/${id}/apply`);
}
export async function saveJob(id: number, on: boolean): Promise<void> {
  if (on) await api.post(`/api/jobs/${id}/save`);
  else await api.del(`/api/jobs/${id}/save`);
}

/** "How you match" — Atwe AI, or a skills-overlap heuristic without a key
 *  (`ai:false`). Never gated behind a plan. */
export interface JobMatch {
  score: number;
  level: string;
  have: string[];
  missing: string[];
  summary: string | null;
  ai: boolean;
}
export function matchJob(id: number) {
  return api.post<JobMatch>(`/api/jobs/${id}/match`, {});
}
/** Atwe AI drafts a cover note from the profile + newest resume. 503 with no key. */
export function aiCoverNote(id: number) {
  return api.post<{ note: string }>(`/api/jobs/${id}/ai-cover`, {});
}
/** Recording a view is what feeds the poster's Insights. Best-effort. */
export function recordJobView(id: number): void {
  api.post(`/api/jobs/${id}/view`, {}).catch(() => {});
}

/* ── posting a job, and the pipeline afterwards ───────────────────────────── */

export interface JobDraft {
  title: string;
  company?: string;
  location?: string;
  type?: string;
  remote?: boolean;
  description?: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryPeriod?: SalaryPeriod | null;
}

export function postJob(d: JobDraft) {
  return api.post<{ id: number }>('/api/jobs', d);
}
export async function closeJob(id: number): Promise<void> {
  await api.post(`/api/jobs/${id}/close`, {});
}
export async function deleteJob(id: number): Promise<void> {
  await api.del(`/api/jobs/${id}`);
}

export interface Applicant {
  id: number;
  name: string;
  username: string | null;
  avatar: string | null;
  verified: boolean;
  headline: string | null;
  accountType: 'personal' | 'business';
  status: ApplicantStatus;
  saved: boolean;
  applied_at: string;
  /** The cover note they wrote. NB the server calls it `note`. */
  note: string | null;
  resumeTitle: string | null;
  answers: { id: string; text: string; value: string | null }[];
  /** null when the job asks nothing required; else did they clear the knockouts. */
  meets: boolean | null;
}

export function useApplicants(id: number | string, enabled: boolean) {
  return useQuery({
    queryKey: ['applicants', String(id)],
    queryFn: () => api.get<{
      title: string;
      screening: ScreeningQuestion[];
      applicants: Applicant[];
    }>(`/api/jobs/${id}/applicants`),
    enabled: enabled && id != null && id !== '',
  });
}

export async function setApplicantStatus(
  jobId: number, userId: number, status: ApplicantStatus,
): Promise<void> {
  await api.patch(`/api/jobs/${jobId}/applicants/${userId}`, { status });
}

/* ── open to work ─────────────────────────────────────────────────────────── */

export interface WorkerListing {
  userId: number;
  role: string | null;
  location: string | null;
  schedule: string | null;
  rateMin: number | null;
  rateMax: number | null;
  ratePeriod: SalaryPeriod | null;
  remote: boolean;
  about: string | null;
  user: {
    id: number; name: string; username: string | null; avatar: string | null;
    verified: boolean; headline: string | null; accountType: 'personal' | 'business';
  };
  skills: string[];
}

export function useMyWorkerListing() {
  return useQuery({
    queryKey: ['worker-listing-me'],
    queryFn: () => api.get<{ listing: WorkerListing | null }>('/api/worker-listings/me'),
  });
}
export function useWorkers(q: string, remote: boolean) {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (remote) p.set('remote', 'true');
  const qs = p.toString();
  return useQuery({
    queryKey: ['workers', q, remote],
    queryFn: () => api.get<{ workers: WorkerListing[] }>(`/api/worker-listings${qs ? `?${qs}` : ''}`),
  });
}
/* Being listed and being VISIBLE are two different switches on the server, and
   that catches people out: `worker_listings` holds what you do, while
   `users.otw_visibility` decides who may see it — and it defaults to **off**.
   Post a listing without touching it and you are on the board's table but
   invisible to every search, which reads as "it didn't work". So the app always
   sets both together. */
export type OtwVisibility = 'off' | 'recruiters' | 'everyone';

export function useOpenToWork() {
  return useQuery({
    queryKey: ['open-to-work'],
    queryFn: () => api.get<{ visibility: OtwVisibility; hasListing: boolean }>('/api/open-to-work'),
  });
}
export async function setOpenToWork(visibility: OtwVisibility): Promise<void> {
  await api.put('/api/open-to-work', { visibility });
}

export const OTW_LABEL: Record<OtwVisibility, string> = {
  everyone: 'Everyone',
  recruiters: 'Businesses only',
  off: 'Nobody yet',
};

export interface WorkerDraft {
  role: string;
  location?: string;
  schedule?: string;
  about?: string;
  rateMin?: number | null;
  rateMax?: number | null;
  ratePeriod?: SalaryPeriod | null;
  remote?: boolean;
}
export async function postWorkerListing(d: WorkerDraft): Promise<void> {
  await api.post('/api/worker-listings', d);
}
export async function removeWorkerListing(): Promise<void> {
  await api.del('/api/worker-listings/me');
}

/* ── display helpers ──────────────────────────────────────────────────────── */

const PER: Record<SalaryPeriod, string> = {
  year: '/yr', month: '/mo', week: '/wk', day: '/day', hour: '/hr',
};

/** Whole dollars, grouped — "$85,000". Job pay is stored in whole units, not
 *  cents, unlike everything in the wallet; do not divide by 100 here. */
function amount(n: number): string {
  return '$' + n.toLocaleString('en-US');
}

/** "$60,000–$85,000/yr" · "from $25/hr" · "up to $40/hr" · null when unstated. */
export function payLabel(j: {
  salaryMin: number | null; salaryMax: number | null; salaryPeriod: SalaryPeriod | null;
}): string | null {
  const per = j.salaryPeriod ? PER[j.salaryPeriod] : '';
  if (j.salaryMin != null && j.salaryMax != null) {
    return j.salaryMin === j.salaryMax
      ? amount(j.salaryMin) + per
      : `${amount(j.salaryMin)}–${amount(j.salaryMax)}${per}`;
  }
  if (j.salaryMin != null) return `from ${amount(j.salaryMin)}${per}`;
  if (j.salaryMax != null) return `up to ${amount(j.salaryMax)}${per}`;
  return null;
}

/** Employers type "Remote" into the location box AND tick the remote flag all
 *  the time, which renders "Remote · Remote" side by side. The flag wins,
 *  because that is the one the filter actually searches on. One helper, so the
 *  card and the detail cannot disagree about it. */
export function showsPlace(j: { location: string | null; remote: boolean }): boolean {
  return !!j.location && (j.location ?? '').trim().toLowerCase() !== 'remote';
}

/** The same shape, spelled `rate*` on a worker listing. */
export function rateLabel(w: WorkerListing): string | null {
  return payLabel({ salaryMin: w.rateMin, salaryMax: w.rateMax, salaryPeriod: w.ratePeriod });
}

/** Where an application stands, in the words a person would use. */
export const STATUS_LABEL: Record<ApplicantStatus, string> = {
  applied: 'Applied',
  reviewed: 'Reviewed',
  shortlisted: 'Shortlisted',
  rejected: 'Not selected',
  hired: 'Hired',
};
