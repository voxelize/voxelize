/**
 * Everything a user can toggle, as one serializable record: the toolbar
 * edits it, the URL carries it, the control API and the capture CLI set it
 * with `key=value` pairs.
 */

export type FogMode = "off" | "distance" | "game";

export type SplitMode = "none" | "side" | "swipe";

export type ViewerOptions = {
  /** Time of day, 0..1 (0 midnight, 0.25 sunrise, 0.5 noon). */
  time: number;
  fog: FogMode;
  water: boolean;
  /** Plants and leaves (the cutout materials). */
  plants: boolean;
  /** The coarse far layer past the meshed chunks. */
  far: boolean;
  /** Sun shadows from the engine's cascades, near the camera. */
  shadows: boolean;
  /** Active overlay ids, drawn in order. */
  overlays: string[];
  overlayOpacity: number;
  /** Radius of meshed chunks around the focus, in chunks. */
  nearRadius: number;
  /** Reach of the far layer, in blocks. */
  farDistance: number;
  /** How two sources share the screen. */
  split: SplitMode;
  /** Where the swipe divides the screen, 0..1 from the left. */
  swipe: number;
  /** Coordinates, legend and labels drawn over the canvas. */
  hud: boolean;
  /**
   * Seconds the camera takes to cover 90% of a height change it makes on
   * its own (following the ground under the look point, clearing a ridge)
   * and, in part, a wheel zoom; 0 snaps.
   */
  smoothing: number;
  /** Free flight keeps its height unless Space or Shift asks; off flies along the view. */
  levelFlight: boolean;
};

export const DEFAULT_OPTIONS: Readonly<ViewerOptions> = Object.freeze({
  time: 0.5,
  fog: "distance",
  water: true,
  plants: true,
  far: true,
  shadows: true,
  overlays: [],
  overlayOpacity: 0.6,
  nearRadius: 12,
  farDistance: 3000,
  split: "none",
  swipe: 0.5,
  hud: true,
  smoothing: 0.75,
  levelFlight: true,
});

const FOG_MODES: readonly FogMode[] = ["off", "distance", "game"];
const SPLIT_MODES: readonly SplitMode[] = ["none", "side", "swipe"];

const BOOLEAN_KEYS = [
  "water",
  "plants",
  "far",
  "shadows",
  "hud",
  "levelFlight",
] as const;
const NUMBER_KEYS = {
  time: [0, 1],
  overlayOpacity: [0, 1],
  nearRadius: [1, 48],
  farDistance: [0, 16384],
  swipe: [0, 1],
  smoothing: [0, 3],
} as const;

function parseBoolean(key: string, value: string): boolean {
  const v = value.trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(v)) return true;
  if (["0", "false", "off", "no"].includes(v)) return false;
  throw new Error(`${key} takes on or off, got ${JSON.stringify(value)}`);
}

/**
 * One `key=value` change. Overlays take a comma list (`overlays=biome,grid`),
 * and `+id` / `-id` add or remove one.
 */
export function applyOption(
  options: ViewerOptions,
  key: string,
  value: string,
): ViewerOptions {
  const next: ViewerOptions = { ...options, overlays: [...options.overlays] };
  if ((BOOLEAN_KEYS as readonly string[]).includes(key)) {
    (next as Record<string, unknown>)[key] = parseBoolean(key, value);
    return next;
  }
  if (key in NUMBER_KEYS) {
    const [lo, hi] = NUMBER_KEYS[key as keyof typeof NUMBER_KEYS];
    const n = Number(value);
    if (!Number.isFinite(n)) {
      throw new Error(`${key} takes a number, got ${JSON.stringify(value)}`);
    }
    (next as Record<string, unknown>)[key] = Math.min(hi, Math.max(lo, n));
    return next;
  }
  if (key === "fog") {
    if (!(FOG_MODES as readonly string[]).includes(value)) {
      throw new Error(`fog takes ${FOG_MODES.join(" | ")}`);
    }
    next.fog = value as FogMode;
    return next;
  }
  if (key === "split") {
    if (!(SPLIT_MODES as readonly string[]).includes(value)) {
      throw new Error(`split takes ${SPLIT_MODES.join(" | ")}`);
    }
    next.split = value as SplitMode;
    return next;
  }
  if (key === "overlays" || key === "overlay") {
    const items = value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.every((item) => /^[+-]/.test(item))) {
      for (const item of items) {
        const id = item.slice(1);
        next.overlays = next.overlays.filter((o) => o !== id);
        if (item.startsWith("+")) next.overlays.push(id);
      }
    } else {
      next.overlays = items.filter((item) => item !== "none");
    }
    return next;
  }
  throw new Error(`unknown option ${JSON.stringify(key)}`);
}

/** `water=off,fog=game` or repeated pairs. */
export function applyOptionPairs(
  options: ViewerOptions,
  pairs: string | string[],
): ViewerOptions {
  const list = (Array.isArray(pairs) ? pairs : [pairs])
    .flatMap((p) => splitPairs(p))
    .filter(Boolean);
  return list.reduce((acc, pair) => {
    const at = pair.indexOf("=");
    if (at <= 0) throw new Error(`expected key=value, got ${pair}`);
    return applyOption(acc, pair.slice(0, at).trim(), pair.slice(at + 1));
  }, options);
}

/** Splits `a=1,b=2` but keeps `overlays=x,y` whole up to the next `key=`. */
function splitPairs(text: string): string[] {
  const out: string[] = [];
  for (const piece of text.split(",")) {
    if (piece.includes("=") || out.length === 0) out.push(piece);
    else out[out.length - 1] += `,${piece}`;
  }
  return out;
}

/** Only the keys that differ from `base`, as strings (for a URL). */
export function serializeOptions(
  options: ViewerOptions,
  base: Readonly<ViewerOptions> = DEFAULT_OPTIONS,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(base) as (keyof ViewerOptions)[]) {
    const value = options[key];
    const fallback = base[key];
    if (Array.isArray(value)) {
      if (value.join(",") !== (fallback as string[]).join(",")) {
        out[key] = value.join(",") || "none";
      }
    } else if (value !== fallback) {
      out[key] =
        typeof value === "boolean" ? (value ? "on" : "off") : String(value);
    }
  }
  return out;
}

/** Options from URL parameters; unknown keys are left for the host. */
export function parseOptions(
  params: URLSearchParams,
  base: Readonly<ViewerOptions> = DEFAULT_OPTIONS,
): ViewerOptions {
  let options: ViewerOptions = { ...base, overlays: [...base.overlays] };
  for (const key of Object.keys(base)) {
    const value = params.get(key);
    if (value !== null) options = applyOption(options, key, value);
  }
  return options;
}
