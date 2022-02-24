export type DeepPartial<T> = {
  [P in keyof T]?: DeepPartial<T[P]>;
};

export type BlockParams = {
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
  name: string;
  textures: { [key: string]: string };
  transparentStandalone: boolean;
};

export const defaultBlockParams: BlockParams = {
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
  textures: {},
};

export type TextureRange = {
  [key: string]: {
    startU: number;
    endU: number;
    startV: number;
    endV: number;
  };
};
