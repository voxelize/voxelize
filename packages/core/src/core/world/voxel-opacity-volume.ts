import {
  ClampToEdgeWrapping,
  Data3DTexture,
  NearestFilter,
  RedFormat,
  UnsignedByteType,
  Vector3,
} from "three";

import type { Chunk } from "./chunk";
import type { Registry } from "./registry";

export interface VoxelOpacityVolumeConfig {
  size: [number, number, number];
  resolution: number;
}

const defaultConfig: VoxelOpacityVolumeConfig = {
  size: [96, 64, 96],
  resolution: 1,
};

export class VoxelOpacityVolume {
  private config: VoxelOpacityVolumeConfig;
  private texture: Data3DTexture;
  private data = new Uint8Array(new ArrayBuffer(0));
  private volumeMin = new Vector3();
  private volumeSize = new Vector3();
  private gridRes = new Vector3();
  private lastCenterX = NaN;
  private lastCenterY = NaN;
  private lastCenterZ = NaN;
  private isDirty = true;

  private tempHalfSize = new Vector3();

  constructor(config: Partial<VoxelOpacityVolumeConfig> = {}) {
    this.config = { ...defaultConfig, ...config };

    const [width, height, depth] = this.config.size;
    const res = this.config.resolution;
    const texWidth = Math.ceil(width / res);
    const texHeight = Math.ceil(height / res);
    const texDepth = Math.ceil(depth / res);

    this.data = new Uint8Array(
      new ArrayBuffer(texWidth * texHeight * texDepth)
    );
    this.data.fill(0);

    this.texture = new Data3DTexture(this.data, texWidth, texHeight, texDepth);
    this.texture.format = RedFormat;
    this.texture.type = UnsignedByteType;
    this.texture.minFilter = NearestFilter;
    this.texture.magFilter = NearestFilter;
    this.texture.wrapS = ClampToEdgeWrapping;
    this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.wrapR = ClampToEdgeWrapping;
    this.texture.needsUpdate = true;

    this.volumeSize.set(width, height, depth);
    this.gridRes.set(texWidth, texHeight, texDepth);
  }

  markDirty() {
    this.isDirty = true;
  }

  updateCenter(center: Vector3): boolean {
    this.tempHalfSize.copy(this.volumeSize).multiplyScalar(0.5);

    const newMinX = Math.floor(center.x - this.tempHalfSize.x);
    const newMinY = Math.floor(center.y - this.tempHalfSize.y);
    const newMinZ = Math.floor(center.z - this.tempHalfSize.z);

    const moved =
      newMinX !== this.lastCenterX ||
      newMinY !== this.lastCenterY ||
      newMinZ !== this.lastCenterZ;

    if (moved) {
      this.volumeMin.set(newMinX, newMinY, newMinZ);
      this.lastCenterX = newMinX;
      this.lastCenterY = newMinY;
      this.lastCenterZ = newMinZ;
      this.isDirty = true;
    }

    return moved;
  }

  updateFromChunks(chunks: Map<string, Chunk>, registry: Registry): boolean {
    if (!this.isDirty) {
      return false;
    }

    this.isDirty = false;
    this.data.fill(0);

    const res = this.config.resolution;
    const texWidth = Math.round(this.gridRes.x);
    const texHeight = Math.round(this.gridRes.y);
    const texDepth = Math.round(this.gridRes.z);

    for (const chunk of chunks.values()) {
      if (!chunk.isReady) continue;
      this.writeChunkOpacity(
        chunk,
        registry,
        texWidth,
        texHeight,
        texDepth,
        res
      );
    }

    this.texture.needsUpdate = true;
    return true;
  }

  private writeChunkOpacity(
    chunk: Chunk,
    registry: Registry,
    texWidth: number,
    texHeight: number,
    texDepth: number,
    res: number
  ) {
    const chunkSize = chunk.options.size;
    const maxHeight = chunk.options.maxHeight;
    const [cx, cz] = chunk.coords;
    const chunkMinX = cx * chunkSize;
    const chunkMinZ = cz * chunkSize;

    const volumeMinX = this.volumeMin.x;
    const volumeMinY = this.volumeMin.y;
    const volumeMinZ = this.volumeMin.z;
    const volumeMaxX = volumeMinX + this.volumeSize.x;
    const volumeMaxY = volumeMinY + this.volumeSize.y;
    const volumeMaxZ = volumeMinZ + this.volumeSize.z;

    const startX = Math.max(chunkMinX, volumeMinX);
    const endX = Math.min(chunkMinX + chunkSize, volumeMaxX);
    const startY = Math.max(0, volumeMinY);
    const endY = Math.min(maxHeight, volumeMaxY);
    const startZ = Math.max(chunkMinZ, volumeMinZ);
    const endZ = Math.min(chunkMinZ + chunkSize, volumeMaxZ);

    if (startX >= endX || startY >= endY || startZ >= endZ) {
      return;
    }

    for (let wy = startY; wy < endY; wy += res) {
      for (let wz = startZ; wz < endZ; wz += res) {
        for (let wx = startX; wx < endX; wx += res) {
          const lx = wx - chunkMinX;
          const ly = wy;
          const lz = wz - chunkMinZ;

          const voxel = chunk.getRawValue(lx, ly, lz);
          const blockId = voxel & 0xffff;

          if (blockId === 0) continue;

          const block = registry.blocksById.get(blockId);
          if (!block) continue;

          if (block.isOpaque || (!block.isEmpty && !block.isSeeThrough)) {
            const tx = Math.floor((wx - volumeMinX) / res);
            const ty = Math.floor((wy - volumeMinY) / res);
            const tz = Math.floor((wz - volumeMinZ) / res);

            if (
              tx >= 0 &&
              tx < texWidth &&
              ty >= 0 &&
              ty < texHeight &&
              tz >= 0 &&
              tz < texDepth
            ) {
              const idx = tx + ty * texWidth + tz * texWidth * texHeight;
              this.data[idx] = 255;
            }
          }
        }
      }
    }
  }

  setVoxelOpacity(wx: number, wy: number, wz: number, opaque: boolean) {
    const res = this.config.resolution;
    const texWidth = Math.round(this.gridRes.x);
    const texHeight = Math.round(this.gridRes.y);
    const texDepth = Math.round(this.gridRes.z);

    const tx = Math.floor((wx - this.volumeMin.x) / res);
    const ty = Math.floor((wy - this.volumeMin.y) / res);
    const tz = Math.floor((wz - this.volumeMin.z) / res);

    if (
      tx >= 0 &&
      tx < texWidth &&
      ty >= 0 &&
      ty < texHeight &&
      tz >= 0 &&
      tz < texDepth
    ) {
      const idx = tx + ty * texWidth + tz * texWidth * texHeight;
      this.data[idx] = opaque ? 255 : 0;
      this.texture.needsUpdate = true;
    }
  }

  getTexture(): Data3DTexture {
    return this.texture;
  }

  getVolumeMin(): Vector3 {
    return this.volumeMin.clone();
  }

  getVolumeSize(): Vector3 {
    return this.volumeSize.clone();
  }

  getGridResolution(): Vector3 {
    return this.gridRes.clone();
  }

  dispose() {
    this.texture.dispose();
  }
}
