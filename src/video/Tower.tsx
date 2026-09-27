import { interpolate, spring } from "remotion";
import type { ClipDriver, ClipProps } from "./props.ts";
import { theme } from "./theme.ts";
import { frameAt, lastAt } from "./timing.ts";

type Props = {
  props: ClipProps;
  frame: number;
  t: number;
  width: number;
};

const ROW = 92;
const ROW_GAP = 10;
const POSITION_COL = 96;
const GAP_COL = 190;

/**
 * A two-row slice of the broadcast timing tower. Positions and the gap stay put;
 * the driver plates slide past each other when one overtakes the other.
 */
export function Tower({ props, frame, t, width }: Props) {
  const { drivers, gaps, swaps } = props;
  const sample = lastAt(gaps, t);
  const aheadNumber = sample?.ahead ?? drivers[0].number;
  const position = sample?.position ?? 0;
  const order = drivers[0].number === aheadNumber ? [0, 1] : [1, 0];

  const swap = lastAt(swaps, t);
  const swapFrame = swap && swap.t <= t ? frameAt(swap.t, props) : null;
  const slide = swapFrame === null ? 1 : spring({ frame: frame - swapFrame, fps: props.fps, config: { damping: 16, stiffness: 110 } });
  const flash = swapFrame === null ? 0 : interpolate(frame - swapFrame, [0, 5, 36], [0, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const slotY = (slot: number) => slot * (ROW + ROW_GAP);
  const plateWidth = width - POSITION_COL - GAP_COL;

  return (
    <div style={{ position: "relative", width, height: 2 * ROW + ROW_GAP }}>
      {[0, 1].map((slot) => (
        <div key={slot} style={{ position: "absolute", top: slotY(slot), left: 0, height: ROW, width: POSITION_COL, display: "flex", alignItems: "center", fontSize: 44, fontWeight: 700 }}>
          P{position + slot}
        </div>
      ))}

      {order.map((driverIndex, slot) => {
        const previousSlot = swapFrame === null ? slot : 1 - slot;
        const y = interpolate(slide, [0, 1], [slotY(previousSlot), slotY(slot)]);
        const justTookTheLead = slot === 0 && swapFrame !== null;
        return (
          <Plate
            key={driverIndex}
            driver={drivers[driverIndex]}
            top={y}
            left={POSITION_COL}
            width={plateWidth}
            flash={justTookTheLead ? flash : 0}
            // The car moving up is the one overtaking, so it passes over the other plate.
            onTop={slot === 0}
          />
        );
      })}

      <div style={{ position: "absolute", top: slotY(1), right: 0, height: ROW, width: GAP_COL, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
        {sample && <Figures text={`+${sample.gap.toFixed(3)}`} color={sample.gap < 1 ? theme.timing : theme.paint} />}
      </div>
    </div>
  );
}

type PlateProps = { driver: ClipDriver; top: number; left: number; width: number; flash: number; onTop: boolean };

function Plate({ driver, top, left, width, flash, onTop }: PlateProps) {
  return (
    <div
      style={{
        position: "absolute",
        zIndex: onTop ? 2 : 1,
        top,
        left,
        width,
        height: ROW,
        display: "flex",
        alignItems: "center",
        gap: 22,
        background: theme.plate,
        borderRadius: 6,
        overflow: "hidden",
      }}
    >
      <div style={{ position: "absolute", inset: 0, background: theme.kerb, opacity: flash }} />
      <div style={{ width: 14, alignSelf: "stretch", background: driver.color, position: "relative" }} />
      <div style={{ fontSize: 46, fontWeight: 900, position: "relative", width: 104 }}>{driver.acronym}</div>
      <div style={{ fontSize: 38, fontWeight: 400, position: "relative", color: theme.muted }}>{driver.name}</div>
    </div>
  );
}

/** Timing figures with fixed-width digits, so the number doesn't jitter as it changes. */
function Figures({ text, color }: { text: string; color: string }) {
  return (
    <div style={{ display: "flex", fontSize: 50, fontWeight: 700, color }}>
      {[...text].map((char, k) => (
        <span key={k} style={{ display: "inline-block", width: /\d/.test(char) ? "0.56em" : char === "." ? "0.26em" : "0.5em", textAlign: "center" }}>
          {char}
        </span>
      ))}
    </div>
  );
}
