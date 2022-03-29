import { Coords3 } from "@voxelize/common";
import type { LightColor } from "@voxelize/common";

import { CHUNK_HORIZONTAL_NEIGHBORS, VOXEL_NEIGHBORS } from "./constants";
import { Registry } from "./registry";
import { Space } from "./space";
import { WorldParams } from "./world";

type LightNode = {
  voxel: Coords3;
  level: number;
};

class Lights {
  static floodLight = (
    queue: LightNode[],
    isSunlight: boolean,
    color: LightColor,
    space: Space,
    registry: Registry,
    params: WorldParams
  ) => {
    const { maxHeight, maxLightLevel } = params;
    const [shape0, , shape2] = space.shape;

    const [startX, , startZ] = space.min;

    while (queue.length) {
      const { voxel, level } = queue.shift();
      const [vx, vy, vz] = voxel;

      // offsets
      for (const [ox, oy, oz] of VOXEL_NEIGHBORS) {
        const nvy = vy + oy;

        if (nvy < 0 || nvy >= maxHeight) {
          continue;
        }

        const nvx = vx + ox;
        const nvz = vz + oz;

        if (nvx < 0 || nvz < 0 || nvx >= shape0 || nvz >= shape2) {
          continue;
        }

        const sunDown = isSunlight && oy === -1 && level == maxLightLevel;
        const nextLevel = level - (sunDown ? 0 : 1);
        const nextVoxel = [nvx, nvy, nvz];
        const blockType = registry.getBlockById(
          space.getVoxel(nvx + startX, nvy, nvz + startZ)
        );

        if (
          !blockType.isTransparent || isSunlight
            ? space.getSunlight(nvx, nvy, nvz)
            : space.getTorchLight(nvx, nvy, nvz, color)
        ) {
          continue;
        }

        if (isSunlight) {
          space.setSunlight(nvx, nvy, nvz, nextLevel);
        } else {
          space.setTorchLight(nvx, nvy, nvz, nextLevel, color);
        }

        queue.push({
          voxel: nextVoxel,
          level: nextLevel,
        } as LightNode);
      }
    }
  };

  static propagate = (
    space: Space,
    registry: Registry,
    params: WorldParams
  ) => {
    const { width, min } = space;
    const { maxHeight, maxLightLevel } = params;

    const redLightQueue: LightNode[] = [];
    const greenLightQueue: LightNode[] = [];
    const blueLightQueue: LightNode[] = [];
    const sunlightQueue: LightNode[] = [];

    const [startX, , startZ] = min;

    for (let z = 1; z < width - 1; z++) {
      for (let x = 1; x < width - 1; x++) {
        const h = space.getMaxHeight(x + startX, z + startZ);

        for (let y = maxHeight - 1; y >= 0; y--) {
          const id = space.getVoxel(x + startX, y, z + startZ);
          const {
            isTransparent,
            isLight,
            redLightLevel,
            greenLightLevel,
            blueLightLevel,
          } = registry.getBlockById(id);

          if (y > h && isTransparent) {
            space.setSunlight(startX + x, y, startZ + z, maxLightLevel);

            for (const [ox, oz] of CHUNK_HORIZONTAL_NEIGHBORS) {
              const neighborId = space.getVoxel(
                x + ox + startX,
                y,
                z + oz + startZ
              );
              const neighborBlock = registry.getBlockById(neighborId);

              if (!neighborBlock.isTransparent) {
                continue;
              }

              if (space.getMaxHeight(x + ox + startX, z + oz + startZ) > y) {
                // means sunlight should propagate here horizontally
                if (
                  !sunlightQueue.find(
                    ({ voxel }) =>
                      voxel[0] === x && voxel[1] === y && voxel[2] === z
                  )
                ) {
                  sunlightQueue.push({
                    level: maxLightLevel,
                    voxel: [startX + x, y, startZ + z],
                  } as LightNode);
                }
              }
            }
          }

          if (isLight) {
            if (redLightLevel > 0) {
              space.setRedLight(startX + x, y, startZ + z, redLightLevel);
              redLightQueue.push({
                level: redLightLevel,
                voxel: [startX + x, y, startZ + z],
              } as LightNode);
            }

            if (greenLightLevel > 0) {
              space.setGreenLight(startX + x, y, startZ + z, greenLightLevel);
              greenLightQueue.push({
                level: greenLightLevel,
                voxel: [startX + x, y, startZ + z],
              } as LightNode);
            }

            if (blueLightLevel > 0) {
              space.setBlueLight(startX + x, y, startZ + z, blueLightLevel);
              blueLightQueue.push({
                level: blueLightLevel,
                voxel: [startX + x, y, startZ + z],
              } as LightNode);
            }
          }
        }
      }
    }

    Lights.floodLight(redLightQueue, false, "RED", space, registry, params);
    Lights.floodLight(greenLightQueue, false, "GREEN", space, registry, params);
    Lights.floodLight(blueLightQueue, false, "BLUE", space, registry, params);
    Lights.floodLight(sunlightQueue, true, "SUNLIGHT", space, registry, params);

    return space.getLights(...space.coords);
  };
}

export type { LightNode };

export { LightColor, Lights };
