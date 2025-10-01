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

  const chunks: (Chunk | null)[] = chunksData.map((chunkData: any) =>
    chunkData ? RawChunk.deserialize(chunkData) : null
  );

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

  const chunkCache = new Map<string, Chunk | null>();

  const getCachedChunk = (coords: Coords2): Chunk | null => {
    const key = `${coords[0]},${coords[1]}`;
    let chunk = chunkCache.get(key);
    if (chunk === undefined) {
      chunk = getChunkByCoords(coords);
      chunkCache.set(key, chunk);
    }
    return chunk;
  };

  const getVoxelAt = (vx: number, vy: number, vz: number) => {
    const coords = ChunkUtils.mapVoxelToChunk([vx, vy, vz], chunkSize);
    const chunk = getCachedChunk(coords);
    return chunk?.getVoxel(vx, vy, vz) ?? 0;
  };

  const getSunlightAt = (vx: number, vy: number, vz: number) => {
    const coords = ChunkUtils.mapVoxelToChunk([vx, vy, vz], chunkSize);
    const chunk = getCachedChunk(coords);
    return chunk?.getSunlight(vx, vy, vz) ?? 0;
  };

  const getTorchlightAt = (
    vx: number,
    vy: number,
    vz: number,
    color: LightColor
  ) => {
    const coords = ChunkUtils.mapVoxelToChunk([vx, vy, vz], chunkSize);
    const chunk = getCachedChunk(coords);
    return chunk?.getTorchLight(vx, vy, vz, color) ?? 0;
  };

  // New helper function for light calculation
  function calculateLightValues(
    vx: number,
    vy: number,
    vz: number,
    dx: number,
    dy: number,
    dz: number,
    dir: number[],
    isSeeThrough: boolean,
    isAllTransparent: boolean
  ) {
    if (isSeeThrough || isAllTransparent) {
      return {
        sun: getSunlightAt(vx, vy, vz),
        red: getTorchlightAt(vx, vy, vz, "RED"),
        green: getTorchlightAt(vx, vy, vz, "GREEN"),
        blue: getTorchlightAt(vx, vy, vz, "BLUE"),
      };
    }

    let sumSunlight = 0;
    let sumRedLight = 0;
    let sumGreenLight = 0;
    let sumBlueLight = 0;
    let count = 0;

    // Loop through all 9 neighbors of this vertex
    for (let x = 0; x <= 1; x++) {
      for (let y = 0; y <= 1; y++) {
        for (let z = 0; z <= 1; z++) {
          const offsetX = x * (dx === 0 ? -1 : 1);
          const offsetY = y * (dy === 0 ? -1 : 1);
          const offsetZ = z * (dz === 0 ? -1 : 1);

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

          const diagonal4Id = getVoxelAt(
            vx + offsetX,
            vy + offsetY,
            vz + offsetZ
          );
          const diagonal4 = registry.blocksById.get(diagonal4Id);

          if (diagonal4.isOpaque) {
            continue;
          }

          if (dir[0] * offsetX + dir[1] * offsetY + dir[2] * offsetZ === 0) {
            const facingId = getVoxelAt(
              vx + offsetX * dir[0],
              vy + offsetY * dir[1],
              vz + offsetZ * dir[2]
            );
            const facing = registry.blocksById.get(facingId);

            if (facing.isOpaque) {
              continue;
            }
          }

          const absSum =
            Math.abs(offsetX) + Math.abs(offsetY) + Math.abs(offsetZ);
          if (absSum === 3) {
            const diagonalYZId = getVoxelAt(vx, vy + offsetY, vz + offsetZ);
            const diagonalXZId = getVoxelAt(vx + offsetX, vy, vz + offsetZ);
            const diagonalXYId = getVoxelAt(vx + offsetX, vy + offsetY, vz);

            const diagonalYZ = registry.blocksById.get(diagonalYZId);
            const diagonalXZ = registry.blocksById.get(diagonalXZId);
            const diagonalXY = registry.blocksById.get(diagonalXYId);

            if (
              diagonalYZ.isOpaque &&
              diagonalXZ.isOpaque &&
              diagonalXY.isOpaque
            ) {
              continue;
            }

            if (diagonalXY.isOpaque && diagonalXZ.isOpaque) {
              const neighborYId = getVoxelAt(vx, vy + offsetY, vz);
              const neighborZId = getVoxelAt(vx, vy, vz + offsetZ);
              const neighborY = registry.blocksById.get(neighborYId);
              const neighborZ = registry.blocksById.get(neighborZId);

              if (neighborY.isOpaque && neighborZ.isOpaque) {
                continue;
              }
            }

            if (diagonalXY.isOpaque && diagonalYZ.isOpaque) {
              const neighborXId = getVoxelAt(vx + offsetX, vy, vz);
              const neighborZId = getVoxelAt(vx, vy, vz + offsetZ);
              const neighborX = registry.blocksById.get(neighborXId);
              const neighborZ = registry.blocksById.get(neighborZId);

              if (neighborX.isOpaque && neighborZ.isOpaque) {
                continue;
              }
            }

            if (diagonalXZ.isOpaque && diagonalYZ.isOpaque) {
              const neighborXId = getVoxelAt(vx + offsetX, vy, vz);
              const neighborYId = getVoxelAt(vx, vy + offsetY, vz);
              const neighborX = registry.blocksById.get(neighborXId);
              const neighborY = registry.blocksById.get(neighborYId);

              if (neighborX.isOpaque && neighborY.isOpaque) {
                continue;
              }
            }
          }

          sumSunlight += localSunlight;
          sumRedLight += localRedLight;
          sumGreenLight += localGreenLight;
          sumBlueLight += localBlueLight;
          count++;
        }
      }
    }

    if (count === 0) {
      return { sun: 0, red: 0, green: 0, blue: 0 };
    }

    return {
      sun: sumSunlight / count,
      red: sumRedLight / count,
      green: sumGreenLight / count,
      blue: sumBlueLight / count,
    };
  }

  const getVoxelRotationAt = (vx: number, vy: number, vz: number) => {
    const coords = ChunkUtils.mapVoxelToChunk([vx, vy, vz], chunkSize);
    const chunk = getCachedChunk(coords);
    return chunk?.getVoxelRotation(vx, vy, vz) ?? new BlockRotation();
  };

  const getVoxelStageAt = (vx: number, vy: number, vz: number) => {
    const coords = ChunkUtils.mapVoxelToChunk([vx, vy, vz], chunkSize);
    const chunk = getCachedChunk(coords);
    return chunk?.getVoxelStage(vx, vy, vz) ?? 0;
  };

  // Start meshing
  const [minX, minY, minZ] = min;
  const [maxX, maxY, maxZ] = max;

  const geometries: Record<string, InProgressGeometryProtocol> = {};

  // Pre-calculate direction offsets
  const directions = [
    [-1, 0, 0],
    [1, 0, 0],
    [0, -1, 0],
    [0, 1, 0],
    [0, 0, -1],
    [0, 0, 1],
  ];

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

        // Optimize surrounding check
        const isSurrounded = !directions.some(([dx, dy, dz]) => {
          const neighbor = getVoxelAt(vx + dx, vy + dy, vz + dz);
          return !registry.blocksById.get(neighbor)?.isOpaque;
        });

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

          if (rotatable || yRotatable) {
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
            // Get first AABB as base if exists
            let selfBounding = aabbs[0] || new AABB(0, 0, 0, 1, 1, 1);
            let nBounding = nBlock.aabbs[0] || new AABB(0, 0, 0, 1, 1, 1);

            // Union remaining AABBs
            for (let i = 1; i < aabbs.length; i++) {
              const aabb = aabbs[i];
              selfBounding = new AABB(
                Math.min(selfBounding.minX, aabb.minX),
                Math.min(selfBounding.minY, aabb.minY),
                Math.min(selfBounding.minZ, aabb.minZ),
                Math.max(selfBounding.maxX, aabb.maxX),
                Math.max(selfBounding.maxY, aabb.maxY),
                Math.max(selfBounding.maxZ, aabb.maxZ)
              );
            }

            for (let i = 1; i < nBlock.aabbs.length; i++) {
              const aabb = nBlock.aabbs[i];
              nBounding = new AABB(
                Math.min(nBounding.minX, aabb.minX),
                Math.min(nBounding.minY, aabb.minY),
                Math.min(nBounding.minZ, aabb.minZ),
                Math.max(nBounding.maxX, aabb.maxX),
                Math.max(nBounding.maxY, aabb.maxY),
                Math.max(nBounding.maxZ, aabb.maxZ)
              );
            }

            // Create translated bounding box
            const translatedBounding = new AABB(
              nBounding.minX + dir[0],
              nBounding.minY + dir[1],
              nBounding.minZ + dir[2],
              nBounding.maxX + dir[0],
              nBounding.maxY + dir[1],
              nBounding.maxZ + dir[2]
            );

            // Manual intersection check
            const intersects = !(
              translatedBounding.maxX < selfBounding.minX ||
              translatedBounding.minX > selfBounding.maxX ||
              translatedBounding.maxY < selfBounding.minY ||
              translatedBounding.minY > selfBounding.maxY ||
              translatedBounding.maxZ < selfBounding.minZ ||
              translatedBounding.minZ > selfBounding.maxZ
            );

            // Manual touching check
            const touches =
              translatedBounding.maxX === selfBounding.minX ||
              translatedBounding.minX === selfBounding.maxX ||
              translatedBounding.maxY === selfBounding.minY ||
              translatedBounding.minY === selfBounding.maxY ||
              translatedBounding.maxZ === selfBounding.minZ ||
              translatedBounding.minZ === selfBounding.maxZ;

            if (!(intersects || touches)) {
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
            const fourLights: number[][] = [[], [], [], []];

            for (const { pos: cornerPos, uv } of corners) {
              const pos = [...cornerPos] as Coords3;

              if (rotatable || yRotatable) {
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

              const b011Id = getVoxelAt(vx + 0, vy + unitDy, vz + unitDz);
              const b101Id = getVoxelAt(vx + unitDx, vy + 0, vz + unitDz);
              const b110Id = getVoxelAt(vx + unitDx, vy + unitDy, vz + 0);
              const b111Id = getVoxelAt(vx + unitDx, vy + unitDy, vz + unitDz);

              const b011 = !registry.blocksById.get(b011Id).isOpaque;
              const b101 = !registry.blocksById.get(b101Id).isOpaque;
              const b110 = !registry.blocksById.get(b110Id).isOpaque;
              const b111 = !registry.blocksById.get(b111Id).isOpaque;

              const ao =
                isSeeThrough || isAllTransparent
                  ? 3
                  : Math.abs(dir[0]) === 1
                  ? vertexAO(b110, b101, b111)
                  : Math.abs(dir[1]) === 1
                  ? vertexAO(b110, b011, b111)
                  : vertexAO(b011, b101, b111);

              const lightValues = calculateLightValues(
                vx,
                vy,
                vz,
                dx,
                dy,
                dz,
                dir,
                isSeeThrough,
                isAllTransparent
              );

              let light = 0;
              light = LightUtils.insertRedLight(light, lightValues.red);
              light = LightUtils.insertGreenLight(light, lightValues.green);
              light = LightUtils.insertBlueLight(light, lightValues.blue);
              light = LightUtils.insertSunlight(light, lightValues.sun);
              geometry.lights.push(Math.floor(light) | (ao << 16));

              fourLights[0].push(lightValues.sun);
              fourLights[1].push(lightValues.red);
              fourLights[2].push(lightValues.green);
              fourLights[3].push(lightValues.blue);
              faceAOs.push(ao);
            }

            const aRt = fourLights[1][0];
            const bRt = fourLights[1][1];
            const cRt = fourLights[1][2];
            const dRt = fourLights[1][3];

            const aGt = fourLights[2][0];
            const bGt = fourLights[2][1];
            const cGt = fourLights[2][2];
            const dGt = fourLights[2][3];

            const aBt = fourLights[3][0];
            const bBt = fourLights[3][1];
            const cBt = fourLights[3][2];
            const dBt = fourLights[3][3];

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
        indices: new Uint16Array(geometry.indices.length),
        lights: new Int32Array(geometry.lights),
        positions: new Float32Array(geometry.positions),
        uvs: new Float32Array(geometry.uvs),
        voxel: geometry.voxel,
        faceName: geometry.faceName,
        at: geometry.at,
      };

      for (let i = 0; i < geometry.indices.length; i++) {
        packedGeometry.indices[i] = geometry.indices[i];
      }

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
