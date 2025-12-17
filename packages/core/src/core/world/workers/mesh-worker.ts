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

type FaceKey = {
  blockId: number;
  faceName: string;
  independent: boolean;
  ao: [number, number, number, number];
  light: [number, number, number, number];
  uvStartU: number;
  uvEndU: number;
  uvStartV: number;
  uvEndV: number;
};

type FaceData = {
  key: FaceKey;
  uvRange: UV;
  isSeeThrough: boolean;
  isFluid: boolean;
};

type GreedyQuad = {
  x: number;
  y: number;
  w: number;
  h: number;
  data: FaceData;
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

  function canGreedyMeshBlock(
    block: {
      isFluid: boolean;
      rotatable: boolean;
      yRotatable: boolean;
      dynamicPatterns: { parts: { rule: object }[] }[] | null;
    },
    rotation: BlockRotation
  ): boolean {
    const isIdentityRotation = rotation.value === 0 && rotation.yRotation === 0;
    return (
      !block.isFluid &&
      !block.rotatable &&
      !block.yRotatable &&
      !block.dynamicPatterns &&
      isIdentityRotation
    );
  }

  function faceKeyEquals(a: FaceKey, b: FaceKey): boolean {
    return (
      a.blockId === b.blockId &&
      a.faceName === b.faceName &&
      a.independent === b.independent &&
      a.ao[0] === b.ao[0] &&
      a.ao[1] === b.ao[1] &&
      a.ao[2] === b.ao[2] &&
      a.ao[3] === b.ao[3] &&
      a.light[0] === b.light[0] &&
      a.light[1] === b.light[1] &&
      a.light[2] === b.light[2] &&
      a.light[3] === b.light[3] &&
      a.uvStartU === b.uvStartU &&
      a.uvEndU === b.uvEndU &&
      a.uvStartV === b.uvStartV &&
      a.uvEndV === b.uvEndV
    );
  }

  function extractGreedyQuads(
    mask: Map<string, FaceData>,
    minU: number,
    maxU: number,
    minV: number,
    maxV: number
  ): GreedyQuad[] {
    const quads: GreedyQuad[] = [];

    for (let v = minV; v < maxV; v++) {
      for (let u = minU; u < maxU; u++) {
        const key = `${u},${v}`;
        const data = mask.get(key);
        if (!data) continue;

        mask.delete(key);

        let width = 1;
        while (u + width < maxU) {
          const neighborKey = `${u + width},${v}`;
          const neighbor = mask.get(neighborKey);
          if (neighbor && faceKeyEquals(neighbor.key, data.key)) {
            mask.delete(neighborKey);
            width++;
          } else {
            break;
          }
        }

        let height = 1;
        heightLoop: while (v + height < maxV) {
          for (let du = 0; du < width; du++) {
            const neighborKey = `${u + du},${v + height}`;
            const neighbor = mask.get(neighborKey);
            if (!neighbor || !faceKeyEquals(neighbor.key, data.key)) {
              break heightLoop;
            }
          }
          for (let du = 0; du < width; du++) {
            mask.delete(`${u + du},${v + height}`);
          }
          height++;
        }

        quads.push({
          x: u,
          y: v,
          w: width,
          h: height,
          data,
        });
      }
    }

    return quads;
  }

  function processGreedyQuad(
    quad: GreedyQuad,
    axis: number,
    uAxis: number,
    vAxis: number,
    slice: number,
    dir: Coords3,
    minPos: Coords3,
    block: { isOpaque: boolean },
    geometry: InProgressGeometryProtocol
  ): void {
    const [minX, minY, minZ] = minPos;
    const isOpaque = block.isOpaque;
    const isFluid = quad.data.isFluid;

    const { startU, endU, startV, endV } = quad.data.uvRange;
    const scale = isOpaque ? 0.0 : 0.0001;

    const uMin = quad.x;
    const uMax = quad.x + quad.w;
    const vMin = quad.y;
    const vMax = quad.y + quad.h;

    const slicePos = slice + (dir[axis] > 0 ? 1 : 0);

    let corners: [number, number, number][];
    let uvCorners: [number, number][];

    if (dir[0] === 1 && dir[1] === 0 && dir[2] === 0) {
      corners = [
        [slicePos, vMax, uMax],
        [slicePos, vMin, uMax],
        [slicePos, vMax, uMin],
        [slicePos, vMin, uMin],
      ];
      uvCorners = [
        [0.0, 1.0],
        [0.0, 0.0],
        [1.0, 1.0],
        [1.0, 0.0],
      ];
    } else if (dir[0] === -1 && dir[1] === 0 && dir[2] === 0) {
      corners = [
        [slicePos, vMax, uMin],
        [slicePos, vMin, uMin],
        [slicePos, vMax, uMax],
        [slicePos, vMin, uMax],
      ];
      uvCorners = [
        [0.0, 1.0],
        [0.0, 0.0],
        [1.0, 1.0],
        [1.0, 0.0],
      ];
    } else if (dir[0] === 0 && dir[1] === 1 && dir[2] === 0) {
      corners = [
        [uMin, slicePos, vMax],
        [uMax, slicePos, vMax],
        [uMin, slicePos, vMin],
        [uMax, slicePos, vMin],
      ];
      uvCorners = [
        [1.0, 1.0],
        [0.0, 1.0],
        [1.0, 0.0],
        [0.0, 0.0],
      ];
    } else if (dir[0] === 0 && dir[1] === -1 && dir[2] === 0) {
      corners = [
        [uMax, slicePos, vMax],
        [uMin, slicePos, vMax],
        [uMax, slicePos, vMin],
        [uMin, slicePos, vMin],
      ];
      uvCorners = [
        [1.0, 0.0],
        [0.0, 0.0],
        [1.0, 1.0],
        [0.0, 1.0],
      ];
    } else if (dir[0] === 0 && dir[1] === 0 && dir[2] === 1) {
      corners = [
        [uMin, vMin, slicePos],
        [uMax, vMin, slicePos],
        [uMin, vMax, slicePos],
        [uMax, vMax, slicePos],
      ];
      uvCorners = [
        [0.0, 0.0],
        [1.0, 0.0],
        [0.0, 1.0],
        [1.0, 1.0],
      ];
    } else if (dir[0] === 0 && dir[1] === 0 && dir[2] === -1) {
      corners = [
        [uMax, vMin, slicePos],
        [uMin, vMin, slicePos],
        [uMax, vMax, slicePos],
        [uMin, vMax, slicePos],
      ];
      uvCorners = [
        [0.0, 0.0],
        [1.0, 0.0],
        [0.0, 1.0],
        [1.0, 1.0],
      ];
    } else {
      return;
    }

    const ndx = Math.floor(geometry.positions.length / 3);

    for (let i = 0; i < 4; i++) {
      const pos = corners[i];
      geometry.positions.push(pos[0] - minX - dir[0] * scale);
      geometry.positions.push(pos[1] - minY - dir[1] * scale);
      geometry.positions.push(pos[2] - minZ - dir[2] * scale);

      const u = uvCorners[i][0] * (endU - startU) + startU;
      const v = uvCorners[i][1] * (endV - startV) + startV;
      geometry.uvs.push(u);
      geometry.uvs.push(v);

      const ao = quad.data.key.ao[i];
      const light = quad.data.key.light[i];
      const fluidBit = isFluid ? 1 << 18 : 0;
      const greedyBit = 1 << 19;
      geometry.lights.push(light | (ao << 16) | fluidBit | greedyBit);
    }

    const faceAOs = quad.data.key.ao;

    if (faceAOs[0] + faceAOs[3] > faceAOs[1] + faceAOs[2]) {
      geometry.indices.push(ndx);
      geometry.indices.push(ndx + 1);
      geometry.indices.push(ndx + 3);
      geometry.indices.push(ndx + 3);
      geometry.indices.push(ndx + 2);
      geometry.indices.push(ndx);
    } else {
      geometry.indices.push(ndx);
      geometry.indices.push(ndx + 1);
      geometry.indices.push(ndx + 2);
      geometry.indices.push(ndx + 2);
      geometry.indices.push(ndx + 1);
      geometry.indices.push(ndx + 3);
    }
  }

  const { chunksData, min, max } = e.data;
  const { chunkSize, greedyMeshing = true } = e.data.options as WorldOptions;

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
          const offsetX = x * dx;
          const offsetY = y * dy;
          const offsetZ = z * dz;

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

          if (!diagonal4 || diagonal4.isOpaque) {
            continue;
          }

          if (dir[0] * offsetX + dir[1] * offsetY + dir[2] * offsetZ === 0) {
            const facingId = getVoxelAt(
              vx + offsetX * dir[0],
              vy + offsetY * dir[1],
              vz + offsetZ * dir[2]
            );
            const facing = registry.blocksById.get(facingId);

            if (!facing || facing.isOpaque) {
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

            if (!diagonalYZ || !diagonalXZ || !diagonalXY) {
              continue;
            }

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

              if (neighborY?.isOpaque && neighborZ?.isOpaque) {
                continue;
              }
            }

            if (diagonalXY.isOpaque && diagonalYZ.isOpaque) {
              const neighborXId = getVoxelAt(vx + offsetX, vy, vz);
              const neighborZId = getVoxelAt(vx, vy, vz + offsetZ);
              const neighborX = registry.blocksById.get(neighborXId);
              const neighborZ = registry.blocksById.get(neighborZId);

              if (neighborX?.isOpaque && neighborZ?.isOpaque) {
                continue;
              }
            }

            if (diagonalXZ.isOpaque && diagonalYZ.isOpaque) {
              const neighborXId = getVoxelAt(vx + offsetX, vy, vz);
              const neighborYId = getVoxelAt(vx, vy + offsetY, vz);
              const neighborX = registry.blocksById.get(neighborXId);
              const neighborY = registry.blocksById.get(neighborYId);

              if (neighborX?.isOpaque && neighborY?.isOpaque) {
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

  const FLUID_BASE_HEIGHT = 0.875;
  const FLUID_STAGE_DROPOFF = 0.1;

  const getFluidEffectiveHeight = (stage: number) => {
    return Math.max(FLUID_BASE_HEIGHT - stage * FLUID_STAGE_DROPOFF, 0.1);
  };

  const hasFluidAbove = (
    vx: number,
    vy: number,
    vz: number,
    fluidId: number
  ) => {
    return getVoxelAt(vx, vy + 1, vz) === fluidId;
  };

  const getFluidHeightAt = (
    vx: number,
    vy: number,
    vz: number,
    fluidId: number
  ): number | null => {
    if (getVoxelAt(vx, vy, vz) === fluidId) {
      const stage = getVoxelStageAt(vx, vy, vz);
      return getFluidEffectiveHeight(stage);
    }
    return null;
  };

  const calculateFluidCornerHeight = (
    vx: number,
    vy: number,
    vz: number,
    cornerX: number,
    cornerZ: number,
    cornerOffsets: [number, number][],
    fluidId: number
  ): number => {
    const upperCheckOffsets = [
      [cornerX - 1, cornerZ - 1],
      [cornerX - 1, cornerZ],
      [cornerX, cornerZ - 1],
      [cornerX, cornerZ],
    ];

    for (const [dx, dz] of upperCheckOffsets) {
      if (getVoxelAt(vx + dx, vy + 1, vz + dz) === fluidId) {
        return 1.0;
      }
    }

    const selfStage = getVoxelStageAt(vx, vy, vz);
    const selfHeight = getFluidEffectiveHeight(selfStage);

    let totalHeight = selfHeight;
    let count = 1;
    let hasAirNeighbor = false;

    for (const [dx, dz] of cornerOffsets) {
      const nx = vx + dx;
      const nz = vz + dz;

      if (hasFluidAbove(nx, vy, nz, fluidId)) {
        totalHeight += 1.0;
        count += 1;
      } else {
        const h = getFluidHeightAt(nx, vy, nz, fluidId);
        if (h !== null) {
          totalHeight += h;
          count += 1;
        } else {
          const neighborId = getVoxelAt(nx, vy, nz);
          const neighborBlock = registry.blocksById.get(neighborId);
          if (neighborBlock?.isEmpty) {
            hasAirNeighbor = true;
          }
        }
      }
    }

    if (count === 1 && hasAirNeighbor) {
      return 0.1;
    }
    return totalHeight / count;
  };

  type FluidFace = {
    name: string;
    dir: [number, number, number];
    independent: boolean;
    isolated: boolean;
    corners: { pos: [number, number, number]; uv: [number, number] }[];
    range: { startU: number; endU: number; startV: number; endV: number };
  };

  const createFluidFaces = (
    vx: number,
    vy: number,
    vz: number,
    fluidId: number,
    originalFaces: {
      name: string;
      range: { startU: number; endU: number; startV: number; endV: number };
    }[]
  ): FluidFace[] => {
    const cornerNxNz: [number, number][] = [
      [-1, 0],
      [0, -1],
      [-1, -1],
    ];
    const cornerPxNz: [number, number][] = [
      [1, 0],
      [0, -1],
      [1, -1],
    ];
    const cornerNxPz: [number, number][] = [
      [-1, 0],
      [0, 1],
      [-1, 1],
    ];
    const cornerPxPz: [number, number][] = [
      [1, 0],
      [0, 1],
      [1, 1],
    ];

    const hNxNz = calculateFluidCornerHeight(
      vx,
      vy,
      vz,
      0,
      0,
      cornerNxNz,
      fluidId
    );
    const hPxNz = calculateFluidCornerHeight(
      vx,
      vy,
      vz,
      1,
      0,
      cornerPxNz,
      fluidId
    );
    const hNxPz = calculateFluidCornerHeight(
      vx,
      vy,
      vz,
      0,
      1,
      cornerNxPz,
      fluidId
    );
    const hPxPz = calculateFluidCornerHeight(
      vx,
      vy,
      vz,
      1,
      1,
      cornerPxPz,
      fluidId
    );

    const uvRangeMap: Record<
      string,
      { startU: number; endU: number; startV: number; endV: number }
    > = {};
    for (const face of originalFaces) {
      uvRangeMap[face.name] = face.range;
    }
    const defaultRange = { startU: 0, endU: 1, startV: 0, endV: 1 };
    const getRange = (name: string) => uvRangeMap[name] ?? defaultRange;

    return [
      {
        name: "py",
        dir: [0, 1, 0],
        independent: true,
        isolated: false,
        range: getRange("py"),
        corners: [
          { pos: [0, hNxPz, 1], uv: [1, 1] },
          { pos: [1, hPxPz, 1], uv: [0, 1] },
          { pos: [0, hNxNz, 0], uv: [1, 0] },
          { pos: [1, hPxNz, 0], uv: [0, 0] },
        ],
      },
      {
        name: "ny",
        dir: [0, -1, 0],
        independent: false,
        isolated: false,
        range: getRange("ny"),
        corners: [
          { pos: [1, 0, 1], uv: [1, 0] },
          { pos: [0, 0, 1], uv: [0, 0] },
          { pos: [1, 0, 0], uv: [1, 1] },
          { pos: [0, 0, 0], uv: [0, 1] },
        ],
      },
      {
        name: "px",
        dir: [1, 0, 0],
        independent: true,
        isolated: false,
        range: getRange("px"),
        corners: [
          { pos: [1, hPxPz, 1], uv: [0, hPxPz] },
          { pos: [1, 0, 1], uv: [0, 0] },
          { pos: [1, hPxNz, 0], uv: [1, hPxNz] },
          { pos: [1, 0, 0], uv: [1, 0] },
        ],
      },
      {
        name: "nx",
        dir: [-1, 0, 0],
        independent: true,
        isolated: false,
        range: getRange("nx"),
        corners: [
          { pos: [0, hNxNz, 0], uv: [0, hNxNz] },
          { pos: [0, 0, 0], uv: [0, 0] },
          { pos: [0, hNxPz, 1], uv: [1, hNxPz] },
          { pos: [0, 0, 1], uv: [1, 0] },
        ],
      },
      {
        name: "pz",
        dir: [0, 0, 1],
        independent: true,
        isolated: false,
        range: getRange("pz"),
        corners: [
          { pos: [0, 0, 1], uv: [0, 0] },
          { pos: [1, 0, 1], uv: [1, 0] },
          { pos: [0, hNxPz, 1], uv: [0, hNxPz] },
          { pos: [1, hPxPz, 1], uv: [1, hPxPz] },
        ],
      },
      {
        name: "nz",
        dir: [0, 0, -1],
        independent: true,
        isolated: false,
        range: getRange("nz"),
        corners: [
          { pos: [1, 0, 0], uv: [0, 0] },
          { pos: [0, 0, 0], uv: [1, 0] },
          { pos: [1, hPxNz, 0], uv: [0, hPxNz] },
          { pos: [0, hNxNz, 0], uv: [1, hNxNz] },
        ],
      },
    ];
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

  const VOXEL_NEIGHBORS: Coords3[] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];

  function computeFaceAoAndLight(
    vx: number,
    vy: number,
    vz: number,
    dir: Coords3,
    block: {
      isOpaque: boolean;
      isSeeThrough: boolean;
      isTransparent: [boolean, boolean, boolean, boolean, boolean, boolean];
      aabbs: AABB[];
    }
  ): {
    aos: [number, number, number, number];
    lights: [number, number, number, number];
  } {
    const blockAabb = AABB.union(block.aabbs);
    const isSeeThrough = block.isSeeThrough;
    const isAllTransparent =
      block.isTransparent[0] &&
      block.isTransparent[1] &&
      block.isTransparent[2] &&
      block.isTransparent[3] &&
      block.isTransparent[4] &&
      block.isTransparent[5];

    const cornerPositions: [number, number, number][] =
      dir[0] === 1
        ? [
            [1.0, 1.0, 1.0],
            [1.0, 0.0, 1.0],
            [1.0, 1.0, 0.0],
            [1.0, 0.0, 0.0],
          ]
        : dir[0] === -1
        ? [
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0],
            [0.0, 1.0, 1.0],
            [0.0, 0.0, 1.0],
          ]
        : dir[1] === 1
        ? [
            [0.0, 1.0, 1.0],
            [1.0, 1.0, 1.0],
            [0.0, 1.0, 0.0],
            [1.0, 1.0, 0.0],
          ]
        : dir[1] === -1
        ? [
            [1.0, 0.0, 1.0],
            [0.0, 0.0, 1.0],
            [1.0, 0.0, 0.0],
            [0.0, 0.0, 0.0],
          ]
        : dir[2] === 1
        ? [
            [0.0, 0.0, 1.0],
            [1.0, 0.0, 1.0],
            [0.0, 1.0, 1.0],
            [1.0, 1.0, 1.0],
          ]
        : [
            [1.0, 0.0, 0.0],
            [0.0, 0.0, 0.0],
            [1.0, 1.0, 0.0],
            [0.0, 1.0, 0.0],
          ];

    const aos: [number, number, number, number] = [0, 0, 0, 0];
    const lights: [number, number, number, number] = [0, 0, 0, 0];

    for (let i = 0; i < 4; i++) {
      const pos = cornerPositions[i];
      const dx = pos[0] <= blockAabb.minX + 0.01 ? -1 : 1;
      const dy = pos[1] <= blockAabb.minY + 0.01 ? -1 : 1;
      const dz = pos[2] <= blockAabb.minZ + 0.01 ? -1 : 1;

      const b011Id = getVoxelAt(vx + 0, vy + dy, vz + dz);
      const b101Id = getVoxelAt(vx + dx, vy + 0, vz + dz);
      const b110Id = getVoxelAt(vx + dx, vy + dy, vz + 0);
      const b111Id = getVoxelAt(vx + dx, vy + dy, vz + dz);

      const b011 = !registry.blocksById.get(b011Id)?.isOpaque;
      const b101 = !registry.blocksById.get(b101Id)?.isOpaque;
      const b110 = !registry.blocksById.get(b110Id)?.isOpaque;
      const b111 = !registry.blocksById.get(b111Id)?.isOpaque;

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

      aos[i] = ao;
      lights[i] = Math.floor(light);
    }

    return { aos, lights };
  }

  function shouldRenderFace(
    vx: number,
    vy: number,
    vz: number,
    voxelId: number,
    dir: Coords3,
    block: {
      isOpaque: boolean;
      isSeeThrough: boolean;
      isFluid: boolean;
      aabbs: AABB[];
    },
    seeThrough: boolean,
    isFluid: boolean
  ): boolean {
    const nvx = vx + dir[0];
    const nvy = vy + dir[1];
    const nvz = vz + dir[2];

    const neighborId = getVoxelAt(nvx, nvy, nvz);
    const nCoords = ChunkUtils.mapVoxelToChunk([nvx, nvy, nvz], chunkSize);
    const nIsVoid = !getChunkByCoords(nCoords);
    const nBlock = registry.blocksById.get(neighborId);

    if (!nIsVoid && !nBlock) {
      return false;
    }

    if (!nBlock) {
      return nIsVoid;
    }

    const isOpaque = block.isOpaque;
    const isSeeThrough = block.isSeeThrough;

    if (nIsVoid || nBlock.isEmpty) {
      return true;
    }

    if (
      seeThrough &&
      !isOpaque &&
      !nBlock.isOpaque &&
      ((isSeeThrough &&
        neighborId === voxelId &&
        nBlock.transparentStandalone) ||
        (neighborId !== voxelId && (isSeeThrough || nBlock.isSeeThrough)))
    ) {
      return true;
    }

    if (!seeThrough && (!isOpaque || !nBlock.isOpaque)) {
      return true;
    }

    if (
      isFluid &&
      nBlock.isOpaque &&
      !nBlock.isFluid &&
      !hasFluidAbove(vx, vy, vz, voxelId)
    ) {
      return true;
    }

    return false;
  }

  if (greedyMeshing) {
    const processedNonGreedy = new Set<string>();

    const greedyDirections: [number, number, number][] = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];

    for (const [dx, dy, dz] of greedyDirections) {
      const dir: Coords3 = [dx, dy, dz];

      const [axis, uAxis, vAxis] =
        dx !== 0 ? [0, 2, 1] : dy !== 0 ? [1, 0, 2] : [2, 0, 1];

      const sliceRange =
        axis === 0 ? [minX, maxX] : axis === 1 ? [minY, maxY] : [minZ, maxZ];

      const uRange =
        uAxis === 0 ? [minX, maxX] : uAxis === 1 ? [minY, maxY] : [minZ, maxZ];

      const vRange =
        vAxis === 0 ? [minX, maxX] : vAxis === 1 ? [minY, maxY] : [minZ, maxZ];

      for (let slice = sliceRange[0]; slice < sliceRange[1]; slice++) {
        const greedyMask = new Map<string, FaceData>();
        const nonGreedyFaces: {
          vx: number;
          vy: number;
          vz: number;
          voxelId: number;
          rotation: BlockRotation;
          block: NonNullable<ReturnType<typeof registry.blocksById.get>>;
          face: NonNullable<
            ReturnType<typeof registry.blocksById.get>
          >["faces"][0];
          uvRange: UV;
          isSeeThrough: boolean;
          isFluid: boolean;
        }[] = [];

        for (let u = uRange[0]; u < uRange[1]; u++) {
          for (let v = vRange[0]; v < vRange[1]; v++) {
            const [vx, vy, vz] =
              axis === 0 && uAxis === 2 && vAxis === 1
                ? [slice, v, u]
                : axis === 1 && uAxis === 0 && vAxis === 2
                ? [u, slice, v]
                : [u, v, slice];

            const voxelId = getVoxelAt(vx, vy, vz);
            if (!registry.blocksById.has(voxelId)) {
              continue;
            }

            const rotation = getVoxelRotationAt(vx, vy, vz);
            const block = registry.blocksById.get(voxelId)!;

            if (block.isEmpty) {
              continue;
            }

            if (block.isOpaque) {
              const allNeighborsOpaque = VOXEL_NEIGHBORS.every(
                ([nx, ny, nz]) => {
                  const id = getVoxelAt(vx + nx, vy + ny, vz + nz);
                  return (
                    registry.blocksById.has(id) &&
                    registry.blocksById.get(id)!.isOpaque
                  );
                }
              );
              if (allNeighborsOpaque) {
                continue;
              }
            }

            const isFluid = block.isFluid;
            const isSeeThrough = block.isSeeThrough;

            let faces = block.faces;
            if (isFluid) {
              faces = createFluidFaces(vx, vy, vz, block.id, block.faces);
            } else if (block.dynamicPatterns) {
              faces = [];
              let patternsMatched = false;
              for (const dynamicPattern of block.dynamicPatterns) {
                for (const part of dynamicPattern.parts) {
                  const partMatched = BlockUtils.evaluateBlockRule(
                    part.rule,
                    [vx, vy, vz],
                    { getVoxelAt, getVoxelRotationAt, getVoxelStageAt }
                  );
                  if (partMatched) {
                    patternsMatched = true;
                    faces = [...faces, ...part.faces];
                  }
                }
                if (patternsMatched) break;
              }
            }

            const isNonGreedyBlock = !canGreedyMeshBlock(block, rotation);

            if (isNonGreedyBlock) {
              const key = `${vx},${vy},${vz}`;
              if (processedNonGreedy.has(key)) {
                continue;
              }
              processedNonGreedy.add(key);

              for (const face of faces) {
                nonGreedyFaces.push({
                  vx,
                  vy,
                  vz,
                  voxelId,
                  rotation,
                  block,
                  face,
                  uvRange: face.range,
                  isSeeThrough,
                  isFluid,
                });
              }
              continue;
            }

            const matchingFaces = faces.filter((f) => {
              const faceDir: Coords3 = [f.dir[0], f.dir[1], f.dir[2]];
              if (block.rotatable || block.yRotatable) {
                rotation.rotateNode(faceDir, block.yRotatable, false);
              }
              const effectiveDir: Coords3 = [
                Math.round(faceDir[0]),
                Math.round(faceDir[1]),
                Math.round(faceDir[2]),
              ];
              return (
                effectiveDir[0] === dir[0] &&
                effectiveDir[1] === dir[1] &&
                effectiveDir[2] === dir[2]
              );
            });

            if (matchingFaces.length === 0) {
              continue;
            }

            const shouldRender = shouldRenderFace(
              vx,
              vy,
              vz,
              voxelId,
              dir,
              block,
              isSeeThrough,
              isFluid
            );

            if (!shouldRender) {
              continue;
            }

            for (const face of matchingFaces) {
              const uvRange = face.range;

              if (face.isolated) {
                nonGreedyFaces.push({
                  vx,
                  vy,
                  vz,
                  voxelId,
                  rotation,
                  block,
                  face,
                  uvRange,
                  isSeeThrough,
                  isFluid,
                });
                continue;
              }

              const { aos, lights } = computeFaceAoAndLight(
                vx,
                vy,
                vz,
                dir,
                block
              );

              const key: FaceKey = {
                blockId: block.id,
                faceName: face.name,
                independent: face.independent,
                ao: aos,
                light: lights,
                uvStartU: Math.round(uvRange.startU * 1000000),
                uvEndU: Math.round(uvRange.endU * 1000000),
                uvStartV: Math.round(uvRange.startV * 1000000),
                uvEndV: Math.round(uvRange.endV * 1000000),
              };

              const data: FaceData = {
                key,
                uvRange,
                isSeeThrough,
                isFluid,
              };

              greedyMask.set(`${u},${v}`, data);
            }
          }
        }

        const quads = extractGreedyQuads(
          greedyMask,
          uRange[0],
          uRange[1],
          vRange[0],
          vRange[1]
        );

        for (const quad of quads) {
          const block = registry.blocksById.get(quad.data.key.blockId)!;
          const geoKey = quad.data.key.independent
            ? `${block.name.toLowerCase()}::${quad.data.key.faceName.toLowerCase()}`
            : block.name.toLowerCase();

          if (!geometries[geoKey]) {
            geometries[geoKey] = {
              voxel: quad.data.key.blockId,
              positions: [],
              uvs: [],
              indices: [],
              lights: [],
            };
            if (quad.data.key.independent) {
              geometries[geoKey].faceName = quad.data.key.faceName;
            }
          }

          processGreedyQuad(
            quad,
            axis,
            uAxis,
            vAxis,
            slice,
            dir,
            [minX, minY, minZ],
            block,
            geometries[geoKey]
          );
        }

        for (const {
          vx,
          vy,
          vz,
          voxelId,
          rotation,
          block,
          face,
          uvRange,
          isSeeThrough,
          isFluid,
        } of nonGreedyFaces) {
          const geoKey = face.isolated
            ? `${block.name.toLowerCase()}::${face.name.toLowerCase()}::${vx}-${vy}-${vz}`
            : face.independent
            ? `${block.name.toLowerCase()}::${face.name.toLowerCase()}`
            : block.name.toLowerCase();

          if (!geometries[geoKey]) {
            geometries[geoKey] = {
              voxel: voxelId,
              positions: [],
              uvs: [],
              indices: [],
              lights: [],
            };
            if (face.independent || face.isolated) {
              geometries[geoKey].faceName = face.name;
            }
            if (face.isolated) {
              geometries[geoKey].at = [vx, vy, vz];
            }
          }

          const geometry = geometries[geoKey];
          const { dir: faceDir, corners } = face;
          const fDir: Coords3 = [...faceDir] as Coords3;

          if (block.rotatable || block.yRotatable) {
            rotation.rotateNode(fDir, block.yRotatable, false);
          }

          fDir[0] = Math.round(fDir[0]);
          fDir[1] = Math.round(fDir[1]);
          fDir[2] = Math.round(fDir[2]);

          const nvx = vx + fDir[0];
          const nvy = vy + fDir[1];
          const nvz = vz + fDir[2];

          const neighborId = getVoxelAt(nvx, nvy, nvz);
          const nCoords = ChunkUtils.mapVoxelToChunk(
            [nvx, nvy, nvz],
            chunkSize
          );
          const nIsVoid = !getChunkByCoords(nCoords);
          const nBlock = registry.blocksById.get(neighborId);

          if (!nBlock) {
            continue;
          }

          let aabbs = block.aabbs;
          if (isFluid) {
            const fluidFaces = createFluidFaces(
              vx,
              vy,
              vz,
              block.id,
              block.faces
            );
            const maxHeight = Math.max(
              ...fluidFaces[0].corners.map((c) => c.pos[1])
            );
            aabbs = [new AABB(0, 0, 0, 1, maxHeight, 1)];
          }

          let seeThroughCheck = false;
          if (isSeeThrough && !block.isOpaque && nBlock.isOpaque) {
            let selfBounding = aabbs[0] || new AABB(0, 0, 0, 1, 1, 1);
            let nBounding = nBlock.aabbs[0] || new AABB(0, 0, 0, 1, 1, 1);
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
            const translatedBounding = new AABB(
              nBounding.minX + fDir[0],
              nBounding.minY + fDir[1],
              nBounding.minZ + fDir[2],
              nBounding.maxX + fDir[0],
              nBounding.maxY + fDir[1],
              nBounding.maxZ + fDir[2]
            );
            const intersects = !(
              translatedBounding.maxX < selfBounding.minX ||
              translatedBounding.minX > selfBounding.maxX ||
              translatedBounding.maxY < selfBounding.minY ||
              translatedBounding.minY > selfBounding.maxY ||
              translatedBounding.maxZ < selfBounding.minZ ||
              translatedBounding.minZ > selfBounding.maxZ
            );
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
            nIsVoid ||
            nBlock.isEmpty ||
            (isSeeThrough &&
              !block.isOpaque &&
              !nBlock.isOpaque &&
              ((isSeeThrough &&
                neighborId === voxelId &&
                nBlock.transparentStandalone) ||
                (neighborId !== voxelId &&
                  (isSeeThrough || nBlock.isSeeThrough)) ||
                seeThroughCheck)) ||
            (!isSeeThrough && (!block.isOpaque || !nBlock.isOpaque)) ||
            (isFluid &&
              nBlock.isOpaque &&
              !nBlock.isFluid &&
              !hasFluidAbove(vx, vy, vz, voxelId))
          ) {
            const { startU, startV, endU, endV } = uvRange;
            const ndx = Math.floor(geometry.positions.length / 3);

            const faceAOs: number[] = [];
            const fourLights: number[][] = [[], [], [], []];

            const blockAabb = AABB.union(aabbs);

            const isAllTransparent =
              block.isTransparent[0] &&
              block.isTransparent[1] &&
              block.isTransparent[2] &&
              block.isTransparent[3] &&
              block.isTransparent[4] &&
              block.isTransparent[5];

            for (const { pos: cornerPos, uv } of corners) {
              const pos = [...cornerPos] as Coords3;

              if (block.rotatable || block.yRotatable) {
                rotation.rotateNode(pos, block.yRotatable, true);
              }

              const posX = vx + pos[0];
              const posY = vy + pos[1];
              const posZ = vz + pos[2];

              const scale = block.isOpaque ? 0.0 : 0.0001;
              geometry.positions.push(
                posX - minX - fDir[0] * scale,
                posY - minY - fDir[1] * scale,
                posZ - minZ - fDir[2] * scale
              );

              geometry.uvs.push(
                uv[0] * (endU - startU) + startU,
                uv[1] * (endV - startV) + startV
              );

              const unitDx = pos[0] <= blockAabb.minX + 0.01 ? -1 : 1;
              const unitDy = pos[1] <= blockAabb.minY + 0.01 ? -1 : 1;
              const unitDz = pos[2] <= blockAabb.minZ + 0.01 ? -1 : 1;

              const b011Id = getVoxelAt(vx + 0, vy + unitDy, vz + unitDz);
              const b101Id = getVoxelAt(vx + unitDx, vy + 0, vz + unitDz);
              const b110Id = getVoxelAt(vx + unitDx, vy + unitDy, vz + 0);
              const b111Id = getVoxelAt(vx + unitDx, vy + unitDy, vz + unitDz);

              const b011 = !registry.blocksById.get(b011Id)?.isOpaque;
              const b101 = !registry.blocksById.get(b101Id)?.isOpaque;
              const b110 = !registry.blocksById.get(b110Id)?.isOpaque;
              const b111 = !registry.blocksById.get(b111Id)?.isOpaque;

              const ao =
                isSeeThrough || isAllTransparent
                  ? 3
                  : Math.abs(fDir[0]) === 1
                  ? vertexAO(b110, b101, b111)
                  : Math.abs(fDir[1]) === 1
                  ? vertexAO(b110, b011, b111)
                  : vertexAO(b011, b101, b111);

              const lightValues = calculateLightValues(
                vx,
                vy,
                vz,
                unitDx,
                unitDy,
                unitDz,
                fDir,
                isSeeThrough,
                isAllTransparent
              );

              let light = 0;
              light = LightUtils.insertRedLight(light, lightValues.red);
              light = LightUtils.insertGreenLight(light, lightValues.green);
              light = LightUtils.insertBlueLight(light, lightValues.blue);
              light = LightUtils.insertSunlight(light, lightValues.sun);
              const fluidBit = isFluid ? 1 << 18 : 0;
              geometry.lights.push(Math.floor(light) | (ao << 16) | fluidBit);

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
            const fEquals = faceAOs[0] + faceAOs[3] === faceAOs[1] + faceAOs[2];
            const ozaoR = aRt + dRt < bRt + cRt && fEquals;
            const ozaoG = aGt + dGt < bGt + cGt && fEquals;
            const ozaoB = aBt + dBt < bBt + cBt && fEquals;
            const anzp1R =
              (bRt > (aRt + dRt) / 2.0 && (aRt + dRt) / 2.0 > cRt) ||
              (cRt > (aRt + dRt) / 2.0 && (aRt + dRt) / 2.0 > bRt);
            const anzp1G =
              (bGt > (aGt + dGt) / 2.0 && (aGt + dGt) / 2.0 > cGt) ||
              (cGt > (aGt + dGt) / 2.0 && (aGt + dGt) / 2.0 > bGt);
            const anzp1B =
              (bBt > (aBt + dBt) / 2.0 && (aBt + dBt) / 2.0 > cBt) ||
              (cBt > (aBt + dBt) / 2.0 && (aBt + dBt) / 2.0 > bBt);
            const anzR = oneTr0 && anzp1R;
            const anzG = oneTg0 && anzp1G;
            const anzB = oneTb0 && anzp1B;

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
              geometry.indices.push(ndx + 3);
              geometry.indices.push(ndx + 3);
              geometry.indices.push(ndx + 2);
              geometry.indices.push(ndx);
            } else {
              geometry.indices.push(ndx + 2);
              geometry.indices.push(ndx + 2);
              geometry.indices.push(ndx + 1);
              geometry.indices.push(ndx + 3);
            }
          }
        }
      }
    }
  } else {
    for (let vx = minX; vx < maxX; vx++) {
      for (let vz = minZ; vz < maxZ; vz++) {
        for (let vy = minY; vy < maxY; vy++) {
          const voxel = getVoxelAt(vx, vy, vz);
          const rotation = getVoxelRotationAt(vx, vy, vz);
          const block = registry.blocksById.get(voxel);

          if (!block) {
            continue;
          }

          const {
            id,
            isSeeThrough,
            isEmpty,
            isOpaque,
            isFluid,
            name,
            rotatable,
            yRotatable,
            isDynamic,
            dynamicPatterns,
            isTransparent,
          } = block;

          let aabbs = block.aabbs;
          let faces = block.faces;

          if (isEmpty || faces.length === 0) {
            continue;
          }

          if (isFluid) {
            const fluidFaces = createFluidFaces(vx, vy, vz, id, block.faces);
            const maxHeight = Math.max(
              ...fluidFaces[0].corners.map((c) => c.pos[1])
            );
            faces = fluidFaces as typeof faces;
            aabbs = [new AABB(0, 0, 0, 1, maxHeight, 1)];
          } else if (dynamicPatterns) {
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

            if (!nBlock) {
              continue;
            }

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
              nIsVoid ||
              nBlock.isEmpty ||
              (isSeeThrough &&
                !isOpaque &&
                !nBlock.isOpaque &&
                ((isSeeThrough &&
                  neighborId == id &&
                  nBlock.transparentStandalone) ||
                  (neighborId != id && (isSeeThrough || nBlock.isSeeThrough)) ||
                  seeThroughCheck)) ||
              (!isSeeThrough && (!isOpaque || !nBlock.isOpaque)) ||
              (isFluid &&
                nBlock.isOpaque &&
                !nBlock.isFluid &&
                !hasFluidAbove(vx, vy, vz, id))
            ) {
              const { startU, startV, endU, endV } = uvMap[face.name];
              const ndx = Math.floor(geometry.positions.length / 3);

              const faceAOs: number[] = [];
              const fourLights: number[][] = [[], [], [], []];

              const blockAabb = AABB.union(aabbs);

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

                const unitDx = pos[0] <= blockAabb.minX + 0.01 ? -1 : 1;
                const unitDy = pos[1] <= blockAabb.minY + 0.01 ? -1 : 1;
                const unitDz = pos[2] <= blockAabb.minZ + 0.01 ? -1 : 1;

                const b011Id = getVoxelAt(vx + 0, vy + unitDy, vz + unitDz);
                const b101Id = getVoxelAt(vx + unitDx, vy + 0, vz + unitDz);
                const b110Id = getVoxelAt(vx + unitDx, vy + unitDy, vz + 0);
                const b111Id = getVoxelAt(
                  vx + unitDx,
                  vy + unitDy,
                  vz + unitDz
                );

                const b011 = !registry.blocksById.get(b011Id)?.isOpaque;
                const b101 = !registry.blocksById.get(b101Id)?.isOpaque;
                const b110 = !registry.blocksById.get(b110Id)?.isOpaque;
                const b111 = !registry.blocksById.get(b111Id)?.isOpaque;

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
                  unitDx,
                  unitDy,
                  unitDz,
                  dir,
                  isSeeThrough,
                  isAllTransparent
                );

                let light = 0;
                light = LightUtils.insertRedLight(light, lightValues.red);
                light = LightUtils.insertGreenLight(light, lightValues.green);
                light = LightUtils.insertBlueLight(light, lightValues.blue);
                light = LightUtils.insertSunlight(light, lightValues.sun);
                const fluidBit = isFluid ? 1 << 18 : 0;
                geometry.lights.push(Math.floor(light) | (ao << 16) | fluidBit);

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
              const fEquals =
                faceAOs[0] + faceAOs[3] == faceAOs[1] + faceAOs[2];
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
