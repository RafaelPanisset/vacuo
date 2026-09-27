import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findBattles, neutralisedWindows, type RaceData } from "./battles.ts";

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

const message = (seconds: number, text: string) => ({
  date: at(seconds),
  category: "Other",
  flag: null,
  message: text,
  lap_number: null,
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
});
