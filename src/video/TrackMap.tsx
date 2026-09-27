import type { ClipDriver, Point } from "./props.ts";
import { textOn, theme } from "./theme.ts";

type Props = {
  size: number;
  track: Point[];
  cars: [Point[], Point[]];
  drivers: [ClipDriver, ClipDriver];
  frame: number;
};

const PADDING = 32;
// How many frames of each car's recent path stay visible behind it.
const TRAIL_FRAMES = 12;

export function TrackMap({ size, track, cars, drivers, frame }: Props) {
  const toPx = ([x, y]: Point): Point => [PADDING + x * (size - 2 * PADDING), PADDING + y * (size - 2 * PADDING)];
  const trackPath = track.length > 0 ? `M ${track.map((p) => toPx(p).join(" ")).join(" L ")} Z` : "";
  const i = Math.min(frame, cars[0].length - 1);
  // Teammates share a colour, so the second car is drawn hollow to tell them apart.
  const hollowSecond = drivers[0].color.toLowerCase() === drivers[1].color.toLowerCase();

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <defs>
        <pattern id="chequer" width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill={theme.paint} />
          <rect width="4" height="4" fill="#141414" />
          <rect x="4" y="4" width="4" height="4" fill="#141414" />
        </pattern>
      </defs>

      {/* Painted edge lines, then the asphalt on top, leaving a thin white line on each side. */}
      <path d={trackPath} fill="none" stroke={theme.paint} strokeWidth={34} strokeLinejoin="round" />
      <path d={trackPath} fill="none" stroke={theme.trackSurface} strokeWidth={28} strokeLinejoin="round" />
      {track.length > 3 && <FinishLine from={toPx(track[0])} towards={toPx(track[3])} />}

      {cars.map((points, car) => (
        <Trail key={car} points={points.slice(Math.max(0, i - TRAIL_FRAMES), i + 1).map(toPx)} color={drivers[car].color} />
      ))}
      {cars.map((points, car) => (
        <Car
          key={car}
          at={toPx(points[i])}
          driver={drivers[car]}
          hollow={hollowSecond && car === 1}
          size={size}
          // Tags go on opposite sides so they don't overlap when the cars are side by side.
          tagSide={car === 0 ? "above" : "below"}
        />
      ))}
    </svg>
  );
}

function FinishLine({ from, towards }: { from: Point; towards: Point }) {
  const angle = (Math.atan2(towards[1] - from[1], towards[0] - from[0]) * 180) / Math.PI;
  return (
    <rect
      x={from[0] - 6}
      y={from[1] - 16}
      width={12}
      height={32}
      fill="url(#chequer)"
      transform={`rotate(${angle} ${from[0]} ${from[1]})`}
    />
  );
}

function Trail({ points, color }: { points: Point[]; color: string }) {
  return (
    <g>
      {points.slice(1).map((p, k) => (
        <line
          key={k}
          x1={points[k][0]}
          y1={points[k][1]}
          x2={p[0]}
          y2={p[1]}
          stroke={color}
          strokeWidth={10}
          strokeLinecap="round"
          opacity={((k + 1) / points.length) * 0.7}
        />
      ))}
    </g>
  );
}

type CarProps = { at: Point; driver: ClipDriver; hollow: boolean; tagSide: "above" | "below"; size: number };

function Car({ at, driver, hollow, tagSide, size }: CarProps) {
  const [x, y] = at;
  const tagWidth = 92;
  const tagHeight = 46;
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  const tagX = clamp(tagSide === "above" ? x + 22 : x - 22 - tagWidth, size - tagWidth);
  const tagY = clamp(tagSide === "above" ? y - 22 - tagHeight : y + 22, size - tagHeight);

  return (
    <g>
      <circle cx={x} cy={y} r={19} fill={theme.paint} />
      <circle cx={x} cy={y} r={14} fill={driver.color} />
      {hollow && <circle cx={x} cy={y} r={8} fill={theme.asphalt} />}
      <rect
        x={tagX}
        y={tagY}
        width={tagWidth}
        height={tagHeight}
        rx={6}
        fill={hollow ? theme.asphalt : driver.color}
        stroke={hollow ? driver.color : "none"}
        strokeWidth={4}
      />
      <text
        x={tagX + tagWidth / 2}
        y={tagY + tagHeight / 2 + 11}
        textAnchor="middle"
        fontSize={32}
        fontWeight={700}
        fill={hollow ? theme.paint : textOn(driver.color)}
      >
        {driver.acronym}
      </text>
    </g>
  );
}
