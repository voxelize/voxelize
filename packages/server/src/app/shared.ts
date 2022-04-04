/**
 * Generic TypeScript constructor
 */
export type Constructor<T> = new () => T;

/**
 * Options to exporting into worker-transferable objects
 */
export type ExportOptions = {
  needVoxels?: boolean;
  needLights?: boolean;
  needHeightMap?: boolean;
};
