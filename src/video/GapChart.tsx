import type { ClipProps } from "./props.ts";
import { theme } from "./theme.ts";

type Props = {
  props: ClipProps;
  t: number;
  width: number;
  height: number;
};

// Matches the battle's release gap: above this the fight is over, so there's nothing to show.
const MAX_GAP = 1.5;
const LABEL_WIDTH = 64;

/** The gap between the two cars over the clip, with the part still to come dimmed. */
export function GapChart({ props, t, width, height }: Props) {
  const plotWidth = width - LABEL_WIDTH;
  const duration = (props.actionFrames / props.fps) * props.speed;
  const x = (seconds: number) => (seconds / duration) * plotWidth;
  const y = (gap: number) => (Math.min(gap, MAX_GAP) / MAX_GAP) * height;
  const line = props.gaps.map((g, k) => `${k === 0 ? "M" : "L"} ${x(g.t).toFixed(1)} ${(height - y(g.gap)).toFixed(1)}`).join(" ");
  const now = x(t);

  return (
    <svg width={width} height={height + 8} viewBox={`0 0 ${width} ${height + 8}`}>
      <defs>
        <clipPath id="elapsed">
          <rect x={0} y={-10} width={now} height={height + 20} />
        </clipPath>
      </defs>

      <line x1={0} x2={plotWidth} y1={height} y2={height} stroke={theme.faint} strokeWidth={2} />
      <line x1={0} x2={plotWidth} y1={height - y(1)} y2={height - y(1)} stroke={theme.timing} strokeWidth={3} strokeDasharray="10 10" />
      <text x={plotWidth + 14} y={height - y(1) + 11} fontSize={30} fontWeight={600} fill={theme.timing}>
        1s
      </text>

      {props.swaps.map((s) => (
        <rect key={s.t} x={x(s.t) - 3} y={0} width={6} height={height} fill={theme.kerb} opacity={s.t <= t ? 1 : 0.35} />
      ))}

      <path d={line} fill="none" stroke={theme.paint} strokeWidth={4} strokeLinejoin="round" opacity={0.25} />
      <path d={line} fill="none" stroke={theme.paint} strokeWidth={4} strokeLinejoin="round" clipPath="url(#elapsed)" />
      <line x1={now} x2={now} y1={-4} y2={height + 4} stroke={theme.paint} strokeWidth={3} />
    </svg>
  );
}
