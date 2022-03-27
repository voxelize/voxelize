import { ClientFlag, IDComponent, System } from "@voxelize/common";

import { Chunks } from "../chunks";
import { ChunkRequestsComponent } from "../comps";
import { Client } from "../ents";

class GenerateChunksSystem extends System {
  constructor(private chunks: Chunks) {
    super([ClientFlag.type, IDComponent.type, ChunkRequestsComponent.type]);
  }

  update(client: Client): void {
    const id = IDComponent.get(client).data;
    const requests = ChunkRequestsComponent.get(client).data;

    // go through pending chunk requests, see if any's ready
    requests.forEach((name, i) => {
      const chunk = this.chunks.getChunkByName(name);
      if (!chunk) return;

      requests.splice(i, 1);
      this.chunks.sendChunk(chunk, id);
    });
  }
}

export { GenerateChunksSystem };
