/**
 * The page's scripted surface: what the capture CLI, the viewer server's
 * session API and a puppeteer script call, installed on
 * `window.__voxelizeViewer`. Everything is plain data in and out.
 */
import type { FlightOptions, FlightResult } from "./camera";
import { applyOptionPairs, parseOptions, type ViewerOptions } from "./options";
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
    bookmarks: () => bookmarks,
    goTo(id, options = {}) {
      const bookmark = bookmarks.find((b) => b.id === id);
      if (!bookmark)
        throw new Error(
          `no bookmark ${id}; known: ${bookmarks.map((b) => b.id).join(", ")}`,
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
