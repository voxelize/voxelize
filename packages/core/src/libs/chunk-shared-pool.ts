import type { RawChunk } from "../core/world/raw-chunk";

type SlotRecord = {
  key: string;
  elementCount: number;
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

export class ChunkSharedPool {
  private static instance: ChunkSharedPool | null = null;

  private buffer: SharedArrayBuffer | null = null;
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
      isActive: this.buffer !== null,
      maxSlots: this.maxSlots,
      usedSlots: this.slots.size,
      bytesAllocated: this.buffer?.byteLength ?? 0,
    };
  }

  hasSlot(key: string): boolean {
    return this.slots.has(key);
  }

  ensureChunk(chunk: RawChunk): boolean {
    if (!ChunkSharedPool.isSharedArrayBufferAvailable()) {
      return false;
    }

    const key = chunk.name;
    if (this.slots.has(key)) {
      return true;
    }

    if (!chunk.isReady) {
      return false;
    }

    const elementCount = chunk.voxels.data.length;
    if (elementCount === 0) {
      return false;
    }

    if (!this.buffer || this.elementCountPerSlot !== elementCount) {
      if (this.slots.size > 0) {
        return false;
      }
      this.initializeBuffer(elementCount);
    }

    const slotIndex = this.allocateSlotIndex();
    if (slotIndex === null) {
      return false;
    }

    const bytesPerArray = elementCount * Uint32Array.BYTES_PER_ELEMENT;
    const voxelsByteOffset = slotIndex * bytesPerArray * 2;
    const lightsByteOffset = voxelsByteOffset + bytesPerArray;

    if (!this.buffer) {
      return false;
    }

    const voxelsView = new Uint32Array(
      this.buffer,
      voxelsByteOffset,
      elementCount,
    );
    const lightsView = new Uint32Array(
      this.buffer,
      lightsByteOffset,
      elementCount,
    );

    voxelsView.set(chunk.voxels.data);
    lightsView.set(chunk.lights.data);

    chunk.voxels.data = voxelsView;
    chunk.lights.data = lightsView;

    this.slots.set(key, {
      key,
      elementCount,
      voxelsByteOffset,
      lightsByteOffset,
    });

    return true;
  }

  releaseChunk(key: string): void {
    const slot = this.slots.get(key);
    if (!slot) return;

    const slotIndex = slot.voxelsByteOffset / (slot.elementCount * 8);
    this.freeSlotIndices.push(slotIndex);
    this.slots.delete(key);
  }

  private initializeBuffer(elementCount: number): void {
    const bytesPerArray = elementCount * Uint32Array.BYTES_PER_ELEMENT;
    const bytesPerSlot = bytesPerArray * 2;
    const totalBytes = bytesPerSlot * this.maxSlots;

    this.buffer = new SharedArrayBuffer(totalBytes);
    this.elementCountPerSlot = elementCount;
    this.freeSlotIndices = Array.from({ length: this.maxSlots }, (_, i) => i);
    this.slots.clear();
  }

  private allocateSlotIndex(): number | null {
    if (this.freeSlotIndices.length === 0) {
      return null;
    }
    return this.freeSlotIndices.pop() ?? null;
  }
}
