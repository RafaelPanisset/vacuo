import { mkdir, readFile, writeFile } from "node:fs/promises";
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

let lastRequestAt = 0;

/**
 * GET an OpenF1 endpoint. Responses are cached on disk when `cache` is true,
 * which is only safe for sessions that have already finished.
 */
export async function get<T>(endpoint: string, params: Params, { cache = true } = {}): Promise<T[]> {
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const cachePath = join(CACHE_DIR, `${endpoint}__${query.toString().replace(/[^\w=-]/g, "_")}.json`);

  if (cache) {
    const cached = await readFile(cachePath, "utf8").catch(() => null);
    if (cached !== null) return JSON.parse(cached);
  }

  const data = await fetchWithRetry<T>(`${BASE_URL}/${endpoint}?${query}`);

  if (cache) {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(cachePath, JSON.stringify(data));
  }
  return data;
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
      await sleep(backoffMs(attempt));
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
    await sleep(retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt));
  }
}

function backoffMs(attempt: number) {
  return 2 ** attempt * 1000;
}

async function throttle() {
  const wait = lastRequestAt + MIN_SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
