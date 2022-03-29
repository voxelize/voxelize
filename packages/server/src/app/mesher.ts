import { Coords3, BlockRotation, LightUtils, MeshData } from "@voxelize/common";

import { BLOCK_FACES } from "./constants";
import { Registry } from "./registry";
import { Space } from "./space";

const vertexAO = (side1: boolean, side2: boolean, corner: boolean) => {
  const s1num = +!side1;
  const s2num = +!side2;
  const cnum = +!corner;

  return s1num === 1 && s2num === 1 ? 0 : 3 - (s1num + s2num + cnum);
};

const getBlockByVoxel = (
  vx: number,
  vy: number,
  vz: number,
  space: Space,
  registry: Registry
) => {
  return registry.getBlockById(space.getVoxel(vx, vy, vz));
};

const avg = (arr: number[]) => {
  let s = 0;
  arr.forEach((n) => (s += n));
  return s / arr.length;
};

class Mesher {
  static meshSpace = (
    min: Coords3,
    max: Coords3,
    space: Space,
    registry: Registry,
    transparent: boolean
  ) => {
    const positions: number[] = [];
    const indices: number[] = [];
    const uvs: number[] = [];
    const aos: number[] = [];

    const redLights: number[] = [];
    const greenLights: number[] = [];
    const blueLights: number[] = [];
    const sunlights: number[] = [];

    const [minX, , minZ] = min;
    const [maxX, , maxZ] = max;

    // loop through each block
    for (let vx = minX; vx < maxX; vx++) {
      for (let vz = minZ; vz < maxZ; vz++) {
        // only loop up to the highest block to save time
        const height = space.getMaxHeight(vx, vz);

        for (let vy = height; vy >= 0; vy--) {
          const voxelId = space.getVoxel(vx, vy, vz);
          const rotation = space.getVoxelRotation(vx, vy, vz);
          const block = registry.getBlockById(voxelId);
          const {
            rotatable,
            isSolid,
            isTransparent,
            isBlock,
            isPlant,
            isFluid,
          } = block;

          if (
            (isSolid || isPlant) &&
            (transparent ? isTransparent : !isTransparent)
          ) {
            const uvMap = registry.getUVMap(block);
            const faceMap = Registry.getFacesMap(block.faces);

            if (isBlock) {
              for (const { corners, dir, side } of BLOCK_FACES) {
                if (rotatable) {
                  BlockRotation.rotate(rotation, dir, false);
                }

                const nvx = vx + dir[0];
                const nvy = vy + dir[1];
                const nvz = vz + dir[2];

                const neighborId = space.getVoxel(nvx, nvy, nvz);
                const nBlockType = registry.getBlockById(neighborId);

                if (
                  ((nBlockType.isTransparent && !nBlockType.isFluid) ||
                    (nBlockType.isFluid && !isFluid)) &&
                  (!transparent ||
                    nBlockType.isEmpty ||
                    neighborId !== voxelId ||
                    (nBlockType.transparentStandalone &&
                      dir[0] + dir[1] + dir[2] >= 1))
                ) {
                  const { startU, endU, startV, endV } = uvMap[faceMap[side]];

                  const ndx = Math.floor(positions.length / 3);
                  const faceAOs = [];

                  const fourSunlights: number[] = [];
                  const fourRedLights: number[] = [];
                  const fourGreenLights: number[] = [];
                  const fourBlueLights: number[] = [];

                  for (const { pos, uv } of corners) {
                    if (rotatable) {
                      BlockRotation.rotate(rotation, pos, true);
                    }

                    const posX = pos[0] + vx;
                    const posY = pos[1] + vy;
                    const posZ = pos[2] + vz;

                    positions.push(posX, posY, posZ);

                    uvs.push(uv[0] * (endU - startU) + startU);
                    uvs.push(uv[1] * (startV - endV) + endV);

                    // calculating the 8 voxels around this vertex
                    const dx = Math.round(pos[0]) === 0 ? -1 : 1;
                    const dy = Math.round(pos[1]) === 0 ? -1 : 1;
                    const dz = Math.round(pos[2]) === 0 ? -1 : 1;

                    const sumSunlights: number[] = [];
                    const sumRedLights: number[] = [];
                    const sumGreenLights: number[] = [];
                    const sumBlueLights: number[] = [];

                    const b000 = getBlockByVoxel(
                      vx,
                      vy,
                      vz,
                      space,
                      registry
                    ).isTransparent;
                    const b001 = getBlockByVoxel(
                      vx,
                      vy,
                      vz + dz,
                      space,
                      registry
                    ).isTransparent;
                    const b010 = getBlockByVoxel(
                      vx,
                      vy + dy,
                      vz,
                      space,
                      registry
                    ).isTransparent;
                    const b011 = getBlockByVoxel(
                      vx,
                      vy + dy,
                      vz + dz,
                      space,
                      registry
                    ).isTransparent;
                    const b100 = getBlockByVoxel(
                      vx + dx,
                      vy,
                      vz,
                      space,
                      registry
                    ).isTransparent;
                    const b101 = getBlockByVoxel(
                      vx + dx,
                      vy,
                      vz + dz,
                      space,
                      registry
                    ).isTransparent;
                    const b110 = getBlockByVoxel(
                      vx + dx,
                      vy + dy,
                      vz,
                      space,
                      registry
                    ).isTransparent;
                    const b111 = getBlockByVoxel(
                      vx + dx,
                      vy + dy,
                      vz + dz,
                      space,
                      registry
                    ).isTransparent;

                    if (Math.abs(dir[0]) === 1) {
                      faceAOs.push(vertexAO(b110, b101, b111));
                    } else if (Math.abs(dir[1]) === 1) {
                      faceAOs.push(vertexAO(b110, b011, b111));
                    } else {
                      faceAOs.push(vertexAO(b011, b101, b111));
                    }

                    // TODO: fix light leaking

                    if (b000) {
                      sumSunlights.push(space.getSunlight(vx, vy, vz));
                      sumRedLights.push(space.getRedLight(vx, vy, vz));
                      sumGreenLights.push(space.getGreenLight(vx, vy, vz));
                      sumBlueLights.push(space.getBlueLight(vx, vy, vz));
                    }

                    if (b001) {
                      sumSunlights.push(space.getSunlight(vx, vy, vz + dz));
                      sumRedLights.push(space.getRedLight(vx, vy, vz + dz));
                      sumGreenLights.push(space.getGreenLight(vx, vy, vz + dz));
                      sumBlueLights.push(space.getBlueLight(vx, vy, vz + dz));
                    }

                    if (b010) {
                      sumSunlights.push(space.getSunlight(vx, vy + dy, vz));
                      sumRedLights.push(space.getRedLight(vx, vy + dy, vz));
                      sumGreenLights.push(space.getGreenLight(vx, vy + dy, vz));
                      sumBlueLights.push(space.getBlueLight(vx, vy + dy, vz));
                    }

                    if (b011) {
                      sumSunlights.push(
                        space.getSunlight(vx, vy + dy, vz + dz)
                      );
                      sumRedLights.push(
                        space.getRedLight(vx, vy + dy, vz + dz)
                      );
                      sumGreenLights.push(
                        space.getGreenLight(vx, vy + dy, vz + dz)
                      );
                      sumBlueLights.push(
                        space.getBlueLight(vx, vy + dy, vz + dz)
                      );
                    }

                    if (b100) {
                      sumSunlights.push(space.getSunlight(vx + dx, vy, vz));
                      sumRedLights.push(space.getRedLight(vx + dx, vy, vz));
                      sumGreenLights.push(space.getGreenLight(vx + dx, vy, vz));
                      sumBlueLights.push(space.getBlueLight(vx + dx, vy, vz));
                    }

                    if (b101) {
                      sumSunlights.push(
                        space.getSunlight(vx + dx, vy, vz + dz)
                      );
                      sumRedLights.push(
                        space.getRedLight(vx + dx, vy, vz + dz)
                      );
                      sumGreenLights.push(
                        space.getGreenLight(vx + dx, vy, vz + dz)
                      );
                      sumBlueLights.push(
                        space.getBlueLight(vx + dx, vy, vz + dz)
                      );
                    }

                    if (b110) {
                      sumSunlights.push(
                        space.getSunlight(vx + dx, vy + dy, vz)
                      );
                      sumRedLights.push(
                        space.getRedLight(vx + dx, vy + dy, vz)
                      );
                      sumGreenLights.push(
                        space.getGreenLight(vx + dx, vy + dy, vz)
                      );
                      sumBlueLights.push(
                        space.getBlueLight(vx + dx, vy + dy, vz)
                      );
                    }

                    if (b111) {
                      sumSunlights.push(
                        space.getSunlight(vx + dx, vy + dy, vz + dz)
                      );
                      sumRedLights.push(
                        space.getRedLight(vx + dx, vy + dy, vz + dz)
                      );
                      sumGreenLights.push(
                        space.getGreenLight(vx + dx, vy + dy, vz + dz)
                      );
                      sumBlueLights.push(
                        space.getBlueLight(vx + dx, vy + dy, vz + dz)
                      );
                    }

                    fourSunlights.push(avg(sumSunlights));
                    fourRedLights.push(avg(sumRedLights));
                    fourGreenLights.push(avg(sumGreenLights));
                    fourBlueLights.push(avg(sumBlueLights));
                  }

                  /* -------------------------------------------------------------------------- */
                  /*                     I KNOW THIS IS UGLY, BUT IT WORKS!                     */
                  /* -------------------------------------------------------------------------- */

                  const [aRT, bRT, cRT, dRT] = fourRedLights;
                  const [aGT, bGT, cGT, dGT] = fourGreenLights;
                  const [aBT, bBT, cBT, dBT] = fourBlueLights;

                  const threshold = 0;

                  // at least one zero
                  const oneTr0 =
                    aRT <= threshold ||
                    bRT <= threshold ||
                    cRT <= threshold ||
                    dRT <= threshold;
                  const oneTg0 =
                    aGT <= threshold ||
                    bGT <= threshold ||
                    cGT <= threshold ||
                    dGT <= threshold;
                  const oneTb0 =
                    aBT <= threshold ||
                    bBT <= threshold ||
                    cBT <= threshold ||
                    dBT <= threshold;

                  // one is zero, the ao rule, but only for zero AO's
                  const fEquals =
                    faceAOs[0] + faceAOs[3] == faceAOs[1] + faceAOs[2];
                  const ozaoR = fEquals && aRT + dRT < bRT + cRT;
                  const ozaoG = fEquals && aGT + dGT < bGT + cGT;
                  const ozaoB = fEquals && aBT + dBT < bBT + cBT;

                  // all not zero, 4 parts
                  const anzp1R = bRT > (aRT + dRT) / 2 && (aRT + dRT) / 2 > cRT;
                  const anzp1G = bGT > (aGT + dGT) / 2 && (aGT + dGT) / 2 > cGT;
                  const anzp1B = bBT > (aBT + dBT) / 2 && (aBT + dBT) / 2 > cBT;

                  // fixed two light sources colliding
                  const anzR = oneTr0 && anzp1R;
                  const anzG = oneTg0 && anzp1G;
                  const anzB = oneTb0 && anzp1B;

                  // common starting indices
                  indices.push(ndx);
                  indices.push(ndx + 1);

                  if (
                    faceAOs[0] + faceAOs[3] > faceAOs[1] + faceAOs[2] ||
                    ozaoR ||
                    ozaoG ||
                    ozaoB ||
                    anzR ||
                    anzG ||
                    anzB
                  ) {
                    // generate flipped quad
                    indices.push(ndx + 3);
                    indices.push(ndx + 3);
                    indices.push(ndx + 2);
                    indices.push(ndx);
                  } else {
                    indices.push(ndx + 2);
                    indices.push(ndx + 2);
                    indices.push(ndx + 1);
                    indices.push(ndx + 3);
                  }

                  aos.push(...faceAOs);
                  sunlights.push(...fourSunlights);
                  redLights.push(...fourRedLights);
                  greenLights.push(...fourGreenLights);
                  blueLights.push(...fourBlueLights);
                }
              }
            }
          }
        }
      }
    }

    const lights: number[] = [];

    for (let i = 0; i < sunlights.length; i++) {
      const s = sunlights[i];
      const r = redLights[i];
      const g = greenLights[i];
      const b = blueLights[i];

      let light = 0;
      light = LightUtils.insertRedLight(light, r);
      light = LightUtils.insertGreenLight(light, g);
      light = LightUtils.insertBlueLight(light, b);
      light = LightUtils.insertSunlight(light, s);

      lights.push(light);
    }

    const data = {
      positions: new Float32Array(positions),
      indices: new Int32Array(indices),
      uvs: new Float32Array(uvs),
      aos: new Int32Array(aos),
      lights: new Int32Array(lights),
    } as MeshData;

    const buffers = [
      data.positions.buffer.slice(0),
      data.indices.buffer.slice(0),
      data.uvs.buffer.slice(0),
      data.aos.buffer.slice(0),
      data.lights.buffer.slice(0),
    ];

    return { data, buffers };
  };
}

export { Mesher };
