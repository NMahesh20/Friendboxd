// ─── In-memory job store (for long-running crawls) ─────────────────────────
// A crawl takes tens of seconds, so the obvious design — one POST held open
// until it's done — is fragile on mobile. The connection carries zero bytes
// for that whole stretch, and mobile carrier NATs / transparent proxies
// happily reap idle TCP connections; Chrome then rejects the in-flight
// fetch and the user just sees "Network error". The 2s /api/status poll
// doesn't help because it runs on its own socket, not the crawl's.
//
// So the long routes return a job id immediately and the client polls a
// cheap GET until the result lands. Every exchange is short, a dropped poll
// simply retries, and nothing depends on one connection surviving.
//
// LIFESPAN: process memory only, swept after TTL. A cold start or a redeploy
// loses in-flight jobs — the client sees the job disappear and is told to
// start again, which is a far better failure than a hung spinner. Crawls
// don't span restarts in practice because keepalive.ts pings the health
// endpoint while a crawl is in flight.

export type JobState = 'pending' | 'done' | 'error';

export interface JobRecord<T = unknown> {
  state: JobState;
  /** Result payload, set only when state === 'done'. */
  result?: T;
  /** Human-readable error, set only when state === 'error'. */
  error?: string;
  /** HTTP-ish status to replay on the client, set only when state === 'error'. */
  errorStatus?: number;
  /**
   * Client-supplied id for this run. A retry of the *same* run reuses it so
   * a connection that died after the server accepted the work doesn't kick
   * off a second identical crawl.
   */
  key?: string;
  createdAt: number;
  /** Absolute time after which the record is swept. */
  expiresAt: number;
}

/** How long a finished (or abandoned) job stays readable. */
const JOB_TTL_MS = 15 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;
/** Backstop against unbounded growth if a crawl is abandoned repeatedly. */
const MAX_JOBS = 200;

interface JobStore {
  jobs: Map<string, JobRecord>;
  timer: ReturnType<typeof setInterval> | null;
}

// Stashed on globalThis so dev hot-reloads don't orphan running jobs.
const g = globalThis as typeof globalThis & { __friendboxdJobs?: JobStore };
const store: JobStore = (g.__friendboxdJobs ??= { jobs: new Map(), timer: null });

function sweep(): void {
  const now = Date.now();
  for (const [id, job] of store.jobs) {
    if (job.expiresAt <= now) store.jobs.delete(id);
  }
}

function ensureSweeper(): void {
  if (store.timer) return;
  store.timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  // Never let the sweeper alone hold the process open.
  store.timer.unref?.();
}

/**
 * Register a new pending job. When `key` is given and a job with the same
 * key is still pending, that job is returned instead with `created: false` —
 * a retried request reattaches to the work already in flight rather than
 * crawling everything a second time. Only start the work when `created`.
 *
 * The returned id is 128 bits of randomness, so one client can never read
 * another's result.
 */
export function createJob<T>(key?: string): { jobId: string; created: boolean } {
  ensureSweeper();

  if (key) {
    for (const [existingId, job] of store.jobs) {
      if (job.key === key && job.state === 'pending') {
        return { jobId: existingId, created: false };
      }
    }
  }

  // Drop the oldest entries first if we're somehow at the cap.
  if (store.jobs.size >= MAX_JOBS) {
    const oldest = [...store.jobs.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    for (const [id] of oldest.slice(0, Math.max(1, store.jobs.size - MAX_JOBS + 1))) {
      store.jobs.delete(id);
    }
  }

  const id = globalThis.crypto.randomUUID().replace(/-/g, '');
  const now = Date.now();
  store.jobs.set(id, {
    state: 'pending',
    key,
    createdAt: now,
    expiresAt: now + JOB_TTL_MS,
  });
  return { jobId: id, created: true };
}

export function completeJob<T>(id: string, result: T): void {
  const job = store.jobs.get(id);
  if (!job) return;
  job.state = 'done';
  job.result = result;
  job.expiresAt = Date.now() + JOB_TTL_MS;
}

export function failJob(id: string, error: string, status = 500): void {
  const job = store.jobs.get(id);
  if (!job) return;
  job.state = 'error';
  job.error = error;
  job.errorStatus = status;
  job.expiresAt = Date.now() + JOB_TTL_MS;
}

/** Read a job, or null when it's unknown or already swept. */
export function getJob<T>(id: string): JobRecord<T> | null {
  const job = store.jobs.get(id) as JobRecord<T> | undefined;
  if (!job) return null;
  if (job.expiresAt <= Date.now()) {
    store.jobs.delete(id);
    return null;
  }
  return job;
}
