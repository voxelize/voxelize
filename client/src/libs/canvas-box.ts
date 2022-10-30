import { Color, MathUtils, sRGBEncoding } from "three";
import {
  BoxGeometry,
  FrontSide,
  Group,
  LinearMipMapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  RepeatWrapping,
  Side,
  Texture,
} from "three";

/**
 * Parameters to create a canvas box.
 */
export type CanvasBoxParams = {
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
   * The height of the box. Defaults to `1`.
   */
  height?: number;

  /**
   * The depth of the box. Defaults to `1`.
   */
  depth?: number;

  /**
   * The width segments of the box, which is the number of pixels of the canvases along the width.
   * Defaults to `8`.
   */
  widthSegments: number;

  /**
   * The height segments of the box, which is the number of pixels of the canvases along the height.
   * Defaults to `8`.
   */
  heightSegments?: number;

  /**
   * The depth segments of the box, which is the number of pixels of the canvases along the depth.
   * Defaults to `8`.
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
 */
export type BoxSides =
  | "back"
  | "front"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "all";

const defaultParams: CanvasBoxParams = {
  gap: 0,
  layers: 1,
  width: 1,
  widthSegments: 8,
  height: 1,
  heightSegments: 8,
  depth: 1,
  depthSegments: 8,
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

    this.rotation.y = Math.PI / 2;
  }

  /**
   * Add art to the canvas(s) of this box layer.
   
   * @param side The side(s) of the box layer to draw on.
   * @param art The art or art function to draw on the box layer's side.
   */
  paint = (side: BoxSides[] | BoxSides, art: ArtFunction | Color | Texture) => {
    const actualSides =
      side === "all" ? BOX_SIDES : Array.isArray(side) ? side : [side];

    for (const face of actualSides) {
      const material = this.materials.get(face);
      if (!material) continue;

      const canvas = <HTMLCanvasElement>material.map?.image;
      if (!canvas) continue;

      const context = canvas.getContext("2d");
      if (!context) continue;

      context.imageSmoothingEnabled = false;

      const { width, height } = this.getDimensionFromSide(face);

      if (art instanceof Texture) {
        context.drawImage(art.image, 0, 0, width, height);
      } else {
        if (art instanceof Color) {
          context.save();
          context.fillStyle = `rgb(${art.r * 255},${art.g * 255},${
            art.b * 255
          })`;
          context.fillRect(0, 0, width, height);
          context.restore();
        } else {
          art(context, canvas);
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

    const material = new MeshBasicMaterial({
      side: this.side,
      map: new Texture(canvas),
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
      material.map.encoding = sRGBEncoding;
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
 * box.paint("all", (ctx, canvas) => {
 *   ctx.fillStyle = "red";
 *   ctx.fillRect(0, 0, canvas.width, canvas.height);
 * });
 * ```
 *
 * <div style={{width: "100%", display: "flex", flexDirection: "column", alignItems: "center"}}>
 *
 *  ![Bobby from King of the Hill](/img/bobby-canvas-box.png)
 *
 *  <p style={{textAlign: "center", color: "gray", fontSize: "0.8rem"}}>Bobby from King of the Hill rendered in CanvasBoxes</p>
 * </div>
 *
 * @noInheritDoc
 */
export class CanvasBox extends Group {
  /**
   * Parameters for creating a canvas box.
   */
  public params: CanvasBoxParams;

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
   * @param params The parameters for creating a canvas box.
   */
  constructor(params: Partial<CanvasBoxParams> = {}) {
    super();

    this.params = {
      ...defaultParams,
      ...params,
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
    } = this.params;

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
