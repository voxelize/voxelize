import { BaseChunks, ChunkUtils, Coords2 } from "@voxelize/common";
import { v4 as uuidv4 } from "uuid";

import { Network } from "../core/network";

import { Chunk } from "./chunk";
import { World } from "./world";

class Chunks extends BaseChunks<Chunk> {
  private packets = new Map<string, Coords2[]>();

  static SUPPOSED_NEIGHBORS = -1;

  constructor(public world: World) {
    super();
  }

  getChunk = (cx: number, cz: number) => {
    return this.getChunkByName(ChunkUtils.getChunkName([cx, cz]));
  };

  getChunkByName = (name: string) => {
    // means processing
    if (this.world.pipeline.hasChunk(name)) {
      return null;
    }

    const chunk = this.map.get(name);
    if (chunk) return chunk;

    const { chunkSize, maxHeight, padding } = this.params;
    const [cx, cz] = ChunkUtils.parseChunkName(name);
    const newChunk = new Chunk(uuidv4(), cx, cz, {
      padding,
      maxHeight,
      size: chunkSize,
    });

    this.addChunk(newChunk);
    this.world.pipeline.addChunk(newChunk, 0);

    return null;
  };

  sendChunk = (chunk: Chunk, to: string) => {
    let packets = this.packets.get(to);
    if (!packets) packets = [];
    packets.push(chunk.coords);
    this.packets.set(to, packets);
  };

  update = () => {
    if (this.packets.size === 0) return;

    for (const [to, packets] of this.packets) {
      if (packets.length === 0) continue;

      const client = this.world.room.findClient(to);
      if (!client) return;

      client.send(
        Network.encode({
          type: "REQUEST",
          chunks: packets
            .splice(0, this.params.maxResponsePerTick)
            .map((coords) => {
              const chunk = this.getChunk(...coords);
              if (!chunk) return;

              return {
                x: coords[0],
                z: coords[1],
                meshes: [chunk.mesh],
                voxels: chunk.voxels.data,
                lights: chunk.lights.data,
              };
            }),
        })
      );
    }
  };

  get params() {
    return this.world.params;
  }

  get registry() {
    return this.world.registry;
  }
}

export { Chunks };
