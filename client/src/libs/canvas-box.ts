import { Color, MathUtils } from "three";
import {
  BoxBufferGeometry,
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
  dimension: number;
  side: Side;
};

export type ArtFunction = (
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  width?: number,
  dimension?: number
) => void;

export type BoxSides =
  | "back"
  | "front"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "all"
  | "sides";

export const defaultParams: CanvasBoxParams = {
  gap: 0,
  layers: 1,
  width: 8,
  dimension: 1,
  side: FrontSide,
};

export const BOX_SIDES = ["back", "front", "top", "bottom", "left", "right"];

export class BoxLayer {
  public geometry: BoxBufferGeometry;
  public materials: Map<string, MeshBasicMaterial> = new Map();
  public mesh: Mesh;

  constructor(
    public dimension: number,
    public width: number,
    private side: Side
  ) {
    this.geometry = new BoxBufferGeometry(dimension, dimension, dimension);

    for (const face of BOX_SIDES) {
      this.materials.set(face, this.createCanvasMaterial());
    }

    this.mesh = new Mesh(this.geometry, Array.from(this.materials.values()));

    this.mesh.rotation.y = Math.PI / 2;
  }

  createCanvasMaterial = () => {
    const canvas = document.createElement("canvas");
    canvas.height = this.width;
    canvas.width = this.width;

    const material = new MeshBasicMaterial({
      side: this.side,
      map: new Texture(canvas),
      transparent: true,
    });

    if (material.map) {
      material.map.magFilter = NearestFilter;
      material.map.minFilter = LinearMipMapLinearFilter;
      material.map.wrapS = RepeatWrapping;
      material.map.wrapT = RepeatWrapping;
      material.map.needsUpdate = true;
    }

    return material;
  };

  paint = (side: BoxSides[] | BoxSides, art: ArtFunction | Color | Texture) => {
    const actualSides = Array.isArray(side)
      ? side
      : side === "all"
      ? BOX_SIDES
      : side === "sides"
      ? ["front", "back", "left", "right"]
      : [side];

    for (const face of actualSides) {
      const material = this.materials.get(face);
      if (!material) continue;

      if (art instanceof Texture) {
        material.map = art;
      } else {
        const canvas = <HTMLCanvasElement>material.map?.image;
        if (!canvas) continue;

        const context = canvas.getContext("2d");
        if (!context) continue;

        if (art instanceof Color) {
          context.save();
          context.fillStyle = `rgb(${art.r * 255},${art.g * 255},${
            art.b * 255
          })`;
          context.fillRect(0, 0, this.dimension, this.dimension);
          context.restore();
        } else {
          art(context, canvas, this.width, this.dimension);
        }
      }

      material.needsUpdate = true;
      material.map.needsUpdate = true;
    }
  };
}

export class CanvasBox {
  public params: CanvasBoxParams;

  public meshes = new Group();
  public layers: BoxLayer[] = [];

  constructor(params: Partial<CanvasBoxParams> = {}) {
    this.params = {
      ...defaultParams,
      ...params,
    };

    this.makeBoxes();
  }

  makeBoxes = () => {
    const { layers, gap, dimension, side, width } = this.params;

    for (let i = 0; i < layers; i++) {
      const newBoxLayer = new BoxLayer(dimension + i * gap * 2, width, side);
      this.layers.push(newBoxLayer);
      this.meshes.add(newBoxLayer.mesh);
    }
  };

  paint = (
    side: BoxSides[] | BoxSides,
    art: ArtFunction | Color | Texture,
    layer = 0
  ) => {
    if (layer >= this.layers.length) {
      throw new Error("Canvas box layer does not exist.");
    }

    this.layers[layer].paint(side, art);
  };

  // TODO: fix this ugly code ?
  scaleColor = (() => {
    let m = 1.0;

    return (multiplier: number) => {
      const scale = MathUtils.lerp(m, multiplier, 0.3);
      this.layers.forEach((layer) => {
        layer.materials.forEach((material) => {
          material.color.multiplyScalar((1 / m) * scale);
        });
      });
      m = scale;
    };
  })();

  get boxMaterials() {
    return this.layers[0].materials;
  }
}
