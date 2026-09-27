import { findBattles, type Battle } from "./battles.ts";
import type { Driver, Session } from "./openf1.ts";
import { loadRace, parseArgs, resolveRace } from "./race.ts";

const USAGE = `usage: npm run battles -- [latest | <circuit, city or country> | <session_key>] [year] [--top N]

  npm run battles                 latest finished race
  npm run battles -- monza        Monza, this year
  npm run battles -- interlagos 2025
  npm run battles -- 11361 --top 5`;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("-h") || argv.includes("--help")) return console.log(USAGE);
  const { query, year, top } = parseArgs(argv, { top: 10 });

  const session = await resolveRace(query, year);
  log(`Fetching ${session.circuit_short_name} ${session.year} (session ${session.session_key})...`);
  const race = await loadRace(session);
  printBattles(session, findBattles(race).slice(0, top), race.drivers);
}

function printBattles(session: Session, battles: Battle[], drivers: Map<number, Driver>) {
  console.log(`\n${bold(`${session.circuit_short_name} ${session.year}`)} · top ${battles.length} battles\n`);
  const rows = battles.map((b, i) => [
    String(i + 1),
    `${name(drivers, b.drivers[0])} vs ${name(drivers, b.drivers[1])}`,
    `P${b.position}`,
    b.startLap === b.endLap ? `${b.startLap}` : `${b.startLap}–${b.endLap}`,
    duration(b.end - b.start),
    `${b.minGap.toFixed(3)}s`,
    String(b.swaps),
    b.score.toFixed(1),
  ]);
  printTable(["#", "Battle", "For", "Laps", "Time", "Min gap", "Swaps", "Score"], rows);
}

function printTable(header: string[], rows: string[][]) {
  const widths = header.map((h, col) => Math.max(visibleLength(h), ...rows.map((r) => visibleLength(r[col]))));
  const line = (cells: string[]) => cells.map((c, col) => c + " ".repeat(widths[col] - visibleLength(c))).join("  ");
  console.log(dim(line(header)));
  for (const row of rows) console.log(line(row));
  console.log();
}

function name(drivers: Map<number, Driver>, number: number): string {
  const d = drivers.get(number);
  if (!d) return `#${number}`;
  return color(d.team_colour, d.name_acronym);
}

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

function color(hex: string, text: string): string {
  if (!useColor || !/^[0-9a-f]{6}$/i.test(hex)) return text;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `\x1b[1;38;2;${r};${g};${b}m${text}\x1b[0m`;
}

const bold = (text: string) => (useColor ? `\x1b[1m${text}\x1b[0m` : text);
const dim = (text: string) => (useColor ? `\x1b[2m${text}\x1b[0m` : text);
const visibleLength = (text: string) => text.replace(/\x1b\[[\d;]*m/g, "").length;
const log = (message: string) => console.error(dim(message));

main().catch((err: Error) => {
  console.error(err.message);
  process.exitCode = 1;
});
