/**
 * The page's scripted surface: what the capture CLI, the viewer server's
 * session API and a puppeteer script call, installed on
 * `window.__voxelizeViewer`. Everything is plain data in and out.
 */
import type { FlightOptions, FlightResult } from "./camera";
import type { TextureCensus } from "./materials";
import { applyOptionPairs, parseOptions, type ViewerOptions } from "./options";
import type { PinActionResult } from "./pin-layer";
import type { Pin } from "./pins";
import {
  type Bookmark,
  parseVec,
  type Pose,
  type Preset,
  PRESETS,
  type Vec3,
} from "./pose";
import type { IdleReport, SourceRef, ViewerState, WorldViewer } from "./viewer";

export type ViewerControl = {
  state(): ViewerState;
  setPose(pose: Pose, preset?: Preset): ViewerState;
  setPreset(preset: Preset, span?: number): ViewerState;
  setOptions(options: Partial<ViewerOptions>): ViewerState;
  /** Back to the options the page started with. */
  resetOptions(): ViewerState;
  /** `key=value` pairs, as the CLI's `--toggle` takes them. */
  applyOptions(pairs: string[]): ViewerState;
  setSources(a: SourceRef, b?: SourceRef | null): Promise<ViewerState>;
  waitIdle(options?: {
    timeoutMs?: number;
    settleFrames?: number;
  }): Promise<IdleReport>;
  bookmarks(): Bookmark[];
  /** Jumps to a bookmark; `fly` eases there the way the toolbar does. */
  goTo(
    bookmarkId: string,
    options?: { fly?: boolean } & FlightOptions,
  ): ViewerState | Promise<ViewerState>;
  /**
   * Flies the camera to frame (x, y, z) as a double-click does, keeping the
   * preset; a null y takes the ground there. Resolves when it lands or is
   * cut short.
   */
  flyTo(
    x: number,
    y: number | null,
    z: number,
    options?: FlightOptions,
  ): Promise<FlightResult>;
  flyToPose(
    pose: Pose,
    preset?: Preset,
    options?: FlightOptions,
  ): Promise<FlightResult>;
  cancelFlight(): ViewerState;
  /** The ground point under canvas pixel (x, y), as a double-click there would fly to; null for sky. */
  pick(x: number, y: number): Vec3 | null;
  /** Drops the pin as a click there does, moving it from wherever it stood; a null y takes the ground. Resolves with what the source knows of the column. */
  dropPin(x: number, y: number | null, z: number): Promise<Pin>;
  /** The pin, or null when there is none. */
  pin(): Pin | null;
  /** Where the pin's banner stands on the canvas, CSS pixels (the middle of its cloth); null when it is not on screen. */
  pinOnScreen(): { x: number; y: number } | null;
  /** Every atlas slot and own-texture face of source A's (or B's) view, with the ones nothing painted listed by block and face. */
  textureCensus(which?: "a" | "b"): TextureCensus | null;
  removePin(): boolean;
  /**
   * Runs a wheel action on the pin (`"pin"`) or on a bare point: spawn, fly,
   * look, measure (from the pin; `{ to: [x, y, z] }`, a null y taking the
   * ground), bookmark, copy-link, copy-coords, remove, pin, and any the
   * host added. Spawn returns the game link without opening it unless
   * `{ open: true }`.
   */
  pinAction(
    target: "pin" | [number, number | null, number],
    action: string,
    args?: Record<string, unknown>,
  ): Promise<PinActionResult>;
  query(x: number, z: number, which?: "a" | "b"): Promise<unknown>;
  shareLink(): string | null;
  /** Frame times over `ms` of real frames, for a frame-budget claim. */
  measureFrames(ms?: number): Promise<FrameReport>;
};

export type FrameReport = {
  frames: number;
  durationMs: number;
  fps: number;
  meanMs: number;
  p95Ms: number;
  maxMs: number;
};

/** Times `ms` worth of animation frames. */
export async function measureFrames(ms = 5000): Promise<FrameReport> {
  const times: number[] = [];
  const started = performance.now();
  let last = started;
  while (performance.now() - started < ms) {
    const now = await new Promise<number>((resolve) =>
      requestAnimationFrame(resolve),
    );
    times.push(now - last);
    last = now;
  }
  const sorted = [...times].sort((a, b) => a - b);
  const durationMs = performance.now() - started;
  return {
    frames: times.length,
    durationMs,
    fps: (times.length * 1000) / durationMs,
    meanMs: times.reduce((s, t) => s + t, 0) / Math.max(1, times.length),
    p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    maxMs: sorted.at(-1) ?? 0,
  };
}

declare global {
  interface Window {
    __voxelizeViewer?: ViewerControl;
  }
}

export function installControl(
  viewer: WorldViewer,
  bookmarks: Bookmark[] = [],
  base: ViewerOptions = viewer.options,
): ViewerControl {
  const initial = { ...base, overlays: [...base.overlays] };
  if (!viewer.bookmarks.length) viewer.setBookmarks(bookmarks);
  const control: ViewerControl = {
    resetOptions() {
      viewer.setOptions({ ...initial, overlays: [...initial.overlays] });
      return viewer.state();
    },
    state: () => viewer.state(),
    setPose(pose, preset) {
      viewer.setPose(pose, preset);
      return viewer.state();
    },
    setPreset(preset, span) {
      viewer.setPreset(preset, span);
      return viewer.state();
    },
    setOptions(options) {
      viewer.setOptions(options);
      return viewer.state();
    },
    applyOptions(pairs) {
      viewer.setOptions(applyOptionPairs(viewer.options, pairs));
      return viewer.state();
    },
    async setSources(a, b = null) {
      await viewer.setSources(a, b);
      return viewer.state();
    },
    waitIdle: (options) => viewer.waitIdle(options),
    bookmarks: () => viewer.bookmarks,
    goTo(id, options = {}) {
      const bookmark = viewer.bookmarks.find((b) => b.id === id);
      if (!bookmark)
        throw new Error(
          `no bookmark ${id}; known: ${viewer.bookmarks.map((b) => b.id).join(", ")}`,
        );
      const preset = bookmark.preset ?? viewer.rig.preset;
      if (options.fly) {
        return viewer
          .flyToPose(bookmark.pose, preset, options)
          .then(() => viewer.state());
      }
      viewer.setPose(bookmark.pose, preset);
      return viewer.state();
    },
    flyTo: (x, y, z, options) => viewer.flyTo([x, y, z], options),
    flyToPose: (pose, preset, options) =>
      viewer.flyToPose(pose, preset, options),
    cancelFlight() {
      viewer.cancelFlight();
      return viewer.state();
    },
    pick: (x, y) => viewer.pickGround(x, y),
    dropPin(x, y, z) {
      const height = y ?? viewer.surfaceAt(x, z);
      if (height === null) {
        return Promise.reject(
          new Error(`nothing loaded at ${x},${z} to pin; pass its height`),
        );
      }
      return viewer.pins.drop([x, height, z]);
    },
    pin: () => viewer.pins.current(),
    pinOnScreen() {
      const at = viewer.pins.onScreen();
      if (!at) return null;
      // The cloth hangs off the pole's right side, over its top quarter.
      const tall = at.base[1] - at.top[1];
      return { x: at.base[0] + tall * 0.15, y: at.top[1] + tall * 0.25 };
    },
    textureCensus: (which = "a") => viewer.textureCensus(which),
    removePin: () => viewer.pins.remove(),
    pinAction(target, action, args = {}) {
      const ground = ([x, y, z]: [number, number | null, number]) => {
        const height = y ?? viewer.surfaceAt(x, z);
        if (height === null) throw new Error(`nothing loaded at ${x},${z}`);
        return [x, height, z] as Vec3;
      };
      let resolved: { pin: Pin | null; point: Vec3 };
      try {
        if (target === "pin") {
          const pin = viewer.pins.current();
          if (!pin) throw new Error("there is no pin; drop one first");
          resolved = { pin, point: pin.point };
        } else {
          resolved = { pin: null, point: ground(target) };
        }
        if (Array.isArray(args.to)) {
          args = {
            ...args,
            to: ground(args.to as [number, number | null, number]),
          };
        }
      } catch (error) {
        return Promise.reject(error);
      }
      return viewer.pins.run(resolved, action, { open: false, ...args });
    },
    query: (x, z, which) => viewer.query(x, z, which),
    shareLink: () => viewer.shareLink(),
    measureFrames,
  };
  window.__voxelizeViewer = control;
  return control;
}

/** What a viewer URL asks for: sources, pose, preset and options. */
export type UrlRequest = {
  a: string | null;
  b: string | null;
  pose: Pose | null;
  preset: Preset | null;
  bookmark: string | null;
  options: ViewerOptions;
};

export function readUrl(search: string, base: ViewerOptions): UrlRequest {
  const params = new URLSearchParams(search);
  const pos = params.get("pos");
  const look = params.get("look");
  const preset = params.get("preset");
  return {
    a: params.get("a") ?? params.get("source"),
    b: params.get("b"),
    pose: pos && look ? { eye: parseVec(pos), look: parseVec(look) } : null,
    preset:
      preset && (PRESETS as readonly string[]).includes(preset)
        ? (preset as Preset)
        : null,
    bookmark: params.get("bookmark"),
    options: parseOptions(params, base),
  };
}
