import { Coords3 } from "@voxelize/common";
import ndarray, { NdArray } from "ndarray";

import { CHUNK_HORIZONTAL_NEIGHBORS, VOXEL_NEIGHBORS } from "./constants";
import { Registry } from "./registry";
import { Space } from "./space";
import { WorldParams } from "./world";

type LightNode = {
  voxel: Coords3;
  level: number;
};

type LightArray = NdArray<Uint32Array>;

enum LightColor {
  RED,
  GREEN,
  BLUE,
  SUNLIGHT,
}

class Lights {
  static extractSunlight = (light: number) => {
    return (light >> 12) & 0xf;
  };

  static insertSunlight = (light: number, level: number) => {
    return (light & 0xfff) | (level << 12);
  };

  static extractRedLight = (light: number) => {
    return (light >> 8) & 0xf;
  };

  static insertRedLight = (light: number, level: number) => {
    return (light & 0xf0ff) | (level << 8);
  };

  static extractGreenLight = (light: number) => {
    return (light >> 4) & 0xf;
  };

  static insertGreenLight = (light: number, level: number) => {
    return (light & 0xff0f) | (level << 4);
  };

  static extractBlueLight = (light: number) => {
    return light & 0xf;
  };

  static insertBlueLight = (light: number, level: number) => {
    return (light & 0xfff0) | level;
  };

  static floodLight = (
    queue: LightNode[],
    isSunlight: boolean,
    color: LightColor,
    space: Space,
    lights: LightArray,
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
            ? Lights.getSunlight(lights, nvx, nvy, nvz)
            : Lights.getTorchLight(lights, nvx, nvy, nvz, color)
        ) {
          continue;
        }

        if (isSunlight) {
          Lights.setSunlight(lights, nvx, nvy, nvz, nextLevel);
        } else {
          Lights.setTorchLight(lights, nvx, nvy, nvz, nextLevel, color);
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
    const { width, min, shape } = space;
    const { padding, chunkSize, maxHeight, maxLightLevel } = params;

    const [s0, s1, s2] = shape;
    const shapeSize = s0 * s1 * s2;

    const lights = ndarray(new Uint32Array(shapeSize), shape);

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
            Lights.setSunlight(lights, x, y, z, maxLightLevel);

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
                    voxel: [x, y, z],
                  } as LightNode);
                }
              }
            }
          }

          if (isLight) {
            if (redLightLevel > 0) {
              Lights.setRedLight(lights, x, y, z, redLightLevel);
              redLightQueue.push({
                level: redLightLevel,
                voxel: [x, y, z],
              } as LightNode);
            }

            if (greenLightLevel > 0) {
              Lights.setGreenLight(lights, x, y, z, greenLightLevel);
              greenLightQueue.push({
                level: greenLightLevel,
                voxel: [x, y, z],
              } as LightNode);
            }

            if (blueLightLevel > 0) {
              Lights.setRedLight(lights, x, y, z, blueLightLevel);
              blueLightQueue.push({
                level: blueLightLevel,
                voxel: [x, y, z],
              } as LightNode);
            }
          }
        }
      }
    }

    const { RED, GREEN, BLUE, SUNLIGHT } = LightColor;

    Lights.floodLight(
      redLightQueue,
      false,
      RED,
      space,
      lights,
      registry,
      params
    );
    Lights.floodLight(
      greenLightQueue,
      false,
      GREEN,
      space,
      lights,
      registry,
      params
    );
    Lights.floodLight(
      blueLightQueue,
      false,
      BLUE,
      space,
      lights,
      registry,
      params
    );
    Lights.floodLight(
      sunlightQueue,
      true,
      SUNLIGHT,
      space,
      lights,
      registry,
      params
    );

    const dims = [chunkSize + padding * 2, maxHeight, chunkSize + padding * 2];
    const chunkLights = ndarray<Uint32Array>(
      new Uint32Array[dims[0] * dims[1] * dims[2]](),
      dims
    );

    const margin = (width - chunkSize) / 2;
    for (let x = margin - padding; x < margin + chunkSize + padding; x++) {
      for (let z = margin - padding; z < margin + chunkSize + padding; z++) {
        for (let cy = 0; cy < maxHeight; cy++) {
          const cx = x - margin + padding;
          const cz = z - margin + padding;

          chunkLights.set(cx, cy, cz, lights.get(x, cy, z));
        }
      }
    }

    return chunkLights;
  };

  private static getSunlight = (
    lights: LightArray,
    x: number,
    y: number,
    z: number
  ) => {
    const val = lights.get(x, y, z);
    if (val === undefined) return 0;
    return Lights.extractSunlight(val);
  };

  private static setSunlight = (
    lights: LightArray,
    x: number,
    y: number,
    z: number,
    level: number
  ) => {
    const val = lights.get(x, y, z);
    if (val === undefined) return;
    lights.set(x, y, z, Lights.insertSunlight(val, level));
  };

  private static getRedLight = (
    lights: LightArray,
    x: number,
    y: number,
    z: number
  ) => {
    const val = lights.get(x, y, z);
    if (val === undefined) return 0;
    return Lights.extractRedLight(val);
  };

  private static setRedLight = (
    lights: LightArray,
    x: number,
    y: number,
    z: number,
    level: number
  ) => {
    const val = lights.get(x, y, z);
    if (val === undefined) return;
    lights.set(x, y, z, Lights.insertRedLight(val, level));
  };

  private static getGreenLight = (
    lights: LightArray,
    x: number,
    y: number,
    z: number
  ) => {
    const val = lights.get(x, y, z);
    if (val === undefined) return 0;
    return Lights.extractGreenLight(val);
  };

  private static setGreenLight = (
    lights: LightArray,
    x: number,
    y: number,
    z: number,
    level: number
  ) => {
    const val = lights.get(x, y, z);
    if (val === undefined) return;
    lights.set(x, y, z, Lights.insertGreenLight(val, level));
  };

  private static getBlueLight = (
    lights: LightArray,
    x: number,
    y: number,
    z: number
  ) => {
    const val = lights.get(x, y, z);
    if (val === undefined) return 0;
    return Lights.extractBlueLight(val);
  };

  private static setBlueLight = (
    lights: LightArray,
    x: number,
    y: number,
    z: number,
    level: number
  ) => {
    const val = lights.get(x, y, z);
    if (val === undefined) return;
    lights.set(x, y, z, Lights.insertBlueLight(val, level));
  };

  private static getTorchLight = (
    lights: LightArray,
    x: number,
    y: number,
    z: number,
    color: LightColor
  ) => {
    switch (color) {
      case LightColor.RED:
        return Lights.getRedLight(lights, x, y, z);
      case LightColor.GREEN:
        return Lights.getGreenLight(lights, x, y, z);
      case LightColor.BLUE:
        return Lights.getBlueLight(lights, x, y, z);
      default:
        throw new Error("Getting light of unknown color!");
    }
  };

  private static setTorchLight = (
    lights: LightArray,
    x: number,
    y: number,
    z: number,
    level: number,
    color: LightColor
  ) => {
    switch (color) {
      case LightColor.RED:
        return Lights.setRedLight(lights, x, y, z, level);
      case LightColor.GREEN:
        return Lights.setGreenLight(lights, x, y, z, level);
      case LightColor.BLUE:
        return Lights.setBlueLight(lights, x, y, z, level);
      default:
        throw new Error("Setting light of unknown color!");
    }
  };
}

export type { LightNode };

export { LightColor, Lights };
