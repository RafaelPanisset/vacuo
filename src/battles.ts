import type { Interval, Lap, Pit, Position, RaceControl } from "./openf1.ts";

export type RaceData = {
  intervals: Interval[];
  positions: Position[];
  laps: Lap[];
  raceControl: RaceControl[];
  pits: Pit[];
};

export type Battle = {
  /** Driver numbers as [ahead, behind] when the battle started. */
  drivers: [number, number];
  start: number;
  end: number;
  startLap: number;
  endLap: number;
  /** Best classification position the two were fighting for. */
  position: number;
  minGap: number;
  meanGap: number;
  /** How many times the order between the two flipped. */
  swaps: number;
  score: number;
  /** Gap samples for the pair during the battle, in time order. */
  samples: PairSample[];
};

export type Options = {
  /** Seconds. A battle starts when the car behind gets inside this gap. */
  closeGap: number;
  /**
   * Seconds. A battle only ends once the gap grows past this, so a car hovering
   * around `closeGap` doesn't split one fight into several.
   */
  releaseGap: number;
  /** A battle ends if the pair has no samples for this long (neutralised, pit stop, lost adjacency). */
  maxSilenceMs: number;
  minDurationMs: number;
};

export const DEFAULT_OPTIONS: Options = {
  closeGap: 1.0,
  releaseGap: 1.5,
  maxSilenceMs: 40_000,
  minDurationMs: 90_000,
};

type Window = { from: number; to: number };

export type PairSample = {
  t: number;
  ahead: number;
  behind: number;
  gap: number;
  /** Position of the car ahead, i.e. the position being fought for. */
  position: number;
};

// Overtaking is switched off (DRS before 2026, overtake mode from 2026) whenever
// the race is neutralised, so these messages bracket the periods of real racing.
const OVERTAKING_ENABLED = /\b(DRS|OVERTAKE) ENABLED\b/;
const NEUTRALISED = /\b(DRS|OVERTAKE) DISABLED\b|(?<!VIRTUAL )SAFETY CAR DEPLOYED|RED FLAG/;
const VSC_DEPLOYED = /\b(VSC|VIRTUAL SAFETY CAR) DEPLOYED\b/;
const VSC_ENDING = /\b(VSC|VIRTUAL SAFETY CAR) ENDING\b/;
// After "VSC ENDING" drivers still need a few seconds to get back up to speed.
const VSC_RESUME_MS = 15_000;
// A pit stop reshuffles the order without anyone fighting for it.
const PIT_MARGIN_MS = 20_000;
const DEFAULT_PIT_LANE_S = 30;

export function findBattles(data: RaceData, options: Partial<Options> = {}): Battle[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const neutralised = neutralisedWindows(data.raceControl);
  const pits = pitWindows(data.pits);
  const samples = adjacentSamples(data).filter(
    (s) =>
      !inAny(neutralised, s.t) &&
      !inAny(pits.get(s.ahead) ?? [], s.t) &&
      !inAny(pits.get(s.behind) ?? [], s.t),
  );
  const lapAt = lapLookup(data.laps);

  const battles: Battle[] = [];
  for (const pairSamples of groupBy(samples, (s) => pairKey(s.ahead, s.behind)).values()) {
    for (const segment of battleSegments(pairSamples, opts)) {
      const first = segment[0];
      const last = segment[segment.length - 1];
      if (last.t - first.t < opts.minDurationMs) continue;

      const gaps = segment.map((s) => s.gap);
      const battle: Omit<Battle, "score"> = {
        samples: segment,
        drivers: [first.ahead, first.behind],
        start: first.t,
        end: last.t,
        startLap: lapAt(first.behind, first.t),
        endLap: lapAt(last.behind, last.t),
        position: Math.min(...segment.map((s) => s.position)),
        minGap: Math.min(...gaps),
        meanGap: gaps.reduce((a, b) => a + b, 0) / gaps.length,
        swaps: segment.filter((s, i) => i > 0 && s.ahead !== segment[i - 1].ahead).length,
      };
      battles.push({ ...battle, score: score(battle) });
    }
  }
  return battles.sort((a, b) => b.score - a.score);
}

/**
 * Long, close fights for high positions that end in an overtake score best.
 * Length is square-rooted so a 20-lap DRS train doesn't beat a 3-lap fight for the lead.
 */
function score(b: Omit<Battle, "score" | "samples">): number {
  const laps = Math.max(1, b.endLap - b.startLap + 1);
  const positionWeight = 1 + (2 * (20 - Math.min(b.position, 20))) / 19;
  const closeness = 2 - b.meanGap;
  const action = 1 + 0.5 * Math.min(b.swaps, 4);
  return Math.sqrt(laps) * positionWeight * closeness * action;
}

export function neutralisedWindows(raceControl: RaceControl[]): Window[] {
  const messages = [...raceControl].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const windows: Window[] = [];
  // Until overtaking is first enabled (formation lap, opening lap) the field runs nose to tail.
  let neutralSince: number | null = messages.some((m) => OVERTAKING_ENABLED.test(m.message)) ? -Infinity : null;
  let vscSince: number | null = null;

  for (const m of messages) {
    const t = Date.parse(m.date);
    if (NEUTRALISED.test(m.message)) {
      neutralSince ??= t;
    } else if (OVERTAKING_ENABLED.test(m.message) && neutralSince !== null) {
      windows.push({ from: neutralSince, to: t });
      neutralSince = null;
    }
    if (VSC_DEPLOYED.test(m.message)) {
      vscSince ??= t;
    } else if (VSC_ENDING.test(m.message) && vscSince !== null) {
      windows.push({ from: vscSince, to: t + VSC_RESUME_MS });
      vscSince = null;
    }
  }
  if (neutralSince !== null) windows.push({ from: neutralSince, to: Infinity });
  if (vscSince !== null) windows.push({ from: vscSince, to: Infinity });
  return windows;
}

function pitWindows(pits: Pit[]): Map<number, Window[]> {
  const windows = new Map<number, Window[]>();
  for (const p of pits) {
    const entry = Date.parse(p.date);
    const laneMs = (p.lane_duration ?? DEFAULT_PIT_LANE_S) * 1000;
    const list = windows.get(p.driver_number) ?? [];
    list.push({ from: entry - PIT_MARGIN_MS, to: entry + laneMs + PIT_MARGIN_MS });
    windows.set(p.driver_number, list);
  }
  return windows;
}

/**
 * Replays position changes and interval samples in time order, so each interval
 * sample can be paired with whoever was directly ahead at that moment.
 */
export function adjacentSamples(data: RaceData): PairSample[] {
  type Event =
    | { t: number; kind: "position"; driver: number; position: number }
    | { t: number; kind: "interval"; driver: number; gap: Interval["interval"] };

  const events: Event[] = [
    ...data.positions.map((p): Event => ({ t: Date.parse(p.date), kind: "position", driver: p.driver_number, position: p.position })),
    ...data.intervals.map((i): Event => ({ t: Date.parse(i.date), kind: "interval", driver: i.driver_number, gap: i.interval })),
  ];
  // On equal timestamps apply position changes first.
  events.sort((a, b) => a.t - b.t || (a.kind === "position" ? -1 : 1));

  const positionOf = new Map<number, number>();
  const driverAt = new Map<number, number>();
  const samples: PairSample[] = [];

  for (const e of events) {
    if (e.kind === "position") {
      positionOf.set(e.driver, e.position);
      driverAt.set(e.position, e.driver);
      continue;
    }
    if (typeof e.gap !== "number" || e.gap <= 0) continue;

    const position = positionOf.get(e.driver);
    if (position === undefined || position === 1) continue;
    const ahead = driverAt.get(position - 1);
    // Position updates for two swapping cars arrive separately; skip until both agree.
    if (ahead === undefined || positionOf.get(ahead) !== position - 1) continue;

    samples.push({ t: e.t, ahead, behind: e.driver, gap: e.gap, position: position - 1 });
  }
  return samples;
}

/** Splits one pair's samples into battles, using `closeGap`/`releaseGap` as hysteresis. */
function battleSegments(samples: PairSample[], opts: Options): PairSample[][] {
  const segments: PairSample[][] = [];
  let current: PairSample[] | null = null;

  const close = () => {
    if (!current) return;
    // Drop the tail where the gap was already opening up, so the battle ends at the last close moment.
    while (current[current.length - 1].gap >= opts.closeGap) current.pop();
    segments.push(current);
    current = null;
  };

  for (const s of samples) {
    const last = current?.[current.length - 1];
    if (last && (s.gap >= opts.releaseGap || s.t - last.t > opts.maxSilenceMs)) close();
    if (current) current.push(s);
    else if (s.gap < opts.closeGap) current = [s];
  }
  close();
  return segments;
}

function lapLookup(laps: Lap[]): (driver: number, t: number) => number {
  const starts = new Map<number, { t: number; lap: number }[]>();
  for (const l of laps) {
    if (!l.date_start) continue;
    const list = starts.get(l.driver_number) ?? [];
    list.push({ t: Date.parse(l.date_start), lap: l.lap_number });
    starts.set(l.driver_number, list);
  }
  for (const list of starts.values()) list.sort((a, b) => a.t - b.t);

  return (driver, t) => {
    let lap = 1;
    for (const s of starts.get(driver) ?? []) {
      if (s.t > t) break;
      lap = s.lap;
    }
    return lap;
  };
}

function inAny(windows: Window[], t: number): boolean {
  return windows.some((w) => t >= w.from && t <= w.to);
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = groups.get(k) ?? [];
    list.push(item);
    groups.set(k, list);
  }
  return groups;
}
