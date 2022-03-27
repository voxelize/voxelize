import { BaseWorldParams, Coords2, Coords3 } from "../types";
import { ChunkUtils, LightColor } from "../utils";

import { BaseChunk } from "./base-chunk";
import { BaseRegistry } from "./base-registry";

abstract class BaseChunks<C extends BaseChunk> {
  protected map = new Map<string, C>();

  /**
   * Get or start generating a chunk.
   *
   * @param cx x coordinate of chunk
   * @param cz z coordinate of chunk
   * @returns a chunk if chunk exists, otherwise null
   */
  abstract getChunk: (cx: number, cz: number) => C;
  abstract getChunkByName: (name: string) => C;

  getChunkByVoxel = (vx: number, vy: number, vz: number) => {
    const coords = ChunkUtils.mapVoxelPosToChunkPos(
      [vx, vy, vz],
      this.worldParams.chunkSize
    );

    return this.getChunk(...coords);
  };

  getVoxelByVoxel = (vx: number, vy: number, vz: number) => {
    const chunk = this.getChunkByVoxel(vx, vy, vz);
    if (!chunk) return 0;
    return chunk.getVoxel(vx, vy, vz);
  };

  getVoxelByWorld = (wx: number, wy: number, wz: number) => {
    const voxel = ChunkUtils.mapWorldPosToVoxelPos([wx, wy, wz], 1);
    return this.getVoxelByVoxel(...voxel);
  };

  setVoxelByVoxel: (vx: number, vy: number, vz: number, id: number) => number;

  getVoxelRotationByVoxel = (vx: number, vy: number, vz: number) => {
    const chunk = this.getChunkByVoxel(vx, vy, vz);
    if (!chunk) throw new Error("Rotation not obtainable.");
    return chunk.getVoxelRotation(vx, vy, vz);
  };

  setVoxelRotationByVoxel: (
    vx: number,
    vy: number,
    vz: number,
    rotation: number
  ) => number;

  getVoxelStageByVoxel = (vx: number, vy: number, vz: number) => {
    const chunk = this.getChunkByVoxel(vx, vy, vz);
    if (!chunk) throw new Error("Stage not obtainable.");
    return chunk.getVoxelStage(vx, vy, vz);
  };

  setVoxelStageByVoxel: (
    vx: number,
    vy: number,
    vz: number,
    stage: number
  ) => number;

  getSunlightByVoxel = (vx: number, vy: number, vz: number) => {
    const chunk = this.getChunkByVoxel(vx, vy, vz);
    if (!chunk) return 0;
    return chunk.getSunlight(vx, vy, vz);
  };

  setSunlightByVoxel: (
    vx: number,
    vy: number,
    vz: number,
    level: number
  ) => void;

  getTorchLightByVoxel = (
    vx: number,
    vy: number,
    vz: number,
    color: LightColor
  ) => {
    const chunk = this.getChunkByVoxel(vx, vy, vz);
    if (!chunk) return 0;
    return chunk.getTorchLight(vx, vy, vz, color);
  };

  setTorchLightByVoxel: (
    vx: number,
    vy: number,
    vz: number,
    level: number,
    color: LightColor
  ) => void;

  getBlockByVoxel = (vx: number, vy: number, vz: number) => {
    const voxel = this.getVoxelByVoxel(vx, vy, vz);
    return this.registry.getBlockById(voxel);
  };

  getMaxHeight = (vx: number, vz: number) => {
    const chunk = this.getChunkByVoxel(vx, 0, vz);
    if (!chunk) return 0;
    return chunk.getMaxHeight(vx, vz);
  };

  setMaxHeight: (vx: number, vz: number, height: number) => void;

  getWalkableByVoxel = (vx: number, vy: number, vz: number) => {
    const block = this.getBlockByVoxel(vx, vy, vz);
    return !block.isSolid || block.isPlant;
  };

  getSolidityByVoxel = (vx: number, vy: number, vz: number) => {
    return this.getVoxelByVoxel(vx, vy, vz) !== 0;
  };

  getFluidityByVoxel = (vx: number, vy: number, vz: number) => {
    return false;
  };

  getNeighborChunkCoords = (vx: number, vy: number, vz: number) => {
    const { chunkSize } = this.worldParams;
    const neighborChunks: Coords2[] = [];

    const [cx, cz] = ChunkUtils.mapVoxelPosToChunkPos([vx, vy, vz], chunkSize);
    const [lx, , lz] = ChunkUtils.mapVoxelPosToChunkLocalPos(
      [vx, vy, vz],
      chunkSize
    );

    const a = lx <= 0;
    const b = lz <= 0;
    const c = lx >= chunkSize - 1;
    const d = lz >= chunkSize - 1;

    // direct neighbors
    if (a) neighborChunks.push([cx - 1, cz]);
    if (b) neighborChunks.push([cx, cz - 1]);
    if (c) neighborChunks.push([cx + 1, cz]);
    if (d) neighborChunks.push([cx, cz + 1]);

    // side-to-side neighbors
    if (a && b) neighborChunks.push([cx - 1, cz - 1]);
    if (a && d) neighborChunks.push([cx - 1, cz + 1]);
    if (b && c) neighborChunks.push([cx + 1, cz - 1]);
    if (c && d) neighborChunks.push([cx + 1, cz + 1]);

    return neighborChunks;
  };

  getStandableVoxel = (vx: number, vy: number, vz: number) => {
    while (true) {
      if (vy === 0 || this.getWalkableByVoxel(vx, vy, vz)) {
        vy -= 1;
      } else {
        break;
      }
    }

    vy += 1;
    return [vx, vy, vz] as Coords3;
  };

  all = () => {
    return Array.from(this.map.values());
  };

  raw = (name: string) => {
    return this.map.get(name);
  };

  addChunk = (chunk: C) => {
    return this.map.set(chunk.name, chunk);
  };

  removeChunk = (chunk: C) => {
    return this.map.delete(chunk.name);
  };

  checkSurrounded = (cx: number, cz: number) => {
    const neighbors: C[] = [];
    const { maxLightLevel, chunkSize } = this.worldParams;
    const r = Math.ceil(maxLightLevel / chunkSize);

    let count = 0;

    for (let x = -r; x <= r; x++) {
      for (let z = -r; z <= r; z++) {
        if (x === 0 && z === 0) {
          continue;
        }

        if (x ** 2 + z ** 2 > r ** 2) {
          continue;
        }

        count++;
        neighbors.push(this.raw(ChunkUtils.getChunkName([cx + x, cz + z])));
      }
    }

    return neighbors.filter(Boolean).length >= count;
  };

  abstract get worldParams(): BaseWorldParams;
  abstract get registry(): BaseRegistry;
}

export { BaseChunks };
