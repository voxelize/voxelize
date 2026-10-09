/**
 * The viewer's own pixel art: a 3x5 letter set for pin banners, the
 * banner's faces, and a built-in set of 16x16 action icons for hosts that
 * do not supply their own. Everything is painted with whole pixels on a
 * small canvas and drawn nearest-filtered, never smoothed.
 */
import type { ViewerTheme } from "./theme";

const GLYPHS: Record<string, string> = {
  A: "010101111101101",
  B: "110101110101110",
  C: "011100100100011",
  D: "110101101101110",
  E: "111100110100111",
  F: "111100110100100",
  G: "011100101101011",
  H: "101101111101101",
  I: "111010010010111",
  J: "001001001101010",
  K: "101101110101101",
  L: "100100100100111",
  M: "101111111101101",
  N: "110101101101101",
  O: "010101101101010",
  P: "110101110100100",
  Q: "010101101110011",
  R: "110101110101101",
  S: "011100010001110",
  T: "111010010010010",
  U: "101101101101111",
  V: "101101101101010",
  W: "101101111111101",
  X: "101101010101101",
  Y: "101101010010010",
  Z: "111001010100111",
  "0": "111101101101111",
  "1": "010110010010111",
  "2": "110001010100111",
  "3": "110001010001110",
  "4": "101101111001001",
  "5": "111100110001110",
  "6": "011100111101111",
  "7": "111001010010010",
  "8": "111101111101111",
  "9": "111101111001110",
};

/** Lit pixels of `char` in a 3x5 grid, row by row; null for a character the set lacks. */
export function glyph(char: string): boolean[] | null {
  const bits = GLYPHS[char.toUpperCase()];
  return bits ? [...bits].map((b) => b === "1") : null;
}

function rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace("#", "").slice(0, 6), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** `hex` with each channel scaled by `factor`, the warm side kept a touch brighter. */
export function shade(hex: string, factor: number): string {
  const [r, g, b] = rgb(hex);
  const warm = factor < 1 ? 1 : 1.04;
  const c = (v: number, k = 1) =>
    Math.max(0, Math.min(255, Math.round(v * factor * k)));
  return `rgb(${c(r, warm)} ${c(g)} ${c(b, 1 / warm)})`;
}

type Ctx = CanvasRenderingContext2D;

const px = (ctx: Ctx, color: string, x: number, y: number, w = 1, h = 1) => {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
};

/** A banner face `w` x `h` texels at (x, y): cloth with two folds, a hem and the label. */
export function paintCloth(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  cloth: string,
  letter: string,
  label: string,
) {
  px(ctx, cloth, x, y, w, h);
  // Folds run down the cloth as darker columns, lit on their left edge.
  for (const fold of [2, w - 3]) {
    if (fold <= 0 || fold >= w) continue;
    px(ctx, shade(cloth, 0.8), x + fold, y + 1, 1, h - 1);
    px(ctx, shade(cloth, 1.12), x + fold - 1, y + 2, 1, Math.max(1, h - 4));
  }
  px(ctx, shade(cloth, 1.18), x, y, w, 1);
  px(ctx, shade(cloth, 0.68), x, y + h - 1, w, 1);
  const chars = [...label.toUpperCase()].filter((c) => glyph(c)).slice(0, 2);
  const width = chars.length * 4 - 1;
  let gx = x + Math.floor((w - width) / 2);
  const gy = y + Math.floor((h - 5) / 2);
  for (const char of chars) {
    const bits = glyph(char) ?? [];
    bits.forEach((on, i) => {
      if (!on) return;
      const cx = gx + (i % 3);
      const cy = gy + Math.floor(i / 3);
      px(ctx, shade(cloth, 0.55), cx + 1, cy + 1);
      px(ctx, letter, cx, cy);
    });
    gx += 4;
  }
}

/** A cloth edge (top, bottom or side of the banner): the cloth a step darker. */
export function paintClothEdge(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  cloth: string,
) {
  px(ctx, shade(cloth, 0.74), x, y, w, h);
}

/** A side of the pole: two-tone wood with grain nicks, darker where it meets the ground. */
export function paintPole(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  wood: string,
) {
  for (let i = 0; i < w; i++) {
    px(ctx, shade(wood, i === 0 ? 1.12 : 0.86), x + i, y, 1, h);
  }
  for (let row = 3; row < h - 3; row += 5) {
    px(ctx, shade(wood, 0.7), x + (row % 2), y + row);
  }
  px(ctx, shade(wood, 0.62), x, y + h - 3, w, 3);
}

/** An end of the pole or the cap: one flat tone. */
export function paintFlat(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  factor = 1,
) {
  px(ctx, shade(color, factor), x, y, w, h);
}

/** A side of the finial: brass with a catch-light on its upper edge. */
export function paintCap(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  metal: string,
) {
  px(ctx, shade(metal, 0.86), x, y, w, h);
  px(ctx, shade(metal, 1.15), x, y, w, 1);
  px(ctx, shade(metal, 0.66), x + w - 1, y + 1, 1, Math.max(1, h - 1));
}

/**
 * The built-in 16x16 icons, as pixel maps: `o` outline, `l` `m` `d` a light,
 * mid and dark ramp, `a` the theme's accent, `r` a red, `.` clear.
 */
const ICONS: Record<string, string[]> = {
  spawn: [
    "................",
    "....oooooooo....",
    "....orrrrrrro...",
    "....orrlrrrrro..",
    "....orrrrrrrro..",
    "....orrrrrrro...",
    "....ooooooooo...",
    "....omo.........",
    "....omo.........",
    "....omo.........",
    "....omo.........",
    "....omo.........",
    "...ooomoo.......",
    "..odddddddo.....",
    "..ooooooooo.....",
    "................",
  ],
  fly: [
    "................",
    ".........ooooo..",
    ".........ollao..",
    "..........olao..",
    ".........olmao..",
    "........olmoao..",
    ".......olmo.oo..",
    "......olmo......",
    ".....olmo.......",
    "....olmo........",
    "...olmo.........",
    "..olmo..........",
    "..omo...........",
    "..oo............",
    "................",
    "................",
  ],
  look: [
    "................",
    "................",
    "................",
    ".....oooooo.....",
    "...oolllllloo...",
    "..ollloooolllo..",
    ".ollloaaaaolllo.",
    ".olloaaoaaaollo.",
    ".olloaooaaaollo.",
    ".ollloaaaaolllo.",
    "..ollloooolllo..",
    "...oolllllloo...",
    ".....oooooo.....",
    "................",
    "................",
    "................",
  ],
  measure: [
    "................",
    "...........ooo..",
    "..........ollmo.",
    ".........ollmdo.",
    "........ollmdo..",
    ".......odlmdo...",
    "......ollodo....",
    ".....ollmdo.....",
    "....odlmdo......",
    "...ollodo.......",
    "..ollmdo........",
    ".ollmdo.........",
    ".odmdo..........",
    ".oooo...........",
    "................",
    "................",
  ],
  bookmark: [
    "................",
    "...oooooooooo...",
    "...ollllllllo...",
    "...olmmmmmmlo...",
    "...olmaaaamlo...",
    "...olmmmmmmlo...",
    "...olmaaaamlo...",
    "...olmmmmmmlo...",
    "...olmmmmmmlo...",
    "...olmmmmmmlo...",
    "...olmmoommlo...",
    "...olmo..omlo...",
    "...olo....olo...",
    "...oo......oo...",
    "................",
    "................",
  ],
  "copy-link": [
    "................",
    "................",
    "........oooo....",
    ".......ollllo...",
    "......olooolo...",
    "......olo.olo...",
    "...oooolo.olo...",
    "..ollllaooolo...",
    "..olooaolllo....",
    "..olo.olooo.....",
    "..olo.olo.......",
    "..olooolo.......",
    "...ollllo.......",
    "....oooo........",
    "................",
    "................",
  ],
  "copy-coords": [
    "................",
    "................",
    "....oo....oo....",
    "....om....om....",
    "..oooooooooooo..",
    "..ollllllllllo..",
    "..oooooooooooo..",
    "....om....om....",
    "....om....om....",
    "..oooooooooooo..",
    "..ollllllllllo..",
    "..oooooooooooo..",
    "....om....om....",
    "....oo....oo....",
    "................",
    "................",
  ],
  remove: [
    "................",
    "................",
    "..ooo......ooo..",
    "..orro....orro..",
    "..orrro..orrro..",
    "...orrrooorrro..",
    "....orrrrrrro...",
    ".....orrrrro....",
    ".....orrrrro....",
    "....orrrrrrro...",
    "...orrrooorrro..",
    "..orrro..orrro..",
    "..orro....orro..",
    "..ooo......ooo..",
    "................",
    "................",
  ],
  pin: [
    "................",
    ".....oooooo.....",
    "....orrrrrro....",
    "...orrlrrrrro...",
    "...orlrrrrrro...",
    "...orrrrrrrro...",
    "...orrrrrrrro...",
    "....orrrrrro....",
    ".....orrrrro....",
    "......orrro.....",
    "......orrro.....",
    ".......oro......",
    ".......oro......",
    "........o.......",
    "................",
    "................",
  ],
};

/** The built-in icon for `id` as a data URL, painted in `theme`'s colours; null when there is none. */
export function builtinIcon(id: string, theme: ViewerTheme): string | null {
  const rows = ICONS[id];
  if (!rows || typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const colors: Record<string, string> = {
    o: theme.outline,
    l: "#e9e3d5",
    m: "#b6ad9d",
    d: "#7a7163",
    a: theme.accent,
    r: theme.pinCloth[0] ?? "#a33b35",
  };
  rows.forEach((row, y) =>
    [...row].forEach((c, x) => {
      const color = colors[c];
      if (color) px(ctx, color, x, y);
    }),
  );
  return canvas.toDataURL("image/png");
}
