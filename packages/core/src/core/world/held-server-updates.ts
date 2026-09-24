import type { UpdateProtocol } from "@voxelize/protocol";

/**
 * Server voxel updates for chunks that are in this client's pipeline but have
 * no voxel data yet (requested, or received and waiting in the processing
 * queue). The server sends a chunk's LOAD and its later UPDATEs in order, so
 * an update can land while the snapshot it follows is still unapplied here;
 * dropping it then would let the older snapshot win. Held per chunk, one
 * entry per voxel in arrival order (a voxel's latest update wins), and handed
 * back when the chunk's data lands.
 */
export class HeldServerUpdates {
  private byChunk = new Map<string, Map<string, UpdateProtocol>>();

  hold(chunkName: string, update: UpdateProtocol): void {
    let held = this.byChunk.get(chunkName);
    if (!held) {
      held = new Map();
      this.byChunk.set(chunkName, held);
    }
    const voxelKey = `${update.vx},${update.vy},${update.vz}`;
    // Re-inserted so a voxel's replay position follows its latest update.
    held.delete(voxelKey);
    held.set(voxelKey, update);
  }

  /** Everything held for the chunk, in arrival order; the chunk is cleared. */
  take(chunkName: string): UpdateProtocol[] {
    const held = this.byChunk.get(chunkName);
    if (!held) return [];
    this.byChunk.delete(chunkName);
    return [...held.values()];
  }

  /** Drops chunks that left the pipeline before their data landed. */
  prune(isInPipeline: (chunkName: string) => boolean): void {
    for (const chunkName of this.byChunk.keys()) {
      if (!isInPipeline(chunkName)) this.byChunk.delete(chunkName);
    }
  }

  clear(): void {
    this.byChunk.clear();
  }

  get chunkCount(): number {
    return this.byChunk.size;
  }
}
