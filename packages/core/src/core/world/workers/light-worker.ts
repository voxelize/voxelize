import { Coords3 } from "../../../types";
import { BlockUtils } from "../../../utils/block-utils";
import { ChunkUtils } from "../../../utils/chunk-utils";
import { LightColor, LightUtils } from "../../../utils/light-utils";
import { Block, BlockRotation } from "../block";
import type { LightNode, VoxelDelta, WorldOptions } from "../index";
import { RawChunk } from "../raw-chunk";
import { Registry } from "../registry";

let registry: Registry;

const VOXEL_NEIGHBORS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [0, 1, 0],
  [0, -1, 0],
];

const ALL_TRANSPARENT = [true, true, true, true, true, true];

interface VoxelAccess {
  getVoxelAt(vx: number, vy: number, vz: number): number;
  getVoxelRotationAt(vx: number, vy: number, vz: number): BlockRotation;
  getVoxelStageAt(vx: number, vy: number, vz: number): number;
  getSunlightAt(vx: number, vy: number, vz: number): number;
  getTorchLightAt(
    vx: number,
    vy: number,
    vz: number,
    color: LightColor
  ): number;
  setSunlightAt(vx: number, vy: number, vz: number, level: number): void;
  setTorchLightAt(
    vx: number,
    vy: number,
    vz: number,
    level: number,
    color: LightColor
  ): void;
  markChunkModified(cx: number, cz: number): void;
}

class BoundedSpace implements VoxelAccess {
  private chunkCache = new Map<number, RawChunk | null>();
  private modifiedChunks = new Set<RawChunk>();

  constructor(
    private chunkGrid: (RawChunk | null)[][],
    private gridWidth: number,
    private gridDepth: number,
    private gridOffsetX: number,
    private gridOffsetZ: number,
    private chunkSize: number
  ) {}

  private hashChunkCoords(cx: number, cz: number): number {
    return ((cx * 73856093) ^ (cz * 83492791)) >>> 0;
  }

  private getChunkByCoords(cx: number, cz: number): RawChunk | null {
    const localX = cx - this.gridOffsetX;
    const localZ = cz - this.gridOffsetZ;

    if (
      localX < 0 ||
      localX >= this.gridWidth ||
      localZ < 0 ||
      localZ >= this.gridDepth
    ) {
      return null;
    }

    return this.chunkGrid[localX][localZ];
  }

  private getCachedChunk(cx: number, cz: number): RawChunk | null {
    const key = this.hashChunkCoords(cx, cz);
    let chunk = this.chunkCache.get(key);
    if (chunk === undefined) {
      chunk = this.getChunkByCoords(cx, cz);
      this.chunkCache.set(key, chunk);
    }
    return chunk;
  }

  getVoxelAt(vx: number, vy: number, vz: number): number {
    const [cx, cz] = ChunkUtils.mapVoxelToChunk([vx, vy, vz], this.chunkSize);
    const chunk = this.getCachedChunk(cx, cz);
    return chunk?.getVoxel(vx, vy, vz) ?? 0;
  }

  getVoxelRotationAt(vx: number, vy: number, vz: number): BlockRotation {
    const [cx, cz] = ChunkUtils.mapVoxelToChunk([vx, vy, vz], this.chunkSize);
    const chunk = this.getCachedChunk(cx, cz);
    return chunk?.getVoxelRotation(vx, vy, vz) ?? new BlockRotation();
  }

  getVoxelStageAt(vx: number, vy: number, vz: number): number {
    const [cx, cz] = ChunkUtils.mapVoxelToChunk([vx, vy, vz], this.chunkSize);
    const chunk = this.getCachedChunk(cx, cz);
    return chunk?.getVoxelStage(vx, vy, vz) ?? 0;
  }

  getSunlightAt(vx: number, vy: number, vz: number): number {
    const [cx, cz] = ChunkUtils.mapVoxelToChunk([vx, vy, vz], this.chunkSize);
    const chunk = this.getCachedChunk(cx, cz);
    return chunk?.getSunlight(vx, vy, vz) ?? 0;
  }

  getTorchLightAt(
    vx: number,
    vy: number,
    vz: number,
    color: LightColor
  ): number {
    const [cx, cz] = ChunkUtils.mapVoxelToChunk([vx, vy, vz], this.chunkSize);
    const chunk = this.getCachedChunk(cx, cz);
    return chunk?.getTorchLight(vx, vy, vz, color) ?? 0;
  }

  setSunlightAt(vx: number, vy: number, vz: number, level: number): void {
    const [cx, cz] = ChunkUtils.mapVoxelToChunk([vx, vy, vz], this.chunkSize);
    const chunk = this.getCachedChunk(cx, cz);
    if (chunk) {
      chunk.setSunlight(vx, vy, vz, level);
      this.modifiedChunks.add(chunk);
    }
  }

  setTorchLightAt(
    vx: number,
    vy: number,
    vz: number,
    level: number,
    color: LightColor
  ): void {
    const [cx, cz] = ChunkUtils.mapVoxelToChunk([vx, vy, vz], this.chunkSize);
    const chunk = this.getCachedChunk(cx, cz);
    if (chunk) {
      chunk.setTorchLight(vx, vy, vz, level, color);
      this.modifiedChunks.add(chunk);
    }
  }

  markChunkModified(cx: number, cz: number): void {
    const chunk = this.getCachedChunk(cx, cz);
    if (chunk) {
      this.modifiedChunks.add(chunk);
    }
  }

  getModifiedChunks(): RawChunk[] {
    return Array.from(this.modifiedChunks);
  }
}

function floodLight(
  space: VoxelAccess,
  queue: LightNode[],
  color: LightColor,
  min: Coords3 | undefined,
  max: Coords3 | undefined,
  options: WorldOptions
) {
  const { maxHeight, minChunk, maxChunk, maxLightLevel, chunkSize } = options;

  const [startCX, startCZ] = minChunk;
  const [endCX, endCZ] = maxChunk;

  const isSunlight = color === "SUNLIGHT";

  const blockCache = new Map<number, Block>();
  const rotationCache = new Map<number, BlockRotation>();

  const hashCoords = (vx: number, vy: number, vz: number): number => {
    return ((vx * 73856093) ^ (vy * 19349663) ^ (vz * 83492791)) >>> 0;
  };

  const getCachedBlock = (vx: number, vy: number, vz: number): Block => {
    const key = hashCoords(vx, vy, vz);
    let block = blockCache.get(key);
    if (!block) {
      const id = space.getVoxelAt(vx, vy, vz);
      block = registry.blocksById.get(id)!;
      blockCache.set(key, block);
    }
    return block;
  };

  const getCachedRotation = (
    vx: number,
    vy: number,
    vz: number
  ): BlockRotation => {
    const key = hashCoords(vx, vy, vz);
    let rotation = rotationCache.get(key);
    if (!rotation) {
      rotation = space.getVoxelRotationAt(vx, vy, vz);
      rotationCache.set(key, rotation);
    }
    return rotation;
  };

  for (let i = 0; i < queue.length; i++) {
    const { voxel, level } = queue[i];

    if (level === 0) {
      continue;
    }

    const [vx, vy, vz] = voxel;
    const sourceBlock = getCachedBlock(vx, vy, vz);
    const sourceRotation = getCachedRotation(vx, vy, vz);
    const sourceTransparency =
      !isSunlight && BlockUtils.getBlockTorchLightLevel(sourceBlock, color) > 0
        ? ALL_TRANSPARENT
        : BlockUtils.getBlockRotatedTransparency(sourceBlock, sourceRotation);

    for (const [ox, oy, oz] of VOXEL_NEIGHBORS) {
      const nvy = vy + oy;

      if (nvy < 0 || nvy >= maxHeight) {
        continue;
      }

      const nvx = vx + ox;
      const nvz = vz + oz;

      const [ncx, ncz] = ChunkUtils.mapVoxelToChunk([nvx, nvy, nvz], chunkSize);

      if (
        ncx < startCX ||
        ncx > endCX ||
        ncz < startCZ ||
        ncz > endCZ ||
        (min && (nvx < min[0] || nvz < min[2])) ||
        (max && (nvx >= max[0] || nvz >= max[2]))
      ) {
        continue;
      }

      const nextVoxel: Coords3 = [nvx, nvy, nvz];
      const nBlock = getCachedBlock(nvx, nvy, nvz);
      const nRotation = getCachedRotation(nvx, nvy, nvz);
      const nTransparency = BlockUtils.getBlockRotatedTransparency(
        nBlock,
        nRotation
      );
      const reduce =
        isSunlight &&
        !nBlock.lightReduce &&
        oy === -1 &&
        level === maxLightLevel
          ? 0
          : 1;

      if (level <= reduce) {
        continue;
      }

      const nextLevel = level - reduce;

      if (
        !LightUtils.canEnter(sourceTransparency, nTransparency, ox, oy, oz) ||
        (isSunlight
          ? space.getSunlightAt(nvx, nvy, nvz)
          : space.getTorchLightAt(nvx, nvy, nvz, color)) >= nextLevel
      ) {
        continue;
      }

      if (isSunlight) {
        space.setSunlightAt(nvx, nvy, nvz, nextLevel);
      } else {
        space.setTorchLightAt(nvx, nvy, nvz, nextLevel, color);
      }

      queue.push({ voxel: nextVoxel, level: nextLevel });
    }
  }
}

function removeLight(
  space: VoxelAccess,
  voxel: Coords3,
  color: LightColor,
  options: WorldOptions
): LightNode[] {
  const { maxHeight, maxLightLevel } = options;

  const fill: LightNode[] = [];
  const queue: LightNode[] = [];

  const isSunlight = color === "SUNLIGHT";
  const [vx, vy, vz] = voxel;

  queue.push({
    voxel,
    level: isSunlight
      ? space.getSunlightAt(vx, vy, vz)
      : space.getTorchLightAt(vx, vy, vz, color),
  });

  if (isSunlight) {
    space.setSunlightAt(vx, vy, vz, 0);
  } else {
    space.setTorchLightAt(vx, vy, vz, 0, color);
  }

  for (let i = 0; i < queue.length; i++) {
    const { voxel, level } = queue[i];
    const [vx, vy, vz] = voxel;

    for (const [ox, oy, oz] of VOXEL_NEIGHBORS) {
      const nvy = vy + oy;

      if (nvy < 0 || nvy >= maxHeight) {
        continue;
      }

      const nvx = vx + ox;
      const nvz = vz + oz;

      const nBlockId = space.getVoxelAt(nvx, nvy, nvz);
      const nBlock = registry.blocksById.get(nBlockId)!;
      const rotation = space.getVoxelRotationAt(nvx, nvy, nvz);
      const nTransparency = BlockUtils.getBlockRotatedTransparency(
        nBlock,
        rotation
      );

      if (
        (isSunlight
          ? true
          : BlockUtils.getBlockTorchLightLevel(nBlock, color) === 0) &&
        !LightUtils.canEnterInto(nTransparency, ox, oy, oz)
      ) {
        continue;
      }

      const nVoxel: Coords3 = [nvx, nvy, nvz];
      const nl = isSunlight
        ? space.getSunlightAt(nvx, nvy, nvz)
        : space.getTorchLightAt(nvx, nvy, nvz, color);

      if (nl === 0) {
        continue;
      }

      if (
        nl < level ||
        (isSunlight &&
          oy === -1 &&
          level === maxLightLevel &&
          nl === maxLightLevel)
      ) {
        queue.push({ voxel: nVoxel, level: nl });

        if (isSunlight) {
          space.setSunlightAt(nvx, nvy, nvz, 0);
        } else {
          space.setTorchLightAt(nvx, nvy, nvz, 0, color);
        }
      } else if (isSunlight && oy === -1 ? nl > level : nl >= level) {
        fill.push({ voxel: nVoxel, level: nl });
      }
    }
  }

  return fill;
}

function removeLightsBatch(
  space: VoxelAccess,
  voxels: Coords3[],
  color: LightColor,
  options: WorldOptions
): LightNode[] {
  if (!voxels.length) return [];

  const { maxHeight, maxLightLevel } = options;

  const fill: LightNode[] = [];
  const queue: LightNode[] = [];

  const isSunlight = color === "SUNLIGHT";

  voxels.forEach(([vx, vy, vz]) => {
    const level = isSunlight
      ? space.getSunlightAt(vx, vy, vz)
      : space.getTorchLightAt(vx, vy, vz, color);
    if (level === 0) return;

    queue.push({ voxel: [vx, vy, vz], level });
    if (isSunlight) {
      space.setSunlightAt(vx, vy, vz, 0);
    } else {
      space.setTorchLightAt(vx, vy, vz, 0, color);
    }
  });

  for (let i = 0; i < queue.length; i++) {
    const { voxel, level } = queue[i];
    const [vx, vy, vz] = voxel;

    for (const [ox, oy, oz] of VOXEL_NEIGHBORS) {
      const nvy = vy + oy;
      if (nvy < 0 || nvy >= maxHeight) continue;

      const nvx = vx + ox;
      const nvz = vz + oz;

      const nBlockId = space.getVoxelAt(nvx, nvy, nvz);
      const nBlock = registry.blocksById.get(nBlockId)!;
      const rotation = space.getVoxelRotationAt(nvx, nvy, nvz);
      const nTransparency = BlockUtils.getBlockRotatedTransparency(
        nBlock,
        rotation
      );

      if (
        (isSunlight
          ? true
          : BlockUtils.getBlockTorchLightLevel(nBlock, color) === 0) &&
        !LightUtils.canEnterInto(nTransparency, ox, oy, oz)
      ) {
        continue;
      }

      const nl = isSunlight
        ? space.getSunlightAt(nvx, nvy, nvz)
        : space.getTorchLightAt(nvx, nvy, nvz, color);
      if (nl === 0) continue;

      if (
        nl < level ||
        (isSunlight &&
          oy === -1 &&
          level === maxLightLevel &&
          nl === maxLightLevel)
      ) {
        queue.push({ voxel: [nvx, nvy, nvz], level: nl });
        if (isSunlight) {
          space.setSunlightAt(nvx, nvy, nvz, 0);
        } else {
          space.setTorchLightAt(nvx, nvy, nvz, 0, color);
        }
      } else if (isSunlight && oy === -1 ? nl > level : nl >= level) {
        fill.push({ voxel: [nvx, nvy, nvz], level: nl });
      }
    }
  }

  return fill;
}

onmessage = function (e) {
  const { type } = e.data;

  if (type === "init") {
    registry = Registry.deserialize(e.data.registryData);
    return;
  }

  if (type === "batchOperations") {
    const {
      jobId,
      color,
      boundingBox,
      chunksData,
      chunkGridDimensions,
      chunkGridOffset,
      relevantDeltas,
      lightOps,
      options,
    } = e.data;

    const [gridWidth, gridDepth] = chunkGridDimensions;
    const [gridOffsetX, gridOffsetZ] = chunkGridOffset;

    const chunkGrid: (RawChunk | null)[][] = [];
    let idx = 0;
    for (let x = 0; x < gridWidth; x++) {
      chunkGrid[x] = [];
      for (let z = 0; z < gridDepth; z++) {
        const data = chunksData[idx++];
        chunkGrid[x][z] = data ? RawChunk.deserialize(data) : null;
      }
    }

    let lastSequenceId = 0;
    Object.entries(relevantDeltas).forEach(([chunkName, deltas]) => {
      const [cx, cz] = ChunkUtils.parseChunkName(chunkName);
      const localX = cx - gridOffsetX;
      const localZ = cz - gridOffsetZ;

      if (
        localX < 0 ||
        localX >= gridWidth ||
        localZ < 0 ||
        localZ >= gridDepth
      ) {
        return;
      }

      const chunk = chunkGrid[localX][localZ];
      if (!chunk) return;

      (deltas as VoxelDelta[]).forEach((delta) => {
        const { coords, newVoxel, newRotation, newStage, sequenceId } = delta;
        chunk.setVoxel(coords[0], coords[1], coords[2], newVoxel);
        if (newRotation)
          chunk.setVoxelRotation(coords[0], coords[1], coords[2], newRotation);
        if (newStage !== undefined)
          chunk.setVoxelStage(coords[0], coords[1], coords[2], newStage);
        lastSequenceId = Math.max(lastSequenceId, sequenceId);
      });
    });

    const space = new BoundedSpace(
      chunkGrid,
      gridWidth,
      gridDepth,
      gridOffsetX,
      gridOffsetZ,
      options.chunkSize
    );

    const { min, shape } = boundingBox;
    const maxCoords: Coords3 = [
      min[0] + shape[0],
      min[1] + shape[1],
      min[2] + shape[2],
    ];

    if (lightOps.removals.length > 0) {
      const fillQueue = removeLightsBatch(
        space,
        lightOps.removals,
        color,
        options
      );
      if (fillQueue.length > 0) {
        floodLight(space, fillQueue, color, min, maxCoords, options);
      }
    }

    if (lightOps.floods.length > 0) {
      lightOps.floods.forEach((node) => {
        const [vx, vy, vz] = node.voxel;
        if (color === "SUNLIGHT") {
          space.setSunlightAt(vx, vy, vz, node.level);
        } else {
          space.setTorchLightAt(vx, vy, vz, node.level, color);
        }
      });

      floodLight(space, lightOps.floods, color, min, maxCoords, options);
    }

    const modifiedChunks = space.getModifiedChunks();

    postMessage(
      {
        jobId,
        modifiedChunks: modifiedChunks.map((chunk) => ({
          coords: chunk.coords,
          lights: chunk.lights.data,
        })),
        appliedDeltas: { lastSequenceId },
      },
      {
        transfer: modifiedChunks.map((c) => c.lights.data.buffer),
      }
    );
  }
};
