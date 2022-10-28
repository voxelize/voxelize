import { ChunkProtocol } from "@voxelize/transport/src/types";

import { Coords2 } from "../../types";

import { BlockUpdate } from "./block";
import { Chunk } from "./chunk";

class Chunks extends Map<string, Chunk> {
  public requested = new Map<string, number>();
  public toRequest: string[] = [];
  public toProcess: [ChunkProtocol, number][] = [];
  public toUpdate: BlockUpdate[] = [];
  public toAdd: string[] = [];

  public currentChunk: Coords2;
}

export { Chunks };
