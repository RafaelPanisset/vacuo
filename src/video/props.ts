/** [x, y] in the unit square, y pointing down. */
export type Point = [number, number];

export type ClipDriver = {
  number: number;
  acronym: string;
  /** Last name, e.g. "Verstappen". */
  name: string;
  team: string;
  /** Hex colour with leading #. */
  color: string;
};

/** Everything the video needs, precomputed so the composition only has to draw. */
export type ClipProps = {
  title: string;
  totalLaps: number;
  fps: number;
  /** Frames of race action, after which the result is held on screen for `holdFrames`. */
  actionFrames: number;
  holdFrames: number;
  /** Race seconds per video second. */
  speed: number;
  drivers: [ClipDriver, ClipDriver];
  track: Point[];
  /** Each driver's position at every action frame. */
  cars: [Point[], Point[]];
  // Times below are race seconds since the start of the clip.
  gaps: { t: number; gap: number; ahead: number; position: number }[];
  swaps: { t: number; ahead: number }[];
  laps: { t: number; lap: number }[];
};
