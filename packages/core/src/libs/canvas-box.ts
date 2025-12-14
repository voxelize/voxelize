import {
  BoxGeometry,
  CanvasTexture,
  Color,
  FrontSide,
  Group,
  LinearMipMapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  NoColorSpace,
  RepeatWrapping,
  Side,
  Texture,
} from "three";

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
   * The side of the box to render. Defaults to `THREE.FrontSide`.
   */
  side: Side;

  /**
   * Whether or not should this canvas box be rendered as transparent. Defaults to `false`.
   */
  transparent?: boolean;
};

/**
 * A function to programmatically draw on a canvas.
 */
export type ArtFunction = (
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement
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
};

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

/**
 * A layer of a canvas box. This is a group of six canvases that are rendered as a single mesh.
 *
 * @noInheritDoc
 */
export class BoxLayer extends Mesh {
  /**
   * The materials of the six faces of this box layer.
   */
  public materials: Map<string, MeshBasicMaterial> = new Map();

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
   */
  constructor(
    /**
     * Test
     */
    width: number,
    height: number,
    depth: number,
    widthSegments: number,
    heightSegments: number,
    depthSegments: number,
    side: Side,
    transparent: boolean
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

    for (const face of BOX_SIDES) {
      this.materials.set(face, this.createCanvasMaterial(face));
    }

    const materials = Array.from(this.materials.values());
    const temp = materials[0];
    materials[0] = materials[1];
    materials[1] = temp;

    this.material = materials;

    // NOTE FOR AGENT: This 90-degree Y rotation means the "depth" dimension extends along the X-axis, not "width"
    this.rotation.y = Math.PI / 2;
  }

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
        context.drawImage(art.image, 0, 0, width, height);
      } else {
        if (isColor(art)) {
          context.save();
          context.fillStyle = `rgb(${art.r * 255},${art.g * 255},${
            art.b * 255
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
  };

  /**
   * Create a canvas material for a given side of the box layer.
   */
  private createCanvasMaterial = (face: BoxSides) => {
    const canvas = document.createElement("canvas");

    const { width, height } = this.getDimensionFromSide(face);
    canvas.width = width;
    canvas.height = height;

    // really curious about here. SRGBColorSpace seems really dark??
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = NoColorSpace;

    const material = new MeshBasicMaterial({
      side: this.side,
      map: texture,
      transparent: this.transparent,
      name: face,
    });

    material.toneMapped = false;

    if (material.map) {
      material.map.magFilter = NearestFilter;
      material.map.minFilter = LinearMipMapLinearFilter;
      material.map.wrapS = RepeatWrapping;
      material.map.wrapT = RepeatWrapping;
      material.map.needsUpdate = true;
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

    this.makeBoxes();
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
    layer = 0
  ) => {
    if (layer >= this.boxLayers.length) {
      throw new Error("Canvas box layer does not exist.");
    }

    this.boxLayers[layer].paint(side, art);
  };

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
      widthSegments,
      heightSegments,
      depthSegments,
      transparent,
    } = this.options;

    if (!width) {
      throw new Error("CanvasBox width must be specified.");
    }

    this.width = width;
    this.height = height || width;
    this.depth = depth || width;

    for (let i = 0; i < layers; i++) {
      const newBoxLayer = new BoxLayer(
        width + i * gap * 2,
        (height ? height : width) + i * gap * 2,
        (depth ? depth : width) + i * gap * 2,
        widthSegments,
        heightSegments ? heightSegments : widthSegments,
        depthSegments ? depthSegments : widthSegments,
        side,
        transparent
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
      moonRadius * 2
    );
    grd.addColorStop(0, DOMUtils.rgba(1, 1, 1, 0.3));
    grd.addColorStop(1, DOMUtils.rgba(1, 1, 1, 0));
    context.arc(
      x + moonRadius / 2,
      y + moonRadius / 2,
      moonRadius * 2,
      0,
      2 * Math.PI,
      false
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
    ]
  ) =>
  (context: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    const alpha = context.globalAlpha;
    for (let i = 0; i < starCount; i++) {
      context.globalAlpha = Math.random() * 1 + 0.5;
      context.beginPath();
      context.arc(
        Math.random() * canvas.width,
        Math.random() * canvas.height,
        Math.random() * 0.5,
        0,
        2 * Math.PI,
        false
      );
      context.fillStyle =
        starColors[Math.floor(Math.random() * starColors.length)];
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
