import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  FrontSide,
  Group,
  LinearMipMapLinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  NearestFilter,
  RepeatWrapping,
  SRGBColorSpace,
  Side,
  Texture,
} from "three/webgpu";
import {
  createEntityShadowBody,
  type EntityShadowBody,
  setShadowBody,
} from "../core/world/entity-shadow-uniforms";
import { shadowedBodyColorNode } from "../core/world/shading/entity-shadow";
import { DOMUtils } from "../utils";

/**
 * Parameters to create a canvas box.
 */
export type CanvasBoxOptions = {
  /**
   * The gap between the layers of the box. Defaults to `0`.
   */
  gap: number;

  /**
   * The number of layers of this box. Defaults to `1`.
   */
  layers: number;

  /**
   * THe width of the box. Defaults to `1`.
   */
  width: number;

  /**
   * The height of the box. Defaults to whatever `width` is.
   */
  height?: number;

  /**
   * The depth of the box. Defaults to whatever `width` is.
   */
  depth?: number;

  /**
   * The width segments of the box, which is the number of pixels of the canvases along the width.
   * Defaults to `8`.
   */
  widthSegments: number;

  /**
   * The height segments of the box, which is the number of pixels of the canvases along the height.
   * Defaults to whatever `widthSegments` is.
   */
  heightSegments?: number;

  /**
   * The depth segments of the box, which is the number of pixels of the canvases along the depth.
   * Defaults to whatever `widthSegments` is.
   */
  depthSegments?: number;

  /**
   * Texture pixels per world unit. When set, `widthSegments`,
   * `heightSegments` and `depthSegments` are derived from the box's
   * dimensions at this density (at least one texel each), so every face
   * has square texels whatever the box's proportions. Without it a
   * 0.3 x 0.14 x 0.06 box gets the same `widthSegments` along all three
   * axes and its texture is squashed on every non-square face. Prefer this
   * over hand-picked segment counts for anything that is not a cube.
   */
  texelsPerBlock?: number;

  /**
   * The side of the box to render. Defaults to `THREE.FrontSide`.
   */
  side: Side;

  /**
   * Whether or not should this canvas box be rendered as transparent. Defaults to `false`.
   */
  transparent?: boolean;

  /**
   * Whether this canvas box should receive shadows. Defaults to `false`.
   */
  receiveShadows?: boolean;

  /**
   * Draw each layer in one call instead of six. The six face canvases stay
   * the paintable source (`paint`, `materials` and every face canvas work as
   * before), and each paint is copied into one atlas texture the layer draws
   * with through a single material, at the same texel density, filtering and
   * shader hooks. Opt-in: a consumer that swaps a face material, or edits a
   * face canvas without `paint` (then call `BoxLayer.syncAtlas`), needs the
   * per-face path. Defaults to `false`.
   */
  mergeFaces?: boolean;
};

/**
 * A function to programmatically draw on a canvas.
 */
export type ArtFunction = (
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
) => void;

/**
 * The sides of a canvas box.
 *
 * `"all"` means all six sides, and `"sides"` means all the sides except the top and bottom.
 */
export type BoxSides =
  | "back"
  | "front"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "sides"
  | "all";

const defaultOptions: CanvasBoxOptions = {
  gap: 0,
  layers: 1,
  width: 1,
  widthSegments: 8,
  side: FrontSide,
  transparent: false,
  receiveShadows: false,
};

/**
 * Segment (texel) counts for a box painted at `texelsPerBlock` pixels per
 * world unit: each axis gets as many texels as its length asks for, at
 * least one, so every face has square texels whatever the box's
 * proportions. This is what `CanvasBoxOptions.texelsPerBlock` resolves to.
 */
export function canvasBoxSegments(
  dims: { width: number; height: number; depth: number },
  texelsPerBlock: number,
): { widthSegments: number; heightSegments: number; depthSegments: number } {
  if (!(texelsPerBlock > 0)) {
    throw new Error(
      `CanvasBox texelsPerBlock must be positive, got ${texelsPerBlock}.`,
    );
  }
  const texels = (size: number) =>
    Math.max(1, Math.round(size * texelsPerBlock));
  return {
    widthSegments: texels(dims.width),
    heightSegments: texels(dims.height),
    depthSegments: texels(dims.depth),
  };
}

/**
 * The six default faces of a canvas box.
 */
export const BOX_SIDES: BoxSides[] = [
  "back",
  "front",
  "top",
  "bottom",
  "left",
  "right",
];

type BoxFace = "back" | "front" | "top" | "bottom" | "left" | "right";

/**
 * The face each `BoxGeometry` group draws, by group index (px, nx, py, ny,
 * pz, nz): the order of a layer's per-face material array.
 */
export const CANVAS_BOX_GROUP_FACES: readonly BoxFace[] = [
  "front",
  "back",
  "top",
  "bottom",
  "left",
  "right",
];

/**
 * Texels of the face's own repeat kept round each face in a merged layer's
 * atlas. Face origins and cell edges land on multiples of it too, so for a
 * face whose size is a multiple of eight the first three mip levels hold
 * exactly the texels its own wrapping texture's mips did.
 */
export const CANVAS_BOX_ATLAS_GUTTER = 8;

/** One face's place in a merged layer's atlas, in atlas pixels. */
export type CanvasBoxAtlasRect = {
  /** The face canvas's top-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The face's cell: the face plus the edge copies around it. */
  cellX: number;
  cellWidth: number;
};

export type CanvasBoxAtlasLayout = {
  width: number;
  height: number;
  rects: Record<BoxFace, CanvasBoxAtlasRect>;
};

/**
 * Lay a layer's six face canvases out in one row: each face sits in a cell
 * whose every texel is the face or its repeat, so the atlas has no empty
 * texel for a distant mip level to average in.
 */
export function canvasBoxAtlasLayout(
  sizes: Record<BoxFace, { width: number; height: number }>,
): CanvasBoxAtlasLayout {
  const gutter = CANVAS_BOX_ATLAS_GUTTER;
  const align = (value: number) => Math.ceil(value / gutter) * gutter;
  let tallest = 0;
  for (const face of CANVAS_BOX_GROUP_FACES) {
    tallest = Math.max(tallest, sizes[face].height);
  }
  const height = align(tallest + gutter * 2);
  const rects = {} as Record<BoxFace, CanvasBoxAtlasRect>;
  let cellX = 0;
  for (const face of CANVAS_BOX_GROUP_FACES) {
    const { width: w, height: h } = sizes[face];
    const cellWidth = align(w + gutter * 2);
    rects[face] = {
      x: cellX + gutter,
      y: gutter,
      width: w,
      height: h,
      cellX,
      cellWidth,
    };
    cellX += cellWidth;
  }
  return { width: cellX, height, rects };
}

/**
 * Point each `BoxGeometry` group's UVs at its face's rect in the atlas, so a
 * fragment samples the same face texel it did from the face's own texture
 * (both upload flipped: the canvas top is v = 1). `source` is the geometry's
 * original per-face UV array; `target` receives the atlas UVs.
 */
export function remapCanvasBoxUVs(
  source: ArrayLike<number>,
  target: { [index: number]: number },
  index: ArrayLike<number> | null,
  groups: readonly { start: number; count: number; materialIndex?: number }[],
  layout: CanvasBoxAtlasLayout,
): void {
  for (const group of groups) {
    const face = CANVAS_BOX_GROUP_FACES[group.materialIndex ?? 0];
    if (!face) continue;
    const rect = layout.rects[face];
    for (let i = group.start; i < group.start + group.count; i++) {
      const vertex = index ? index[i] : i;
      const u = source[vertex * 2];
      const v = source[vertex * 2 + 1];
      target[vertex * 2] = (rect.x + u * rect.width) / layout.width;
      target[vertex * 2 + 1] =
        1 - (rect.y + (1 - v) * rect.height) / layout.height;
    }
  }
}

/**
 * Fill a face's atlas cell with the face repeated on its own period, the
 * face itself at its rect. A face's own texture wraps (RepeatWrapping), so
 * a filtered sample across its edge, or a whole mip texel near it, reads
 * the opposite edge; the repeats around the face give the atlas the same
 * neighbours. The cell is cleared first: the face canvas already holds
 * everything painted on it.
 */
function blitFaceToAtlas(
  context: CanvasRenderingContext2D,
  face: HTMLCanvasElement,
  rect: CanvasBoxAtlasRect,
  atlasHeight: number,
) {
  const { x, y, width: w, height: h, cellX, cellWidth } = rect;
  context.clearRect(cellX, 0, cellWidth, atlasHeight);
  if (w <= 0 || h <= 0) return;
  const cellRight = cellX + cellWidth;
  for (let tileY = y - Math.ceil(y / h) * h; tileY < atlasHeight; tileY += h) {
    for (
      let tileX = x - Math.ceil((x - cellX) / w) * w;
      tileX < cellRight;
      tileX += w
    ) {
      // The part of this repeat inside the cell.
      const left = Math.max(tileX, cellX);
      const top = Math.max(tileY, 0);
      const right = Math.min(tileX + w, cellRight);
      const bottom = Math.min(tileY + h, atlasHeight);
      if (right <= left || bottom <= top) continue;
      context.drawImage(
        face,
        left - tileX,
        top - tileY,
        right - left,
        bottom - top,
        left,
        top,
        right - left,
        bottom - top,
      );
    }
  }
}

/**
 * A layer of a canvas box. This is a group of six canvases that are rendered as a single mesh.
 *
 * @noInheritDoc
 */
export class BoxLayer extends Mesh {
  /**
   * The materials of the six faces of this box layer.
   */
  public materials: Map<string, MeshBasicNodeMaterial> = new Map();

  /**
   * The body this layer's faces are shaded as part of (only set if
   * receiveShadows is true): its own until {@link setShadowBody} points it
   * at the body it belongs to (a character's).
   */
  public shadowBody: EntityShadowBody | null = null;

  /**
   * The width of the box layer.
   */
  public width: number;

  /**
   * The height of the box layer.
   */
  public height: number;

  /**
   * The depth of the box layer.
   */
  public depth: number;

  /**
   * The width segments of the box layer.
   */
  public widthSegments: number;

  /**
   * The height segments of the box layer.
   */
  public heightSegments: number;

  /**
   * The depth segments of the box layer.
   */
  public depthSegments: number;

  /**
   * The side of the box layer to render.
   */
  private side: Side;

  /**
   * Whether or not should this canvas box be rendered as transparent.
   */
  private transparent: boolean;

  /**
   * Whether or not should this canvas box receive shadows.
   */
  private receiveShadows: boolean;

  /**
   * The one atlas this layer draws with when its faces are merged
   * (`CanvasBoxOptions.mergeFaces`), else `null` and the layer draws each
   * face with its own material.
   */
  public atlas: {
    canvas: HTMLCanvasElement;
    texture: CanvasTexture;
    material: MeshBasicNodeMaterial;
    layout: CanvasBoxAtlasLayout | null;
  } | null = null;

  /** The geometry whose UVs point into the atlas, and its per-face UVs. */
  private atlasGeometry: BufferGeometry | null = null;
  private faceUVs: Float32Array | null = null;
  private atlasSignature = "";

  /**
   * Create a six-sided canvas box layer.
   *
   * @param width The width of the box layer.
   * @param height The height of the box layer.
   * @param depth The depth of the box layer.
   * @param widthSegments The width segments of the box layer.
   * @param heightSegments The height segments of the box layer.
   * @param depthSegments The depth segments of the box layer.
   * @param side The side of the box layer to render.
   * @param transparent Whether or not should this canvas box be rendered as transparent.
   * @param receiveShadows Whether or not should this canvas box receive shadows.
   * @param mergeFaces Whether to draw the six faces in one call through an atlas.
   */
  constructor(
    width: number,
    height: number,
    depth: number,
    widthSegments: number,
    heightSegments: number,
    depthSegments: number,
    side: Side,
    transparent: boolean,
    receiveShadows = false,
    mergeFaces = false,
  ) {
    super(new BoxGeometry(width, height, depth));

    this.width = width;
    this.height = height;
    this.depth = depth;
    this.widthSegments = widthSegments;
    this.heightSegments = heightSegments;
    this.depthSegments = depthSegments;
    this.side = side;
    this.transparent = transparent;
    this.receiveShadows = receiveShadows;

    if (receiveShadows) {
      this.shadowBody = createEntityShadowBody();
      this.userData.receiveShadows = true;
    }

    for (const face of BOX_SIDES) {
      this.materials.set(face, this.createCanvasMaterial(face));
    }

    if (mergeFaces) {
      const canvas = document.createElement("canvas");
      const texture = new CanvasTexture(canvas);
      const material = this.createMaterial(texture, "atlas");
      // Faces meet in the atlas, and the repeats round each already stand
      // in for the wrap a face's own texture did.
      texture.wrapS = ClampToEdgeWrapping;
      texture.wrapT = ClampToEdgeWrapping;
      this.atlas = { canvas, texture, material, layout: null };
      this.material = material;
      this.syncAtlas();
    } else {
      const materials = Array.from(this.materials.values());
      const temp = materials[0];
      materials[0] = materials[1];
      materials[1] = temp;

      this.material = materials;
    }

    this.rotation.y = Math.PI / 2;
  }

  /**
   * Bring a merged layer's atlas up to date with its face canvases: relay
   * the atlas out and re-point the UVs when a face canvas was resized or the
   * geometry replaced, then copy the given faces (every face after a
   * relayout) into it. `paint` calls this; call it after editing a face
   * canvas directly. A no-op on a per-face layer.
   */
  syncAtlas = (faces: readonly BoxSides[] = BOX_SIDES) => {
    const atlas = this.atlas;
    if (!atlas) return;

    const sizes = {} as Record<BoxFace, { width: number; height: number }>;
    for (const face of CANVAS_BOX_GROUP_FACES) {
      const canvas = this.materials.get(face)?.map?.image as
        | HTMLCanvasElement
        | undefined;
      sizes[face] = { width: canvas?.width ?? 0, height: canvas?.height ?? 0 };
    }
    const signature = `${this.geometry.uuid}:${CANVAS_BOX_GROUP_FACES.map(
      (face) => `${sizes[face].width}x${sizes[face].height}`,
    ).join(",")}`;

    let targets = faces;
    if (signature !== this.atlasSignature || !atlas.layout) {
      const layout = canvasBoxAtlasLayout(sizes);
      atlas.layout = layout;
      if (
        atlas.canvas.width !== layout.width ||
        atlas.canvas.height !== layout.height
      ) {
        atlas.canvas.width = layout.width;
        atlas.canvas.height = layout.height;
        // A texture's GPU storage keeps its first size; a resized canvas
        // needs a fresh one.
        atlas.texture.dispose();
      }

      const uv = this.geometry.getAttribute("uv") as BufferAttribute;
      if (this.atlasGeometry !== this.geometry || !this.faceUVs) {
        this.atlasGeometry = this.geometry;
        this.faceUVs = new Float32Array(uv.array as ArrayLike<number>);
      }
      remapCanvasBoxUVs(
        this.faceUVs,
        uv.array as Float32Array,
        this.geometry.getIndex()?.array ?? null,
        this.geometry.groups,
        layout,
      );
      uv.needsUpdate = true;

      this.atlasSignature = signature;
      targets = BOX_SIDES;
    }

    const layout = atlas.layout;
    const context = atlas.canvas.getContext("2d");
    if (!context) return;
    context.imageSmoothingEnabled = false;
    for (const face of targets) {
      const rect = layout.rects[face as BoxFace];
      const canvas = this.materials.get(face)?.map?.image as
        | HTMLCanvasElement
        | undefined;
      if (!rect || !canvas) continue;
      blitFaceToAtlas(context, canvas, rect, layout.height);
    }
    atlas.texture.needsUpdate = true;
  };

  /**
   * Add art to the canvas(s) of this box layer.
   
   * @param side The side(s) of the box layer to draw on.
   * @param art The art or art function to draw on the box layer's side.
   */
  paint = (side: BoxSides[] | BoxSides, art: ArtFunction | Color | Texture) => {
    const actualSides =
      side === "all"
        ? BOX_SIDES
        : side === "sides"
          ? (["front", "back", "left", "right"] as BoxSides[])
          : Array.isArray(side)
            ? side
            : [side];

    for (const face of actualSides) {
      const material = this.materials.get(face);
      if (!material) continue;

      const canvas = <HTMLCanvasElement>material.map?.image;
      if (!canvas) continue;

      const context = canvas.getContext("2d");
      if (!context) continue;

      context.imageSmoothingEnabled = false;

      const { width, height } = this.getDimensionFromSide(face);

      const isTexture = (art: any): art is Texture => {
        return art.isTexture;
      };
      const isColor = (art: any): art is Color => {
        return art.isColor;
      };

      if (isTexture(art)) {
        context.drawImage(art.image as CanvasImageSource, 0, 0, width, height);
      } else {
        if (isColor(art)) {
          context.save();
          const srgbColor = art.clone().convertLinearToSRGB();
          context.fillStyle = `rgb(${srgbColor.r * 255},${srgbColor.g * 255},${
            srgbColor.b * 255
          })`;
          context.fillRect(0, 0, width, height);
          context.restore();
        } else if (typeof art === "function") {
          art(context, canvas);
        } else {
          console.warn("Invalid art type: ", art);
        }
      }

      material.needsUpdate = true;
      material.map.needsUpdate = true;
    }

    this.syncAtlas(actualSides);
  };

  /**
   * Free this layer's GPU resources: its geometry, and each face's canvas
   * texture and material (and a merged layer's atlas). The canvases
   * themselves are left intact, so a consumer that still borrows a face (a
   * portrait) re-uploads it instead of drawing garbage. Call once the layer
   * has left the scene for good.
   */
  dispose() {
    this.geometry.dispose();
    for (const material of this.materials.values()) {
      material.map?.dispose();
      material.dispose();
    }
    if (this.atlas) {
      this.atlas.texture.dispose();
      this.atlas.material.dispose();
    }
  }

  /**
   * Shades this layer's faces (and its merged atlas) as part of `body`.
   * No-op for a layer that does not receive shadows.
   */
  setShadowBody(body: EntityShadowBody) {
    if (!this.shadowBody) return;
    this.shadowBody = body;
    for (const material of this.materials.values()) setShadowBody(material, body);
    if (this.atlas) setShadowBody(this.atlas.material, body);
  }

  /**
   * Create a canvas material for a given side of the box layer.
   */
  private createCanvasMaterial = (face: BoxSides) => {
    const canvas = document.createElement("canvas");

    const { width, height } = this.getDimensionFromSide(face);
    canvas.width = width;
    canvas.height = height;

    return this.createMaterial(new CanvasTexture(canvas), face);
  };

  /**
   * The material a face (or a merged layer's atlas) draws with: unlit,
   * nearest-magnified, with this layer's shadow; the world's fog node fogs
   * it (the camera's water included) like every other world material.
   */
  private createMaterial = (texture: CanvasTexture, name: string) => {
    texture.colorSpace = SRGBColorSpace;
    // A face's texture is never offset, repeated or turned: its uv matrix
    // stays identity, instead of being rebuilt for every draw.
    texture.matrixAutoUpdate = false;

    const material = new MeshBasicNodeMaterial({
      side: this.side,
      map: texture,
      transparent: this.transparent,
      name,
    });

    material.toneMapped = false;

    if (material.map) {
      material.map.magFilter = NearestFilter;
      material.map.minFilter = LinearMipMapLinearFilter;
      material.map.wrapS = RepeatWrapping;
      material.map.wrapT = RepeatWrapping;
      material.map.needsUpdate = true;
    }

    if (this.receiveShadows && this.shadowBody) {
      // The sun's shadow on the face's colour, before the world's fog (the
      // scene's fog node) lands over it: the face's own normal drives the
      // slope-scaled bias, so a face turned away from the sun is not
      // darkened by the volume behind it; the body's bounds cap that bias
      // at its edge. One node for every face of every body.
      material.colorNode = shadowedBodyColorNode();
      setShadowBody(material, this.shadowBody);
    }

    return material;
  };

  /**
   * Get the width and height of a given side of the box layer.
   */
  private getDimensionFromSide = (side: BoxSides) => {
    switch (side) {
      case "front":
      case "back": {
        return { width: this.widthSegments, height: this.heightSegments };
      }
      case "left":
      case "right": {
        return { width: this.depthSegments, height: this.heightSegments };
      }
      case "top":
      case "bottom": {
        return { width: this.widthSegments, height: this.heightSegments };
      }
      default: {
        throw new Error("Cannot derive width/height from unknown side.");
      }
    }
  };
}

/**
 * A canvas box is a group of `BoxLayer`s that are rendered as a single mesh.
 * Each box layer is a group of six canvases that are also rendered as a single mesh.
 * You can then paint on each canvas individually by calling `box.paint()`.
 *
 * # Example
 * ```ts
 * const box = new VOXELIZE.CanvasBox();
 *
 * box.paint("all", (ctx, canvas) => {
 *   ctx.fillStyle = "red";
 *   ctx.fillRect(0, 0, canvas.width, canvas.height);
 * });
 * ```
 *
 * ![Bobby from King of the Hill](/img/docs/bobby-canvas-box.png)
 *
 * # Rotation Conventions
 * - `rotation.x`: Positive tilts backward (front face goes up), negative tilts forward
 * - `rotation.y`: Positive rotates left (counter-clockwise from above), negative rotates right
 * - `rotation.z`: Positive rolls counter-clockwise (from front view), negative rolls clockwise
 *
 * @noInheritDoc
 */
export class CanvasBox extends Group {
  /**
   * Parameters for creating a canvas box.
   */
  public options: CanvasBoxOptions;

  /**
   * The inner layers of the canvas box.
   */
  public boxLayers: BoxLayer[] = [];

  /**
   * The width of the canvas box.
   */
  public width: number;

  /**
   * The height of the canvas box.
   */
  public height: number;

  /**
   * The depth of the canvas box.
   */
  public depth: number;

  /**
   * Create a new canvas box.
   *
   * @param options The options for creating a canvas box.
   */
  constructor(options: Partial<CanvasBoxOptions> = {}) {
    super();

    this.options = {
      ...defaultOptions,
      ...options,
    };

    if (this.options.receiveShadows) {
      this.userData.receiveShadows = true;
    }

    this.makeBoxes();
  }

  /**
   * The body this canvas box is shaded as part of (its first layer's).
   * Null if receiveShadows is false.
   */
  get shadowBody(): EntityShadowBody | null {
    return this.boxLayers[0]?.shadowBody ?? null;
  }

  /** Shades every layer as part of `body` (a character's). */
  setShadowBody(body: EntityShadowBody) {
    for (const layer of this.boxLayers) layer.setShadowBody(body);
  }

  /**
   * Add art to the canvas(s) of this box layer.
   *
   * @param side The side(s) of the box layer to draw on.
   * @param art The art or art function to draw on the box layer's side.
   * @param layer The layer to draw on.
   */
  paint = (
    side: BoxSides[] | BoxSides,
    art: ArtFunction | Color | Texture,
    layer = 0,
  ) => {
    if (layer >= this.boxLayers.length) {
      throw new Error("Canvas box layer does not exist.");
    }

    this.boxLayers[layer].paint(side, art);
  };

  /**
   * Free every layer's geometry, face textures and materials. Call once the
   * box has left the scene for good.
   */
  dispose() {
    for (const layer of this.boxLayers) layer.dispose();
  }

  /**
   * The first layer of the canvas box.
   */
  get boxMaterials() {
    return this.boxLayers[0].materials;
  }

  private makeBoxes = () => {
    const {
      layers,
      gap,
      side,
      width,
      height,
      depth,
      texelsPerBlock,
      transparent,
      receiveShadows,
      mergeFaces,
    } = this.options;
    let { widthSegments, heightSegments, depthSegments } = this.options;

    if (!width) {
      throw new Error("CanvasBox width must be specified.");
    }

    this.width = width;
    this.height = height || width;
    this.depth = depth || width;

    if (texelsPerBlock !== undefined) {
      ({ widthSegments, heightSegments, depthSegments } = canvasBoxSegments(
        { width: this.width, height: this.height, depth: this.depth },
        texelsPerBlock,
      ));
    }

    for (let i = 0; i < layers; i++) {
      const newBoxLayer = new BoxLayer(
        width + i * gap * 2,
        (height ? height : width) + i * gap * 2,
        (depth ? depth : width) + i * gap * 2,
        widthSegments,
        heightSegments ? heightSegments : widthSegments,
        depthSegments ? depthSegments : widthSegments,
        side,
        transparent,
        receiveShadows,
        mergeFaces,
      );
      this.boxLayers.push(newBoxLayer);
      this.add(newBoxLayer);
    }
  };
}

/**
 * Draw a sun to a canvas box. This can be used on sky, as sky is essentially a canvas box.
 *
 * @param context The canvas context to draw on.
 * @param canvas The canvas to draw on.
 */
const drawSun =
  (sunRadius = 50, sunColor = "#f8ffb5") =>
  (context: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    const color = new Color(sunColor);

    context.save();

    // bg glow
    context.beginPath();
    let x = canvas.width / 2;
    let y = canvas.height / 2;
    const grd = context.createRadialGradient(x, y, 1, x, y, sunRadius * 2);
    grd.addColorStop(0, DOMUtils.rgba(1, 1, 1, 0.3));
    grd.addColorStop(1, DOMUtils.rgba(1, 1, 1, 0));
    context.arc(x, y, sunRadius * 3, 0, 2 * Math.PI, false);
    context.fillStyle = grd;
    context.fill();
    context.closePath();

    // outer sun
    context.beginPath();
    x = canvas.width / 2 - sunRadius / 2;
    y = canvas.height / 2 - sunRadius / 2;
    context.rect(x, y, sunRadius, sunRadius);
    context.fillStyle = DOMUtils.rgba(color.r, color.g, color.b, 1);
    context.fill();
    context.closePath();

    // inner sun
    context.beginPath();
    const r = sunRadius / 1.6;
    x = canvas.width / 2 - r / 2;
    y = canvas.height / 2 - r / 2;
    context.rect(x, y, r, r);
    context.fillStyle = DOMUtils.rgba(1, 1, 1, 0.5);
    context.fill();
    context.closePath();

    context.restore();
  };

const drawMoon =
  (moonRadius = 20, moonColor = "#e6e2d1", phase = 1) =>
  (context: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    const color = new Color(moonColor);

    const x = canvas.width / 2;
    const y = canvas.height / 2;

    // bg glow
    context.beginPath();
    const grd = context.createRadialGradient(
      x + moonRadius / 2,
      y + moonRadius / 2,
      1,
      x + moonRadius / 2,
      y + moonRadius / 2,
      moonRadius * 2,
    );
    grd.addColorStop(0, DOMUtils.rgba(1, 1, 1, 0.3));
    grd.addColorStop(1, DOMUtils.rgba(1, 1, 1, 0));
    context.arc(
      x + moonRadius / 2,
      y + moonRadius / 2,
      moonRadius * 2,
      0,
      2 * Math.PI,
      false,
    );
    context.fillStyle = grd;
    context.fill();
    context.closePath();

    // clipping region
    context.save();
    context.beginPath();
    context.rect(x, y, moonRadius, moonRadius);
    context.clip();

    // moon bg
    context.beginPath();
    context.rect(x, y, moonRadius, moonRadius);
    context.fillStyle = DOMUtils.rgba(color.r, color.g, color.b, 1);
    context.fill();

    context.translate(x, y);

    // lighter inside
    context.beginPath();
    context.rect(4, 4, moonRadius - 8, moonRadius - 8);
    context.fillStyle = DOMUtils.rgba(1, 1, 1, 0.8);
    context.fill();

    // moon phase
    const px = phase * moonRadius * 2 - moonRadius;
    context.beginPath();
    context.rect(px, 0, moonRadius, moonRadius);
    context.fillStyle = DOMUtils.rgba(0, 0, 0, 0.8);
    context.fill();
    context.beginPath();
    context.rect(2 + px, 2, moonRadius - 4, moonRadius - 4);
    context.fillStyle = DOMUtils.rgba(0, 0, 0, 0.9);
    context.fill();

    context.restore();
  };

/** mulberry32: the same stars from the same seed on every client. */
const starRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const drawStars =
  (
    starCount = 100,
    starColors = [
      "#FFFFFF",
      "#FFFFFF",
      "#FFFFFF",
      "#FFFFFF",
      "#FFFFFF",
      "#FFFFFF",
      "#FFFFFF",
      "#FFFFFF",
      "#FFFFFF",
      "#FFFFFF",
      "#8589FF",
      "#FF8585",
    ],
    /**
     * Seed the starfield from something every client shares (the world's
     * seed), so every player sees the same stars. Omitted, each draw is
     * its own.
     */
    seed?: number,
  ) =>
  (context: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    const random = seed === undefined ? Math.random : starRandom(seed);
    const alpha = context.globalAlpha;
    for (let i = 0; i < starCount; i++) {
      context.globalAlpha = random() * 1 + 0.5;
      context.beginPath();
      context.arc(
        random() * canvas.width,
        random() * canvas.height,
        random() * 0.5,
        0,
        2 * Math.PI,
        false,
      );
      context.fillStyle = starColors[Math.floor(random() * starColors.length)];
      context.fill();
    }

    context.globalAlpha = alpha;
  };

/**
 * An art function to draw a crown to a canvas box.
 *
 * @param context The canvas context to draw on.
 *
 * # Example
 * ```ts
 * const box = new VOXELIZE.CanvasBox();
 * box.paint("sides", VOXELIZE.drawCrown);
 */
const drawCrown: ArtFunction = (context: CanvasRenderingContext2D) => {
  const gold = [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 2],
    [2, 2],
    [2, 1],
    [3, 0],
    [3, 2],
    [4, 0],
    [4, 2],
    [5, 1],
    [5, 2],
    [6, 2],
    [7, 0],
    [7, 1],
    [7, 2],
  ];

  const blue = [
    [1, 1],
    [6, 1],
  ];

  context.fillStyle = "#f7ea00";
  gold.forEach(([x, y]) => context.fillRect(x, y, 1, 1));

  context.fillStyle = "#51c2d5";
  blue.forEach(([x, y]) => context.fillRect(x, y, 1, 1));

  context.fillStyle = "#ff005c";
  context.fillRect(3, 1, 1, 1);
  context.fillRect(4, 1, 1, 1);
};

/**
 * A preset of art functions to draw on canvas boxes.
 */
export const artFunctions = {
  drawCrown,
  drawSun,
  drawMoon,
  drawStars,
};
