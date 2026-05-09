import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
} from "three";

import type { World } from "../index";

import { ItemDef } from "./item";

export type ItemRendererFactory = (
  itemDef: ItemDef,
  world: World,
) => ItemRenderer;

export abstract class ItemRenderer {
  constructor(
    protected itemDef: ItemDef,
    protected world: World,
  ) {}

  get id(): number {
    return this.itemDef.id;
  }

  get name(): string {
    return this.itemDef.name;
  }

  abstract getHeldMesh(useAlt?: boolean): Object3D | null;

  abstract getInventoryImage(useAlt?: boolean): HTMLImageElement | null;

  abstract getDropMesh(): Object3D | null;

  update?(): void;

  onEquip?(): void;

  onUnequip?(): void;

  dispose?(): void;
}

const THICKNESS = 0.25;
const SIZE = 2.5;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
  });
}

function getImageData(image: HTMLImageElement): ImageData {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get 2D context");
  }
  canvas.width = image.width;
  canvas.height = image.height;
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, image.width, image.height);
}

export interface ImageItemMeshData {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  pixelSize: number;
  scaleFactor: number;
  aspectRatio: number;
}

function generateMeshDataFromImage(image: HTMLImageElement): ImageItemMeshData {
  const imageData = getImageData(image);
  const { width, height, data } = imageData;

  const aspectRatio = width / height;
  const scaleFactor = aspectRatio >= 1 ? SIZE / width : SIZE / height;
  const pixelSize = scaleFactor;

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  let vertexIndex = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];
      if (alpha < 128) continue;

      const r = data[idx] / 255;
      const g = data[idx + 1] / 255;
      const b = data[idx + 2] / 255;

      const px = (x - width / 2) * pixelSize;
      const py = (height / 2 - y) * pixelSize;

      const x0 = px - pixelSize / 2;
      const x1 = px + pixelSize / 2;
      const y0 = py - pixelSize / 2;
      const y1 = py + pixelSize / 2;
      const z0 = 0;
      const z1 = THICKNESS;

      const verts = [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y1, z0],
        [x0, y1, z0],
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
      ];

      for (const v of verts) {
        positions.push(v[0], v[1], v[2]);
        colors.push(r, g, b);
      }

      const faces = [
        [0, 1, 2, 3],
        [5, 4, 7, 6],
        [4, 0, 3, 7],
        [1, 5, 6, 2],
        [3, 2, 6, 7],
        [4, 5, 1, 0],
      ];

      for (const face of faces) {
        indices.push(
          vertexIndex + face[0],
          vertexIndex + face[1],
          vertexIndex + face[2],
          vertexIndex + face[0],
          vertexIndex + face[2],
          vertexIndex + face[3],
        );
      }

      vertexIndex += 8;
    }
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
    pixelSize,
    scaleFactor,
    aspectRatio,
  };
}

function createMeshFromData(data: ImageItemMeshData): Group {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(data.positions, 3));
  geometry.setAttribute("color", new BufferAttribute(data.colors, 3));
  geometry.setIndex(new BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();

  const material = new MeshBasicMaterial({ vertexColors: true });
  const mesh = new Mesh(geometry, material);

  mesh.position.set(1, -1.8, -2);
  mesh.quaternion.setFromAxisAngle({ x: 0, y: 1, z: 0 } as never, -Math.PI / 4);

  const group1 = new Group();
  group1.add(mesh);
  group1.position.set(-0.08, 2.67, 2.75);

  const group2 = new Group();
  group2.add(group1);

  return group2;
}

function createDropMeshFromData(data: ImageItemMeshData): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(data.positions, 3));
  geometry.setAttribute("color", new BufferAttribute(data.colors, 3));
  geometry.setIndex(new BufferAttribute(data.indices, 1));
  geometry.computeBoundingSphere();

  const material = new MeshBasicMaterial({ vertexColors: true });
  return new Mesh(geometry, material);
}

export class ImageItemRenderer extends ItemRenderer {
  private image: HTMLImageElement | null = null;
  private altImage: HTMLImageElement | null = null;
  private meshData: ImageItemMeshData | null = null;
  private altMeshData: ImageItemMeshData | null = null;
  private loadPromise: Promise<void>;

  constructor(itemDef: ItemDef, world: World) {
    super(itemDef, world);
    this.loadPromise = this.load();
  }

  private async load(): Promise<void> {
    const imageComp = this.world.items.getResolvedImageComp(this.itemDef);
    if (!imageComp) {
      console.warn(`Item "${this.name}" has no image component, cannot render`);
      return;
    }

    try {
      this.image = await loadImage(imageComp.src);
      this.meshData = generateMeshDataFromImage(this.image);

      if (imageComp.altSrc) {
        this.altImage = await loadImage(imageComp.altSrc);
        this.altMeshData = generateMeshDataFromImage(this.altImage);
      }
    } catch (err) {
      console.error(`Failed to load image for item "${this.name}":`, err);
    }
  }

  async waitForLoad(): Promise<void> {
    return this.loadPromise;
  }

  isLoaded(): boolean {
    return this.meshData !== null;
  }

  getHeldMesh(useAlt = false): Object3D | null {
    const data = useAlt && this.altMeshData ? this.altMeshData : this.meshData;
    if (!data) return null;
    return createMeshFromData(data);
  }

  getInventoryImage(useAlt = false): HTMLImageElement | null {
    if (useAlt && this.altImage) return this.altImage;
    return this.image;
  }

  getDropMesh(): Object3D | null {
    if (!this.meshData) return null;
    return createDropMeshFromData(this.meshData);
  }

  dispose(): void {
    this.image = null;
    this.altImage = null;
    this.meshData = null;
    this.altMeshData = null;
  }
}
