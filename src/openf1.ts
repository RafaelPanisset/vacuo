import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BASE_URL = "https://api.openf1.org/v1";
const CACHE_DIR = ".cache/openf1";

// Free tier allows 3 req/s and 30 req/min. Spacing requests 2.1s apart keeps us under both.
const MIN_SPACING_MS = 2100;
const MAX_ATTEMPTS = 4;

export type Session = {
  session_key: number;
  session_name: string;
  date_start: string;
  date_end: string;
  location: string;
  country_name: string;
  circuit_short_name: string;
  year: number;
  is_cancelled?: boolean;
};

export type Driver = {
  driver_number: number;
  name_acronym: string;
  full_name: string;
  team_name: string;
  team_colour: string;
};

// `interval` is the gap to the car ahead in the classification. It can be null
// (leader, missing sample) or a string like "+1 LAP".
export type Interval = {
  date: string;
  driver_number: number;
  interval: number | string | null;
  gap_to_leader: number | string | null;
};

export type Position = {
  date: string;
  driver_number: number;
  position: number;
};

export type Lap = {
  driver_number: number;
  lap_number: number;
  date_start: string | null;
  lap_duration: number | null;
  is_pit_out_lap?: boolean;
};

/** Car position on track, sampled at roughly 3.7 Hz. */
export type Location = {
  date: string;
  driver_number: number;
  x: number;
  y: number;
  z: number;
};

export type RaceControl = {
  date: string;
  category: string;
  flag: string | null;
  message: string;
  lap_number: number | null;
};

export type Pit = {
  date: string;
  driver_number: number;
  lap_number: number;
  lane_duration: number | null;
};

type Params = Record<string, string | number>;

// No request goes out before this time; rate limits push it further back for everyone.
let nextRequestAt = 0;
let queue: Promise<void> = Promise.resolve();
let tempFiles = 0;

/**
 * GET an OpenF1 endpoint. Responses are cached on disk when `cache` is true,
 * which is only safe for sessions that have already finished.
 */
export async function get<T>(endpoint: string, params: Params, { cache = true } = {}): Promise<T[]> {
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const cachePath = join(CACHE_DIR, `${endpoint}__${query.toString().replace(/[^\w=-]/g, "_")}.json`);

  if (cache) {
    const cached = await readCache<T>(cachePath);
    if (cached) return cached;
  }

  const data = await fetchWithRetry<T>(`${BASE_URL}/${endpoint}?${query}`);

  // An empty result can just mean OpenF1 hasn't published the data yet, so it isn't kept.
  if (cache && data.length > 0) await writeCache(cachePath, data);
  return data;
}

async function readCache<T>(path: string): Promise<T[] | null> {
  const text = await readFile(path, "utf8").catch(() => null);
  if (text === null) return null;
  try {
    const data = JSON.parse(text);
    // Older versions cached empty results, which may just have been published late.
    return Array.isArray(data) && data.length > 0 ? data : null;
  } catch {
    // Unreadable (say, from an older interrupted write): fetch it again.
    return null;
  }
}

/** The cache only saves time, so failing to write it never fails the request. */
async function writeCache(path: string, data: unknown[]) {
  // Written next to the target and renamed into place, so a crash mid-write
  // never leaves a half-written file behind.
  const temp = `${path}.${process.pid}.${++tempFiles}.tmp`;
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(temp, JSON.stringify(data));
    await rename(temp, path);
  } catch (err) {
    await rm(temp, { force: true }).catch(() => {});
    console.error(`Warning: could not cache ${path}: ${(err as Error).message}`);
  }
}

async function fetchWithRetry<T>(url: string): Promise<T[]> {
  for (let attempt = 1; ; attempt++) {
    await throttle();
    let res: Response;
    let body: string;
    try {
      res = await fetch(url);
      body = await res.text();
    } catch (err) {
      // Large responses sometimes get cut off mid-body ("terminated"); that's worth retrying.
      if (attempt === MAX_ATTEMPTS) throw err;
      holdRequests(backoffMs(attempt));
      continue;
    }

    if (res.ok) return JSON.parse(body);
    // OpenF1 answers 404 {"detail": "No results found."} for an empty result set.
    if (res.status === 404) return [];

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS) {
      throw new Error(`OpenF1 ${res.status} for ${url}: ${body}`);
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    holdRequests(retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt));
  }
}

/** Keeps every request, not just the one being retried, from going out for `ms`. */
function holdRequests(ms: number) {
  nextRequestAt = Math.max(nextRequestAt, Date.now() + ms);
}

function backoffMs(attempt: number) {
  return 2 ** attempt * 1000;
}

/** Waits for this request's turn. Calls made at the same time line up instead of going out together. */
function throttle(): Promise<void> {
  const turn = queue.then(async () => {
    // Re-check after sleeping: a rate limit may have pushed the time back meanwhile.
    for (let wait = nextRequestAt - Date.now(); wait > 0; wait = nextRequestAt - Date.now()) await sleep(wait);
    nextRequestAt = Date.now() + MIN_SPACING_MS;
  });
  queue = turn;
  return turn;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
