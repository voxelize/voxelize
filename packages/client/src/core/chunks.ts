import {
  BaseChunks,
  ChunkUtils,
  Coords2,
  Coords3,
  MeshData,
} from "@voxelize/common";
import { Group } from "three";

import { Client } from "..";

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

class Chunks extends BaseChunks<Chunk> {
  public params: ChunksParams;

  public mesh = new Group();

  private requested = new Set<string>();
  private toRequest: string[] = [];

  public currentChunk: Coords2;

  constructor(public client: Client, params: Partial<ChunksParams> = {}) {
    super();

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
    const { x, z, id, lights, mesh, voxels, heightMap } = data;
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

  get worldParams() {
    return this.client.world.params;
  }

  get registry() {
    return this.client.registry;
  }

  private surroundChunks = () => {
    const [cx, cz] = this.currentChunk;
    const { renderRadius } = this.client.settings;

    for (let x = -renderRadius; x <= renderRadius; x++) {
      for (let z = -renderRadius; z <= renderRadius; z++) {
        if (x ** 2 + z ** 2 >= renderRadius ** 2) continue;

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
      type: "REQUEST",
      json: {
        chunks: toRequest,
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
}

export { Chunks };
