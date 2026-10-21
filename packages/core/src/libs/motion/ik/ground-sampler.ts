import type { World } from "../../../core/world";

import { GroundHeightSampler } from "./gait-stepper";

export function createVoxelGroundSampler(
  world: World,
  maxProbeDepth: number,
): GroundHeightSampler {
  // Point queries only: walks a single voxel column downward with getBlockAt.
  // Never iterates chunk volumes; callers keep per-frame probe counts small
  // (foot replants plus a handful of chassis-clearance probes).
  return (x, y, z) => {
    if (!world.isInitialized) return null;
    const vx = Math.floor(x);
    const vz = Math.floor(z);
    let vy = Math.floor(y);

    for (let step = 0; step <= maxProbeDepth; step++, vy--) {
      const block = world.getBlockAt(vx, vy, vz);
      if (!block) return null;
      if (!block.isEmpty && !block.isFluid && !block.isPassable) {
        return vy + 1;
      }
    }
    return null;
  };
}
