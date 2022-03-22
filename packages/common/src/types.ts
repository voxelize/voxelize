export type DeepPartial<T> = {
  [P in keyof T]?: DeepPartial<T[P]>;
};

export type AllFaces = {
  all: string;
};

export type ThreeFaces = {
  top: string;
  side: string;
  bottom: string;
};

export type SixFaces = {
  px: string;
  py: string;
  pz: string;
  nx: string;
  ny: string;
  nz: string;
};

export type PlantFaces = {
  diagonal: string;
};

export type BlockFace =
  | keyof AllFaces
  | keyof ThreeFaces
  | keyof SixFaces
  | keyof PlantFaces;

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
  isSolid: boolean;
  isTransparent: boolean;
  transparentStandalone: boolean;
  faces: BlockFace[];
};

export const defaultBlock: Block = {
  id: 0,
  name: "",
  rotatable: false,
  yRotatable: false,
  isEmpty: false,
  isSolid: true,
  isFluid: false,
  isTransparent: false,
  isLight: false,
  isBlock: true,
  isPlant: false,
  isPlantable: false,
  redLightLevel: 0,
  greenLightLevel: 0,
  blueLightLevel: 0,
  transparentStandalone: false,
  faces: [],
};

export type TextureRange = {
  startU: number;
  endU: number;
  startV: number;
  endV: number;
};

export type Coords2 = [number, number];
export type Coords3 = [number, number, number];
