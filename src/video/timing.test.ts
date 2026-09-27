import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClipDriver, ClipProps } from "./props.ts";
import { frameAt, raceTime } from "./timing.ts";

const nobody: ClipDriver = { number: 0, acronym: "", name: "", team: "", color: "#ffffff" };
const props: ClipProps = {
  title: "",
  totalLaps: 0,
  fps: 30,
  actionFrames: 810,
  holdFrames: 90,
  speed: 12,
  durationS: 324,
  drivers: [nobody, nobody],
  track: [],
  cars: [[], []],
  gaps: [],
  swaps: [],
  laps: [],
};

describe("raceTime", () => {
  it("starts on the first moment of the clip window", () => {
    assert.equal(raceTime(0, props), 0);
  });

  it("reaches the end of the clip window on the last action frame", () => {
    assert.equal(raceTime(props.actionFrames - 1, props), 324);
  });

  it("holds the last moment while the result is on screen", () => {
    assert.equal(raceTime(props.actionFrames + props.holdFrames - 1, props), 324);
  });
});

describe("frameAt", () => {
  it("is the inverse of raceTime", () => {
    assert.ok(Math.abs(frameAt(raceTime(400, props), props) - 400) < 1e-9);
  });
});
