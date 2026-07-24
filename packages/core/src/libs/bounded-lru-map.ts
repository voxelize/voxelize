/**
 * A `Map` that forgets its least-recently-used entry once it is full.
 *
 * Caches keyed by voxel, chunk or block coordinate are the most common way a
 * renderer grows without bound: the key space is effectively infinite over a
 * session, so a plain `Map` retains one entry per coordinate the player ever
 * touched. Reaching for this instead makes the bound explicit and gives the
 * cache a capacity that lives in an option field.
 */
export class BoundedLruMap<K, V> {
  private readonly entries = new Map<K, V>();

  /**
   * @param capacity Entries retained before the least-recently-used one is
   * evicted. A capacity below one disables the cache entirely.
   */
  constructor(public readonly capacity: number) {}

  /**
   * Read an entry and mark it most-recently-used.
   */
  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;

    // Re-inserting moves the key to the end of the Map's insertion order,
    // which is what makes the eviction in `set` least-recently-used.
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  /**
   * Read an entry without affecting eviction order.
   */
  peek(key: K): V | undefined {
    return this.entries.get(key);
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  set(key: K, value: V): void {
    if (this.capacity < 1) return;

    this.entries.delete(key);
    this.entries.set(key, value);

    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  delete(key: K): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  /**
   * Entries from least- to most-recently-used.
   */
  values(): IterableIterator<V> {
    return this.entries.values();
  }

  get size(): number {
    return this.entries.size;
  }
}
