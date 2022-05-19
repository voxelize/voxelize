import { Box3, Vector2, Vector3 } from "three";

import { Client } from "..";
import { Coords2, Coords3, ServerMesh } from "../types";
import { ChunkUtils, LightColor, MathUtils } from "../utils";

import { Chunk } from "./chunk";

type ServerChunk = {
  x: number;
  z: number;
  id: string;
  lights: Uint32Array;
  voxels: Uint32Array;
  heightMap: Uint32Array;
  mesh: ServerMesh;
};

type ChunksParams = {
  inViewRadius: number;
  maxRequestsPerTick: number;
  maxProcessesPerTick: number;
};

const defaultParams: ChunksParams = {
  inViewRadius: 1,
  maxRequestsPerTick: 4,
  maxProcessesPerTick: 1,
};

class Chunks {
  public params: ChunksParams;

  // public mesh = new Group();

  public requested = new Set<string>();
  public toRequest: string[] = [];
  public toProcess: ServerChunk[] = [];

  public currentChunk: Coords2;

  private timeExceeded = false;
  private map = new Map<string, Chunk>();
  private cache = new Map<string, any>();

  constructor(public client: Client, params: Partial<ChunksParams> = {}) {
    this.params = {
      ...defaultParams,
      ...params,
    };
  }

  getChunk = (cx: number, cz: number) => {
    return this.getChunkByName(ChunkUtils.getChunkName([cx, cz]));
  };

  getChunkByName = (name: string) => {
    return this.map.get(name);
  };

  handleServerChunk = (data: ServerChunk) => {
    this.toProcess.push(data);
  };

  update = (() => {
    let count = 0;

    return () => {
      count++;
      if (count % 5 !== 0) return;

      const { position } = this.client.controls;
      const { dimension, chunkSize } = this.worldParams;

      const coords = ChunkUtils.mapVoxelPosToChunkPos(
        ChunkUtils.mapWorldPosToVoxelPos(position as Coords3, dimension),
        chunkSize
      );

      this.cache.clear();
      this.timeExceeded = false;

      // check if player chunk changed.
      if (
        !this.currentChunk ||
        this.currentChunk[0] !== coords[0] ||
        this.currentChunk[1] !== coords[1]
      ) {
        this.currentChunk = coords;
        this.maintainChunks();
      }

      this.surroundChunks();

      if (this.toRequest.length) {
        this.requestChunks();
      }

      if (this.toProcess.length) {
        this.meshChunks();
      }
    };
  })();

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

  setVoxelByVoxel = (vx: number, vy: number, vz: number, type: number) => {
    this.setVoxelsByVoxel([{ vx, vy, vz, type }]);
  };

  setVoxelsByVoxel = (
    updates: { vx: number; vy: number; vz: number; type: number }[]
  ) => {
    this.client.network.send({
      type: "UPDATE",
      updates,
    });
  };

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

  addChunk = (chunk: Chunk) => {
    return this.map.set(chunk.name, chunk);
  };

  removeChunk = (chunk: Chunk) => {
    return this.map.delete(chunk.name);
  };

  checkSurrounded = (cx: number, cz: number, r: number) => {
    for (let x = -r; x <= r; x++) {
      for (let z = -r; z <= r; z++) {
        if (x === 0 && z === 0) {
          continue;
        }

        if (!this.raw(ChunkUtils.getChunkName([cx + x, cz + z]))) {
          return false;
        }
      }
    }

    return true;
  };

  reset = () => {
    this.map.forEach((chunk) => {
      chunk.removeFromScene();
      chunk.dispose();
    });
    this.map.clear();

    this.requested.clear();
    this.toRequest.length = 0;
    this.toProcess.length = 0;
    this.currentChunk = [0, 0];
  };

  isWithinWorld = (cx: number, cz: number) => {
    const { minChunk, maxChunk } = this.client.world.params;

    return (
      cx >= minChunk[0] &&
      cx <= maxChunk[0] &&
      cz >= minChunk[1] &&
      cz <= maxChunk[1]
    );
  };

  isChunkInView = (cx: number, cz: number) => {
    const name = ChunkUtils.getChunkName([cx, cz]);
    if (this.cache.get(name) !== undefined) {
      return this.cache.get(name);
    }

    const [pcx, pcz] = this.client.controls.chunk;

    if ((pcx - cx) ** 2 + (pcz - cz) ** 2 <= this.params.inViewRadius ** 2) {
      return true;
    }

    const { x, z } = this.client.controls.getDirection();

    const vec1 = new Vector3(cz - pcz, cx - pcx, 0);
    const vec2 = new Vector3(z, x, 0);
    const angle = MathUtils.normalizeAngle(vec1.angleTo(vec2));

    const result = Math.abs(angle) < (Math.PI * 2) / 5;

    this.cache.set(name, result);

    return result;
  };

  get worldParams() {
    return this.client.world.params;
  }

  get registry() {
    return this.client.registry;
  }

  private surroundChunks = () => {
    const [cx, cz] = this.currentChunk;
    const { renderRadius } = this.client.settings;

    (() => {
      const now = performance.now();
      for (let x = -renderRadius; x <= renderRadius; x++) {
        for (let z = -renderRadius; z <= renderRadius; z++) {
          // Stop process if it's taking too long.
          if (performance.now() - now >= 1.5) {
            this.timeExceeded = true;
            return;
          }

          if (x ** 2 + z ** 2 >= renderRadius ** 2) continue;

          if (!this.isWithinWorld(cx + x, cz + z)) {
            continue;
          }

          const name = ChunkUtils.getChunkName([cx + x, cz + z]);

          if (this.requested.has(name)) {
            continue;
          }

          if (!this.isChunkInView(cx + x, cz + z)) {
            continue;
          }

          const chunk = this.getChunkByName(name);

          if (!chunk) {
            if (!this.toRequest.includes(name)) {
              this.toRequest.push(name);
            }

            continue;
          }

          chunk.addToScene();
        }
      }
    })();

    this.toRequest.sort((a, b) => {
      const [cx1, cz1] = ChunkUtils.parseChunkName(a);
      const [cx2, cz2] = ChunkUtils.parseChunkName(b);

      return (
        (cx - cx1) ** 2 + (cz - cz1) ** 2 - (cx - cx2) ** 2 - (cz - cz2) ** 2
      );
    });
  };

  private requestChunks = () => {
    const { maxRequestsPerTick } = this.params;
    const toRequest = this.toRequest.splice(0, maxRequestsPerTick);

    toRequest.forEach((name) => this.requested.add(name));

    this.client.network.send({
      type: "LOAD",
      json: {
        chunks: toRequest.map((name) => ChunkUtils.parseChunkName(name)),
      },
    });
  };

  private meshChunks = () => {
    if (this.timeExceeded) return;

    const { maxProcessesPerTick } = this.params;
    const toProcess = this.toProcess.splice(0, maxProcessesPerTick);

    toProcess.forEach((data) => {
      const { x, z, id } = data;

      let chunk = this.getChunk(x, z);

      const { chunkSize, maxHeight } = this.worldParams;

      if (!chunk) {
        chunk = new Chunk(this.client, id, x, z, {
          size: chunkSize,
          maxHeight,
        });

        this.map.set(chunk.name, chunk);

        chunk.setServerChunk(data);

        if (this.isChunkInView(x, z)) {
          chunk.build();
        }
      } else {
        chunk.setServerChunk(data);
        chunk.build();
      }

      this.requested.delete(chunk.name);
    });
  };

  // if the chunk is too far away, remove from scene.
  private maintainChunks = () => {
    const { chunkSize } = this.worldParams;
    const { renderRadius } = this.client.settings;

    const deleteDistance = renderRadius * chunkSize * 1.414;
    const deleted: Coords2[] = [];

    for (const chunk of this.map.values()) {
      const dist = chunk.distTo(...this.client.controls.voxel);

      if (dist > deleteDistance) {
        chunk.removeFromScene();
        chunk.mesh.opaque?.geometry.dispose();
        chunk.mesh.transparent?.geometry.dispose();
        this.map.delete(chunk.name);
        deleted.push(chunk.coords);
      }
    }

    if (deleted.length) {
      this.client.network.send({
        type: "UNLOAD",
        json: {
          chunks: deleted,
        },
      });
    }
  };
}

export type { ServerChunk, ChunksParams };

export { Chunks };
