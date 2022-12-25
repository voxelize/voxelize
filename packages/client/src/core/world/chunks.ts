import { ChunkProtocol } from "@voxelize/transport/src/types";

import { Coords2 } from "../../types";

import { Chunk } from "./chunk";

export class Chunks {
  public requested: Map<string, number> = new Map();

  public toRequest: Coords2[] = [];

  public loaded: Map<string, Chunk> = new Map();

  public toProcess: ChunkProtocol[] = [];

  /**
   * @hidden
   */
  constructor() {
    // DO NOTHING
  }
}
