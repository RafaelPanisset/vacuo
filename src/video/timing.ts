import type { ClipProps } from "./props.ts";

/** Race seconds since the start of the clip shown at `frame`. Frozen during the final hold. */
export function raceTime(frame: number, props: ClipProps): number {
  return (Math.min(frame, props.actionFrames - 1) / props.fps) * props.speed;
}

/** The video frame at which race time `t` is shown. */
export function frameAt(t: number, props: ClipProps): number {
  return (t / props.speed) * props.fps;
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
