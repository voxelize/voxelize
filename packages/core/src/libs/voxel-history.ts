/**
 * What voxels held before they last changed, for a bounded number of voxels.
 *
 * Every voxel write records here, so a blast that opens a crater records
 * tens of thousands of times a second. Recording is one map read, and one
 * map write for a voxel not held yet. When the store is full the voxel that
 * was first recorded longest ago makes room: its slot in a ring is taken
 * over, with no walk over the map to find it. (A map kept in
 * least-recently-used order by deleting and re-inserting on every touch
 * evicts through its key iterator, which steps over every entry deleted
 * since the map last rebuilt its table: thousands of steps a write once a
 * mass edit has churned it.)
 */
export class VoxelHistory {
  private readonly byVoxel = new Map<string, number[]>();
  private readonly ring: (string | undefined)[];
  private next = 0;

  /**
   * @param capacity Voxels held before the oldest makes room. Below one,
   * nothing is kept.
   * @param depth Values kept for one voxel, oldest dropped first. Below one,
   * nothing is kept.
   */
  constructor(
    public readonly capacity: number,
    public readonly depth: number,
  ) {
    this.ring = new Array(Math.max(0, capacity));
  }

  get size(): number {
    return this.byVoxel.size;
  }

  /** Remember `value` as what the voxel named `key` held until now. */
  record(key: string, value: number): void {
    if (this.capacity < 1 || this.depth < 1) return;
    let history = this.byVoxel.get(key);
    if (history === undefined) {
      const evicted = this.ring[this.next];
      if (evicted !== undefined) this.byVoxel.delete(evicted);
      this.ring[this.next] = key;
      this.next = (this.next + 1) % this.capacity;
      history = [];
      this.byVoxel.set(key, history);
    }
    history.push(value);
    if (history.length > this.depth) history.shift();
  }

  /**
   * What the voxel held `count` changes ago (1 is just before its latest
   * change), or 0 when that is not held.
   */
  previous(key: string, count = 1): number {
    const history = this.byVoxel.get(key);
    if (history === undefined) return 0;
    return history[history.length - count] || 0;
  }

  clear(): void {
    this.byVoxel.clear();
    this.ring.fill(undefined);
    this.next = 0;
  }
}
