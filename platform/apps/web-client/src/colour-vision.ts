// Colour vision aids: a daltonising colour matrix over the game view and
// the interface, so colours a colour-blind player confuses (red and green,
// or blue and yellow) are shifted into ones they can tell apart.
//
// M = I + E (I - S): S simulates the colour vision deficiency (Machado et
// al. 2009, full severity), I - S is the information it loses, and E moves
// that into channels the viewer still sees.

export type ColourVision = "normal" | "protanopia" | "deuteranopia" | "tritanopia";

export const COLOUR_VISIONS: { kind: ColourVision; label: string }[] = [
  { kind: "normal", label: "Off" },
  { kind: "protanopia", label: "Red-blind (protanopia)" },
  { kind: "deuteranopia", label: "Green-blind (deuteranopia)" },
  { kind: "tritanopia", label: "Blue-blind (tritanopia)" },
];

type M3 = number[]; // 3 x 3, row major

export const SIMULATION: Record<Exclude<ColourVision, "normal">, M3> = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

const IDENTITY: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const RED_GREEN_SHIFT: M3 = [0, 0, 0, 0.7, 1, 0, 0.7, 0, 1];
const BLUE_YELLOW_SHIFT: M3 = [1, 0, 0.7, 0, 1, 0.7, 0, 0, 0];

export function multiply(a: M3, b: M3): M3 {
  const out = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return out;
}

export function apply(m: M3, [r, g, b]: [number, number, number]): [number, number, number] {
  return [m[0] * r + m[1] * g + m[2] * b, m[3] * r + m[4] * g + m[5] * b, m[6] * r + m[7] * g + m[8] * b];
}

/** The correction matrix for a kind of colour vision (identity for normal). */
export function daltonize(kind: ColourVision): M3 {
  if (kind === "normal") return [...IDENTITY];
  const lost = IDENTITY.map((v, i) => v - SIMULATION[kind][i]);
  const shift = kind === "tritanopia" ? BLUE_YELLOW_SHIFT : RED_GREEN_SHIFT;
  return IDENTITY.map((v, i) => v + multiply(shift, lost)[i]);
}

/** The `values` of an SVG feColorMatrix for a 3 x 3 colour matrix. */
export function colorMatrixValues(m: M3): string {
  const row = (r: number) => `${m[r * 3]} ${m[r * 3 + 1]} ${m[r * 3 + 2]} 0 0`;
  return `${row(0)} ${row(1)} ${row(2)} 0 0 0 1 0`;
}

/** Filter the given elements (or clear the filter for normal vision). */
export function applyColourVision(kind: ColourVision, targets: HTMLElement[]) {
  let svg: Element | null = document.getElementById("colour-vision-svg");
  if (!svg) {
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.id = "colour-vision-svg";
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("style", "position:absolute;width:0;height:0");
    svg.innerHTML = '<filter id="colour-vision" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values=""/></filter>';
    document.body.append(svg);
  }
  svg.querySelector("feColorMatrix")!.setAttribute("values", colorMatrixValues(daltonize(kind)));
  for (const el of targets) el.style.filter = kind === "normal" ? "" : "url(#colour-vision)";
}
