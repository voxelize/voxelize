import { AABB } from "@voxelize/voxel-aabb";

import { BlockRotation } from "./libs";

export type DeepPartial<T> = {
  [P in keyof T]?: DeepPartial<T[P]>;
};

export type PartialRecord<K extends keyof any, T> = {
  [P in K]?: T;
};

export type Block = {
  id: number;
  name: string;
  redLightLevel: number;
  greenLightLevel: number;
  blueLightLevel: number;
  rotatable: boolean;
  yRotatable: boolean;
  isBlock: boolean;
  isEmpty: boolean;
  isFluid: boolean;
  isLight: boolean;
  isPlant: boolean;
  isPlantable: boolean;
  isOpaque: boolean;
  isPxTransparent: boolean;
  isNxTransparent: boolean;
  isPyTransparent: boolean;
  isNyTransparent: boolean;
  isPzTransparent: boolean;
  isNzTransparent: boolean;
  transparentStandalone: boolean;
  faces: {
    corners: { pos: number[]; uv: [] }[];
    dir: number[];
    name: string;
  }[];
  aabbs: AABB[];
};

export type TextureRange = {
  startU: number;
  endU: number;
  startV: number;
  endV: number;
};

export type Coords2 = [number, number];
export type Coords3 = [number, number, number];

export type ServerMesh = {
  opaque?: MeshData;
  transparent?: MeshData;
  level: number;
};

export type MeshData = {
  positions: Float32Array;
  indices: Int32Array;
  uvs: Float32Array;
  lights: Int32Array;
};

export type BaseWorldParams = {
  chunkSize: number;
  maxHeight: number;
  maxLightLevel: number;
};

export type MESSAGE_TYPE = "ERROR" | "SERVER" | "PLAYER" | "INFO";

/**
 * A CSS measurement. E.g. "30px", "51em"
 */
export type CSSMeasurement = `${number}${string}`;

export type BlockUpdate = {
  vx: number;
  vy: number;
  vz: number;
  type: number;
  rotation?: BlockRotation;
};
