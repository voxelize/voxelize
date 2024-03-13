import { AABB } from "@voxelize/aabb";

import { Coords2, Coords3 } from "../../../types";
import { BlockUtils } from "../../../utils/block-utils";
import { ChunkUtils } from "../../../utils/chunk-utils";
import { LightColor, LightUtils } from "../../../utils/light-utils";
import { BlockRotation } from "../block";
import { type Chunk, type UV, type WorldOptions } from "../index";
import { RawChunk } from "../raw-chunk";
import { Registry } from "../registry";

let registry: Registry;

type InProgressGeometryProtocol = {
  voxel: number;
  at?: Coords3;
  faceName?: string;
  positions: number[];
  uvs: number[];
  indices: number[];
  lights: number[];
};

// @ts-ignore
onmessage = function (e) {
  const { type } = e.data;

  if (type && type.toLowerCase() === "init") {
    registry = Registry.deserialize(e.data.registryData);
    return;
  }

  function vertexAO(side1: boolean, side2: boolean, corner: boolean) {
    const numS1 = Number(!side1);
    const numS2 = Number(!side2);
    const numC = Number(!corner);

    if (numS1 === 1 && numS2 === 1) {
      return 0;
    }

    return 3 - (numS1 + numS2 + numC);
  }

  const { chunksData, min, max } = e.data;
  const { chunkSize } = e.data.options as WorldOptions;

  const chunks: (Chunk | null)[] = chunksData.map((chunkData: any) => {
    if (!chunkData) {
      return null;
    }

    const chunk = RawChunk.deserialize(chunkData);
    return chunk;
  });

  const getChunkByCoords = (coords: Coords2) => {
    const centerCoords = chunks[4].coords;
    const dx = coords[0] - centerCoords[0];
    const dy = coords[1] - centerCoords[1];
    const index = (dy + 1) * 3 + (dx + 1);
    if (index < 0 || index >= chunks.length) {
      throw new Error(`Invalid coordinates: ${coords}`);
    }
    return chunks[index];
  };

  const getVoxelAt = (vx: number, vy: number, vz: number) => {
    const coords = ChunkUtils.mapVoxelToChunk([vx, vy, vz], chunkSize);
    const chunk = getChunkByCoords(coords);
    return chunk?.getVoxel(vx, vy, vz) ?? 0;
  };

  const getSunlightAt = (vx: number, vy: number, vz: number) => {
    const coords = ChunkUtils.mapVoxelToChunk([vx, vy, vz], chunkSize);
    const chunk = getChunkByCoords(coords);
    return chunk?.getSunlight(vx, vy, vz) ?? 0;
  };

  const getTorchlightAt = (
    vx: number,
    vy: number,
    vz: number,
    color: LightColor
  ) => {
    const coords = ChunkUtils.mapVoxelToChunk([vx, vy, vz], chunkSize);
    const chunk = getChunkByCoords(coords);
    return chunk?.getTorchLight(vx, vy, vz, color) ?? 0;
  };

  const getVoxelRotationAt = (vx: number, vy: number, vz: number) => {
    const coords = ChunkUtils.mapVoxelToChunk([vx, vy, vz], chunkSize);
    const chunk = getChunkByCoords(coords);
    return chunk?.getVoxelRotation(vx, vy, vz) ?? new BlockRotation();
  };

  const getVoxelStageAt = (vx: number, vy: number, vz: number) => {
    const coords = ChunkUtils.mapVoxelToChunk([vx, vy, vz], chunkSize);
    const chunk = getChunkByCoords(coords);
    return chunk?.getVoxelStage(vx, vy, vz) ?? 0;
  };

  const getBlockAt = (vx: number, vy: number, vz: number) => {
    const voxelId = getVoxelAt(vx, vy, vz);
    return registry.blocksById.get(voxelId);
  };

  // Start meshing
  const [minX, minY, minZ] = min;
  const [maxX, maxY, maxZ] = max;

  const geometries: Record<string, InProgressGeometryProtocol> = {};

  for (let vx = minX; vx < maxX; vx++) {
    for (let vz = minZ; vz < maxZ; vz++) {
      for (let vy = minY; vy < maxY; vy++) {
        const voxel = getVoxelAt(vx, vy, vz);
        const rotation = getVoxelRotationAt(vx, vy, vz);
        const block = registry.blocksById.get(voxel);

        const {
          id,
          isSeeThrough,
          isEmpty,
          isOpaque,
          name,
          rotatable,
          yRotatable,
          isDynamic,
          dynamicPatterns,
          isTransparent,
        } = block;

        let aabbs = block.aabbs;
        let faces = block.faces;

        if ((isDynamic && !dynamicPatterns) || isEmpty || faces.length === 0) {
          continue;
        }

        if (dynamicPatterns) {
          faces = [];
          aabbs = [];

          let patternsMatched = false;

          for (const dynamicPattern of dynamicPatterns) {
            for (const part of dynamicPattern.parts) {
              const partMatched = BlockUtils.evaluateBlockRule(
                part.rule,
                [vx, vy, vz],
                {
                  getVoxelAt,
                  getVoxelRotationAt,
                  getVoxelStageAt,
                }
              );

              if (partMatched) {
                patternsMatched = true;
                faces = [...faces, ...part.faces];
                aabbs = [...aabbs, ...part.aabbs];
              }
            }

            if (patternsMatched) {
              break;
            }
          }
        }

        // Skip blocks that are completely surrounded by other blocks
        let isSurrounded = true;

        for (const [dx, dy, dz] of [
          [-1, 0, 0],
          [1, 0, 0],
          [0, -1, 0],
          [0, 1, 0],
          [0, 0, -1],
          [0, 0, 1],
        ]) {
          const neighbor = getVoxelAt(vx + dx, vy + dy, vz + dz);
          const neighborBlock = registry.blocksById.get(neighbor);
          if (!neighborBlock?.isOpaque) {
            isSurrounded = false;
            break;
          }
        }

        if (isSurrounded) {
          continue;
        }

        const isAllTransparent =
          isTransparent[0] &&
          isTransparent[1] &&
          isTransparent[2] &&
          isTransparent[3] &&
          isTransparent[4] &&
          isTransparent[5];

        const uvMap: Record<string, UV> = {};
        for (const face of faces) {
          uvMap[face.name] = face.range;
        }

        for (const face of faces) {
          const key = face.isolated
            ? `${name.toLowerCase()}::${face.name.toLowerCase()}::${vx}-${vy}-${vz}`
            : face.independent
            ? `${name.toLowerCase()}::${face.name.toLowerCase()}`
            : name.toLowerCase();

          const geometry =
            geometries[key] ??
            ({
              lights: [],
              voxel: id,
              positions: [],
              uvs: [],
              indices: [],
            } as InProgressGeometryProtocol);

          if (face.independent || face.isolated) {
            geometry.faceName = face.name;
          }

          if (face.isolated) {
            geometry.at = [vx, vy, vz];
          }

          // Process the face
          const { dir: faceDir, corners } = face;
          const dir = [...faceDir] as Coords3;

          if (rotatable) {
            rotation.rotateNode(dir, yRotatable, false);
          }

          dir[0] = Math.round(dir[0]);
          dir[1] = Math.round(dir[1]);
          dir[2] = Math.round(dir[2]);

          const nvx = vx + dir[0];
          const nvy = vy + dir[1];
          const nvz = vz + dir[2];

          const neighborId = getVoxelAt(nvx, nvy, nvz);
          const nCoords = ChunkUtils.mapVoxelToChunk(
            [nvx, nvy, nvz],
            chunkSize
          );
          const nIsVoid = !getChunkByCoords(nCoords);
          const nBlock = registry.blocksById.get(neighborId);

          let seeThroughCheck = false;

          if (isSeeThrough && !isOpaque && nBlock.isOpaque) {
            const selfBounding = AABB.union(aabbs);
            const nBounding = AABB.union(nBlock.aabbs);
            nBounding.translate(dir);
            if (
              !(
                selfBounding.intersects(nBounding) ||
                selfBounding.touches(nBounding)
              )
            ) {
              seeThroughCheck = true;
            }
          }

          if (
            (nIsVoid && nBlock.isEmpty) ||
            (isSeeThrough &&
              !isOpaque &&
              !nBlock.isOpaque &&
              ((isSeeThrough &&
                neighborId == id &&
                nBlock.transparentStandalone) ||
                (neighborId != id && (isSeeThrough || nBlock.isSeeThrough)) ||
                seeThroughCheck)) ||
            (!isSeeThrough && (!isOpaque || !nBlock.isOpaque))
          ) {
            const { startU, startV, endU, endV } = uvMap[face.name];
            const ndx = Math.floor(geometry.positions.length / 3);

            const faceAOs: number[] = [];
            const fourSunlights: number[] = [];
            const fourRedLights: number[] = [];
            const fourGreenLights: number[] = [];
            const fourBlueLights: number[] = [];

            for (const { pos: cornerPos, uv } of corners) {
              const pos = [...cornerPos] as Coords3;

              if (rotatable) {
                rotation.rotateNode(pos, yRotatable, true);
              }

              const posX = vx + pos[0];
              const posY = vy + pos[1];
              const posZ = vz + pos[2];

              const scale = isOpaque ? 0.0 : 0.0001;
              geometry.positions.push(
                posX - minX - dir[0] * scale,
                posY - minY - dir[1] * scale,
                posZ - minZ - dir[2] * scale
              );

              geometry.uvs.push(
                uv[0] * (endU - startU) + startU,
                uv[1] * (endV - startV) + startV
              );

              const dx = Math.round(pos[0]);
              const dy = Math.round(pos[1]);
              const dz = Math.round(pos[2]);

              const unitDx = dx === 0 ? -1 : 1;
              const unitDy = dy === 0 ? -1 : 1;
              const unitDz = dz === 0 ? -1 : 1;

              const sumSunlights: number[] = [];
              const sumRedLights: number[] = [];
              const sumGreenLights: number[] = [];
              const sumBlueLights: number[] = [];

              const b011 = !getBlockAt(vx + 0, vy + unitDy, vz + unitDz)
                .isOpaque;
              const b101 = !getBlockAt(vx + unitDx, vy + 0, vz + unitDz)
                .isOpaque;
              const b110 = !getBlockAt(vx + unitDx, vy + unitDy, vz + 0)
                .isOpaque;
              const b111 = !getBlockAt(vx + unitDx, vy + unitDy, vz + unitDz)
                .isOpaque;

              const ao =
                isSeeThrough || isAllTransparent
                  ? 3
                  : Math.abs(dir[0]) === 1
                  ? vertexAO(b110, b101, b111)
                  : Math.abs(dir[1]) === 1
                  ? vertexAO(b110, b011, b111)
                  : vertexAO(b011, b101, b111);

              let sunlight: number;
              let redLight: number;
              let greenLight: number;
              let blueLight: number;

              if (isSeeThrough || isAllTransparent) {
                sunlight = getSunlightAt(vx, vy, vz);
                redLight = getTorchlightAt(vx, vy, vz, "RED");
                greenLight = getTorchlightAt(vx, vy, vz, "GREEN");
                blueLight = getTorchlightAt(vx, vy, vz, "BLUE");
              } else {
                // Loop through all 9 neighbors of this vertex
                for (let x = 0; x <= 1; x++) {
                  for (let y = 0; y <= 1; y++) {
                    for (let z = 0; z <= 1; z++) {
                      const offsetX = x * unitDx;
                      const offsetY = y * unitDy;
                      const offsetZ = z * unitDz;

                      const localSunlight = getSunlightAt(
                        vx + offsetX,
                        vy + offsetY,
                        vz + offsetZ
                      );
                      const localRedLight = getTorchlightAt(
                        vx + offsetX,
                        vy + offsetY,
                        vz + offsetZ,
                        "RED"
                      );
                      const localGreenLight = getTorchlightAt(
                        vx + offsetX,
                        vy + offsetY,
                        vz + offsetZ,
                        "GREEN"
                      );
                      const localBlueLight = getTorchlightAt(
                        vx + offsetX,
                        vy + offsetY,
                        vz + offsetZ,
                        "BLUE"
                      );

                      if (
                        localSunlight == 0 &&
                        localRedLight == 0 &&
                        localGreenLight == 0 &&
                        localBlueLight == 0
                      ) {
                        continue;
                      }

                      const diagonal4 = getBlockAt(
                        vx + offsetX,
                        vy + offsetY,
                        vz + offsetZ
                      );

                      if (diagonal4.isOpaque) {
                        continue;
                      }

                      if (
                        dir[0] * offsetX +
                          dir[1] * offsetY +
                          dir[2] * offsetZ ===
                        0
                      ) {
                        const facing = getBlockAt(
                          vx + offsetX * dir[0],
                          vy + offsetY * dir[1],
                          vz + offsetZ * dir[2]
                        );

                        if (facing.isOpaque) {
                          continue;
                        }
                      }

                      // Diagonal light leaking fix
                      if (
                        Math.abs(offsetX) +
                          Math.abs(offsetY) +
                          Math.abs(offsetZ) ===
                        3
                      ) {
                        const diagonalYZ = getBlockAt(
                          vx,
                          vy + offsetY,
                          vz + offsetZ
                        );
                        const diagonalXZ = getBlockAt(
                          vx + offsetX,
                          vy,
                          vz + offsetZ
                        );
                        const diagonalXY = getBlockAt(
                          vx + offsetX,
                          vy + offsetY,
                          vz
                        );

                        // Three corners are blocked
                        if (
                          diagonalYZ.isOpaque &&
                          diagonalXZ.isOpaque &&
                          diagonalXY.isOpaque
                        ) {
                          continue;
                        }

                        // Two corners are blocked
                        if (diagonalXY.isOpaque && diagonalXZ.isOpaque) {
                          const neighborY = getBlockAt(vx, vy + offsetY, vz);
                          const neighborZ = getBlockAt(vx, vy, vz + offsetZ);

                          if (neighborY.isOpaque && neighborZ.isOpaque) {
                            continue;
                          }
                        }

                        if (diagonalXY.isOpaque && diagonalYZ.isOpaque) {
                          const neighborX = getBlockAt(vx + offsetX, vy, vz);
                          const neighborZ = getBlockAt(vx, vy, vz + offsetZ);

                          if (neighborX.isOpaque && neighborZ.isOpaque) {
                            continue;
                          }
                        }

                        if (diagonalXZ.isOpaque && diagonalYZ.isOpaque) {
                          const neighborX = getBlockAt(vx + offsetX, vy, vz);
                          const neighborY = getBlockAt(vx, vy + offsetY, vz);

                          if (neighborX.isOpaque && neighborY.isOpaque) {
                            continue;
                          }
                        }
                      }

                      sumSunlights.push(localSunlight);
                      sumRedLights.push(localRedLight);
                      sumGreenLights.push(localGreenLight);
                      sumBlueLights.push(localBlueLight);
                    }
                  }
                }

                sunlight =
                  sumSunlights.reduce((a, b) => a + b, 0) / sumSunlights.length;
                redLight =
                  sumRedLights.reduce((a, b) => a + b, 0) / sumRedLights.length;
                greenLight =
                  sumGreenLights.reduce((a, b) => a + b, 0) /
                  sumGreenLights.length;
                blueLight =
                  sumBlueLights.reduce((a, b) => a + b, 0) /
                  sumBlueLights.length;
              }

              let light = 0;
              light = LightUtils.insertRedLight(light, redLight);
              light = LightUtils.insertGreenLight(light, greenLight);
              light = LightUtils.insertBlueLight(light, blueLight);
              light = LightUtils.insertSunlight(light, sunlight);
              geometry.lights.push(Math.floor(light) | (ao << 16));

              fourSunlights.push(sunlight);
              fourRedLights.push(redLight);
              fourGreenLights.push(greenLight);
              fourBlueLights.push(blueLight);
              faceAOs.push(ao);
            }

            const aRt = fourRedLights[0];
            const bRt = fourRedLights[1];
            const cRt = fourRedLights[2];
            const dRt = fourRedLights[3];

            const aGt = fourGreenLights[0];
            const bGt = fourGreenLights[1];
            const cGt = fourGreenLights[2];
            const dGt = fourGreenLights[3];

            const aBt = fourBlueLights[0];
            const bBt = fourBlueLights[1];
            const cBt = fourBlueLights[2];
            const dBt = fourBlueLights[3];

            const threshold = 0;

            /* -------------------------------------------------------------------------- */
            /*                     I KNOW THIS IS UGLY, BUT IT WORKS!                     */
            /* -------------------------------------------------------------------------- */
            // at least one zero
            const oneTr0 =
              aRt <= threshold ||
              bRt <= threshold ||
              cRt <= threshold ||
              dRt <= threshold;
            const oneTg0 =
              aGt <= threshold ||
              bGt <= threshold ||
              cGt <= threshold ||
              dGt <= threshold;
            const oneTb0 =
              aBt <= threshold ||
              bBt <= threshold ||
              cBt <= threshold ||
              dBt <= threshold;
            // one is zero, and ao rule, but only for zero AO's
            const fEquals = faceAOs[0] + faceAOs[3] == faceAOs[1] + faceAOs[2];
            const ozaoR = aRt + dRt < bRt + cRt && fEquals;
            const ozaoG = aGt + dGt < bGt + cGt && fEquals;
            const ozaoB = aBt + dBt < bBt + cBt && fEquals;
            // all not zero, 4 parts
            const anzp1R =
              (bRt > (aRt + dRt) / 2.0 && (aRt + dRt) / 2.0 > cRt) ||
              (cRt > (aRt + dRt) / 2.0 && (aRt + dRt) / 2.0 > bRt);
            const anzp1G =
              (bGt > (aGt + dGt) / 2.0 && (aGt + dGt) / 2.0 > cGt) ||
              (cGt > (aGt + dGt) / 2.0 && (aGt + dGt) / 2.0 > bGt);
            const anzp1B =
              (bBt > (aBt + dBt) / 2.0 && (aBt + dBt) / 2.0 > cBt) ||
              (cBt > (aBt + dBt) / 2.0 && (aBt + dBt) / 2.0 > bBt);
            // fixed two light sources colliding
            const anzR = oneTr0 && anzp1R;
            const anzG = oneTg0 && anzp1G;
            const anzB = oneTb0 && anzp1B;

            // common starting indices
            geometry.indices.push(ndx);
            geometry.indices.push(ndx + 1);

            if (
              faceAOs[0] + faceAOs[3] > faceAOs[1] + faceAOs[2] ||
              ozaoR ||
              ozaoG ||
              ozaoB ||
              anzR ||
              anzG ||
              anzB
            ) {
              // Generate flipped triangles
              geometry.indices.push(ndx + 3);
              geometry.indices.push(ndx + 3);
              geometry.indices.push(ndx + 2);
              geometry.indices.push(ndx);
            } else {
              // Generate normal triangles
              geometry.indices.push(ndx + 2);
              geometry.indices.push(ndx + 2);
              geometry.indices.push(ndx + 1);
              geometry.indices.push(ndx + 3);
            }
          }

          // Insert into the map
          geometries[key] = geometry;
        }
      }
    }
  }

  const arrayBuffers: ArrayBuffer[] = [];
  const geometriesPacked = Object.values(geometries)
    .map((geometry) => {
      const packedGeometry = {
        indices: new Uint16Array(geometry.indices),
        lights: new Int32Array(geometry.lights),
        positions: new Float32Array(geometry.positions),
        uvs: new Float32Array(geometry.uvs),
        voxel: geometry.voxel,
        faceName: geometry.faceName,
        at: geometry.at,
      };

      arrayBuffers.push(packedGeometry.indices.buffer);
      arrayBuffers.push(packedGeometry.lights.buffer);
      arrayBuffers.push(packedGeometry.positions.buffer);
      arrayBuffers.push(packedGeometry.uvs.buffer);

      return packedGeometry;
    })
    .filter((geometry) => geometry.positions.length > 0);

  // @ts-ignore
  postMessage({ geometries: geometriesPacked }, arrayBuffers);
};
