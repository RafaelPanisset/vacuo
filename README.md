# Vácuo

Finds the best wheel-to-wheel battles of any Formula 1 race from public timing data, and turns each one into a 30-second vertical video: an animated track map, a two-row timing tower that swaps on every overtake, and the gap between the two cars over time.

*Vácuo* is what Brazilian F1 fans call the slipstream.

<p align="center">
  <img src="docs/monza-2026-pia-ver.gif" width="324" alt="Monza 2026, Piastri and Verstappen fighting for P3: the timing tower swaps on each overtake while both cars move around an animated track map, and the clip ends with 'Verstappen recupera o P3'.">
</p>

```
$ npm run battles -- monza --top 5

Monza 2026 · top 5 battles

#  Battle      For  Laps   Time   Min gap  Swaps  Score
1  PIA vs VER  P3   38–48  13:44  0.014s   5      37.3
2  PIA vs NOR  P4   43–53  14:09  0.003s   3      31.5
3  HAM vs PIA  P4   23–28  6:59   0.069s   1      12.6
4  LIN vs BEA  P7   1–3    1:46   0.039s   2      11.9
5  GAS vs RUS  P1   1–3    1:56   0.018s   1      10.6

$ npm run clip -- monza
out/monza-2026-pia-ver.mp4
```

The on-screen text is in Brazilian Portuguese, since the videos are made for Brazilian F1 fans. All of it lives in `src/video/BattleClip.tsx`.

## Usage

Requires Node 23.6 or newer, which runs TypeScript directly with no build step.

```
npm install

npm run battles                     # latest finished race
npm run battles -- baku             # by circuit, city or country, this year
npm run battles -- interlagos 2025  # another season (OpenF1 has data from 2023)
npm run battles -- 11361 --top 5    # by OpenF1 session key

npm run clip -- baku                # render the best battle to out/<race>-<drivers>.mp4
npm run clip -- monza --battle 2    # the second best one
npm run clip -- monza --no-render   # only write the clip data, then preview and tweak it live:
npm run studio -- --props=out/monza-2026-pia-ver.json

npm test
npm run typecheck
```

## How it works

**1. Fetch.** `openf1.ts` downloads intervals, positions, laps, race control messages and pit stops from [OpenF1](https://openf1.org). Requests are spaced 2.1s apart to stay inside the free tier (30 req/min), retried on 429, 5xx and dropped connections, and cached in `.cache/` once a race is over.

**2. Detect.** `battles.ts` is a pure function from race data to a ranked list of battles.
- The intervals endpoint gives each car's gap to the car ahead, but not *which* car is ahead. Replaying position changes and interval samples in time order pairs every sample with the car directly in front at that moment.
- Samples during a safety car, VSC, red flag, before overtaking is first enabled, or around a pit stop are dropped. Under a safety car the whole field runs within a second of each other, which is a queue, not a fight. Overtaking is disabled whenever the race is neutralised (DRS until 2025, overtake mode from 2026), so those race control messages bracket the real racing.
- A battle starts when the gap drops under 1.0s and ends once it grows past 1.5s. With a single threshold, a car hovering around one second split one long chase into several battles.
- Each battle is scored by length (square-rooted, so a 20-lap DRS train doesn't beat a 3-lap fight for the lead), position at stake, closeness, and number of position swaps.

**3. Clip.** `clip.ts` picks up to 324s of race time, at most 12× real speed, centred on the overtakes. When they don't all fit, the earliest ones are dropped rather than the last, so the clip always ends on the real outcome. The first version got this wrong and would have told viewers the losing driver held the position. It then fetches both cars' positions (about 3.7 Hz, irregularly spaced) and interpolates where each car is on every frame.

**4. Render.** The [Remotion](https://www.remotion.dev) composition in `src/video/` is a pure function of the frame number: it only reads the precomputed data and draws. That's what lets Remotion render 900 frames in parallel in under a minute.

## Tests

`npm test` runs 17 tests with Node's built-in test runner. They cover battle detection (thresholds, hysteresis, safety cars, VSC, pit stops, overtakes) and clip window selection, using small synthetic races.

## Stack

TypeScript on Node 24 with native type stripping, `node:test`, React 19 and Remotion 4. Timing data comes from [OpenF1](https://openf1.org), an open source, unofficial F1 API.

## Disclaimer

Vácuo is an unofficial project and is not associated in any way with the Formula 1 companies. F1, FORMULA ONE, FORMULA 1, FIA FORMULA ONE WORLD CHAMPIONSHIP, GRAND PRIX and related marks are trade marks of Formula One Licensing B.V.

## License

[MIT](LICENSE)
