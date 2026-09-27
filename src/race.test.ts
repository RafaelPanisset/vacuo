import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArgs } from "./race.ts";

const thisYear = new Date().getFullYear();

describe("parseArgs", () => {
  it("reads a race name made of several words", () => {
    assert.deepEqual(parseArgs(["las", "vegas", "2023"], { top: 10 }), { query: "las vegas", year: 2023, top: 10 });
  });

  it("reads flags wherever they appear", () => {
    assert.deepEqual(parseArgs(["--top", "5", "abu", "dhabi"], { top: 10 }), { query: "abu dhabi", year: thisYear, top: 5 });
  });

  it("treats a four-digit session key as a race, not a year", () => {
    assert.deepEqual(parseArgs(["9869"], {}), { query: "9869", year: thisYear });
  });

  it("defaults to the latest race of this year", () => {
    assert.deepEqual(parseArgs([], {}), { query: "latest", year: thisYear });
  });
});
