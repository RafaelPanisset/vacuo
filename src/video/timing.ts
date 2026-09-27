import type { ClipProps } from "./props.ts";

/** Race seconds since the start of the clip shown at `frame`. Frozen during the final hold. */
export function raceTime(frame: number, props: ClipProps): number {
  return actionFrameToRaceSeconds(frame, props.actionFrames, props.durationS);
}

/**
 * The first action frame shows the start of the clip window and the last one its end,
 * so something that happens right at the end is still on screen.
 * clip.ts places the cars with this too, so they always agree with the clock.
 */
export function actionFrameToRaceSeconds(frame: number, actionFrames: number, durationS: number): number {
  return (Math.min(frame, actionFrames - 1) / (actionFrames - 1)) * durationS;
}

/** The video frame at which race time `t` is shown. */
export function frameAt(t: number, props: ClipProps): number {
  return (t / props.durationS) * (props.actionFrames - 1);
}

/** The last item at or before `t` (items sorted by `t`), falling back to the first. */
export function lastAt<T extends { t: number }>(items: T[], t: number): T | undefined {
  let found: T | undefined;
  for (const item of items) {
    if (item.t > t) break;
    found = item;
  }
  return found ?? items[0];
}
