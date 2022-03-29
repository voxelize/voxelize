export type Constructor<T> = new () => T;

export type ExportOptions = {
  needVoxels?: boolean;
  needLights?: boolean;
  needHeightMap?: boolean;
};
