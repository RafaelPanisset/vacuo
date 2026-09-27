import { Composition } from "remotion";
import { BattleClip } from "./BattleClip.tsx";
import type { ClipDriver, ClipProps } from "./props.ts";
import { layout } from "./theme.ts";

const nobody: ClipDriver = { number: 0, acronym: "", name: "", team: "", color: "#ffffff" };

// Real props come from `npm run clip`, or `--props=out/<clip>.json` in the studio.
const empty: ClipProps = {
  title: "",
  totalLaps: 0,
  fps: 30,
  actionFrames: 810,
  holdFrames: 90,
  speed: 1,
  durationS: 27,
  drivers: [nobody, nobody],
  track: [],
  cars: [[], []],
  gaps: [],
  swaps: [],
  laps: [],
};

export function Root() {
  return (
    <Composition
      id="Battle"
      component={BattleClip}
      width={layout.width}
      height={layout.height}
      fps={30}
      durationInFrames={empty.actionFrames + empty.holdFrames}
      defaultProps={empty}
      calculateMetadata={({ props }) => ({ fps: props.fps, durationInFrames: props.actionFrames + props.holdFrames })}
    />
  );
}
