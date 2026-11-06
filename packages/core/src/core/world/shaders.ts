import type {
  ChunkMaterialOptions,
  ChunkSwayConstants,
} from "./shading/chunk-material";

export {
  WATER_DEPTH_BIAS_BLOCKS,
  WATER_DEPTH_DRAWN,
  WATER_DEPTH_DRY,
  WATER_DEPTH_SIDE_BEHIND,
  WATER_DEPTH_SIDE_FRONT,
  WATER_DEPTH_SIDE_OFF,
  WATER_DEPTH_UNKNOWN,
} from "./water-depth-constants";

type SwayOptions = Partial<Omit<ChunkSwayConstants, "isCrossShaded">>;

/**
 * Ready-made customizations for `World.customizeMaterial`: a block that
 * sways with a fixed profile baked into its program (`sway`), or the same
 * with cross-quad shading, fixed sun incidence and no face shade
 * (`swayCross`). Blocks in the shared cutout buckets should prefer
 * `World.setBlockSway`, which keeps them in the bucket.
 */
export const customShaders = {
  sway(options: SwayOptions = {}): Partial<ChunkMaterialOptions> {
    return { sway: { ...options, isCrossShaded: false } };
  },

  swayCross(options: SwayOptions = {}): Partial<ChunkMaterialOptions> {
    return { sway: { ...options, isCrossShaded: true } };
  },
};
