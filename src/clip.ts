import type { Battle } from "./battles.ts";
import { get, type Lap, type Location } from "./openf1.ts";
import type { Race } from "./race.ts";
import type { ClipDriver, ClipProps, Point } from "./video/props.ts";
import { actionFrameToRaceSeconds } from "./video/timing.ts";

export const FPS = 30;
const ACTION_S = 27;
const HOLD_S = 3;
// Any faster and a car laps the track in a few seconds, too quick to follow.
const MAX_SPEED = 12;
// Race time kept before the first overtake and after the last, so the build-up is visible.
const LEAD_IN_MS = 30_000;
// Extra location data fetched around the window so interpolation has neighbours at the edges.
const LOCATION_PAD_MS = 2_000;

type Window = { from: number; to: number };

export async function prepareClip(race: Race, battle: Battle): Promise<ClipProps> {
  const window = clipWindow(battle);
  const locations = (driver: number, from: number, to: number) =>
    get<Location>(
      "location",
      {
        session_key: race.session.session_key,
        driver_number: driver,
        // OpenF1 reads these as date >= from and date <= to.
        "date>": new Date(from).toISOString(),
        "date<": new Date(to).toISOString(),
      },
      { cache: race.final },
    );

  const [ahead, behind] = battle.drivers;
  const padded = { from: window.from - LOCATION_PAD_MS, to: window.to + LOCATION_PAD_MS };
  const cars: [Location[], Location[]] = [
    await locations(ahead, padded.from, padded.to),
    await locations(behind, padded.from, padded.to),
  ];

  const lap = referenceLap(race.laps, battle);
  const lapStart = Date.parse(lap.date_start!);
  const outline = await locations(lap.driver_number, lapStart, lapStart + lap.lap_duration! * 1000);

  return buildClip(race, battle, window, outline, cars);
}

/**
 * Picks the stretch of the battle that fits in the clip: centred on the overtakes
 * (or the closest moment, if nobody got past) and no faster than MAX_SPEED.
 * When the overtakes don't all fit, the earliest are dropped, never the last one:
 * the clip has to end on the real outcome.
 */
export function clipWindow(battle: Battle): Window {
  const length = Math.min(battle.end - battle.start, ACTION_S * MAX_SPEED * 1000);
  const swaps = swapSamples(battle).map((s) => s.t);
  const closest = battle.samples.reduce((best, s) => (s.gap < best.gap ? s : best));
  const focus = swaps.length > 0 ? swaps : [closest.t];
  const [first, last] = [focus[0], focus[focus.length - 1]];

  const fitsWithLeadIn = last - first + 2 * LEAD_IN_MS <= length;
  const from = fitsWithLeadIn ? (first + last) / 2 - length / 2 : last + LEAD_IN_MS - length;
  const clamped = Math.min(Math.max(from, battle.start), battle.end - length);
  return { from: clamped, to: clamped + length };
}

export function buildClip(race: Race, battle: Battle, window: Window, outline: Location[], cars: [Location[], Location[]]): ClipProps {
  const durationS = (window.to - window.from) / 1000;
  const speed = durationS / ACTION_S;
  const actionFrames = ACTION_S * FPS;
  const track = onTrack(outline);
  const project = projection(track.length > 0 ? track : onTrack([...cars[0], ...cars[1]]));
  const since = (t: number) => round((t - window.from) / 1000);

  const carFrames = cars.map((locations) => {
    const at = interpolator(onTrack(locations));
    return Array.from({ length: actionFrames }, (_, frame) =>
      project(at(window.from + actionFrameToRaceSeconds(frame, actionFrames, durationS) * 1000)),
    );
  }) as [Point[], Point[]];

  const inWindow = battle.samples.filter((s) => s.t >= window.from && s.t <= window.to);
  const chaser = battle.drivers[1];
  const chaserLaps = race.laps
    .filter((l) => l.driver_number === chaser && l.date_start)
    .map((l) => ({ t: Date.parse(l.date_start!), lap: l.lap_number }))
    .sort((a, b) => a.t - b.t);
  const lapAtStart = chaserLaps.filter((l) => l.t <= window.from).at(-1);

  return {
    title: `${race.session.circuit_short_name} ${race.session.year}`,
    totalLaps: Math.max(...race.laps.map((l) => l.lap_number)),
    fps: FPS,
    actionFrames,
    holdFrames: HOLD_S * FPS,
    speed: round(speed),
    durationS,
    drivers: battle.drivers.map((n) => clipDriver(race, n)) as [ClipDriver, ClipDriver],
    track: track.map(project),
    cars: carFrames,
    gaps: inWindow.map((s) => ({ t: since(s.t), gap: s.gap, ahead: s.ahead, position: s.position })),
    swaps: swapSamples(battle)
      .filter((s) => s.t >= window.from && s.t <= window.to)
      .map((s) => ({ t: since(s.t), ahead: s.ahead })),
    laps: [
      ...(lapAtStart ? [{ t: 0, lap: lapAtStart.lap }] : []),
      ...chaserLaps.filter((l) => l.t > window.from && l.t <= window.to).map((l) => ({ t: since(l.t), lap: l.lap })),
    ],
  };
}

function swapSamples(battle: Battle) {
  return battle.samples.filter((s, i) => i > 0 && s.ahead !== battle.samples[i - 1].ahead);
}

/** The chaser's fastest clean lap during the battle, used to draw the track. */
function referenceLap(laps: Lap[], battle: Battle): Lap {
  const chaser = battle.drivers[1];
  const clean = laps.filter((l) => l.driver_number === chaser && l.date_start && l.lap_duration && !l.is_pit_out_lap);
  const during = clean.filter((l) => l.lap_number >= battle.startLap && l.lap_number <= battle.endLap);
  const candidates = during.length > 0 ? during : clean;
  if (candidates.length === 0) throw new Error(`No clean lap for car ${chaser} to draw the track from.`);
  return candidates.reduce((best, l) => (l.lap_duration! < best.lap_duration! ? l : best));
}

function clipDriver(race: Race, number: number): ClipDriver {
  const d = race.drivers.get(number);
  return {
    number,
    acronym: d?.name_acronym ?? `#${number}`,
    name: d ? lastName(d.full_name) : `Car ${number}`,
    team: d?.team_name ?? "",
    color: d?.team_colour ? `#${d.team_colour}` : "#ffffff",
  };
}

/** "Andrea Kimi ANTONELLI" -> "Antonelli" */
function lastName(fullName: string): string {
  const last = fullName.trim().split(/\s+/).at(-1) ?? fullName;
  return last.charAt(0) + last.slice(1).toLowerCase();
}

// The car sits at (0, 0) while the timing system has no fix on it.
function onTrack(locations: Location[]): Location[] {
  return locations.filter((l) => l.x !== 0 || l.y !== 0);
}

/** Fits track coordinates into the unit square, keeping the aspect ratio and flipping y so north is up. */
function projection(points: Location[]): (p: { x: number; y: number }) => Point {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = 1 / Math.max(maxX - minX, maxY - minY);
  const offsetX = (1 - (maxX - minX) * scale) / 2;
  const offsetY = (1 - (maxY - minY) * scale) / 2;
  return (p) => [round((p.x - minX) * scale + offsetX), round((maxY - p.y) * scale + offsetY)];
}

/** Linear interpolation over time. Expects calls with non-decreasing `t`. */
function interpolator(locations: Location[]): (t: number) => { x: number; y: number } {
  const points = locations.map((l) => ({ t: Date.parse(l.date), x: l.x, y: l.y })).sort((a, b) => a.t - b.t);
  if (points.length === 0) throw new Error("No location data for this battle.");
  let i = 0;
  return (t) => {
    while (i < points.length - 2 && points[i + 1].t <= t) i++;
    const a = points[i];
    const b = points[i + 1] ?? a;
    const k = b.t === a.t ? 0 : Math.min(Math.max((t - a.t) / (b.t - a.t), 0), 1);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  };
}

function round(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
