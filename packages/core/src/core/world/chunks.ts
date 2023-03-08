import { ChunkProtocol } from "@voxelize/transport/src/types";

import { Coords2 } from "../../types";

import { Chunk } from "./chunk";

import { BlockUpdate } from ".";

export class Chunks {
  public requested: Map<string, number> = new Map();

  public toRequest: Coords2[] = [];

  public loaded: Map<string, Chunk> = new Map();

  public toProcess: ChunkProtocol[] = [];

  public toUpdate: BlockUpdate[] = [];

  /**
   * @hidden
   */
  constructor() {
    // DO NOTHING
  }
}
