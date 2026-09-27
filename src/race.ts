import type { RaceData } from "./battles.ts";
import { get, type Driver, type Interval, type Lap, type Pit, type Position, type RaceControl, type Session } from "./openf1.ts";

export type Race = RaceData & {
  session: Session;
  drivers: Map<number, Driver>;
  /** Whether the session is over, so its responses can be cached for good. */
  final: boolean;
};

// A race can't run past 3 hours including suspensions, so by start + 4h its data is final.
const FINAL_AFTER_MS = 4 * 60 * 60 * 1000;

/** Finds a finished race by session key, "latest", or a circuit/city/country name. */
export async function resolveRace(query: string, year: number): Promise<Session> {
  if (/^\d+$/.test(query)) {
    const [session] = await get<Session>("sessions", { session_key: query }, { cache: false });
    if (!session) throw new Error(`No session with key ${query}.`);
    return session;
  }

  const races = await get<Session>("sessions", { year, session_name: "Race" }, { cache: false });
  const finished = races
    .filter((s) => !s.is_cancelled && Date.parse(s.date_end) < Date.now())
    .sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start));
  if (finished.length === 0) throw new Error(`No finished races in ${year}.`);
  if (query === "latest") return finished[finished.length - 1];

  const needle = normalise(query);
  const match = finished.filter((s) =>
    [s.circuit_short_name, s.location, s.country_name].some((field) => normalise(field).includes(needle)),
  );
  if (match.length === 0) {
    const names = finished.map((s) => s.circuit_short_name.toLowerCase()).join(", ");
    throw new Error(`No finished ${year} race matches "${query}". Try one of: ${names}`);
  }
  // Countries with several races (e.g. "united states") resolve to the most recent one.
  return match[match.length - 1];
}

export async function loadRace(session: Session): Promise<Race> {
  const final = Date.now() > Date.parse(session.date_start) + FINAL_AFTER_MS;
  const params = { session_key: session.session_key };
  const opts = { cache: final };

  const drivers = await get<Driver>("drivers", params, opts);
  const race: Race = {
    session,
    final,
    drivers: new Map(drivers.map((d) => [d.driver_number, d])),
    intervals: await get<Interval>("intervals", params, opts),
    positions: await get<Position>("position", params, opts),
    laps: await get<Lap>("laps", params, opts),
    raceControl: await get<RaceControl>("race_control", params, opts),
    pits: await get<Pit>("pit", params, opts),
  };
  if (race.intervals.length === 0) throw new Error("No interval data for this session yet.");
  return race;
}

/** Parses `[race words...] [year] [--flag value ...]` arguments shared by the CLIs. */
export function parseArgs<F extends Record<string, number>>(argv: string[], flags: F): F & { query: string; year: number } {
  const args = [...argv];
  const values: Record<string, number> = { ...flags };
  for (const flag of Object.keys(flags)) {
    const i = args.indexOf(`--${flag}`);
    if (i >= 0) values[flag] = Number(args.splice(i, 2)[1]);
  }
  // The last word is the year when it looks like one; OpenF1 session keys are never in the 2000s.
  const year = /^20\d\d$/.test(args.at(-1) ?? "") ? Number(args.pop()) : new Date().getFullYear();
  // Everything else is the race, so names like "las vegas" or "abu dhabi" work unquoted.
  const query = args.join(" ") || "latest";
  return { ...(values as F), query, year };
}

function normalise(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}
