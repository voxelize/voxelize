import ndarray, { NdArray } from "ndarray";
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  FrontSide,
  Group,
  Int8BufferAttribute,
  Mesh,
  ShaderMaterial,
  Vector3,
} from "three";
import CloudWorker from "web-worker:./workers/clouds-worker.ts";

import { Coords3 } from "../types";

import { cull } from "./cull";
import CloudsFragmentShader from "./shaders/clouds/fragment.glsl";
import CloudsVertexShader from "./shaders/clouds/vertex.glsl";
import { WorkerPool } from "./worker-pool";

export type CloudsParams = {
  scale: number;
  width: number;
  height: number;
  worldHeight: number;
  dimensions: Coords3;
  threshold: number;
  lerpFactor: number;
  speedFactor: number;
  color: string;
  alpha: number;
  seed: number;
  count: number;
  octaves: number;
  falloff: number;
  uFogNear?: {
    value: number;
  };
  uFogFar?: {
    value: number;
  };
  uFogColor?: {
    value: Color;
  };
};

const defaultParams: CloudsParams = {
  alpha: 0.8,
  color: "#fff",
  count: 16,
  scale: 0.08,
  width: 8,
  height: 3,
  dimensions: [20, 20, 20],
  speedFactor: 8,
  lerpFactor: 0.3,
  threshold: 0.05,
  octaves: 5,
  falloff: 0.9,
  seed: -1,
  worldHeight: 256,
};

export class Clouds extends Group {
  public array: NdArray;
  public material: ShaderMaterial;
  public initialized = false;
  public params: CloudsParams;

  public meshes: Mesh[][] = [];

  private xOffset = 0;
  private zOffset = 0;
  private locatedCell = [0, 0];
  private newPosition = new Vector3();

  private pool = new WorkerPool(CloudWorker, {
    maxWorker: 2,
  });

  constructor(params: Partial<CloudsParams> = {}) {
    super();

    this.params = { ...defaultParams, ...params };

    const { seed, color, alpha, uFogNear, uFogFar, uFogColor } = this.params;

    if (seed === -1) {
      this.params.seed = Math.floor(Math.random() * 10230123);
    }

    this.material = new ShaderMaterial({
      transparent: true,
      vertexShader: CloudsVertexShader,
      fragmentShader: CloudsFragmentShader,
      side: FrontSide,
      uniforms: {
        uFogNear: uFogNear || { value: 500 },
        uFogFar: uFogFar || { value: 1000 },
        uFogColor: uFogColor || { value: new Color("#fff") },
        uCloudColor: {
          value: new Color(color),
        },
        uCloudAlpha: {
          value: alpha,
        },
      },
    });

    this.material.toneMapped = false;

    this.initialize();
  }

  initialize = async () => {
    const { width } = this.params;

    for (let x = 0; x < width; x++) {
      const arr = [];

      for (let z = 0; z < width; z++) {
        const cell = await this.makeCell(x, z);
        this.add(cell);
        arr.push(cell);
      }

      this.meshes.push(arr);
    }

    this.initialized = true;
  };

  reset = async () => {
    const { width } = this.params;

    for (let x = 0; x < width; x++) {
      for (let z = 0; z < width; z++) {
        await this.makeCell(x, z, this.meshes[x][z]);
      }
    }
  };

  update = (position: Vector3, delta = 0) => {
    if (!this.initialized) return;

    const { speedFactor, count, dimensions } = this.params;

    this.newPosition = this.position.clone();
    this.newPosition.z -= speedFactor * delta;

    const locatedCell = [
      Math.floor((position.x - this.position.x) / (count * dimensions[0])),
      Math.floor((position.z - this.position.z) / (count * dimensions[2])),
    ];

    if (
      this.locatedCell[0] !== locatedCell[0] ||
      this.locatedCell[1] !== locatedCell[1]
    ) {
      const dx = locatedCell[0] - this.locatedCell[0];
      const dz = locatedCell[1] - this.locatedCell[1];

      if (dx) {
        this.shiftX(dx);
      }

      if (dz) {
        this.shiftZ(dz);
      }

      this.locatedCell = locatedCell;
    }

    this.position.lerp(this.newPosition, this.params.lerpFactor);
  };

  private shiftX = async (direction = 1) => {
    const { width } = this.params;

    const arr = direction > 0 ? this.meshes.shift() : this.meshes.pop();

    for (let z = 0; z < width; z++) {
      await this.makeCell(
        this.xOffset + (direction > 0 ? width : 0),
        z + this.zOffset,
        arr[z]
      );
    }

    if (direction > 0) {
      this.meshes.push(arr);
    } else {
      this.meshes.unshift(arr);
    }

    this.xOffset += direction;
  };

  private shiftZ = async (direction = 1) => {
    const { width } = this.params;

    for (let x = 0; x < width; x++) {
      const arr = this.meshes[x];
      const cell = direction > 0 ? arr.shift() : arr.pop();

      await this.makeCell(
        x + this.xOffset,
        this.zOffset + (direction > 0 ? width : 0),
        cell
      );

      if (direction > 0) {
        arr.push(cell);
      } else {
        arr.unshift(cell);
      }
    }

    this.zOffset += direction;
  };

  private makeCell = async (x: number, z: number, mesh?: Mesh) => {
    const {
      width,
      height,
      count,
      scale,
      seed,
      threshold,
      dimensions,
      worldHeight,
      octaves,
      falloff,
    } = this.params;

    const array = mesh
      ? mesh.userData.data
      : ndarray(new Uint8Array((count + 2) * height * (count + 2)), [
          count + 2,
          height,
          count + 2,
        ]);

    const min = [x * count - 1, 0, z * count - 1];
    const max = [(x + 1) * count + 1, height, (z + 1) * count + 1];

    const data = await new Promise<any>((resolve) =>
      this.pool.addJob({
        message: {
          data: array.data,
          configs: {
            min,
            max,
            scale,
            threshold,
            stride: array.stride,
            octaves,
            falloff,
            seed,
          },
        },
        resolve,
        buffers: [array.data.buffer.slice(0)],
      })
    );

    array.data = data;

    const { positions, indices, normals } = await cull(array, {
      dimensions,
      min: [1, 0, 1],
      max: [count + 1, height, count + 1],
      realMin: [0, 0, 0],
      realMax: [count + 2, height, count + 2],
    });

    const geometry = mesh ? mesh.geometry : new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new Int8BufferAttribute(normals, 3));
    geometry.setIndex(Array.from(indices));
    geometry.computeVertexNormals();

    mesh = mesh || new Mesh(geometry, this.material);

    mesh.position.setX((-width / 2 + x) * count * dimensions[0]);
    mesh.position.setY(worldHeight);
    mesh.position.setZ((-width / 2 + z) * count * dimensions[2]);
    mesh.userData.data = array;

    return mesh;
  };
}
