import { ChunkProtocol } from "@voxelize/transport/src/types";

import { BlockUpdate, Coords2 } from "../types";

import { Chunk } from "./chunk";

class Chunks extends Map<string, Chunk> {
  public requested = new Set<string>();
  public toRequest: string[] = [];
  public toProcess: ChunkProtocol[] = [];
  public toUpdate: BlockUpdate[] = [];
  public toAdd: string[] = [];

  public currentChunk: Coords2;
}

export { Chunks };
