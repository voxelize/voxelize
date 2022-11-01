import { ChunkProtocol } from "@voxelize/transport/src/types";

import { Coords2 } from "../../types";

import { BlockUpdate } from "./block";
import { Chunk } from "./chunk";

/**
 * `Chunks` is a map of chunks that are currently loaded or being loaded. This is
 * used completely within {@link World} and shouldn't be modified by anything else.
 *
 * One can use {@link Debug} to view different chunk statuses.
 *
 * @noInheritDoc
 */
export class Chunks extends Map<string, Chunk> {
  /**
   * The map of requested chunks corresponding to how many times the world has attempted
   * to re-request the chunk.
   */
  public requested = new Map<string, number>();

  /**
   * A list of chunk representations ready to be sent to the server to be loaded. The rate at which
   * this list is taken out can be configured at {@link WorldClientParams.maxRequestsPerTick}. Items of
   * this list will be taken out whenever the server responds with any corresponding chunks.
   */
  public toRequest: string[] = [];

  /**
   * A list of {@link ChunkProtocol} objects that are received from the server and are waiting to be
   * loaded into meshes within the world and actual chunk instances. This list empties out at the rate
   * defined at {@link WorldClientParams.maxProcessesPerTick}.
   */
  public toProcess: [ChunkProtocol, number][] = [];

  /**
   * A list of {@link BlockUpdate} objects that awaits to be sent to the server to make actual voxel
   * updates. This list empties out at the rate defined at {@link WorldClientParams.maxUpdatesPerTick}.
   */
  public toUpdate: BlockUpdate[] = [];

  /**
   * A list of chunk representations that are ready to be added into the THREE.js scene. This list empties
   * out at the rate defined at {@link WorldClientParams.maxAddsPerTick}.
   */
  public toAdd: string[] = [];

  /**
   * The current chunk that is used as the center of the world. This is used to determine which chunks
   * should be requested and loaded.
   */
  public currentChunk: Coords2;
}
