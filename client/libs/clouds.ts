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

type CloudsParams = {
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
  count: number;
  octaves: number;
  falloff: number;
  uFogNear: {
    value: number;
  };
  uFogFar: {
    value: number;
  };
  uFogColor: {
    value: Color;
  };
};

class Clouds {
  public array: NdArray;
  public material: ShaderMaterial;
  public initialized = false;

  public meshes: Mesh[][] = [];

  private xOffset = 0;
  private zOffset = 0;
  private cloudGroup = new Group();
  private locatedCell = [0, 0];

  private pool = new WorkerPool(CloudWorker, {
    maxWorker: 6,
  });

  constructor(public params: CloudsParams) {
    const { color, alpha, uFogNear, uFogFar, uFogColor } = this.params;

    this.material = new ShaderMaterial({
      transparent: true,
      vertexShader: CloudsVertexShader,
      fragmentShader: CloudsFragmentShader,
      side: FrontSide,
      uniforms: {
        uFogNear,
        uFogFar,
        uFogColor,
        uCloudColor: {
          value: new Color(color),
        },
        uCloudAlpha: {
          value: alpha,
        },
      },
    });
  }

  initialize = async () => {
    const { width } = this.params;

    for (let x = 0; x < width; x++) {
      const arr = [];

      for (let z = 0; z < width; z++) {
        const cell = await this.makeCell(x, z);
        this.cloudGroup.add(cell);
        arr.push(cell);
      }

      this.meshes.push(arr);
    }

    this.initialized = true;
  };

  move = async (delta: number, position: Vector3) => {
    if (!this.initialized) return;

    const { lerpFactor, speedFactor, count, dimensions } = this.params;

    const newPosition = this.mesh.position.clone();
    newPosition.z -= speedFactor * delta;
    this.mesh.position.lerp(newPosition, lerpFactor);

    const locatedCell = [
      Math.floor((position.x - this.mesh.position.x) / (count * dimensions[0])),
      Math.floor((position.z - this.mesh.position.z) / (count * dimensions[2])),
    ];

    if (
      this.locatedCell[0] !== locatedCell[0] ||
      this.locatedCell[1] !== locatedCell[1]
    ) {
      const dx = locatedCell[0] - this.locatedCell[0];
      const dz = locatedCell[1] - this.locatedCell[1];

      if (dx) {
        await this.shiftX(dx);
      }

      if (dz) {
        await this.shiftZ(dz);
      }

      this.locatedCell = locatedCell;
    }
  };

  get mesh() {
    return this.cloudGroup;
  }

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

    const buffer = (<Uint8Array>array.data).buffer.slice(0);

    const min = [count * (x - 1), 0, count * (z - 1)];
    const max = [count * (x + 2), height, count * (z + 2)];

    const data = await new Promise<any>((resolve) =>
      this.pool.addJob({
        message: {
          data: buffer,
          configs: {
            min,
            max,
            scale,
            threshold,
            stride: array.stride,
            octaves,
            falloff,
          },
        },
        resolve,
        buffers: [buffer],
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
    geometry.dispose();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new Int8BufferAttribute(normals, 3));
    geometry.setIndex(Array.from(indices));

    mesh = mesh || new Mesh(geometry, this.material);

    mesh.position.setX((-width / 2 + x) * count * dimensions[0]);
    mesh.position.setY(worldHeight);
    mesh.position.setZ((-width / 2 + z) * count * dimensions[2]);
    mesh.userData.data = array;

    return mesh;
  };
}

export type { CloudsParams };

export { Clouds };
