"use client";

// ─── Client-side API helpers ────────────────────────────────────────────

import type {
  AnalyzeResult,
  CandidateMovie,
  Friend,
  RecommendationResult,
} from "@/lib/types";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Whether a thrown error is a transport-level failure (DNS, dropped
 * connection, airplane mode) rather than a real server response. Those are
 * worth retrying on flaky mobile data; a 4xx from the server is not.
 */
function isTransportError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 0;
}

function networkErrorMessage(): string {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "You're offline — reconnect and this will pick up where it left off.";
  }
  return "Network error — check your connection and try again.";
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Retry a short request a few times with backoff. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransportError(err) || i === attempts - 1) throw err;
      // 400ms, 1.2s — short enough to feel instant, long enough that a
      // one-bar signal has a chance to come back.
      await sleep(400 * 3 ** i);
    }
  }
  throw lastErr;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(networkErrorMessage(), 0);
  }

  let data: { error?: string } & T;
  try {
    data = await res.json();
  } catch {
    throw new ApiError("Unexpected response from the server.", res.status);
  }

  if (!res.ok) {
    throw new ApiError(
      data.error ?? "Something went wrong. Please try again.",
      res.status,
    );
  }
  return data;
}

async function get<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch {
    throw new ApiError(networkErrorMessage(), 0);
  }

  let data: T & { error?: string };
  try {
    data = await res.json();
  } catch {
    throw new ApiError("Unexpected response from the server.", res.status);
  }

  if (!res.ok) {
    throw new ApiError(
      data.error ?? "Something went wrong. Please try again.",
      res.status,
    );
  }
  return data;
}

// ─── Long-running jobs (crawls) ──────────────────────────────────────────
// A crawl can take a minute or more. Holding one POST open for that long
// breaks on mobile: the socket is idle the whole time, carrier NATs and
// transparent proxies reap it, and Chrome rejects the fetch — surfacing as
// "Network error" with nothing to show for it. Instead we ask the server to
// *start* the work, then poll with short requests. A dropped poll just
// retries, so a single flaky moment no longer costs the user the whole crawl.

const POLL_START_MS = 1000;
const POLL_MAX_MS = 3000;
/** Give up on a crawl after this long rather than polling forever. */
const JOB_DEADLINE_MS = 30 * 60 * 1000;

type JobPoll<T> =
  | { state: "pending" }
  | { state: "done"; result: T }
  | { state: "error"; error: string; status: number };

/**
 * Start a job, then poll until it resolves. Resolves with the job's result
 * or throws an ApiError carrying the server's own message.
 */
async function runJob<T>(
  url: string,
  body: Record<string, unknown>,
): Promise<T> {
  // One id per *run*, reused across transport retries so a connection that
  // died after the server accepted the work reattaches to that same crawl
  // instead of starting a second one.
  const requestId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const { jobId } = await withRetry(() =>
    post<{ jobId: string }>(url, { ...body, requestId }),
  );

  const deadline = Date.now() + JOB_DEADLINE_MS;
  let delay = POLL_START_MS;

  while (Date.now() < deadline) {
    await sleep(delay);
    // Back off gently so a long crawl doesn't hammer the radio — this also
    // runs alongside the /api/status poll that feeds the progress text.
    delay = Math.min(POLL_MAX_MS, Math.round(delay * 1.3));

    let poll: JobPoll<T>;
    try {
      poll = await withRetry(() => get<JobPoll<T>>(`/api/jobs/${jobId}`));
    } catch (err) {
      // A vanished job means the server restarted mid-crawl; there's nothing
      // to resume, so surface it instead of polling a dead id.
      if (err instanceof ApiError && err.status === 404) throw err;
      // Anything else (a dropped poll, a brief 5xx) — keep waiting until the
      // deadline, since the crawl itself is probably still running.
      continue;
    }

    if (poll.state === "done") return poll.result;
    if (poll.state === "error") {
      throw new ApiError(poll.error, poll.status || 500);
    }
  }

  throw new ApiError(
    "This is taking longer than expected. The Letterboxd is blocking requests 😿. Please try later.",
    504,
  );
}

export function analyzeTaste(
  username: string,
  matchTaste = false,
): Promise<AnalyzeResult> {
  return runJob<AnalyzeResult>("/api/analyze", { username, matchTaste });
}

export function validateFriend(username: string): Promise<{ friend: Friend }> {
  return runJob<{ friend: Friend }>("/api/friends", { username });
}

export function getRecommendations(
  username: string,
  friendIds: string[],
  genre: string,
  weights?: Record<string, number>,
): Promise<RecommendationResult> {
  return runJob<RecommendationResult>("/api/recommend", {
    username,
    friendIds,
    genre,
    weights,
  });
}

/** Re-run the AI layer on the current picks to refresh reasons + look-alikes. */
export function refineRecommendations(
  candidates: CandidateMovie[],
  genre: string,
): Promise<{
  candidates: CandidateMovie[];
  aiUsed: boolean;
  aiError?: string | null;
}> {
  return runJob("/api/refine", { candidates, genre });
}

/** Ask Gemini for a few NEW films based on the current picks. */
export function suggestMoreMovies(
  candidates: CandidateMovie[],
  genre: string,
): Promise<{
  movies: CandidateMovie[];
  aiUsed: boolean;
  aiError?: string | null;
}> {
  return runJob("/api/suggest-more", { candidates, genre });
}

/** Map a free-text vibe description to one of the app's Letterboxd genres. */
export function classifyMood(
  description: string,
): Promise<{ genre: string | null; aiError?: string | null }> {
  return runJob("/api/classify-mood", { description });
}
