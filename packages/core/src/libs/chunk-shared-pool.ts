import type { RawChunk } from "../core/world/raw-chunk";

type SlotRecord = {
  key: string;
  slotIndex: number;
  elementCount: number;
  buffer: SharedArrayBuffer;
  voxelsByteOffset: number;
  lightsByteOffset: number;
};

export type ChunkSharedPoolStats = {
  isActive: boolean;
  maxSlots: number;
  usedSlots: number;
  bytesAllocated: number;
};

const DEFAULT_MAX_SLOTS = 512;
/**
 * Slots a block of the pool holds. The pool was one buffer for every slot,
 * made at the first chunk: a quarter of a gigabyte on a page that would
 * load eighty chunks, which a phone's tab did not survive. It is made a
 * block at a time now, as chunks need the room, so it costs what the loaded
 * chunks do.
 */
const SLOTS_PER_BLOCK = 32;

export class ChunkSharedPool {
  private static instance: ChunkSharedPool | null = null;

  private blocks: SharedArrayBuffer[] = [];
  private maxSlots: number;
  private elementCountPerSlot = 0;
  private slots = new Map<string, SlotRecord>();
  private freeSlotIndices: number[] = [];

  private constructor(maxSlots: number) {
    this.maxSlots = maxSlots;
  }

  static getInstance(): ChunkSharedPool {
    if (!ChunkSharedPool.instance) {
      ChunkSharedPool.instance = new ChunkSharedPool(DEFAULT_MAX_SLOTS);
    }
    return ChunkSharedPool.instance;
  }

  static resetForTests(): void {
    ChunkSharedPool.instance = null;
  }

  static isSharedArrayBufferAvailable(): boolean {
    return (
      typeof SharedArrayBuffer !== "undefined" &&
      typeof crossOriginIsolated !== "undefined" &&
      crossOriginIsolated
    );
  }

  getStats(): ChunkSharedPoolStats {
    return {
      isActive: this.blocks.length > 0,
      maxSlots: this.maxSlots,
      usedSlots: this.slots.size,
      bytesAllocated: this.blocks.reduce(
        (bytes, block) => bytes + block.byteLength,
        0,
      ),
    };
  }

  hasSlot(key: string): boolean {
    return this.slots.has(key);
  }

  /**
   * Puts a chunk's voxels and lights on the shared buffer, so a worker reads
   * them where they are instead of being sent a copy. True when the chunk's
   * arrays are views of the pool afterwards.
   *
   * A chunk that already holds a slot is checked, not trusted: the server
   * sending it again (`Chunk.setData`) swaps in plain arrays, and its slot
   * then holds what it had before. Answering "already shared" for that chunk
   * left every dispatch after it copying the whole column on the main
   * thread (nine columns a mesh job) for the rest of the session, with
   * nothing to say so. Its new data is moved into the slot it has.
   */
  ensureChunk(chunk: RawChunk): boolean {
    if (!ChunkSharedPool.isSharedArrayBufferAvailable()) {
      return false;
    }

    const key = chunk.name;
    const held = this.slots.get(key);
    if (held) {
      if (
        chunk.voxels.data.buffer === held.buffer &&
        chunk.lights.data.buffer === held.buffer
      ) {
        return true;
      }
      if (!chunk.isReady || chunk.voxels.data.length !== held.elementCount) {
        return false;
      }
      return this.moveIn(chunk, held);
    }

    if (!chunk.isReady) {
      return false;
    }

    const elementCount = chunk.voxels.data.length;
    if (elementCount === 0) {
      return false;
    }

    if (this.elementCountPerSlot !== elementCount) {
      if (this.slots.size > 0) {
        return false;
      }
      this.blocks = [];
      this.freeSlotIndices = [];
      this.elementCountPerSlot = elementCount;
    }

    const slotIndex = this.allocateSlotIndex();
    if (slotIndex === null) {
      return false;
    }

    const bytesPerArray = elementCount * Uint32Array.BYTES_PER_ELEMENT;
    const voxelsByteOffset = (slotIndex % SLOTS_PER_BLOCK) * bytesPerArray * 2;
    const lightsByteOffset = voxelsByteOffset + bytesPerArray;
    const slot = {
      key,
      slotIndex,
      elementCount,
      buffer: this.blocks[Math.floor(slotIndex / SLOTS_PER_BLOCK)],
      voxelsByteOffset,
      lightsByteOffset,
    };

    if (!this.moveIn(chunk, slot)) {
      this.freeSlotIndices.push(slotIndex);
      return false;
    }
    this.slots.set(key, slot);

    return true;
  }

  /** Copies a chunk's arrays into `slot` and points the chunk at the copy. */
  private moveIn(chunk: RawChunk, slot: SlotRecord): boolean {
    if (chunk.lights.data.length > slot.elementCount) {
      return false;
    }

    const voxelsView = new Uint32Array(
      slot.buffer,
      slot.voxelsByteOffset,
      slot.elementCount,
    );
    const lightsView = new Uint32Array(
      slot.buffer,
      slot.lightsByteOffset,
      slot.elementCount,
    );

    voxelsView.set(chunk.voxels.data);
    lightsView.set(chunk.lights.data);
    // A slot is reused: past a shorter light array, what the last chunk
    // left there is not this one's.
    lightsView.fill(0, chunk.lights.data.length);

    chunk.voxels.data = voxelsView;
    chunk.lights.data = lightsView;

    return true;
  }

  releaseChunk(key: string): void {
    const slot = this.slots.get(key);
    if (!slot) return;

    this.freeSlotIndices.push(slot.slotIndex);
    this.slots.delete(key);
  }

  /**
   * A free slot, from a block already made when one has room; a new block
   * only when every slot made so far is held, and none past `maxSlots`.
   */
  private allocateSlotIndex(): number | null {
    const free = this.freeSlotIndices.pop();
    if (free !== undefined) return free;

    const firstSlot = this.blocks.length * SLOTS_PER_BLOCK;
    const slots = Math.min(SLOTS_PER_BLOCK, this.maxSlots - firstSlot);
    if (slots <= 0) return null;

    const bytesPerSlot =
      this.elementCountPerSlot * Uint32Array.BYTES_PER_ELEMENT * 2;
    this.blocks.push(new SharedArrayBuffer(bytesPerSlot * slots));
    for (let i = slots - 1; i > 0; i--) {
      this.freeSlotIndices.push(firstSlot + i);
    }
    return firstSlot;
  }
}
