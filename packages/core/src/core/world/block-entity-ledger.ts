/**
 * The client's copy of the world's block entities.
 *
 * The server sends every block entity once at join and pushes changes and
 * deletes after that; it never re-sends one because its chunk came back
 * into view. Whatever the client holds is therefore the only copy it will
 * get, and it lives for the whole session — a chunk unloading does not
 * prune it. An entry whose chunk had no voxel data when its update arrived
 * is held as pending and handed to the listeners when the chunk lands,
 * however long that takes: a paint dropped on a timer left the block's
 * face on the missing-texture checker for good, with nothing to bring it
 * back short of the server changing the entity.
 */

export type BlockEntityLedgerEntry<T> = {
  id: string;
  data: T | null;
  etype: string;
  operation: "CREATE" | "UPDATE";
  /** The listeners have not seen this entry's data yet. */
  isPendingDelivery: boolean;
};

export class BlockEntityLedger<T> {
  private byVoxel = new Map<string, BlockEntityLedgerEntry<T>>();
  private byChunk = new Map<string, Set<string>>();

  get size() {
    return this.byVoxel.size;
  }

  get(voxelId: string): BlockEntityLedgerEntry<T> | undefined {
    return this.byVoxel.get(voxelId);
  }

  /**
   * Record a create or update. A later record for the same voxel replaces
   * the earlier one — the listeners want the latest data, once — and a
   * record made while the chunk has no data is pending until the chunk
   * lands.
   */
  record(
    voxelId: string,
    chunkName: string,
    entry: Omit<BlockEntityLedgerEntry<T>, "isPendingDelivery">,
    isChunkReady: boolean,
  ): BlockEntityLedgerEntry<T> {
    const stored: BlockEntityLedgerEntry<T> = {
      ...entry,
      isPendingDelivery: !isChunkReady,
    };
    this.byVoxel.set(voxelId, stored);
    let inChunk = this.byChunk.get(chunkName);
    if (!inChunk) {
      inChunk = new Set();
      this.byChunk.set(chunkName, inChunk);
    }
    inChunk.add(voxelId);
    return stored;
  }

  delete(voxelId: string, chunkName: string): boolean {
    const inChunk = this.byChunk.get(chunkName);
    inChunk?.delete(voxelId);
    if (inChunk && inChunk.size === 0) this.byChunk.delete(chunkName);
    return this.byVoxel.delete(voxelId);
  }

  /**
   * The entries in `chunkName` the listeners have not seen, marked seen.
   * Called when the chunk's data lands; a chunk that lands twice hands
   * nothing over the second time unless something changed in between.
   */
  takePendingForChunk(
    chunkName: string,
  ): Array<{ voxelId: string; entry: BlockEntityLedgerEntry<T> }> {
    const inChunk = this.byChunk.get(chunkName);
    if (!inChunk) return [];
    const pending: Array<{
      voxelId: string;
      entry: BlockEntityLedgerEntry<T>;
    }> = [];
    for (const voxelId of inChunk) {
      const entry = this.byVoxel.get(voxelId);
      if (!entry || !entry.isPendingDelivery) continue;
      entry.isPendingDelivery = false;
      pending.push({ voxelId, entry });
    }
    return pending;
  }

  clear() {
    this.byVoxel.clear();
    this.byChunk.clear();
  }
}
