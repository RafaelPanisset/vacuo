// Colours come from the track itself: asphalt, painted lines, timing-screen yellow, kerb red.
// Team colours are the only other accents, so every clip looks a little different.
export const theme = {
  asphalt: "#2E3033",
  plate: "#3A3D42",
  trackSurface: "#474A50",
  paint: "#ECEBE6",
  muted: "rgba(236, 235, 230, 0.58)",
  faint: "rgba(236, 235, 230, 0.22)",
  timing: "#F5C518",
  kerb: "#D7263D",
};

// Shorts/Reels draw their buttons over the right edge and captions over the bottom,
// so everything that matters stays inside this column.
export const layout = {
  width: 1080,
  height: 1920,
  left: 72,
  contentWidth: 860,
};

/** Black or white text, whichever reads better on `hex`. */
export function textOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.55 ? "#141414" : "#FFFFFF";
}
