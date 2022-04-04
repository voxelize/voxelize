import { BaseChunks, ChunkUtils, Coords2 } from "@voxelize/common";
import { Pool } from "threads";
import { v4 as uuidv4 } from "uuid";

import { Network } from "../core/network";

import { Chunk } from "./chunk";
import { Client } from "./ents";
import { World } from "./world";

/**
 * A manager of all chunks.
 *
 * @param world - World that this chunks manager exists in
 * @extends {BaseChunks<Chunk>}
 */
class Chunks extends BaseChunks<Chunk> {
  private packets = new Map<string, Coords2[]>();
  private encoded = new Map<string, any[]>();

  constructor(public world: World) {
    super();
  }

  /**
   * Get a chunk by coordinates. If chunk does not exist, calling this causes
   * side effects to attempt to generate the chunk. Use `chunks.raw` instead for
   * raw chunk data.
   *
   * @param cx - X coordinate of chunk
   * @param cz - Z coordinate of chunk
   * @returns chunk if chunk exists, else `null`
   */
  getChunk = (cx: number, cz: number) => {
    return this.getChunkByName(ChunkUtils.getChunkName([cx, cz]));
  };

  /**
   * Get a chunk by name. If chunk does not exist, calling this causes
   * side effects to attempt to generate the chunk. Use `chunks.raw` instead for
   * raw chunk data.
   *
   * @param name - Name of the chunk
   * @returns chunk if chunk exists, else `null`
   */
  getChunkByName = (name: string) => {
    // check if the chunk is being processed
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

    // kick-start the chunk processing
    this.addChunk(newChunk);
    this.world.pipeline.appendChunk(newChunk, 0);

    return null;
  };

  /**
   * Send a chunk to a certain client. Note: chunks don't actually get
   * sent immediately. Instead, they get pushed to a sending queue, and is
   * sent in groups in `Chunks.update`.
   *
   * @param chunk - Chunk to be sent
   * @param clientId - ID of client to send this chunk to
   */
  sendChunk = (chunk: Chunk, clientId: string) => {
    let packets = this.packets.get(clientId);
    if (!packets) packets = [];
    packets.push(chunk.coords);
    this.packets.set(clientId, packets);
  };

  /**
   * Handler for client disconnection.
   *
   * @param client
   *
   * DO NOT CALL THIS DIRECTLY! THINGS MAY BREAK!
   */
  onDisconnect = (client: Client) => {
    this.packets.delete(client.id);
  };

  /**
   * Updater for `Chunks`. Does the following:
   * - Offload all chunks to be sent to `Sender` to encode and send
   *
   * DO NOT CALL THIS DIRECTLY! THINGS MAY BREAK!
   */
  update = () => {
    if (this.packets.size === 0) return;

    for (const [to, packets] of this.packets) {
      if (packets.length === 0) continue;

      const client = this.world.room.findClient(to);
      if (!client) return;

      const buffers: ArrayBuffer[] = [];

      const event = {
        type: "REQUEST",
        chunks: packets
          .splice(0, this.worldParams.maxResponsePerTick)
          .map((coords) => {
            const chunk = this.getChunk(...coords);
            if (!chunk) return;

            buffers.push(
              chunk.voxels.data.buffer.slice(0),
              chunk.lights.data.buffer.slice(0),
              chunk.heightMap.data.buffer.slice(0),
              chunk.mesh.opaque?.aos?.buffer.slice(0),
              chunk.mesh.opaque?.indices?.buffer.slice(0),
              chunk.mesh.opaque?.lights?.buffer.slice(0),
              chunk.mesh.opaque?.positions?.buffer.slice(0),
              chunk.mesh.opaque?.uvs?.buffer.slice(0)
            );

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
      };

      this.world.sender.addPacket(client.id, event, buffers);
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
