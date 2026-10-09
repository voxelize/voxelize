/**
 * Overlays: layers keyed by x,z drawn over whatever the camera sees, near
 * meshes and far tiles alike (the composite pass reconstructs each pixel's
 * world position from depth). Three kinds:
 *
 * - `raster`: a colour per far-tile sample, from its height, water,
 *   material and the source's extra layers (a biome map, a landform mask);
 * - `annotations`: the source's labelled footprints (structures, places);
 * - `grid` and `contours`: drawn analytically in the shader.
 *
 * The engine ships the generic ones; a host adds its own `raster`
 * overlays for the layers its source names.
 */
import {
  DataTexture,
  FloatType,
  LinearFilter,
  NearestFilter,
  RedFormat,
  RGBAFormat,
  UnsignedByteType,
} from "three";

import type { FarSpec, FarTileClient } from "./far-layer";
import type { FarTileFile } from "./formats";

export type Rgba = [number, number, number, number];

export type LayerInfo = {
  id: string;
  type: "u8" | "u16" | "u32";
  labels: string[];
  bits: boolean;
};

export type SourceMeta = {
  protocol: number;
  name: string;
  chunkSize: number;
  maxHeight: number;
  subChunks: number;
  levelHeight: number;
  maxLightLevel: number;
  seed: number;
  waterLevel: number;
  far: { kind: "blocks" } | { kind: "classes"; names: string[] } | null;
  layers: LayerInfo[];
  chunkBounds: [number, number, number, number] | null;
  info: Record<string, unknown> | null;
  warnings: string[];
  meshNamespace: string;
};

export type OverlaySample = {
  x: number;
  z: number;
  /** Top face y of the surface (0: nothing). */
  height: number;
  /** Top face y of standing water (0: none). */
  water: number;
  material: number;
  /** A named extra layer's value at this sample (0 when the source has none). */
  layer(id: string): number;
};

export type LegendRow = { label: string; color: string };

export type RasterOverlay = {
  kind: "raster";
  id: string;
  label: string;
  color(sample: OverlaySample, meta: SourceMeta): Rgba | null;
  legend?(meta: SourceMeta): LegendRow[];
  /** Whether a source can draw it (it names the layers this reads). */
  available?(meta: SourceMeta): boolean;
};

export type Annotation = {
  kind: string;
  label: string;
  detail: string;
  anchor: [number, number, number];
  bounds: [number, number, number, number];
};

export type AnnotationOverlay = {
  kind: "annotations";
  id: string;
  label: string;
  color(annotation: Annotation): string;
};

export type AnalyticOverlay = {
  kind: "grid" | "contours";
  id: string;
  label: string;
  /** Grid cell or contour interval in blocks. */
  interval: number;
};

export type ViewerOverlay = RasterOverlay | AnnotationOverlay | AnalyticOverlay;

const hex = (color: string, alpha = 255): Rgba => {
  const v = parseInt(color.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255, alpha];
};

/** Hypsometric ramp for `relief`: sea floor to snow. */
const RELIEF_STOPS: [number, string][] = [
  [0, "#1f3b66"],
  [0.15, "#2f6a8f"],
  [0.18, "#5a9e5a"],
  [0.3, "#a8b86a"],
  [0.45, "#c9a46a"],
  [0.6, "#9b6b4a"],
  [0.8, "#8a8a8a"],
  [1, "#f4f4f4"],
];

export function reliefColor(t: number): Rgba {
  const v = Math.max(0, Math.min(1, t));
  for (let i = 1; i < RELIEF_STOPS.length; i++) {
    const [b, cb] = RELIEF_STOPS[i];
    const [a, ca] = RELIEF_STOPS[i - 1];
    if (v <= b) {
      const k = (v - a) / Math.max(1e-6, b - a);
      const x = hex(ca);
      const y = hex(cb);
      return [
        Math.round(x[0] + (y[0] - x[0]) * k),
        Math.round(x[1] + (y[1] - x[1]) * k),
        Math.round(x[2] + (y[2] - x[2]) * k),
        255,
      ];
    }
  }
  return hex("#f4f4f4");
}

export const BUILTIN_OVERLAYS: ViewerOverlay[] = [
  { kind: "grid", id: "grid", label: "Chunk grid", interval: 16 },
  { kind: "contours", id: "contours", label: "Height contours", interval: 8 },
  {
    kind: "raster",
    id: "relief",
    label: "Relief",
    color: (s, meta) =>
      s.height > 0
        ? reliefColor(s.height / Math.max(1, meta.maxHeight * 0.8))
        : null,
    legend: () => [
      { label: "low", color: "#2f6a8f" },
      { label: "mid", color: "#c9a46a" },
      { label: "high", color: "#f4f4f4" },
    ],
  },
  {
    kind: "raster",
    id: "water",
    label: "Water bodies",
    color: (s, meta) => {
      if (s.water <= s.height || s.water === 0) return null;
      const isSea = meta.waterLevel > 0 && s.water <= meta.waterLevel + 1;
      return isSea ? hex("#2a5fb0", 150) : hex("#2fd0ff", 235);
    },
    legend: () => [
      { label: "sea", color: "#2a5fb0" },
      { label: "fresh water (lakes, ponds, rivers)", color: "#2fd0ff" },
    ],
  },
  {
    kind: "annotations",
    id: "annotations",
    label: "Structures",
    color: () => "#ffd24a",
  },
];

const TEXELS = 1024;

/** Blocks per overlay texel for a view framing `span` blocks. */
export function overlayResolution(span: number): number {
  let res = 1;
  while (res * TEXELS < span * 2.2 && res < 64) res *= 2;
  return res;
}

function layerReader(meta: SourceMeta, tile: FarTileFile) {
  const views = new Map<string, { info: LayerInfo; view: DataView }>();
  meta.layers.forEach((info, i) => {
    const bytes = tile.layers[i];
    if (bytes)
      views.set(info.id, {
        info,
        view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      });
  });
  return (id: string, index: number) => {
    const entry = views.get(id);
    if (!entry) return 0;
    switch (entry.info.type) {
      case "u8":
        return entry.view.getUint8(index);
      case "u16":
        return entry.view.getUint16(index * 2, true);
      default:
        return entry.view.getUint32(index * 4, true);
    }
  };
}

/**
 * One source's overlay texture: a square of texels around the focus at a
 * resolution set by the zoom, filled from far tiles at that spacing as they
 * arrive (each tile paints its own patch; the upload is throttled).
 */
export class OverlayCompositor {
  readonly texture: DataTexture;

  /** Surface heights under the same rect, filtered: contours are drawn from it. */
  readonly heightTexture: DataTexture;

  /** World rect the texture covers: x0, z0, blocks per texel. */
  rect = { x0: 0, z0: 0, res: 1 };

  annotations: Annotation[] = [];

  private data = new Uint8Array(TEXELS * TEXELS * 4);

  private heights = new Float32Array(TEXELS * TEXELS);

  private wantsHeights = false;

  private generation = 0;

  private active: RasterOverlay[] = [];

  private annotationOverlay: AnnotationOverlay | null = null;

  private inFlight = 0;

  private dirty = false;

  private lastUpload = 0;

  private signature = "";

  constructor(
    private readonly meta: SourceMeta,
    private readonly client: FarTileClient,
    private readonly annotationsUrl: string,
  ) {
    this.texture = new DataTexture(
      this.data,
      TEXELS,
      TEXELS,
      RGBAFormat,
      UnsignedByteType,
    );
    this.texture.magFilter = NearestFilter;
    this.texture.minFilter = NearestFilter;
    this.texture.needsUpdate = true;
    this.heightTexture = new DataTexture(
      this.heights,
      TEXELS,
      TEXELS,
      RedFormat,
      FloatType,
    );
    this.heightTexture.magFilter = LinearFilter;
    this.heightTexture.minFilter = LinearFilter;
    this.heightTexture.needsUpdate = true;
  }

  get hasRaster() {
    return this.active.length > 0 || this.annotationOverlay !== null;
  }

  get hasHeights() {
    return this.wantsHeights;
  }

  isIdle() {
    return this.inFlight === 0 && !this.dirty;
  }

  /** Re-targets the texture when the focus, zoom or active overlays move. */
  update(
    focusX: number,
    focusZ: number,
    span: number,
    overlays: ViewerOverlay[],
  ) {
    // Rasters and contours sample far tiles; a source without them has annotations only.
    const sampled = this.meta.far ? overlays : [];
    const rasters = sampled.filter(
      (o): o is RasterOverlay =>
        o.kind === "raster" && (o.available?.(this.meta) ?? true),
    );
    const annotations =
      overlays.find((o): o is AnnotationOverlay => o.kind === "annotations") ??
      null;
    const heights = sampled.some((o) => o.kind === "contours");
    const res = overlayResolution(span);
    const cell = res * 64;
    const x0 = Math.floor((focusX - (TEXELS * res) / 2) / cell) * cell;
    const z0 = Math.floor((focusZ - (TEXELS * res) / 2) / cell) * cell;
    const signature = `${x0},${z0},${res}|${rasters.map((r) => r.id).join(",")}|${annotations?.id ?? ""}|${heights}`;
    if (signature !== this.signature) {
      this.signature = signature;
      this.active = rasters;
      this.annotationOverlay = annotations;
      this.wantsHeights = heights;
      this.rect = { x0, z0, res };
      this.generation += 1;
      this.data.fill(0);
      this.heights.fill(0);
      this.dirty = true;
      if (rasters.length || heights) this.fill(this.generation);
      if (annotations) this.loadAnnotations(this.generation);
    }
    const now = performance.now();
    if (this.dirty && now - this.lastUpload > 150) {
      this.texture.needsUpdate = true;
      this.heightTexture.needsUpdate = true;
      this.lastUpload = now;
      this.dirty = this.inFlight > 0;
    }
  }

  private async fill(generation: number) {
    const { x0, z0, res } = this.rect;
    const span = 64 * res;
    const specs: FarSpec[] = [];
    for (let tz = 0; tz < TEXELS / 64; tz++) {
      for (let tx = 0; tx < TEXELS / 64; tx++) {
        specs.push({
          x0: x0 + tx * span,
          z0: z0 + tz * span,
          step: res,
          size: 64,
        });
      }
    }
    // Nearest the centre first.
    const mid = (TEXELS * res) / 2;
    specs.sort(
      (a, b) =>
        Math.hypot(a.x0 - x0 - mid, a.z0 - z0 - mid) -
        Math.hypot(b.x0 - x0 - mid, b.z0 - z0 - mid),
    );
    let next = 0;
    const lane = async () => {
      while (next < specs.length && generation === this.generation) {
        const batch = specs.slice(next, next + 8);
        next += 8;
        this.inFlight += 1;
        try {
          const tiles = await this.client.fetch(batch);
          if (generation !== this.generation) return;
          for (const tile of tiles) this.paint(tile);
          this.dirty = true;
        } catch (error) {
          console.error(
            `[viewer] overlay tiles failed: ${(error as Error).message}`,
          );
        } finally {
          this.inFlight -= 1;
        }
      }
    };
    await Promise.all([lane(), lane(), lane(), lane()]);
  }

  private paint(tile: FarTileFile) {
    const { x0, z0, res } = this.rect;
    const read = layerReader(this.meta, tile);
    const ox = Math.round((tile.x0 - x0) / res);
    const oz = Math.round((tile.z0 - z0) / res);
    for (let j = 0; j < tile.size; j++) {
      for (let i = 0; i < tile.size; i++) {
        const tx = ox + i;
        const tz = oz + j;
        if (tx < 0 || tz < 0 || tx >= TEXELS || tz >= TEXELS) continue;
        const index = j * tile.size + i;
        const sample: OverlaySample = {
          x: tile.x0 + i * tile.step,
          z: tile.z0 + j * tile.step,
          height: tile.heights[index],
          water: tile.water[index],
          material: tile.materials[index],
          layer: (id) => read(id, index),
        };
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (const overlay of this.active) {
          const c = overlay.color(sample, this.meta);
          if (!c) continue;
          const alpha = c[3] / 255;
          r = r * (1 - alpha) + c[0] * alpha;
          g = g * (1 - alpha) + c[1] * alpha;
          b = b * (1 - alpha) + c[2] * alpha;
          a = a + alpha * (1 - a);
        }
        const o = (tz * TEXELS + tx) * 4;
        this.data[o] = r;
        this.data[o + 1] = g;
        this.data[o + 2] = b;
        this.data[o + 3] = a * 255;
        this.heights[tz * TEXELS + tx] = sample.height;
      }
    }
  }

  private async loadAnnotations(generation: number) {
    const { x0, z0, res } = this.rect;
    const x1 = x0 + TEXELS * res;
    const z1 = z0 + TEXELS * res;
    this.inFlight += 1;
    try {
      const response = await fetch(this.annotationsUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ min: [x0, z0], max: [x1, z1] }),
      });
      if (!response.ok) throw new Error(await response.text());
      const { annotations } = (await response.json()) as {
        annotations: Annotation[];
      };
      if (generation !== this.generation) return;
      this.annotations = annotations;
      const overlay = this.annotationOverlay;
      if (overlay) {
        for (const a of annotations) this.outline(a, hex(overlay.color(a)));
      }
      this.dirty = true;
    } catch (error) {
      this.annotations = [];
      console.error(`[viewer] annotations failed: ${(error as Error).message}`);
    } finally {
      this.inFlight -= 1;
    }
  }

  private outline(a: Annotation, color: Rgba) {
    const { x0, z0, res } = this.rect;
    const [bx0, bz0, bx1, bz1] = a.bounds;
    const tx0 = Math.floor((bx0 - x0) / res);
    const tz0 = Math.floor((bz0 - z0) / res);
    const tx1 = Math.max(tx0 + 1, Math.floor((bx1 - x0) / res));
    const tz1 = Math.max(tz0 + 1, Math.floor((bz1 - z0) / res));
    const set = (x: number, z: number) => {
      if (x < 0 || z < 0 || x >= TEXELS || z >= TEXELS) return;
      const o = (z * TEXELS + x) * 4;
      this.data.set(color, o);
    };
    for (let x = tx0; x <= tx1; x++) {
      set(x, tz0);
      set(x, tz1);
    }
    for (let z = tz0; z <= tz1; z++) {
      set(tx0, z);
      set(tx1, z);
    }
  }

  dispose() {
    this.texture.dispose();
    this.heightTexture.dispose();
  }
}
