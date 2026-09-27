import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adjacentSamples, findBattles, neutralisedWindows, raceWarnings, type RaceData } from "./battles.ts";

const T0 = Date.parse("2026-09-06T13:00:00Z");
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();

const AHEAD = 1;
const BEHIND = 2;

/** Two cars, AHEAD in P1 and BEHIND in P2, with BEHIND sampled every 4s at `gap` (or `gapAt(seconds)`). */
function race({ fromS = 0, toS, gap = 0.5, gapAt = () => gap, raceControl = [] as RaceData["raceControl"] }: {
  fromS?: number;
  toS: number;
  gap?: number;
  gapAt?: (seconds: number) => number;
  raceControl?: RaceData["raceControl"];
}): RaceData {
  const intervals = [];
  for (let s = fromS; s <= toS; s += 4) {
    intervals.push({ date: at(s), driver_number: BEHIND, interval: gapAt(s), gap_to_leader: gapAt(s) });
  }
  return {
    intervals,
    positions: [
      { date: at(-10), driver_number: AHEAD, position: 1 },
      { date: at(-10), driver_number: BEHIND, position: 2 },
    ],
    laps: [
      { driver_number: BEHIND, lap_number: 1, date_start: at(-10), lap_duration: 90 },
      { driver_number: BEHIND, lap_number: 2, date_start: at(80), lap_duration: 90 },
      { driver_number: BEHIND, lap_number: 3, date_start: at(170), lap_duration: 90 },
    ],
    raceControl,
    pits: [],
  };
}

const message = (seconds: number, text: string, lap: number | null = null) => ({
  date: at(seconds),
  category: "Other",
  flag: null,
  message: text,
  lap_number: lap,
});

/** The leader starting `lap` at `seconds` (other cars start it a little later). */
const lapStart = (seconds: number, lap: number, driver = 99) => ({
  driver_number: driver,
  lap_number: lap,
  date_start: at(seconds),
  lap_duration: 90,
});

describe("findBattles", () => {
  it("finds a sustained fight inside the gap threshold", () => {
    const [battle, ...rest] = findBattles(race({ toS: 200 }));

    assert.equal(rest.length, 0);
    assert.deepEqual(battle.drivers, [AHEAD, BEHIND]);
    assert.equal(battle.position, 1);
    assert.equal(battle.startLap, 1);
    assert.equal(battle.endLap, 3);
    assert.equal(battle.swaps, 0);
  });

  it("ignores cars that are close only briefly", () => {
    assert.deepEqual(findBattles(race({ toS: 60 })), []);
  });

  it("ignores cars that are never within the gap threshold", () => {
    assert.deepEqual(findBattles(race({ toS: 200, gap: 1.4 })), []);
  });

  it("keeps one battle when the gap hovers just over the start threshold", () => {
    const hovering = (s: number) => (s >= 100 && s < 160 ? 1.2 : 0.5);
    const battles = findBattles(race({ toS: 260, gapAt: hovering }));
    assert.equal(battles.length, 1);
    assert.equal(battles[0].end - battles[0].start, 260_000);
  });

  it("splits into two battles when the gap clearly opens up in between", () => {
    const opening = (s: number) => (s >= 100 && s < 160 ? 2.0 : 0.5);
    assert.equal(findBattles(race({ toS: 260, gapAt: opening })).length, 2);
  });

  it("ends the battle at the last close moment, not while the gap is opening", () => {
    const fading = (s: number) => (s < 120 ? 0.5 : 1.3);
    const [battle] = findBattles(race({ toS: 300, gapAt: fading }));
    assert.equal(battle.end, T0 + 116_000);
  });

  it("counts an overtake as a swap and keeps it as one battle", () => {
    const data = race({ toS: 200 });
    data.positions.push(
      { date: at(100), driver_number: BEHIND, position: 1 },
      { date: at(100), driver_number: AHEAD, position: 2 },
    );
    for (let s = 100; s <= 200; s += 4) {
      data.intervals.push({ date: at(s), driver_number: AHEAD, interval: 0.4, gap_to_leader: 0.4 });
    }
    data.intervals = data.intervals.filter((i) => i.driver_number === AHEAD || Date.parse(i.date) < T0 + 100_000);

    const [battle, ...rest] = findBattles(data);
    assert.equal(rest.length, 0);
    assert.equal(battle.swaps, 1);
  });

  it("does not count a safety car queue as a battle", () => {
    const data = race({
      toS: 600,
      raceControl: [message(-60, "OVERTAKE ENABLED"), message(0, "SAFETY CAR DEPLOYED"), message(700, "OVERTAKE ENABLED")],
    });
    assert.deepEqual(findBattles(data), []);
  });

  it("keeps racing on the final lap after the leader has taken the flag", () => {
    // BEHIND passes AHEAD at 160s, ten seconds after the leader's chequered flag.
    const data = race({ toS: 200, raceControl: [message(-60, "OVERTAKE ENABLED"), message(150, "CHEQUERED FLAG")] });
    data.positions.push(
      { date: at(160), driver_number: BEHIND, position: 1 },
      { date: at(160), driver_number: AHEAD, position: 2 },
    );
    data.intervals = data.intervals.filter((i) => Date.parse(i.date) < T0 + 160_000);
    for (let s = 160; s <= 200; s += 4) {
      data.intervals.push({ date: at(s), driver_number: AHEAD, interval: 0.4, gap_to_leader: 0.4 });
    }

    const [battle] = findBattles(data);
    assert.equal(battle.swaps, 1);
  });

  it("stops counting a car once it has crossed the finish line", () => {
    // BEHIND's lap 2 runs from 80s to 170s: that is when it takes the flag.
    const data = race({ toS: 300, raceControl: [message(-60, "OVERTAKE ENABLED"), message(150, "CHEQUERED FLAG")] });
    const [battle] = findBattles(data);
    assert.equal(battle.end, T0 + 168_000);
  });

  it("does not count a pit stop as a battle", () => {
    const data = race({ toS: 200 });
    data.pits.push({ date: at(0), driver_number: BEHIND, lap_number: 1, lane_duration: 200 });
    assert.deepEqual(findBattles(data), []);
  });
});

describe("neutralisedWindows", () => {
  it("treats everything before overtaking is first enabled as neutralised", () => {
    const windows = neutralisedWindows([message(100, "OVERTAKE ENABLED")]);
    assert.deepEqual(windows, [{ from: -Infinity, to: T0 + 100_000 }]);
  });

  it("covers a VSC period plus time to get back up to speed", () => {
    const windows = neutralisedWindows([message(0, "DRS ENABLED"), message(100, "VSC DEPLOYED"), message(200, "VSC ENDING")]);
    assert.deepEqual(windows, [
      { from: -Infinity, to: T0 },
      { from: T0 + 100_000, to: T0 + 215_000 },
    ]);
  });

  it("does not mistake a virtual safety car for a full one", () => {
    const windows = neutralisedWindows([
      message(0, "DRS ENABLED"),
      message(100, "VIRTUAL SAFETY CAR DEPLOYED"),
      message(200, "VIRTUAL SAFETY CAR ENDING"),
    ]);
    assert.equal(windows.length, 2);
    assert.equal(windows[1].to, T0 + 215_000);
  });

  // Real messages from Interlagos 2025, where DRS zone 2 was tested ten minutes before the start.
  it("does not end the opening neutral period when DRS is tested in a single zone", () => {
    const windows = neutralisedWindows([
      message(-600, "DRS DISABLED IN ZONE 2"),
      message(-598, "DRS ENABLED IN ZONE 2"),
      message(100, "DRS ENABLED"),
    ]);
    assert.deepEqual(windows, [{ from: -Infinity, to: T0 + 100_000 }]);
  });

  it("does not neutralise the race when DRS is disabled in a single zone", () => {
    const windows = neutralisedWindows([message(0, "DRS ENABLED"), message(200, "DRS DISABLED IN ZONE 1")]);
    assert.deepEqual(windows, [{ from: -Infinity, to: T0 }]);
  });

  it("ignores race control messages after the chequered flag", () => {
    const windows = neutralisedWindows([
      message(0, "OVERTAKE ENABLED"),
      message(100, "CHEQUERED FLAG"),
      message(200, "SAFETY CAR DEPLOYED"),
    ]);
    assert.deepEqual(windows, [{ from: -Infinity, to: T0 }]);
  });

  it("ignores stewards' notes that mention a red flag", () => {
    const windows = neutralisedWindows([
      message(0, "OVERTAKE ENABLED"),
      message(1200, "FIA STEWARDS: INCIDENT INVOLVING CAR 1 (VER) NOTED - OVERTAKING UNDER RED FLAG"),
    ]);
    assert.deepEqual(windows, [{ from: -Infinity, to: T0 }]);
  });

  it("still neutralises the race on a red flag", () => {
    const windows = neutralisedWindows([
      message(0, "OVERTAKE ENABLED"),
      message(100, "RED FLAG - RACE SUSPENDED"),
      message(900, "OVERTAKE ENABLED"),
    ]);
    assert.deepEqual(windows.at(-1), { from: T0 + 100_000, to: T0 + 900_000 });
  });

  it("restarts the race when the leader starts the next lap if overtaking is never re-enabled", () => {
    const windows = neutralisedWindows(
      [
        message(0, "OVERTAKE ENABLED"),
        message(100, "SAFETY CAR DEPLOYED", 2),
        message(400, "SAFETY CAR IN THIS LAP", 5),
        message(3000, "CHEQUERED FLAG", 30),
      ],
      [lapStart(560, 6), lapStart(563, 6, 98)],
    );
    assert.deepEqual(windows, [
      { from: -Infinity, to: T0 },
      { from: T0 + 100_000, to: T0 + 560_000 },
    ]);
  });

  it("falls back to three minutes after the safety car comes in when lap times are missing", () => {
    const windows = neutralisedWindows([
      message(0, "OVERTAKE ENABLED"),
      message(100, "SAFETY CAR DEPLOYED", 2),
      message(400, "SAFETY CAR IN THIS LAP", 5),
      message(3000, "CHEQUERED FLAG", 30),
    ]);
    assert.deepEqual(windows.at(-1), { from: T0 + 100_000, to: T0 + 580_000 });
  });

  it("keeps the racing between two safety cars when overtaking is never re-enabled", () => {
    const windows = neutralisedWindows(
      [
        message(0, "OVERTAKE ENABLED"),
        message(100, "SAFETY CAR DEPLOYED", 2),
        message(400, "SAFETY CAR IN THIS LAP", 5),
        message(2000, "SAFETY CAR DEPLOYED", 22),
        message(2300, "SAFETY CAR IN THIS LAP", 25),
        message(3600, "CHEQUERED FLAG", 40),
      ],
      [lapStart(560, 6), lapStart(2460, 26)],
    );
    assert.deepEqual(windows, [
      { from: -Infinity, to: T0 },
      { from: T0 + 100_000, to: T0 + 560_000 },
      { from: T0 + 2_000_000, to: T0 + 2_460_000 },
    ]);
  });

  it("keeps the race neutralised to the end when it finishes behind the safety car", () => {
    const windows = neutralisedWindows([
      message(0, "OVERTAKE ENABLED"),
      message(2800, "SAFETY CAR DEPLOYED"),
      message(3000, "CHEQUERED FLAG"),
    ]);
    assert.deepEqual(windows.at(-1), { from: T0 + 2_800_000, to: Infinity });
  });
});

describe("adjacentSamples", () => {
  it("skips a car's gap while its own position update is still on the way", () => {
    const [A, B, C] = [1, 2, 3];
    const data: RaceData = {
      positions: [
        { date: at(-10), driver_number: C, position: 3 },
        { date: at(-10), driver_number: A, position: 4 },
        { date: at(-10), driver_number: B, position: 5 },
        // B passes A, but A's own update arrives ten seconds after B's.
        { date: at(10), driver_number: B, position: 4 },
        { date: at(20), driver_number: A, position: 5 },
      ],
      // At 15s A's gap is really to B, which the stale positions would pair with C.
      intervals: [{ date: at(15), driver_number: A, interval: 0.4, gap_to_leader: 12 }],
      laps: [],
      raceControl: [],
      pits: [],
    };
    assert.deepEqual(adjacentSamples(data), []);
  });
});

describe("raceWarnings", () => {
  it("warns when the race stays neutralised long before the finish, so later battles are missing", () => {
    const warnings = raceWarnings([
      message(0, "OVERTAKE ENABLED"),
      message(600, "RED FLAG - RACE SUSPENDED"),
      message(3600, "CHEQUERED FLAG"),
    ]);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /13:10 UTC/);
  });

  it("does not warn when the race just finishes behind the safety car", () => {
    const warnings = raceWarnings([
      message(0, "OVERTAKE ENABLED"),
      message(3400, "SAFETY CAR DEPLOYED"),
      message(3600, "CHEQUERED FLAG"),
      // Stewards keep posting after the flag; that is not neutralised racing.
      message(4800, "FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 11"),
    ]);
    assert.deepEqual(warnings, []);
  });
});
