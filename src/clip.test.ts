import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Battle, PairSample } from "./battles.ts";
import { clipWindow } from "./clip.ts";

const A = 1;
const B = 2;
const MINUTE = 60_000;

/** A battle sampled every 4s, with the lead changing hands at each time in `swapsAt` (ms). */
function battle(durationMs: number, swapsAt: number[] = [], closestAt = 0): Battle {
  const samples: PairSample[] = [];
  for (let t = 0; t <= durationMs; t += 4_000) {
    const swapsSoFar = swapsAt.filter((s) => s <= t).length;
    const ahead = swapsSoFar % 2 === 0 ? A : B;
    samples.push({ t, ahead, behind: ahead === A ? B : A, gap: t === closestAt ? 0.1 : 0.6, position: 3 });
  }
  return {
    drivers: [A, B],
    start: 0,
    end: durationMs,
    startLap: 1,
    endLap: 10,
    position: 3,
    minGap: 0.1,
    meanGap: 0.6,
    swaps: swapsAt.length,
    score: 1,
    samples,
  };
}

describe("clipWindow", () => {
  it("uses the whole battle when it is short enough", () => {
    assert.deepEqual(clipWindow(battle(3 * MINUTE, [MINUTE])), { from: 0, to: 3 * MINUTE });
  });

  it("centres on the overtakes when they fit", () => {
    const window = clipWindow(battle(30 * MINUTE, [10 * MINUTE, 12 * MINUTE]));
    assert.equal((window.from + window.to) / 2, 11 * MINUTE);
  });

  it("keeps the last overtake when they don't all fit, so the clip ends on the real outcome", () => {
    const lastSwap = 20 * MINUTE;
    const window = clipWindow(battle(30 * MINUTE, [4 * MINUTE, 12 * MINUTE, lastSwap]));
    assert.ok(window.to > lastSwap, "the final overtake is in the clip");
    assert.ok(window.from > 4 * MINUTE, "the earliest overtake is the one dropped");
  });

  it("centres on the closest moment when nobody got past", () => {
    const closestAt = 16 * MINUTE;
    const window = clipWindow(battle(30 * MINUTE, [], closestAt));
    assert.equal((window.from + window.to) / 2, closestAt);
  });

  it("never reaches outside the battle", () => {
    const window = clipWindow(battle(30 * MINUTE, [MINUTE / 2]));
    assert.equal(window.from, 0);
  });
});
