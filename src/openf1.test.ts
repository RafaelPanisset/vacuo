import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it, mock } from "node:test";
import { get } from "./openf1.ts";

// The cache lives in a relative .cache/ directory, so each run works in a fresh temp dir.
// node --test runs every test file in its own process, so chdir stays local to this file.
// The clock is mocked too, so waiting out the rate limit takes no real time.
const originalCwd = process.cwd();
const originalFetch = globalThis.fetch;

/** Responses the fake fetch hands out in order, and when each request was sent. */
let responses: { status: number; body: unknown; headers?: Record<string, string> }[] = [];
let sentAt: number[] = [];
const tempDirs: string[] = [];

async function freshWorkingDir() {
  const dir = await mkdtemp(join(tmpdir(), "vacuo-openf1-"));
  tempDirs.push(dir);
  process.chdir(dir);
}

/**
 * Runs `promise` to completion, moving the mocked clock forward 50ms at a time. Small steps
 * matter: jumping straight to the last pending timer would stamp an early request with a
 * late time and hide exactly the bugs these tests are for.
 */
async function run<T>(promise: Promise<T>): Promise<T> {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  while (!settled) {
    // Let file system work and promise callbacks finish before moving the clock.
    await new Promise((resolve) => setImmediate(resolve));
    mock.timers.tick(50);
  }
  return promise;
}

before(async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  await freshWorkingDir();
  globalThis.fetch = async () => {
    sentAt.push(Date.now());
    const next = responses.shift();
    if (!next) throw new Error("unexpected request");
    return new Response(JSON.stringify(next.body), { status: next.status, headers: next.headers });
  };
});

after(async () => {
  mock.timers.reset();
  globalThis.fetch = originalFetch;
  process.chdir(originalCwd);
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
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

    assert.deepEqual(await run(get("pit", { session_key: 1 })), []);
    assert.deepEqual(await run(get("pit", { session_key: 1 })), [{ lap_number: 1 }]);
    assert.equal(sentAt.length, 2);
  });

  it("fetches again when a cache file is corrupt instead of failing on every run", async () => {
    responses = [
      { status: 200, body: [{ lap_number: 1 }] },
      { status: 200, body: [{ lap_number: 2 }] },
    ];
    await run(get("laps", { session_key: 2 }));
    const [file] = (await readdir(".cache/openf1")).filter((f) => f.startsWith("laps__"));
    // What a crash halfway through writing the file leaves behind.
    await writeFile(join(".cache/openf1", file), '[{"lap_numb');

    assert.deepEqual(await run(get("laps", { session_key: 2 })), [{ lap_number: 2 }]);
  });

  it("ignores an empty result left in the cache by an older version", async () => {
    responses = [
      { status: 200, body: [{ lap_number: 1 }] },
      { status: 200, body: [{ lap_number: 2 }] },
    ];
    await run(get("race_control", { session_key: 5 }));
    const [file] = (await readdir(".cache/openf1")).filter((f) => f.startsWith("race_control__"));
    await writeFile(join(".cache/openf1", file), "[]");

    assert.deepEqual(await run(get("race_control", { session_key: 5 })), [{ lap_number: 2 }]);
  });

  it("still returns the data when the cache can't be written", async () => {
    const cwd = process.cwd();
    await freshWorkingDir();
    // A file where the cache directory should go makes every write fail.
    await writeFile(".cache", "");
    responses = [{ status: 200, body: [{ lap_number: 1 }] }];
    const warnings: string[] = [];
    const originalError = console.error;
    console.error = (message: string) => warnings.push(message);
    try {
      assert.deepEqual(await run(get("laps", { session_key: 6 })), [{ lap_number: 1 }]);
    } finally {
      console.error = originalError;
      process.chdir(cwd);
    }
    assert.equal(warnings.length, 1);
  });

  it("holds every request back while one waits out a rate limit", async () => {
    responses = [
      { status: 429, body: {}, headers: { "retry-after": "3" } },
      { status: 200, body: [] },
      { status: 200, body: [] },
    ];

    await run(Promise.all([get("pit", { session_key: 7 }), get("pit", { session_key: 8 })]));

    assert.equal(sentAt.length, 3);
    const afterLimit = sentAt.slice(1).map((t) => t - sentAt[0]);
    assert.ok(afterLimit.every((ms) => ms >= 3000), `requests went out ${afterLimit.join(", ")}ms after the 429`);
  });

  it("spaces out requests made at the same time", async () => {
    responses = [
      { status: 200, body: [] },
      { status: 200, body: [] },
    ];

    await run(Promise.all([get("drivers", { session_key: 3 }), get("drivers", { session_key: 4 })]));

    assert.equal(sentAt.length, 2);
    assert.ok(sentAt[1] - sentAt[0] >= 2000, `requests were ${sentAt[1] - sentAt[0]}ms apart`);
  });
});
