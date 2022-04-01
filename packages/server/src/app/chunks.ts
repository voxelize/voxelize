import { BaseChunks, ChunkUtils, Coords2 } from "@voxelize/common";
import { v4 as uuidv4 } from "uuid";

import { Network } from "../core/network";

import { Chunk } from "./chunk";
import { Client } from "./ents";
import { World } from "./world";

class Chunks extends BaseChunks<Chunk> {
  private packets = new Map<string, Coords2[]>();

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

    const { chunkSize, maxHeight } = this.worldParams;
    const [cx, cz] = ChunkUtils.parseChunkName(name);
    const newChunk = new Chunk(uuidv4(), cx, cz, {
      maxHeight,
      size: chunkSize,
    });

    this.addChunk(newChunk);
    this.world.pipeline.addChunk(newChunk, 0);

    return null;
  };

  sendChunk = (chunk: Chunk, clientId: string) => {
    let packets = this.packets.get(clientId);
    if (!packets) packets = [];
    packets.push(chunk.coords);
    this.packets.set(clientId, packets);
  };

  onDisconnect = (client: Client) => {
    this.packets.delete(client.id);
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
            .splice(0, this.worldParams.maxResponsePerTick)
            .map((coords) => {
              const chunk = this.getChunk(...coords);
              if (!chunk) return;

              return {
                x: coords[0],
                z: coords[1],
                id: chunk.id,
                mesh: chunk.mesh,
                voxels: chunk.voxels.data,
                lights: chunk.lights.data,
                heightMap: chunk.heightMap.data,
              };
            }),
        })
      );
    }
  };

  get worldParams() {
    return this.world.params;
  }

  get registry() {
    return this.world.registry;
  }
}

export { Chunks };
