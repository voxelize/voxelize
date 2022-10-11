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

export type CanvasBoxParams = {
  gap: number; // gap between layers
  layers: number;
  width: number;
  height?: number;
  depth?: number;
  widthSegments: number;
  heightSegments?: number;
  depthSegments?: number;
  side: Side;
  transparent?: boolean;
};

export type ArtFunction = (
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement
) => void;

export type BoxSides =
  | "back"
  | "front"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "all";

export const defaultParams: CanvasBoxParams = {
  gap: 0,
  layers: 1,
  width: 1,
  widthSegments: 8,
  side: FrontSide,
  transparent: false,
};

export const BOX_SIDES: BoxSides[] = [
  "back",
  "front",
  "top",
  "bottom",
  "left",
  "right",
];

export class BoxLayer {
  public geometry: BoxGeometry;
  public materials: Map<string, MeshBasicMaterial> = new Map();
  public mesh: Mesh;

  constructor(
    public width: number,
    public height: number,
    public depth: number,
    public widthSegments: number,
    public heightSegments: number,
    public depthSegments: number,
    private side: Side,
    private transparent: boolean
  ) {
    this.geometry = new BoxGeometry(width, height, depth);

    for (const face of BOX_SIDES) {
      this.materials.set(face, this.createCanvasMaterial(face));
    }

    const materials = Array.from(this.materials.values());
    const temp = materials[0];
    materials[0] = materials[1];
    materials[1] = temp;

    this.mesh = new Mesh(this.geometry, materials);

    this.mesh.rotation.y = Math.PI / 2;
  }

  createCanvasMaterial = (face: BoxSides) => {
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

export class CanvasBox extends Group {
  public params: CanvasBoxParams;

  public boxLayers: BoxLayer[] = [];

  public width: number;
  public height: number;
  public depth: number;

  constructor(params: Partial<CanvasBoxParams> = {}) {
    super();

    this.params = {
      ...defaultParams,
      ...params,
    };

    this.makeBoxes();
  }

  makeBoxes = () => {
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
      this.add(newBoxLayer.mesh);
    }
  };

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

  // TODO: fix this ugly code ?
  scaleColor = (() => {
    let m = 1.0;

    return (multiplier: number) => {
      const scale = MathUtils.lerp(m, multiplier, 0.3);
      this.boxLayers.forEach((layer) => {
        layer.materials.forEach((material) => {
          material.color.multiplyScalar((1 / m) * scale);
        });
      });
      m = scale;
    };
  })();

  get boxMaterials() {
    return this.boxLayers[0].materials;
  }
}
