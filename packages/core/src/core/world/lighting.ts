import { Coords2, Coords3 } from "../../types";
import {
  BLUE_LIGHT,
  BlockUtils,
  ChunkUtils,
  GREEN_LIGHT,
  LightColor,
  LightUtils,
  RED_LIGHT,
  SUNLIGHT,
} from "../../utils";

import { Block, BlockRotation } from "./block";
import { Chunk } from "./chunk";

export type LightNode = {
  voxel: Coords3;
  level: number;
};

export type BoundingBox = {
  min: Coords3;
  shape: Coords3;
};

export type LightJob = {
  jobId: string;
  color: LightColor;
  lightOps: {
    removals: Coords3[];
    floods: LightNode[];
  };
  boundingBox: BoundingBox;
  startSequenceId: number;
  retryCount: number;
  batchId: number;
};

export type LightBatchResult = {
  color: LightColor;
  modifiedChunks: LightWorkerModifiedChunk[];
  boundingBox: BoundingBox;
};

export type LightBatch = {
  batchId: number;
  startSequenceId: number;
  totalJobs: number;
  completedJobs: number;
  results: LightBatchResult[];
  jobs: LightJob[];
  /**
   * Jobs of this batch that have not been handed to a worker yet. Dispatch
   * serializes every chunk the job's bounding box covers, so jobs wait here
   * as cheap descriptors instead of as multi-megabyte copies.
   */
  pendingDispatch: LightJob[];
};

export type LightOperations = {
  removals: {
    sunlight: Coords3[];
    red: Coords3[];
    green: Coords3[];
    blue: Coords3[];
  };
  floods: {
    sunlight: LightNode[];
    red: LightNode[];
    green: LightNode[];
    blue: LightNode[];
  };
  hasOperations: boolean;
};

export type ProcessedUpdate = {
  voxel: Coords3;
  oldId: number;
  newId: number;
  oldBlock: Block;
  newBlock: Block;
  oldRotation: BlockRotation;
  newRotation: BlockRotation;
  oldStage: number;
  stage: number;
};

export type LightWorkerResult = {
  jobId: string;
  modifiedChunks: LightWorkerModifiedChunk[];
  appliedDeltas: {
    lastSequenceId: number;
  };
};

export type LightWorkerModifiedChunk = {
  coords: Coords2;
  lights: Uint32Array;
  minY: number;
  maxY: number;
};

export const VOXEL_NEIGHBORS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [0, 1, 0],
  [0, -1, 0],
];

export type VoxelLightVolumeOptions = {
  chunkSize: number;
  maxHeight: number;
  maxLightLevel: number;
  minChunk: [number, number];
  maxChunk: [number, number];
};

/**
 * The narrow slice of the world that the client-side lighting algorithms
 * sense and mutate: voxel/block lookups plus light reads and writes. The
 * {@link World} satisfies this structurally, and tests can substitute a
 * plain in-memory implementation.
 */
export interface VoxelLightVolume {
  options: VoxelLightVolumeOptions;
  getBlockAt(px: number, py: number, pz: number): Block | null;
  getVoxelAt(px: number, py: number, pz: number): number;
  getVoxelRotationAt(px: number, py: number, pz: number): BlockRotation;
  getVoxelStageAt(px: number, py: number, pz: number): number;
  getSunlightAt(px: number, py: number, pz: number): number;
  setSunlightAt(px: number, py: number, pz: number, level: number): void;
  getTorchLightAt(
    px: number,
    py: number,
    pz: number,
    color: LightColor,
  ): number;
  setTorchLightAt(
    px: number,
    py: number,
    pz: number,
    level: number,
    color: LightColor,
  ): void;
}

export function floodLight(
  world: VoxelLightVolume,
  queue: LightNode[],
  color: LightColor,
  min?: Coords3,
  max?: Coords3,
) {
  if (!queue.length) {
    return;
  }

  const { maxHeight, minChunk, maxChunk, maxLightLevel, chunkSize } =
    world.options;

  const [startCX, startCZ] = minChunk;
  const [endCX, endCZ] = maxChunk;

  const isSunlight = color === "SUNLIGHT";

  const blockCache = new Map<string, Block | null>();
  const rotationCache = new Map<string, BlockRotation>();

  const getCachedBlock = (
    vx: number,
    vy: number,
    vz: number,
  ): Block | null => {
    const key = `${vx},${vy},${vz}`;
    let block = blockCache.get(key);
    if (block === undefined) {
      block = world.getBlockAt(vx, vy, vz);
      blockCache.set(key, block);
    }
    return block;
  };

  const getCachedRotation = (
    vx: number,
    vy: number,
    vz: number,
  ): BlockRotation => {
    const key = `${vx},${vy},${vz}`;
    let rotation = rotationCache.get(key);
    if (!rotation) {
      rotation = world.getVoxelRotationAt(vx, vy, vz);
      rotationCache.set(key, rotation);
    }
    return rotation;
  };

  // Compact processed prefixes away so a large flood's queue holds only
  // its live frontier, mirroring the light worker's guard.
  const queueCompactInterval = 8192;
  let head = 0;
  while (head < queue.length) {
    if (head >= queueCompactInterval) {
      queue.splice(0, head);
      head = 0;
    }
    const node = queue[head++];
    const { voxel, level } = node;

    if (level === 0) {
      continue;
    }

    const [vx, vy, vz] = voxel;
    const sourceBlock = getCachedBlock(vx, vy, vz);
    if (!sourceBlock) {
      continue;
    }
    const sourceRotation = getCachedRotation(vx, vy, vz);
    const sourceTransparency =
      !isSunlight && BlockUtils.getBlockTorchLightLevel(sourceBlock, color) > 0
        ? [true, true, true, true, true, true]
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

      const nextVoxel = [nvx, nvy, nvz] as Coords3;
      const nBlock = getCachedBlock(nvx, nvy, nvz);
      if (!nBlock) {
        continue;
      }
      const nRotation = getCachedRotation(nvx, nvy, nvz);
      const nTransparency = BlockUtils.getBlockRotatedTransparency(
        nBlock,
        nRotation,
      );
      const nextLevel = LightUtils.floodLightNextLevel(
        isSunlight,
        nBlock.lightAttenuation,
        oy,
        level,
        maxLightLevel,
      );

      if (nextLevel <= 0) {
        continue;
      }

      if (
        !LightUtils.canEnter(sourceTransparency, nTransparency, ox, oy, oz) ||
        (isSunlight
          ? world.getSunlightAt(nvx, nvy, nvz)
          : world.getTorchLightAt(nvx, nvy, nvz, color)) >= nextLevel
      ) {
        continue;
      }

      if (isSunlight) {
        world.setSunlightAt(nvx, nvy, nvz, nextLevel);
      } else {
        world.setTorchLightAt(nvx, nvy, nvz, nextLevel, color);
      }

      queue.push({ voxel: nextVoxel, level: nextLevel });
    }
  }
}

export function removeLight(
  world: VoxelLightVolume,
  voxel: Coords3,
  color: LightColor,
) {
  const { maxHeight, maxLightLevel, chunkSize, minChunk, maxChunk } =
    world.options;

  const fill: LightNode[] = [];
  const queue: LightNode[] = [];

  const isSunlight = color === "SUNLIGHT";
  const [vx, vy, vz] = voxel;

  queue.push({
    voxel,
    level: isSunlight
      ? world.getSunlightAt(vx, vy, vz)
      : world.getTorchLightAt(vx, vy, vz, color),
  });

  if (isSunlight) {
    world.setSunlightAt(vx, vy, vz, 0);
  } else {
    world.setTorchLightAt(vx, vy, vz, 0, color);
  }

  let iterationCount = 0;
  const startTime = performance.now();

  let head = 0;
  while (head < queue.length) {
    iterationCount++;
    const node = queue[head++];
    const { voxel, level } = node;

    const [vx, vy, vz] = voxel;

    for (const [ox, oy, oz] of VOXEL_NEIGHBORS) {
      const nvy = vy + oy;

      if (nvy < 0 || nvy >= maxHeight) {
        continue;
      }

      const nvx = vx + ox;
      const nvz = vz + oz;
      const [ncx, ncz] = ChunkUtils.mapVoxelToChunk([nvx, nvy, nvz], chunkSize);

      if (
        ncx < minChunk[0] ||
        ncz < minChunk[1] ||
        ncx > maxChunk[0] ||
        ncz > maxChunk[1]
      ) {
        continue;
      }

      const nBlock = world.getBlockAt(nvx, nvy, nvz);
      if (!nBlock) {
        continue;
      }
      const rotation = world.getVoxelRotationAt(nvx, nvy, nvz);
      const nTransparency = BlockUtils.getBlockRotatedTransparency(
        nBlock,
        rotation,
      );

      if (
        (isSunlight
          ? true
          : BlockUtils.getBlockTorchLightLevel(nBlock, color) === 0) &&
        !LightUtils.canEnterInto(nTransparency, ox, oy, oz)
      ) {
        continue;
      }

      const nVoxel = [nvx, nvy, nvz] as Coords3;
      const nl = isSunlight
        ? world.getSunlightAt(nvx, nvy, nvz)
        : world.getTorchLightAt(nvx, nvy, nvz, color);

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
          world.setSunlightAt(nvx, nvy, nvz, 0);
        } else {
          world.setTorchLightAt(nvx, nvy, nvz, 0, color);
        }
      } else if (isSunlight && oy === -1 ? nl > level : nl >= level) {
        fill.push({ voxel: nVoxel, level: nl });
      }
    }
  }

  const endTime = performance.now();
  console.log(
    `removeLight executed in ${
      endTime - startTime
    }ms with ${iterationCount} iterations, color: ${color}`,
  );

  floodLight(world, fill, color);
}

/**
 * Batch remove light from multiple voxels that previously emitted the same light color.
 * This drastically improves performance when many contiguous light sources are removed at once.
 */
export function removeLightsBatch(
  world: VoxelLightVolume,
  voxels: Coords3[],
  color: LightColor,
) {
  if (!voxels.length) return;

  const { maxHeight, maxLightLevel } = world.options;
  const isSunlight = color === "SUNLIGHT";

  const queue: LightNode[] = [];
  const fill: LightNode[] = [];

  // Initialise the queue with all voxels to be cleared.
  voxels.forEach(([vx, vy, vz]) => {
    const level = isSunlight
      ? world.getSunlightAt(vx, vy, vz)
      : world.getTorchLightAt(vx, vy, vz, color);
    if (level === 0) return;

    // Push into queue and immediately clear the light so we don't visit twice.
    queue.push({ voxel: [vx, vy, vz], level });
    if (isSunlight) {
      world.setSunlightAt(vx, vy, vz, 0);
    } else {
      world.setTorchLightAt(vx, vy, vz, 0, color);
    }
  });

  let head = 0;
  while (head < queue.length) {
    const { voxel, level } = queue[head++];
    const [vx, vy, vz] = voxel;

    for (const [ox, oy, oz] of VOXEL_NEIGHBORS) {
      const nvy = vy + oy;
      if (nvy < 0 || nvy >= maxHeight) continue;

      const nvx = vx + ox;
      const nvz = vz + oz;

      const nBlock = world.getBlockAt(nvx, nvy, nvz);
      if (!nBlock) {
        continue;
      }
      const rotation = world.getVoxelRotationAt(nvx, nvy, nvz);
      const nTransparency = BlockUtils.getBlockRotatedTransparency(
        nBlock,
        rotation,
      );

      if (
        !isSunlight &&
        BlockUtils.getBlockTorchLightLevelAt(nBlock, color, [nvx, nvy, nvz], {
          getVoxelAt: (x, y, z) => world.getVoxelAt(x, y, z),
          getVoxelRotationAt: (x, y, z) => world.getVoxelRotationAt(x, y, z),
          getVoxelStageAt: (x, y, z) => world.getVoxelStageAt(x, y, z),
        }) === 0 &&
        !LightUtils.canEnterInto(nTransparency, ox, oy, oz)
      ) {
        continue;
      }

      const nl = isSunlight
        ? world.getSunlightAt(nvx, nvy, nvz)
        : world.getTorchLightAt(nvx, nvy, nvz, color);
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
          world.setSunlightAt(nvx, nvy, nvz, 0);
        } else {
          world.setTorchLightAt(nvx, nvy, nvz, 0, color);
        }
      } else if (isSunlight && oy === -1 ? nl > level : nl >= level) {
        if (isSunlight) {
          fill.push({ voxel: [nvx, nvy, nvz], level: nl });
          continue;
        }

        const emissionLevel = BlockUtils.getBlockTorchLightLevelAt(
          nBlock,
          color,
          [nvx, nvy, nvz],
          {
            getVoxelAt: (x, y, z) => world.getVoxelAt(x, y, z),
            getVoxelRotationAt: (x, y, z) => world.getVoxelRotationAt(x, y, z),
            getVoxelStageAt: (x, y, z) => world.getVoxelStageAt(x, y, z),
          },
        );
        if (typeof emissionLevel !== "number" || emissionLevel <= 0) {
          queue.push({ voxel: [nvx, nvy, nvz], level: nl });
          world.setTorchLightAt(nvx, nvy, nvz, 0, color);
          continue;
        }

        if (nl === emissionLevel) {
          fill.push({ voxel: [nvx, nvy, nvz], level: emissionLevel });
          continue;
        }

        queue.push({ voxel: [nvx, nvy, nvz], level: nl });
        world.setTorchLightAt(nvx, nvy, nvz, 0, color);
      }
    }
  }

  const liveFill = LightUtils.retainLiveFillNodes(fill, (vx, vy, vz) =>
    isSunlight
      ? world.getSunlightAt(vx, vy, vz)
      : world.getTorchLightAt(vx, vy, vz, color),
  );
  const dedupedFill = LightUtils.dedupeFillQueue(liveFill);
  for (const node of dedupedFill) {
    const [vx, vy, vz] = node.voxel;
    if (isSunlight) {
      world.setSunlightAt(vx, vy, vz, node.level);
    } else {
      world.setTorchLightAt(vx, vy, vz, node.level, color);
    }
  }

  floodLight(world, dedupedFill, color);
}

export function analyzeLightOperations(
  world: VoxelLightVolume,
  processedUpdates: ProcessedUpdate[],
): LightOperations {
  const { maxHeight, maxLightLevel } = world.options;

  interface RemovedLightSource {
    voxel: Coords3;
    block: Block;
  }

  const removedLightSources: RemovedLightSource[] = [];
  const redRemoval: Coords3[] = [];
  const greenRemoval: Coords3[] = [];
  const blueRemoval: Coords3[] = [];
  const sunlightRemoval: Coords3[] = [];

  const redFlood: LightNode[] = [];
  const greenFlood: LightNode[] = [];
  const blueFlood: LightNode[] = [];
  const sunFlood: LightNode[] = [];

  for (const update of processedUpdates) {
    const { voxel, oldBlock, newBlock, newRotation, oldStage } = update;
    const [vx, vy, vz] = voxel;

    let currentEmitsLight = oldBlock.isLight;
    let currentRedLevel = oldBlock.redLightLevel;
    let currentGreenLevel = oldBlock.greenLightLevel;
    let currentBlueLevel = oldBlock.blueLightLevel;

    if (oldBlock.dynamicPatterns) {
      for (const pattern of oldBlock.dynamicPatterns) {
        for (const part of pattern.parts) {
          const ruleMatched = BlockUtils.evaluateBlockRule(
            part.rule,
            [vx, vy, vz],
            {
              getVoxelAt: (x: number, y: number, z: number) => {
                if (x === vx && y === vy && z === vz) return update.oldId;
                return world.getVoxelAt(x, y, z);
              },
              getVoxelRotationAt: (x: number, y: number, z: number) => {
                if (x === vx && y === vy && z === vz) return update.oldRotation;
                return world.getVoxelRotationAt(x, y, z);
              },
              getVoxelStageAt: (x: number, y: number, z: number) => {
                if (x === vx && y === vy && z === vz) return oldStage;
                return world.getVoxelStageAt(x, y, z);
              },
            },
          );

          if (ruleMatched) {
            if (typeof part.redLightLevel === "number") {
              currentRedLevel = part.redLightLevel;
            }
            if (typeof part.greenLightLevel === "number") {
              currentGreenLevel = part.greenLightLevel;
            }
            if (typeof part.blueLightLevel === "number") {
              currentBlueLevel = part.blueLightLevel;
            }
            currentEmitsLight =
              currentRedLevel > 0 ||
              currentGreenLevel > 0 ||
              currentBlueLevel > 0;
            break;
          }
        }
      }
    }

    let newEmitsLight = newBlock.isLight;
    if (newBlock.dynamicPatterns && update.stage !== undefined) {
      newEmitsLight = false;
      for (const pattern of newBlock.dynamicPatterns) {
        for (const part of pattern.parts) {
          const ruleMatched = BlockUtils.evaluateBlockRule(
            part.rule,
            [vx, vy, vz],
            {
              getVoxelAt: (x: number, y: number, z: number) => {
                if (x === vx && y === vy && z === vz) return update.newId;
                return world.getVoxelAt(x, y, z);
              },
              getVoxelRotationAt: (x: number, y: number, z: number) => {
                if (x === vx && y === vy && z === vz) return newRotation;
                return world.getVoxelRotationAt(x, y, z);
              },
              getVoxelStageAt: (x: number, y: number, z: number) => {
                if (x === vx && y === vy && z === vz) return update.stage || 0;
                return world.getVoxelStageAt(x, y, z);
              },
            },
          );

          if (ruleMatched) {
            const hasLight =
              (part.redLightLevel || 0) > 0 ||
              (part.greenLightLevel || 0) > 0 ||
              (part.blueLightLevel || 0) > 0;
            if (hasLight) {
              newEmitsLight = true;
              break;
            }
          }
        }
      }
    }

    if (currentEmitsLight && !newEmitsLight) {
      const blockWithLevels = { ...oldBlock };
      blockWithLevels.redLightLevel = currentRedLevel;
      blockWithLevels.greenLightLevel = currentGreenLevel;
      blockWithLevels.blueLightLevel = currentBlueLevel;

      removedLightSources.push({
        voxel: [vx, vy, vz],
        block: blockWithLevels,
      });
    }
  }

  removedLightSources.forEach(({ voxel, block }) => {
    const [vx, vy, vz] = voxel;

    if (world.getSunlightAt(vx, vy, vz) > 0) {
      sunlightRemoval.push(voxel);
    }

    if (block.redLightLevel > 0) redRemoval.push(voxel);
    if (block.greenLightLevel > 0) greenRemoval.push(voxel);
    if (block.blueLightLevel > 0) blueRemoval.push(voxel);
  });

  for (const update of processedUpdates) {
    const { voxel, oldBlock, newBlock, oldRotation, newRotation } = update;
    const [vx, vy, vz] = voxel;

    const isRemovedLightSource = removedLightSources.some(
      ({ voxel: v }) => v[0] === vx && v[1] === vy && v[2] === vz,
    );

    if (isRemovedLightSource && !oldBlock.isOpaque) {
      continue;
    }

    const currentTransparency = BlockUtils.getBlockRotatedTransparency(
      oldBlock,
      oldRotation,
    );
    const updatedTransparency = BlockUtils.getBlockRotatedTransparency(
      newBlock,
      newRotation,
    );

    if (newBlock.isOpaque || newBlock.lightAttenuation > 0) {
      if (world.getSunlightAt(vx, vy, vz) > 0) {
        sunlightRemoval.push(voxel);
      }
      if (world.getTorchLightAt(vx, vy, vz, "RED") > 0) {
        redRemoval.push(voxel);
      }
      if (world.getTorchLightAt(vx, vy, vz, "GREEN") > 0) {
        greenRemoval.push(voxel);
      }
      if (world.getTorchLightAt(vx, vy, vz, "BLUE") > 0) {
        blueRemoval.push(voxel);
      }
    } else {
      let removeCount = 0;

      const lightData = [
        [SUNLIGHT, world.getSunlightAt(vx, vy, vz)],
        [RED_LIGHT, world.getTorchLightAt(vx, vy, vz, "RED")],
        [GREEN_LIGHT, world.getTorchLightAt(vx, vy, vz, "GREEN")],
        [BLUE_LIGHT, world.getTorchLightAt(vx, vy, vz, "BLUE")],
      ] as const;

      for (const [ox, oy, oz] of VOXEL_NEIGHBORS) {
        const nvy = vy + oy;
        if (nvy < 0 || nvy >= maxHeight) {
          continue;
        }

        const nvx = vx + ox;
        const nvz = vz + oz;

        const nBlock = world.getBlockAt(nvx, nvy, nvz);
        if (!nBlock) {
          continue;
        }
        const nRotation = world.getVoxelRotationAt(nvx, nvy, nvz);
        const nTransparency = BlockUtils.getBlockRotatedTransparency(
          nBlock,
          nRotation,
        );

        if (
          !(
            LightUtils.canEnter(
              currentTransparency,
              nTransparency,
              ox,
              oy,
              oz,
            ) &&
            !LightUtils.canEnter(updatedTransparency, nTransparency, ox, oy, oz)
          )
        ) {
          continue;
        }

        for (const [color, sourceLevel] of lightData) {
          const isSunlight = color === SUNLIGHT;

          const nLevel = isSunlight
            ? world.getSunlightAt(nvx, nvy, nvz)
            : world.getTorchLightAt(nvx, nvy, nvz, color);

          if (
            nLevel < sourceLevel ||
            (oy === -1 &&
              isSunlight &&
              nLevel === maxLightLevel &&
              sourceLevel === maxLightLevel)
          ) {
            removeCount++;
            if (isSunlight) {
              sunlightRemoval.push([nvx, nvy, nvz]);
            } else if (color === RED_LIGHT) {
              redRemoval.push([nvx, nvy, nvz]);
            } else if (color === GREEN_LIGHT) {
              greenRemoval.push([nvx, nvy, nvz]);
            } else if (color === BLUE_LIGHT) {
              blueRemoval.push([nvx, nvy, nvz]);
            }
          }
        }
      }

      if (removeCount === 0) {
        if (world.getSunlightAt(vx, vy, vz) !== 0) {
          sunlightRemoval.push(voxel);
        }
        if (world.getTorchLightAt(vx, vy, vz, "RED") !== 0) {
          redRemoval.push(voxel);
        }
        if (world.getTorchLightAt(vx, vy, vz, "GREEN") !== 0) {
          greenRemoval.push(voxel);
        }
        if (world.getTorchLightAt(vx, vy, vz, "BLUE") !== 0) {
          blueRemoval.push(voxel);
        }
      }
    }

    if (
      newBlock.isLight ||
      (newBlock.dynamicPatterns && update.stage !== undefined)
    ) {
      let redLevel = newBlock.redLightLevel;
      let greenLevel = newBlock.greenLightLevel;
      let blueLevel = newBlock.blueLightLevel;

      if (newBlock.dynamicPatterns && update.stage !== undefined) {
        for (const pattern of newBlock.dynamicPatterns) {
          for (const part of pattern.parts) {
            const ruleMatched = BlockUtils.evaluateBlockRule(
              part.rule,
              [vx, vy, vz],
              {
                getVoxelAt: (x: number, y: number, z: number) =>
                  world.getVoxelAt(x, y, z),
                getVoxelRotationAt: (x: number, y: number, z: number) =>
                  world.getVoxelRotationAt(x, y, z),
                getVoxelStageAt: (x: number, y: number, z: number) =>
                  world.getVoxelStageAt(x, y, z),
              },
            );

            if (ruleMatched) {
              if (typeof part.redLightLevel === "number")
                redLevel = part.redLightLevel;
              if (typeof part.greenLightLevel === "number")
                greenLevel = part.greenLightLevel;
              if (typeof part.blueLightLevel === "number")
                blueLevel = part.blueLightLevel;
              break;
            }
          }
        }
      }

      if (redLevel > 0) {
        redFlood.push({
          voxel: voxel,
          level: redLevel,
        });
      }

      if (greenLevel > 0) {
        greenFlood.push({
          voxel: voxel,
          level: greenLevel,
        });
      }

      if (blueLevel > 0) {
        blueFlood.push({
          voxel: voxel,
          level: blueLevel,
        });
      }
    } else if (oldBlock.isOpaque && !newBlock.isOpaque) {
      for (const [ox, oy, oz] of VOXEL_NEIGHBORS) {
        const nvy = vy + oy;

        if (nvy < 0) {
          continue;
        }

        if (nvy >= maxHeight) {
          if (
            LightUtils.canEnter(
              [true, true, true, true, true, true],
              updatedTransparency,
              ox,
              -1,
              oz,
            )
          ) {
            sunFlood.push({
              voxel: [vx + ox, vy, vz + oz],
              level: maxLightLevel,
            });
          }
          continue;
        }

        const nvx = vx + ox;
        const nvz = vz + oz;

        const nBlock = world.getBlockAt(nvx, nvy, nvz);
        if (!nBlock) {
          continue;
        }
        const nRotation = world.getVoxelRotationAt(nvx, nvy, nvz);
        const nTransparency = BlockUtils.getBlockRotatedTransparency(
          nBlock,
          nRotation,
        );

        if (
          !LightUtils.canEnter(
            currentTransparency,
            nTransparency,
            ox,
            oy,
            oz,
          ) &&
          LightUtils.canEnter(updatedTransparency, nTransparency, ox, oy, oz)
        ) {
          const level = LightUtils.beerLambertTransmit(
            world.getSunlightAt(nvx, nvy, nvz),
            newBlock.lightAttenuation,
          );
          if (level > 0) {
            sunFlood.push({
              voxel: [nvx, nvy, nvz],
              level: level,
            });
          }

          if (!isRemovedLightSource) {
            const redLevel = LightUtils.beerLambertTransmit(
              world.getTorchLightAt(nvx, nvy, nvz, "RED"),
              newBlock.lightAttenuation,
            );
            if (redLevel > 0) {
              redFlood.push({
                voxel: [nvx, nvy, nvz],
                level: redLevel,
              });
            }

            const greenLevel = LightUtils.beerLambertTransmit(
              world.getTorchLightAt(nvx, nvy, nvz, "GREEN"),
              newBlock.lightAttenuation,
            );
            if (greenLevel > 0) {
              greenFlood.push({
                voxel: [nvx, nvy, nvz],
                level: greenLevel,
              });
            }

            const blueLevel = LightUtils.beerLambertTransmit(
              world.getTorchLightAt(nvx, nvy, nvz, "BLUE"),
              newBlock.lightAttenuation,
            );
            if (blueLevel > 0) {
              blueFlood.push({
                voxel: [nvx, nvy, nvz],
                level: blueLevel,
              });
            }
          }
        }
      }
    }
  }

  const hasOperations =
    redRemoval.length > 0 ||
    greenRemoval.length > 0 ||
    blueRemoval.length > 0 ||
    sunlightRemoval.length > 0 ||
    redFlood.length > 0 ||
    greenFlood.length > 0 ||
    blueFlood.length > 0 ||
    sunFlood.length > 0;

  return {
    removals: {
      sunlight: sunlightRemoval,
      red: redRemoval,
      green: greenRemoval,
      blue: blueRemoval,
    },
    floods: {
      sunlight: sunFlood,
      red: redFlood,
      green: greenFlood,
      blue: blueFlood,
    },
    hasOperations,
  };
}

export function mergeLightOperations(
  existing: LightOperations,
  newOps: LightOperations,
): LightOperations {
  return {
    removals: {
      sunlight: [...existing.removals.sunlight, ...newOps.removals.sunlight],
      red: [...existing.removals.red, ...newOps.removals.red],
      green: [...existing.removals.green, ...newOps.removals.green],
      blue: [...existing.removals.blue, ...newOps.removals.blue],
    },
    floods: {
      sunlight: [...existing.floods.sunlight, ...newOps.floods.sunlight],
      red: [...existing.floods.red, ...newOps.floods.red],
      green: [...existing.floods.green, ...newOps.floods.green],
      blue: [...existing.floods.blue, ...newOps.floods.blue],
    },
    hasOperations: true,
  };
}

export function buildLightJobs(
  lightOps: LightOperations,
  startSequenceId: number,
  batchId: number,
  options: VoxelLightVolumeOptions,
  allocateJobId: (color: LightColor) => string,
): LightJob[] {
  const { maxLightLevel, chunkSize, minChunk, maxChunk, maxHeight } = options;

  const colorData: {
    color: LightColor;
    removals: Coords3[];
    floods: LightNode[];
  }[] = [
    {
      color: "SUNLIGHT",
      removals: lightOps.removals.sunlight,
      floods: lightOps.floods.sunlight,
    },
    {
      color: "RED",
      removals: lightOps.removals.red,
      floods: lightOps.floods.red,
    },
    {
      color: "GREEN",
      removals: lightOps.removals.green,
      floods: lightOps.floods.green,
    },
    {
      color: "BLUE",
      removals: lightOps.removals.blue,
      floods: lightOps.floods.blue,
    },
  ];

  const jobsForBatch: LightJob[] = [];

  // Ops separated by more than twice the max light level cannot influence
  // each other's light, so they split into independent jobs with small
  // boxes. One merged box used to span every scattered random-tick update
  // across the render distance — and every chunk in that box got
  // serialized per color, a renderer-killing burst.
  const clusterReach = maxLightLevel * 2;

  type LightCluster = {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
    removals: Coords3[];
    floods: LightNode[];
  };

  colorData.forEach(({ color, removals, floods }) => {
    if (removals.length === 0 && floods.length === 0) return;

    const clusters: LightCluster[] = [];

    const place = (x: number, y: number, z: number): LightCluster => {
      for (const cluster of clusters) {
        if (
          x >= cluster.minX - clusterReach &&
          x <= cluster.maxX + clusterReach &&
          y >= cluster.minY - clusterReach &&
          y <= cluster.maxY + clusterReach &&
          z >= cluster.minZ - clusterReach &&
          z <= cluster.maxZ + clusterReach
        ) {
          cluster.minX = Math.min(cluster.minX, x);
          cluster.minY = Math.min(cluster.minY, y);
          cluster.minZ = Math.min(cluster.minZ, z);
          cluster.maxX = Math.max(cluster.maxX, x);
          cluster.maxY = Math.max(cluster.maxY, y);
          cluster.maxZ = Math.max(cluster.maxZ, z);
          return cluster;
        }
      }
      const fresh: LightCluster = {
        minX: x,
        minY: y,
        minZ: z,
        maxX: x,
        maxY: y,
        maxZ: z,
        removals: [],
        floods: [],
      };
      clusters.push(fresh);
      return fresh;
    };

    for (const voxel of removals) {
      place(voxel[0], voxel[1], voxel[2]).removals.push(voxel);
    }
    for (const node of floods) {
      place(node.voxel[0], node.voxel[1], node.voxel[2]).floods.push(node);
    }

    // Growing bounds can bring clusters into reach of one another.
    let didMerge = true;
    while (didMerge) {
      didMerge = false;
      outer: for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
          const a = clusters[i];
          const b = clusters[j];
          if (
            a.minX - clusterReach <= b.maxX &&
            b.minX - clusterReach <= a.maxX &&
            a.minY - clusterReach <= b.maxY &&
            b.minY - clusterReach <= a.maxY &&
            a.minZ - clusterReach <= b.maxZ &&
            b.minZ - clusterReach <= a.maxZ
          ) {
            a.minX = Math.min(a.minX, b.minX);
            a.minY = Math.min(a.minY, b.minY);
            a.minZ = Math.min(a.minZ, b.minZ);
            a.maxX = Math.max(a.maxX, b.maxX);
            a.maxY = Math.max(a.maxY, b.maxY);
            a.maxZ = Math.max(a.maxZ, b.maxZ);
            a.removals = a.removals.concat(b.removals);
            a.floods = a.floods.concat(b.floods);
            clusters.splice(j, 1);
            didMerge = true;
            break outer;
          }
        }
      }
    }

    for (const cluster of clusters) {
      let minX = cluster.minX - maxLightLevel;
      let minY = cluster.minY - maxLightLevel;
      let minZ = cluster.minZ - maxLightLevel;
      let maxX = cluster.maxX + maxLightLevel;
      let maxY = cluster.maxY + maxLightLevel;
      let maxZ = cluster.maxZ + maxLightLevel;

      minX = Math.max(minX, minChunk[0] * chunkSize);
      minZ = Math.max(minZ, minChunk[1] * chunkSize);
      maxX = Math.min(maxX, (maxChunk[0] + 1) * chunkSize - 1);
      maxZ = Math.min(maxZ, (maxChunk[1] + 1) * chunkSize - 1);
      minY = Math.max(minY, 0);
      maxY = Math.min(maxY, maxHeight - 1);

      const boundingBox: BoundingBox = {
        min: [minX, minY, minZ],
        shape: [maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1],
      };

      const jobId = allocateJobId(color);
      jobsForBatch.push({
        jobId,
        color,
        lightOps: { removals: cluster.removals, floods: cluster.floods },
        boundingBox,
        startSequenceId,
        retryCount: 0,
        batchId,
      });
    }
  });

  return jobsForBatch;
}

export function mergeSingleColorResult(
  chunk: Chunk,
  lights: Uint32Array,
  color: LightColor,
  boundingBox: BoundingBox,
) {
  const currentLights = chunk.lights.data;
  const mask = getLightColorMask(color);
  const inverseMask = ~mask >>> 0;
  const [minX, , minZ] = boundingBox.min;
  const [shapeX, , shapeZ] = boundingBox.shape;
  const maxX = minX + shapeX;
  const maxZ = minZ + shapeZ;
  const [chunkMinX, , chunkMinZ] = chunk.min;
  const { size, maxHeight } = chunk.options;

  const startX = Math.max(minX, chunkMinX);
  const endX = Math.min(maxX, chunkMinX + size);
  const startZ = Math.max(minZ, chunkMinZ);
  const endZ = Math.min(maxZ, chunkMinZ + size);

  for (let vx = startX; vx < endX; vx++) {
    const lx = vx - chunkMinX;
    for (let vy = 0; vy < maxHeight; vy++) {
      for (let vz = startZ; vz < endZ; vz++) {
        const lz = vz - chunkMinZ;
        const index = lx * maxHeight * size + vy * size + lz;
        currentLights[index] =
          (currentLights[index] & inverseMask) | (lights[index] & mask);
      }
    }
  }
}

export function getLightColorMask(color: LightColor): number {
  switch (color) {
    case "SUNLIGHT":
      return 0xf000;
    case "RED":
      return 0x0f00;
    case "GREEN":
      return 0x00f0;
    case "BLUE":
      return 0x000f;
  }
}
