import { loadFont } from "@remotion/google-fonts/TitilliumWeb";
import { AbsoluteFill, interpolate, spring, useCurrentFrame } from "remotion";
import { GapChart } from "./GapChart.tsx";
import type { ClipProps } from "./props.ts";
import { layout, theme } from "./theme.ts";
import { lastAt, raceTime } from "./timing.ts";
import { Tower } from "./Tower.tsx";
import { TrackMap } from "./TrackMap.tsx";

// Titillium Web was F1's own typeface until 2017.
const { fontFamily } = loadFont("normal", { weights: ["400", "600", "700", "900"], subsets: ["latin", "latin-ext"] });

const MAP_SIZE = 800;
const MAP_TOP = 510;

export function BattleClip(props: ClipProps) {
  const frame = useCurrentFrame();
  if (props.cars[0].length === 0) return <Empty />;

  const t = raceTime(frame, props);
  const position = props.gaps[0]?.position ?? 0;
  const lap = lastAt(props.laps, t)?.lap;
  const { left, contentWidth } = layout;
  // Once the action stops the map steps back so the result reads first.
  const mapOpacity = interpolate(frame - props.actionFrames, [0, 12], [1, 0.3], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: theme.asphalt, color: theme.paint, fontFamily }}>
      <Grain />

      <div style={{ position: "absolute", top: 104, left, fontSize: 40, fontWeight: 600, color: theme.muted }}>{props.title}</div>
      <div style={{ position: "absolute", top: 150, left, fontSize: 82, fontWeight: 900, lineHeight: 1 }}>
        Briga pelo P{position}
      </div>

      <div style={{ position: "absolute", top: 290, left }}>
        <Tower props={props} frame={frame} t={t} width={contentWidth} />
      </div>

      <div style={{ position: "absolute", top: MAP_TOP, left: left + (contentWidth - MAP_SIZE) / 2, opacity: mapOpacity }}>
        <TrackMap size={MAP_SIZE} track={props.track} cars={props.cars} drivers={props.drivers} frame={frame} />
      </div>

      <div style={{ position: "absolute", top: 1326, left, width: contentWidth, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 42, fontWeight: 700 }}>{lap ? `Volta ${lap} de ${props.totalLaps}` : ""}</span>
        <span style={{ fontSize: 30, color: theme.muted }}>{props.speed.toFixed(0)}× a velocidade real</span>
      </div>

      <div style={{ position: "absolute", top: 1400, left }}>
        <div style={{ fontSize: 28, color: theme.muted, marginBottom: 10 }}>Distância entre os dois</div>
        <GapChart props={props} t={t} width={contentWidth} height={120} />
      </div>

      <div style={{ position: "absolute", top: 1650, left, width: contentWidth, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 40, fontWeight: 900 }}>vácuo</span>
        <span style={{ fontSize: 28, color: theme.muted }}>dados OpenF1</span>
      </div>

      <Result props={props} frame={frame} />
    </AbsoluteFill>
  );
}

/** Who ended up ahead, shown once the action stops. */
function Result({ props, frame }: { props: ClipProps; frame: number }) {
  if (frame < props.actionFrames) return null;
  const first = props.gaps[0];
  const last = props.gaps[props.gaps.length - 1];
  if (!first || !last) return null;

  const winner = props.drivers.find((d) => d.number === last.ahead) ?? props.drivers[0];
  const place = `P${first.position}`;
  const text =
    last.ahead !== first.ahead
      ? `${winner.name} fica com o ${place}`
      : props.swaps.length > 0
        ? `${winner.name} recupera o ${place}`
        : `${winner.name} segura o ${place}`;

  const enter = spring({ frame: frame - props.actionFrames, fps: props.fps, config: { damping: 18 } });
  return (
    <div
      style={{
        position: "absolute",
        top: MAP_TOP + MAP_SIZE / 2,
        left: layout.left,
        width: layout.contentWidth,
        boxSizing: "border-box",
        padding: "28px 36px",
        background: theme.paint,
        color: theme.asphalt,
        borderLeft: `18px solid ${winner.color}`,
        fontSize: 58,
        fontWeight: 900,
        lineHeight: 1.08,
        textWrap: "balance",
        opacity: enter,
        transform: `translateY(calc(-50% + ${interpolate(enter, [0, 1], [40, 0])}px))`,
      }}
    >
      {text}
    </div>
  );
}

/** A little asphalt texture, so the background isn't a flat fill. */
function Grain() {
  return (
    <svg width={layout.width} height={layout.height} style={{ position: "absolute", inset: 0, opacity: 0.09, mixBlendMode: "overlay" }}>
      <filter id="grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} stitchTiles="stitch" />
      </filter>
      <rect width="100%" height="100%" filter="url(#grain)" />
    </svg>
  );
}

function Empty() {
  return (
    <AbsoluteFill style={{ background: theme.asphalt, color: theme.paint, fontFamily, justifyContent: "center", padding: layout.left, fontSize: 48 }}>
      Sem dados de disputa. Gere um clipe com npm run clip e abra o studio com --props apontando pro JSON em out/.
    </AbsoluteFill>
  );
}
