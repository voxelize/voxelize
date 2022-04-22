import { Box3, Group, Vector3 } from "three";

import { Client } from "..";
import { Coords2, Coords3, MeshData } from "../types";
import { ChunkUtils, LightColor } from "../utils";

import { Chunk } from "./chunk";

type Mesh = { opaque?: MeshData; transparent?: MeshData };

type ServerChunk = {
  x: number;
  z: number;
  id: string;
  lights: Uint32Array;
  voxels: Uint32Array;
  heightMap: Uint32Array;
  mesh: Mesh;
};

type ChunksParams = {
  maxRequestsPerTick: number;
};

const defaultParams: ChunksParams = {
  maxRequestsPerTick: 4,
};

class Chunks {
  public params: ChunksParams;

  public mesh = new Group();

  public requested = new Set<string>();
  public toRequest: string[] = [];

  public currentChunk: Coords2;

  private map = new Map<string, Chunk>();

  constructor(public client: Client, params: Partial<ChunksParams> = {}) {
    this.params = {
      ...defaultParams,
      ...params,
    };

    client.on("ready", () => {
      client.rendering.scene.add(this.mesh);
    });
  }

  getChunk = (cx: number, cz: number) => {
    return this.getChunkByName(ChunkUtils.getChunkName([cx, cz]));
  };

  getChunkByName = (name: string) => {
    return this.map.get(name);
  };

  handleServerChunk = (data: ServerChunk) => {
    const { x, z, id, mesh, lights, voxels, heightMap } = data;
    const { chunkSize, maxHeight } = this.worldParams;

    let chunk = this.getChunk(x, z);

    if (!chunk) {
      chunk = new Chunk(this.client, id, x, z, {
        size: chunkSize,
        maxHeight,
      });

      this.map.set(chunk.name, chunk);
    }

    if (lights.length) chunk.lights.data = lights;
    if (voxels.length) chunk.voxels.data = voxels;
    if (heightMap.length) chunk.heightMap.data = heightMap;

    if (mesh) {
      chunk.build(mesh);
    }

    // TEMP
    // TODO: REMOVE THIS, TOO HACKY
    if (x === 0 && z === 0) {
      const maxHeight = this.getMaxHeight(0, 0);
      this.client.controls.setPosition(0, maxHeight + 2, 0);
    }

    this.requested.delete(chunk.name);
  };

  update = () => {
    const { position } = this.client;
    const { dimension, chunkSize } = this.worldParams;

    const coords = ChunkUtils.mapVoxelPosToChunkPos(
      ChunkUtils.mapWorldPosToVoxelPos(
        position.toArray() as Coords3,
        dimension
      ),
      chunkSize
    );

    // check if player chunk changed.
    if (
      !this.currentChunk ||
      this.currentChunk[0] !== coords[0] ||
      this.currentChunk[1] !== coords[1]
    ) {
      this.currentChunk = coords;
    }

    this.surroundChunks();

    if (this.toRequest.length) {
      this.requestChunks();
    }

    this.maintainChunks();
  };

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

  get worldParams() {
    return this.client.world.params;
  }

  get registry() {
    return this.client.registry;
  }

  private surroundChunks = () => {
    const [cx, cz] = this.currentChunk;
    const { renderRadius } = this.client.settings;
    const { chunkSize, maxHeight } = this.worldParams;

    for (let x = -renderRadius; x <= renderRadius; x++) {
      for (let z = -renderRadius; z <= renderRadius; z++) {
        if (x ** 2 + z ** 2 >= renderRadius ** 2) continue;

        if (!this.withinWorld(cx + x, cz + z)) {
          continue;
        }

        const [minX, minY, minZ] = ChunkUtils.mapChunkPosToVoxelPos(
          [cx + x, cz + z],
          chunkSize
        );

        const maxX = minX + chunkSize;
        const maxY = minY + maxHeight;
        const maxZ = minZ + chunkSize;

        const chunkBox = new Box3(
          new Vector3(minX, minY - 100, minZ),
          new Vector3(maxX, maxY + 100, maxZ)
        );

        if (!this.client.camera.frustum.intersectsBox(chunkBox)) {
          continue;
        }

        const name = ChunkUtils.getChunkName([cx + x, cz + z]);

        if (this.requested.has(name)) {
          continue;
        }

        const chunk = this.getChunkByName(name);

        if (!chunk) {
          if (!this.toRequest.includes(name)) {
            this.toRequest.push(name);
          }

          continue;
        }

        // add to scene
        chunk.addToScene();
      }
    }

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
      type: "CHUNK",
      json: {
        chunks: toRequest.map((name) => ChunkUtils.parseChunkName(name)),
      },
    });
  };

  // if the chunk is too far away, remove from scene.
  private maintainChunks = () => {
    const { chunkSize } = this.worldParams;
    const { renderRadius } = this.client.settings;

    const deleteDistance = renderRadius * chunkSize * 1.414;

    for (const chunk of this.map.values()) {
      const dist = chunk.distTo(...this.client.voxel);

      if (dist > deleteDistance) {
        chunk.removeFromScene();
        chunk.mesh.opaque?.geometry.dispose();
        chunk.mesh.transparent?.geometry.dispose();
        this.map.delete(chunk.name);
      }
    }
  };

  private withinWorld = (cx: number, cz: number) => {
    const [minX, minZ] = this.client.world.params.minChunk;
    const [maxX, maxZ] = this.client.world.params.maxChunk;

    return cx >= minX && cz >= minZ && cx <= maxX && cz <= maxZ;
  };
}

export { Chunks };
