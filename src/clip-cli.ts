import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { findBattles, raceWarnings } from "./battles.ts";
import { prepareClip } from "./clip.ts";
import { loadRace, parseArgs, resolveRace } from "./race.ts";

const USAGE = `usage: npm run clip -- [latest | <circuit, city or country> | <session_key>] [year] [--battle N] [--no-render]

Renders battle N (default 1, as ranked by \`npm run battles\`) to out/<race>-<drivers>.mp4.
With --no-render it only writes the clip data to out/<race>-<drivers>.json, for the studio:
  npm run studio -- --props=out/<race>-<drivers>.json

  npm run clip                    best battle of the latest race
  npm run clip -- baku --battle 2
  npm run clip -- interlagos 2025`;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("-h") || argv.includes("--help")) return console.log(USAGE);
  const render = !argv.includes("--no-render");
  const { query, year, battle: rank } = parseArgs(argv.filter((a) => a !== "--no-render"), { battle: 1 });

  const session = await resolveRace(query, year);
  log(`Fetching ${session.circuit_short_name} ${session.year} (session ${session.session_key})...`);
  const race = await loadRace(session);
  for (const warning of raceWarnings(race.raceControl, race.laps)) log(`Warning: ${warning}`);
  const battles = findBattles(race);
  const battle = battles[rank - 1];
  if (!battle) throw new Error(`Found ${battles.length} battles; pick --battle between 1 and ${battles.length}.`);

  log("Fetching car locations...");
  const props = await prepareClip(race, battle);
  const name = [session.circuit_short_name, session.year, ...props.drivers.map((d) => d.acronym)]
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-");
  await mkdir("out", { recursive: true });
  await writeFile(`out/${name}.json`, JSON.stringify(props));
  if (!render) return console.log(`out/${name}.json`);

  log("Bundling the video...");
  const serveUrl = await bundle({ entryPoint: resolve("src/video/index.ts") });
  const composition = await selectComposition({ serveUrl, id: "Battle", inputProps: props });

  let shown = -1;
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    inputProps: props,
    outputLocation: `out/${name}.mp4`,
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 10) * 10;
      if (pct !== shown) log(`Rendering ${(shown = pct)}%`);
    },
  });
  console.log(`out/${name}.mp4`);
}

function log(message: string) {
  console.error(message);
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exitCode = 1;
});
