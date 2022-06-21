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

type CloudsOptionsType = {
  seed: number;
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

  constructor(public options: CloudsOptionsType) {
    const { color, alpha, seed, uFogNear, uFogFar, uFogColor } = this.options;

    if (seed === -1) this.options.seed = Math.random() * 10000;

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
    const { width } = this.options;

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

  move = (delta: number, position: Vector3) => {
    if (!this.initialized) return;

    const { lerpFactor, speedFactor, count, dimensions } = this.options;

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
        this.shiftX(dx);
      }

      if (dz) {
        this.shiftZ(dz);
      }

      this.locatedCell = locatedCell;
    }
  };

  get mesh() {
    return this.cloudGroup;
  }

  private shiftX = async (direction = 1) => {
    const { width } = this.options;

    const arr = [];

    for (let z = 0; z < width; z++) {
      const cell = await this.makeCell(
        this.xOffset + (direction > 0 ? width : 0),
        z + this.zOffset
      );
      this.cloudGroup.add(cell);
      arr.push(cell);
    }

    let removed: Mesh[];

    if (direction > 0) {
      removed = this.meshes.shift();
      this.meshes.push(arr);
    } else {
      removed = this.meshes.pop();
      this.meshes.unshift(arr);
    }

    if (removed) {
      removed.forEach((mesh) => mesh.geometry?.dispose());
      this.cloudGroup.remove(...removed);
    }

    this.xOffset += direction;
  };

  private shiftZ = async (direction = 1) => {
    const { width } = this.options;

    for (let x = 0; x < width; x++) {
      const cell = await this.makeCell(
        x + this.xOffset,
        this.zOffset + (direction > 0 ? width : 0)
      );
      this.cloudGroup.add(cell);

      const arr = this.meshes[x];

      let removed: Mesh;

      if (direction > 0) {
        removed = arr.shift();
        arr.push(cell);
      } else {
        removed = arr.pop();
        arr.unshift(cell);
      }

      if (removed) {
        removed.geometry?.dispose();
        this.cloudGroup.remove(removed);
      }
    }

    this.zOffset += direction;
  };

  private makeCell = async (x: number, z: number) => {
    const {
      width,
      height,
      count,
      scale,
      threshold,
      seed,
      dimensions,
      worldHeight,
    } = this.options;

    const array = ndarray(new Uint8Array((count + 2) * height * (count + 2)), [
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
            seed,
            scale,
            threshold,
            stride: array.stride,
          },
        },
        resolve,
        buffers: [buffer],
      })
    );

    const newBuffer = new Uint8Array(data);
    array.data = newBuffer;

    const { positions, indices, normals } = await cull(array, {
      dimensions,
      min: [1, 0, 1],
      max: [count + 1, height, count + 1],
      realMin: [0, 0, 0],
      realMax: [count + 2, height, count + 2],
    });

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new Int8BufferAttribute(normals, 3));
    geometry.setIndex(Array.from(indices));
    geometry.computeVertexNormals();

    const mesh = new Mesh(geometry, this.material);

    mesh.position.setX((-width / 2 + x) * count * dimensions[0]);
    mesh.position.setY(worldHeight);
    mesh.position.setZ((-width / 2 + z) * count * dimensions[2]);

    return mesh;
  };
}

export { Clouds };
