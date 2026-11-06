/**
 * What a blended see-through fragment does with the water's depth
 * (`ChunkMaterial.waterDepthSide`, see `WaterDepthPass`): nothing, keep only
 * what lies behind the nearest water face, or only what lies in front of it.
 */
export const WATER_DEPTH_SIDE_OFF = 0;
export const WATER_DEPTH_SIDE_BEHIND = 1;
export const WATER_DEPTH_SIDE_FRONT = 2;

/**
 * What the water's depth holds for a render (`waterDepthState`): nothing
 * drawn for it (every pane fragment counts as behind the water, the order
 * from before the depth existed), no water near any pane in view (every
 * fragment is in front), or the depth of the water near the panes in view.
 */
export const WATER_DEPTH_UNKNOWN = 0;
export const WATER_DEPTH_DRY = 1;
export const WATER_DEPTH_DRAWN = 2;

/**
 * How far behind a water face, in blocks, a pane fragment has to lie to
 * count as behind it: a pane face flush with a water face (a tank's inner
 * wall) stays in front of the water it holds.
 */
export const WATER_DEPTH_BIAS_BLOCKS = 0.02;
