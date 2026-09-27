import assert from "node:assert/strict";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { get } from "./openf1.ts";

// The cache lives in a relative .cache/ directory, so each run works in a fresh temp dir.
// node --test runs every test file in its own process, so chdir stays local to this file.
const originalCwd = process.cwd();
const originalFetch = globalThis.fetch;

/** Responses the fake fetch hands out in order, and when each request was sent. */
let responses: { status: number; body: unknown }[] = [];
let sentAt: number[] = [];

before(async () => {
  process.chdir(await mkdtemp(join(tmpdir(), "vacuo-openf1-")));
  globalThis.fetch = async () => {
    sentAt.push(Date.now());
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return new Response(JSON.stringify(next.body), { status: next.status });
  };
});

after(() => {
  globalThis.fetch = originalFetch;
  process.chdir(originalCwd);
});

beforeEach(() => {
  responses = [];
  sentAt = [];
});

describe("get", () => {
  it("does not cache an empty result, so data OpenF1 publishes later still arrives", async () => {
    responses = [
      { status: 404, body: { detail: "No results found." } },
      { status: 200, body: [{ lap_number: 1 }] },
    ];

    assert.deepEqual(await get("pit", { session_key: 1 }), []);
    assert.deepEqual(await get("pit", { session_key: 1 }), [{ lap_number: 1 }]);
    assert.equal(sentAt.length, 2);
  });

  it("fetches again when a cache file is corrupt instead of failing on every run", async () => {
    responses = [
      { status: 200, body: [{ lap_number: 1 }] },
      { status: 200, body: [{ lap_number: 2 }] },
    ];
    await get("laps", { session_key: 2 });
    const [file] = (await readdir(".cache/openf1")).filter((f) => f.startsWith("laps__"));
    // What a crash halfway through writing the file leaves behind.
    await writeFile(join(".cache/openf1", file), '[{"lap_numb');

    assert.deepEqual(await get("laps", { session_key: 2 }), [{ lap_number: 2 }]);
  });

  it("spaces out requests made at the same time", async () => {
    responses = [
      { status: 200, body: [] },
      { status: 200, body: [] },
    ];

    await Promise.all([get("drivers", { session_key: 3 }), get("drivers", { session_key: 4 })]);

    assert.equal(sentAt.length, 2);
    assert.ok(sentAt[1] - sentAt[0] >= 2000, `requests were ${sentAt[1] - sentAt[0]}ms apart`);
  });
});
