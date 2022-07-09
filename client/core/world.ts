import { Color, Vector3 } from "three";

import { Client } from "..";
import {
  BlockRotation,
  Sky,
  Chunk,
  Chunks,
  ServerChunk,
  ArtFunction,
  BoxSides,
  drawSun,
  Clouds,
  CloudsParams,
  Trigger,
} from "../libs";
import { Coords2, Coords3, PartialRecord, BlockUpdate } from "../types";
import { BlockUtils, ChunkUtils, LightColor, MathUtils } from "../utils";

type SkyFace = ArtFunction | Color | string | null;

type WorldInitParams = {
  skyDimension: number;
  inViewRadius: number;
  maxRequestsPerTick: number;
  maxProcessesPerTick: number;
  maxUpdatesPerTick: number;
  maxAddsPerTick: number;
  skyFaces: PartialRecord<BoxSides, SkyFace>;
  clouds: Partial<CloudsParams> | boolean;
};

const defaultParams: WorldInitParams = {
  skyDimension: 1000,
  inViewRadius: 5,
  maxRequestsPerTick: 2,
  maxProcessesPerTick: 2,
  maxUpdatesPerTick: 1000,
  maxAddsPerTick: 2,
  skyFaces: { top: drawSun },
  clouds: true,
};

type WorldParams = WorldInitParams & {
  subChunks: number;
  chunkSize: number;
  maxHeight: number;
  maxLightLevel: number;
  minChunk: [number, number];
  maxChunk: [number, number];

  gravity: number[];
  minBounceImpulse: number;
  airDrag: number;
  fluidDrag: number;
  fluidDensity: number;
};

/**
 * @category Core
 */
class World {
  // @ts-ignore
  public params: WorldParams = {};

  public sky: Sky;
  public clouds: Clouds;
  public chunks: Chunks;

  public uSunlightIntensity = { value: 1 };

  public blockCache = new Map<string, number>();

  public triggers: Trigger[] = [];

  constructor(public client: Client, params: Partial<WorldInitParams> = {}) {
    const { skyDimension, skyFaces, clouds } = (params = {
      ...defaultParams,
      ...params,
    });

    this.chunks = new Chunks();

    Object.keys(params).forEach((key) => {
      this.params[key] = params[key];
    });

    Object.values((skyFace) => {
      if (typeof skyFace === "string") {
        client.loader.addTexture(skyFace);
      }
    });

    this.sky = new Sky(skyDimension);

    client.once("ready", () => {
      Object.entries(skyFaces).forEach(([side, skyFace]) => {
        if (typeof skyFace === "string") {
          const texture = client.loader.getTexture(skyFace);
          if (texture) {
            this.sky.box.paint(side as BoxSides, texture);
          }
        } else if (skyFace) {
          this.sky.box.paint(side as BoxSides, skyFace);
        }
      });

      client.rendering.scene.add(this.sky.mesh);

      this.clouds = new Clouds({
        alpha: 0.8,
        color: "#fff",
        count: 16,
        scale: 0.08,
        width: 8,
        height: 3,
        dimensions: [20, 20, 20],
        speedFactor: 8,
        lerpFactor: 0.3,
        threshold: 0.05,
        octaves: 5,
        falloff: 0.9,
        seed: -1,
        ...(typeof clouds === "object" ? clouds : {}),
        worldHeight: this.params.maxHeight,
        uFogColor: this.sky.uMiddleColor,
        uFogNear: this.client.rendering.uFogNear,
        uFogFar: this.client.rendering.uFogFar,
      });

      this.clouds.initialize().then(() => {
        client.rendering.scene.add(this.clouds.mesh);
      });
    });
  }

  reset = () => {
    const { scene } = this.client.rendering;

    this.chunks.forEach((chunk) => {
      chunk.removeFromScene(scene);
      chunk.dispose();
    });
    this.chunks.clear();

    this.chunks.requested.clear();
    this.chunks.toRequest.length = 0;
    this.chunks.toProcess.length = 0;
    this.chunks.currentChunk = [0, 0];

    if (this.clouds) {
      this.clouds.reset();
    }

    this.blockCache.clear();
  };

  /**
   * Applies the server settings onto this world.
   * Caution: do not call this after game started!
   *
   * @memberof World
   */
  setParams = (data: WorldParams) => {
    this.params = {
      ...this.params,
      ...data,
    };

    // initialize the physics engine with server provided parameters.
    this.client.physics.initialize(this.params);
  };

  getChunk = (cx: number, cz: number) => {
    return this.getChunkByName(ChunkUtils.getChunkName([cx, cz]));
  };

  getChunkByName = (name: string) => {
    return this.chunks.get(name);
  };

  handleServerChunk = (data: ServerChunk, urgent = false) => {
    if (urgent) {
      this.meshChunk(data);
    } else {
      this.chunks.toProcess.push(data);
    }
  };

  getChunkByVoxel = (vx: number, vy: number, vz: number) => {
    const coords = ChunkUtils.mapVoxelPosToChunkPos(
      [vx, vy, vz],
      this.params.chunkSize
    );

    return this.getChunk(...coords);
  };

  getVoxelByVoxel = (vx: number, vy: number, vz: number) => {
    const chunk = this.getChunkByVoxel(vx, vy, vz);
    if (!chunk) return 0;
    return chunk.getVoxel(vx, vy, vz);
  };

  getVoxelByWorld = (wx: number, wy: number, wz: number) => {
    const voxel = ChunkUtils.mapWorldPosToVoxelPos([wx, wy, wz]);
    return this.getVoxelByVoxel(...voxel);
  };

  setServerVoxel = (
    vx: number,
    vy: number,
    vz: number,
    type: number,
    rotation?: BlockRotation
  ) => {
    this.setServerVoxels([{ vx, vy, vz, type, rotation }]);
  };

  setServerVoxels = (updates: BlockUpdate[]) => {
    if (!this.client.permission.canUpdate) return;

    this.chunks.toUpdate.push(
      ...updates.filter(
        (update) => update.vy >= 0 && update.vy < this.params.maxHeight
      )
    );
  };

  getVoxelRotationByVoxel = (vx: number, vy: number, vz: number) => {
    const chunk = this.getChunkByVoxel(vx, vy, vz);
    if (!chunk) return new BlockRotation(0, 0);
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
    if (!chunk) return 0;
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
    return this.client.registry.getBlockById(voxel);
  };

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
    const { chunkSize } = this.params;
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
    return Array.from(this.chunks.values());
  };

  raw = (name: string) => {
    return this.chunks.get(name);
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
    const [pcx, pcz] = this.client.controls.chunk;

    if ((pcx - cx) ** 2 + (pcz - cz) ** 2 <= this.params.inViewRadius ** 2) {
      return true;
    }

    const { x, z } = this.client.controls.getDirection();

    const vec1 = new Vector3(cz - pcz, cx - pcx, 0);
    const vec2 = new Vector3(z, x, 0);
    const angle = MathUtils.normalizeAngle(vec1.angleTo(vec2));

    return Math.abs(angle) < (Math.PI * 3) / 5;
  };

  addTrigger = (trigger: Trigger) => {
    this.triggers.push(trigger);
    this.client.rendering.scene.add(trigger.mesh);
  };

  update = (() => {
    let count = 0;

    return () => {
      count++;

      this.triggers.forEach((trigger) => {
        const clientAABB = this.client.controls.body.aabb;
        if (clientAABB.intersects(trigger.aabb)) {
          trigger.onTrigger?.();
        }
      });

      const { position } = this.client.controls;
      const { chunkSize, maxUpdatesPerTick } = this.params;

      const coords = ChunkUtils.mapVoxelPosToChunkPos(
        ChunkUtils.mapWorldPosToVoxelPos(position as Coords3),
        chunkSize
      );

      // check if player chunk changed.
      if (
        !this.chunks.currentChunk ||
        this.chunks.currentChunk[0] !== coords[0] ||
        this.chunks.currentChunk[1] !== coords[1]
      ) {
        this.chunks.currentChunk = coords;
      }

      if (count % 2 === 0) {
        this.surroundChunks();
      } else if (count % 3 === 0) {
        this.meshChunks();
        count = 0;
      }

      this.addChunks();
      this.requestChunks();
      this.maintainChunks();

      this.chunks.forEach((chunk) => {
        if (chunk.mesh && !chunk.mesh.isEmpty) {
          chunk.mesh.visible = this.isChunkInView(...chunk.coords);
        }
      });

      const [px, py, pz] = this.client.controls.position;
      this.sky.mesh.position.set(px, py, pz);

      if (this.clouds && this.clouds.initialized) {
        this.clouds.move(
          this.client.clock.delta,
          this.client.controls.object.position
        );
      }

      // Update server voxels
      if (this.chunks.toUpdate.length >= 0) {
        const updates = this.chunks.toUpdate.splice(0, maxUpdatesPerTick);

        if (updates.length) {
          this.client.network.send({
            type: "UPDATE",
            updates: updates.map((update) => {
              const { type, vx, vy, vz } = update;

              const chunk = this.getChunkByVoxel(vx, vy, vz);

              if (chunk) {
                this.blockCache.set(
                  ChunkUtils.getVoxelName([vx, vy, vz]),
                  chunk.getVoxel(vx, vy, vz)
                );
                chunk.setVoxel(vx, vy, vz, type);

                if (update.rotation) {
                  chunk.setVoxelRotation(vx, vy, vz, update.rotation);
                }
              }

              let raw = 0;
              raw = BlockUtils.insertId(raw, update.type);

              if (update.rotation) {
                raw = BlockUtils.insertRotation(raw, update.rotation);
              }

              return {
                ...update,
                voxel: raw,
              };
            }),
          });
        }
      }
    };
  })();

  private surroundChunks = () => {
    const [cx, cz] = this.chunks.currentChunk;
    const renderRadius = this.client.settings.getRenderRadius();

    (() => {
      const now = performance.now();
      for (let x = -renderRadius; x <= renderRadius; x++) {
        for (let z = -renderRadius; z <= renderRadius; z++) {
          // Stop process if it's taking too long.
          if (performance.now() - now >= 1.5) {
            return;
          }

          if (x ** 2 + z ** 2 >= renderRadius ** 2) continue;

          if (!this.isWithinWorld(cx + x, cz + z)) {
            continue;
          }

          const name = ChunkUtils.getChunkName([cx + x, cz + z]);

          if (this.chunks.requested.has(name)) {
            continue;
          }

          if (!this.isChunkInView(cx + x, cz + z)) {
            continue;
          }

          const chunk = this.getChunkByName(name);

          if (!chunk) {
            if (!this.chunks.toRequest.includes(name)) {
              this.chunks.toRequest.push(name);
            }

            continue;
          }

          if (!chunk.isReady) {
            continue;
          }

          if (!this.chunks.toAdd.includes(chunk.name)) {
            this.chunks.toAdd.push(chunk.name);
          }
        }
      }
    })();

    this.chunks.toRequest.sort((a, b) => {
      const [cx1, cz1] = ChunkUtils.parseChunkName(a);
      const [cx2, cz2] = ChunkUtils.parseChunkName(b);

      if (!this.isChunkInView(cx1, cz1)) return -1;
      if (!this.isChunkInView(cx2, cz2)) return 1;

      return (
        (cx - cx1) ** 2 + (cz - cz1) ** 2 - (cx - cx2) ** 2 - (cz - cz2) ** 2
      );
    });

    this.chunks.toProcess.sort((a, b) => {
      const { x: cx1, z: cz1 } = a;
      const { x: cx2, z: cz2 } = b;

      if (!this.isChunkInView(cx1, cz1)) return -1;
      if (!this.isChunkInView(cx2, cz2)) return 1;

      return (
        (cx - cx1) ** 2 + (cz - cz1) ** 2 - (cx - cx2) ** 2 - (cz - cz2) ** 2
      );
    });
  };

  private requestChunks = () => {
    const { maxRequestsPerTick } = this.params;
    const toRequest = this.chunks.toRequest.splice(0, maxRequestsPerTick);

    if (toRequest.length === 0) return;

    toRequest.forEach((name) => this.chunks.requested.add(name));

    this.client.network.send({
      type: "LOAD",
      json: {
        chunks: toRequest.map((name) => ChunkUtils.parseChunkName(name)),
      },
    });
  };

  private meshChunks = () => {
    const { maxProcessesPerTick } = this.params;
    const toProcess = this.chunks.toProcess.splice(0, maxProcessesPerTick);

    toProcess.forEach((data) => {
      this.meshChunk(data);
    });
  };

  private meshChunk = (data: ServerChunk) => {
    const { x, z, id } = data;

    let chunk = this.getChunk(x, z);

    const { chunkSize, maxHeight, subChunks } = this.params;

    if (!chunk) {
      chunk = new Chunk(id, x, z, {
        size: chunkSize,
        maxHeight,
        subChunks,
      });

      this.chunks.set(chunk.name, chunk);
    }

    const { materials } = this.client.registry;

    chunk.build(data, materials);
    this.chunks.requested.delete(chunk.name);
  };

  private addChunks = () => {
    const toAdd = this.chunks.toAdd.splice(0, this.params.maxAddsPerTick);

    toAdd.forEach((name) => {
      const chunk = this.chunks.get(name);
      if (chunk) {
        chunk.addToScene(this.client.rendering.scene);
      }
    });
  };

  // if the chunk is too far away, remove from scene.
  private maintainChunks = () => {
    const { chunkSize } = this.params;
    const renderRadius = this.client.settings.getRenderRadius();

    const deleteDistance = renderRadius * chunkSize * 1.414;
    const deleted: Coords2[] = [];

    for (const chunk of this.chunks.values()) {
      const dist = chunk.distTo(...this.client.controls.voxel);

      if (dist > deleteDistance) {
        chunk.dispose();
        chunk.removeFromScene(this.client.rendering.scene);
        this.chunks.delete(chunk.name);
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

export type { WorldInitParams };

export { World };
