import { BoxGeometry, Color, MeshBasicMaterial } from "three";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  BoxLayer,
  CANVAS_BOX_ATLAS_GUTTER,
  CANVAS_BOX_GROUP_FACES,
  CanvasBox,
  canvasBoxAtlasLayout,
  remapCanvasBoxUVs,
} from "./canvas-box";

/**
 * A pixel-grid stand-in for a 2D canvas: enough of fillRect, clearRect and
 * nearest-neighbour drawImage to paint faces and composite the atlas the
 * way a browser does with image smoothing off.
 */
class PixelCanvas {
  private w = 0;
  private h = 0;
  pixels = new Uint32Array(0);
  private context = new PixelContext(this);

  get width() {
    return this.w;
  }
  set width(value: number) {
    this.w = value;
    this.pixels = new Uint32Array(this.w * this.h);
  }
  get height() {
    return this.h;
  }
  set height(value: number) {
    this.h = value;
    this.pixels = new Uint32Array(this.w * this.h);
  }
  getContext() {
    return this.context;
  }
  get(x: number, y: number) {
    return this.pixels[y * this.w + x];
  }
  set(x: number, y: number, value: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.pixels[y * this.w + x] = value;
  }
}

class PixelContext {
  fillStyle: string | number = 0;
  imageSmoothingEnabled = true;
  constructor(private canvas: PixelCanvas) {}
  save() {}
  restore() {}
  private color(): number {
    if (typeof this.fillStyle === "number") return this.fillStyle;
    const rgb = /rgb\(([^,]+),([^,]+),([^)]+)\)/.exec(this.fillStyle);
    const [r, g, b] = rgb
      ? rgb.slice(1).map((c) => Math.round(Number(c)))
      : [1, 3, 5].map((i) =>
          parseInt((this.fillStyle as string).slice(i, i + 2), 16),
        );
    return (((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0) as number;
  }
  fillRect(x: number, y: number, w: number, h: number) {
    const color = this.color();
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) this.canvas.set(i, j, color);
  }
  clearRect(x: number, y: number, w: number, h: number) {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) this.canvas.set(i, j, 0);
  }
  drawImage(source: PixelCanvas, ...args: number[]) {
    const [sx, sy, sw, sh, dx, dy, dw, dh] =
      args.length === 2
        ? [
            0,
            0,
            source.width,
            source.height,
            args[0],
            args[1],
            source.width,
            source.height,
          ]
        : args;
    for (let j = 0; j < dh; j++)
      for (let i = 0; i < dw; i++) {
        const x = sx + Math.floor(((i + 0.5) * sw) / dw);
        const y = sy + Math.floor(((j + 0.5) * sh) / dh);
        this.canvas.set(dx + i, dy + j, source.get(x, y));
      }
  }
}

beforeAll(() => {
  vi.stubGlobal("document", {
    createElement: () => new PixelCanvas(),
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
});

/** The value, or a failed test naming what was missing. */
function must<T>(value: T | null | undefined, what = "value"): T {
  if (value === null || value === undefined) throw new Error(`missing ${what}`);
  return value;
}

const atlasOf = (layer: BoxLayer) => must(layer.atlas, "atlas");
const layoutOf = (layer: BoxLayer) => must(atlasOf(layer).layout, "layout");

const faceCanvas = (layer: BoxLayer, face: string) =>
  must(must(layer.materials.get(face), face).map, "map")
    .image as unknown as PixelCanvas;

const atlasCanvas = (layer: BoxLayer) =>
  atlasOf(layer).canvas as unknown as PixelCanvas;

/**
 * What a fragment of group `group` at face coordinates (u, v) reads from a
 * merged layer, nearest-sampled at mip 0: the layer's UVs are affine over
 * each face quad, so interpolating the quad's corners is what the
 * rasteriser does.
 */
function sampleMerged(layer: BoxLayer, group: number, u: number, v: number) {
  const geometry = layer.geometry;
  const uv = geometry.getAttribute("uv");
  const index = must(geometry.getIndex(), "index");
  const { start } = geometry.groups[group];
  // BoxGeometry quads: corners (0,1) (1,1) (0,0) (1,0) in vertex order.
  const base = index.getX(start);
  const at = (k: number) => [uv.getX(base + k), uv.getY(base + k)];
  const [a, b, c, d] = [at(0), at(1), at(2), at(3)];
  const lerp = (p: number[], q: number[], t: number) => [
    p[0] + (q[0] - p[0]) * t,
    p[1] + (q[1] - p[1]) * t,
  ];
  const [au, av] = lerp(lerp(c, d, u), lerp(a, b, u), v);
  const atlas = atlasCanvas(layer);
  const x = Math.floor(au * atlas.width);
  // Uploaded flipped: canvas row 0 is v = 1.
  const y = Math.floor((1 - av) * atlas.height);
  return atlas.get(x, y);
}

function paintNoise(box: CanvasBox) {
  let seed = 7;
  box.paint("all", (ctx, canvas) => {
    for (let y = 0; y < canvas.height; y++)
      for (let x = 0; x < canvas.width; x++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        ctx.fillStyle = `rgb(${seed & 255},${(seed >> 8) & 255},${(seed >> 16) & 255})`;
        ctx.fillRect(x, y, 1, 1);
      }
  });
}

describe("canvasBoxAtlasLayout", () => {
  const sizes = {
    front: { width: 16, height: 8 },
    back: { width: 16, height: 8 },
    top: { width: 16, height: 8 },
    bottom: { width: 16, height: 8 },
    left: { width: 5, height: 8 },
    right: { width: 5, height: 8 },
  };

  it("tiles the atlas with one cell per face and no texel left over", () => {
    const layout = canvasBoxAtlasLayout(sizes);
    let x = 0;
    for (const face of CANVAS_BOX_GROUP_FACES) {
      const rect = layout.rects[face];
      expect(rect.cellX).toBe(x);
      x += rect.cellWidth;
    }
    expect(layout.width).toBe(x);
  });

  it("keeps a gutter round every face and its origin on the mip grid", () => {
    const layout = canvasBoxAtlasLayout(sizes);
    const g = CANVAS_BOX_ATLAS_GUTTER;
    for (const face of CANVAS_BOX_GROUP_FACES) {
      const rect = layout.rects[face];
      expect(rect.x % g).toBe(0);
      expect(rect.y % g).toBe(0);
      expect(rect.x - rect.cellX).toBeGreaterThanOrEqual(g);
      expect(
        rect.cellX + rect.cellWidth - (rect.x + rect.width),
      ).toBeGreaterThanOrEqual(g);
      expect(rect.y).toBeGreaterThanOrEqual(g);
      expect(layout.height - (rect.y + rect.height)).toBeGreaterThanOrEqual(g);
    }
    expect(layout.width % g).toBe(0);
    expect(layout.height % g).toBe(0);
  });
});

describe("remapCanvasBoxUVs", () => {
  it("sends each face's texel centres to the same texel of its atlas rect", () => {
    const geometry = new BoxGeometry(1, 0.5, 0.3);
    const sizes = {
      front: { width: 12, height: 6 },
      back: { width: 12, height: 6 },
      top: { width: 12, height: 6 },
      bottom: { width: 12, height: 6 },
      left: { width: 4, height: 6 },
      right: { width: 4, height: 6 },
    };
    const layout = canvasBoxAtlasLayout(sizes);
    const source = Float32Array.from(geometry.getAttribute("uv").array);
    const target = new Float32Array(source.length);
    remapCanvasBoxUVs(
      source,
      target,
      must(geometry.getIndex(), "index").array,
      geometry.groups,
      layout,
    );
    for (const group of geometry.groups) {
      const face = CANVAS_BOX_GROUP_FACES[group.materialIndex ?? 0];
      const rect = layout.rects[face];
      for (let i = group.start; i < group.start + group.count; i++) {
        const vertex = must(geometry.getIndex(), "index").getX(i);
        const [u, v] = [source[vertex * 2], source[vertex * 2 + 1]];
        // Corners land exactly on the rect's corners (flipped rows).
        expect(target[vertex * 2] * layout.width).toBeCloseTo(
          rect.x + u * rect.width,
          4,
        );
        expect((1 - target[vertex * 2 + 1]) * layout.height).toBeCloseTo(
          rect.y + (1 - v) * rect.height,
          4,
        );
      }
    }
  });
});

describe("CanvasBox mergeFaces", () => {
  it("draws each layer with one material, and the per-face path with six", () => {
    const merged = new CanvasBox({ width: 0.5, mergeFaces: true, layers: 2 });
    for (const layer of merged.boxLayers) {
      expect(Array.isArray(layer.material)).toBe(false);
      expect(layer.material).toBe(atlasOf(layer).material);
      expect(layer.material).toBeInstanceOf(MeshBasicMaterial);
    }
    const split = new CanvasBox({ width: 0.5 });
    expect(Array.isArray(split.boxLayers[0].material)).toBe(true);
    expect((split.boxLayers[0].material as unknown[]).length).toBe(6);
    expect(split.boxLayers[0].atlas).toBeNull();
  });

  it("samples every face texel exactly as the face's own texture did", () => {
    const box = new CanvasBox({
      width: 0.5,
      height: 0.25,
      depth: 0.3,
      widthSegments: 16,
      heightSegments: 8,
      depthSegments: 10,
      mergeFaces: true,
    });
    paintNoise(box);
    box.paint("front", new Color("#f99999"));
    const layer = box.boxLayers[0];
    for (let group = 0; group < 6; group++) {
      const face = faceCanvas(layer, CANVAS_BOX_GROUP_FACES[group]);
      for (let y = 0; y < face.height; y++)
        for (let x = 0; x < face.width; x++) {
          const u = (x + 0.5) / face.width;
          const v = 1 - (y + 0.5) / face.height;
          expect(sampleMerged(layer, group, u, v)).toBe(face.get(x, y));
        }
      // A filter tap a little past the face's edge wraps to the opposite
      // edge, as the face's own repeating texture did, and never reads a
      // neighbouring face.
      const du = 0.25 / face.width;
      const dv = 0.25 / face.height;
      const { width: w, height: h } = face;
      expect(sampleMerged(layer, group, 1 + du, 1 - dv)).toBe(face.get(0, 0));
      expect(sampleMerged(layer, group, -du, 1 - dv)).toBe(face.get(w - 1, 0));
      expect(sampleMerged(layer, group, du, -dv)).toBe(face.get(0, 0));
      expect(sampleMerged(layer, group, du, 1 + dv)).toBe(face.get(0, h - 1));
    }
  });

  it("fills each cell with its own face on the face's period", () => {
    const box = new CanvasBox({
      width: 0.5,
      height: 0.25,
      depth: 0.1,
      widthSegments: 16,
      heightSegments: 8,
      depthSegments: 3,
      mergeFaces: true,
    });
    paintNoise(box);
    const layer = box.boxLayers[0];
    const atlas = atlasCanvas(layer);
    for (const face of CANVAS_BOX_GROUP_FACES) {
      const rect = layoutOf(layer).rects[face];
      const canvas = faceCanvas(layer, face);
      const wrap = (n: number, m: number) => ((n % m) + m) % m;
      for (let y = 0; y < atlas.height; y++)
        for (let x = rect.cellX; x < rect.cellX + rect.cellWidth; x++)
          expect(atlas.get(x, y)).toBe(
            canvas.get(
              wrap(x - rect.x, rect.width),
              wrap(y - rect.y, rect.height),
            ),
          );
    }
  });

  it("never lets one face's colour into another face's cell", () => {
    const box = new CanvasBox({
      width: 0.5,
      widthSegments: 4,
      mergeFaces: true,
    });
    const colors = [
      "#ff0000",
      "#00ff00",
      "#0000ff",
      "#ffff00",
      "#00ffff",
      "#ff00ff",
    ];
    CANVAS_BOX_GROUP_FACES.forEach((face, i) =>
      box.paint(face, new Color(colors[i])),
    );
    const layer = box.boxLayers[0];
    const atlas = atlasCanvas(layer);
    for (const face of CANVAS_BOX_GROUP_FACES) {
      const rect = layoutOf(layer).rects[face];
      const expected = faceCanvas(layer, face).get(0, 0);
      for (let y = 0; y < atlas.height; y++)
        for (let x = rect.cellX; x < rect.cellX + rect.cellWidth; x++)
          expect(atlas.get(x, y)).toBe(expected);
    }
  });

  it("repaints one face without touching the others", () => {
    const box = new CanvasBox({
      width: 0.5,
      widthSegments: 4,
      mergeFaces: true,
    });
    box.paint("all", new Color("#223344"));
    const layer = box.boxLayers[0];
    const before = Uint32Array.from(atlasCanvas(layer).pixels);
    const version = atlasOf(layer).texture.version;
    box.paint("top", new Color("#ffffff"));
    const after = atlasCanvas(layer);
    const top = layoutOf(layer).rects.top;
    for (let y = 0; y < after.height; y++)
      for (let x = 0; x < after.width; x++) {
        const inTop = x >= top.cellX && x < top.cellX + top.cellWidth;
        if (!inTop) expect(after.get(x, y)).toBe(before[y * after.width + x]);
      }
    expect(after.get(top.x, top.y)).toBe(faceCanvas(layer, "top").get(0, 0));
    expect(atlasOf(layer).texture.version).toBeGreaterThan(version);
  });

  it("follows a replaced geometry and resized face canvases", () => {
    const box = new CanvasBox({
      width: 0.5,
      height: 0.25,
      depth: 0.125,
      texelsPerBlock: 32,
      mergeFaces: true,
    });
    const layer = box.boxLayers[0];
    // What a consumer that restores authored width/depth does before painting.
    layer.geometry.dispose();
    layer.geometry = new BoxGeometry(layer.depth, layer.height, layer.width);
    for (const face of ["top", "bottom"]) {
      const canvas = faceCanvas(layer, face);
      canvas.width = layer.depthSegments;
      canvas.height = layer.widthSegments;
    }
    paintNoise(box);
    const layout = layoutOf(layer);
    expect(layout.rects.top.width).toBe(layer.depthSegments);
    expect(layout.rects.top.height).toBe(layer.widthSegments);
    for (let group = 0; group < 6; group++) {
      const face = faceCanvas(layer, CANVAS_BOX_GROUP_FACES[group]);
      for (let y = 0; y < face.height; y++)
        for (let x = 0; x < face.width; x++)
          expect(
            sampleMerged(
              layer,
              group,
              (x + 0.5) / face.width,
              1 - (y + 0.5) / face.height,
            ),
          ).toBe(face.get(x, y));
    }
  });

  it("keeps the shadow and underwater hooks on the atlas material", () => {
    const merged = new CanvasBox({
      width: 0.5,
      mergeFaces: true,
      receiveShadows: true,
      underwaterFog: true,
    }).boxLayers[0];
    const split = new CanvasBox({
      width: 0.5,
      receiveShadows: true,
      underwaterFog: true,
    }).boxLayers[0];
    const atlasMaterial = atlasOf(merged).material;
    const faceMaterial = must(split.materials.get("front"), "front");
    // Same program key, so the merged layer reuses the per-face program.
    expect(atlasMaterial.onBeforeCompile.toString()).toBe(
      faceMaterial.onBeforeCompile.toString(),
    );
    expect(atlasMaterial.toneMapped).toBe(false);
    expect(atlasMaterial.side).toBe(faceMaterial.side);
    expect(must(atlasMaterial.map, "atlas map").magFilter).toBe(
      must(faceMaterial.map, "face map").magFilter,
    );
    expect(must(atlasMaterial.map, "atlas map").minFilter).toBe(
      must(faceMaterial.map, "face map").minFilter,
    );
    expect(must(atlasMaterial.map, "atlas map").colorSpace).toBe(
      must(faceMaterial.map, "face map").colorSpace,
    );
  });
});
