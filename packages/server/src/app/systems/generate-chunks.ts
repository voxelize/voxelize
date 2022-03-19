import { ChunkUtils, ClientFlag, System } from "@voxelize/common";

import { Chunks } from "../chunks";
import { ChunkRequestsComponent, CurrentChunkComponent } from "../comps";
import { SettingsComponent } from "../comps/settings";
import { Client } from "../ents";

class GenerateChunksSystem extends System {
  constructor(private chunks: Chunks) {
    super([
      ClientFlag.type,
      ChunkRequestsComponent.type,
      CurrentChunkComponent.type,
      SettingsComponent.type,
    ]);
  }

  update(client: Client): void {
    const requests = ChunkRequestsComponent.get(client).data;
    const currentChunk = CurrentChunkComponent.get(client).data;
    const settings = SettingsComponent.get(client).data;

    // go through pending chunk requests, see if any's ready
    requests.pending.forEach((name) => {
      const chunk = this.chunks.getChunkByName(name);
      if (!chunk) return;
      requests.pending.delete(name);
      requests.finished.add(name);
    });

    // stop if client doesn't need new chunks, otherwise mark that client
    // doesn't need new chunks generated
    if (!currentChunk.changed) return;
    currentChunk.changed = false;

    const { renderRadius } = settings;
    const {
      chunk: { x: cx, z: cz },
    } = currentChunk;

    for (let x = -renderRadius; x <= renderRadius; x++) {
      for (let z = -renderRadius; z <= renderRadius; z++) {
        if (x ** 2 + z ** 2 >= renderRadius ** 2) continue;

        const mappedX = cx + x;
        const mappedZ = cz + z;
        const name = ChunkUtils.getChunkName([mappedX, mappedZ]);

        if (requests.finished.has(name) || requests.pending.has(name)) {
          continue;
        }

        const chunk = this.chunks.getChunk(mappedX, mappedZ);

        if (chunk) {
          requests.finished.add(chunk.name);
        } else {
          requests.pending.add(name);
        }
      }
    }
  }
}

export { GenerateChunksSystem };
