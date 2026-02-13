import {
  ClampToEdgeWrapping,
  Data3DTexture,
  LinearFilter,
  RGBAFormat,
  UnsignedByteType,
  Vector3,
} from "three";

import type { DynamicLight, LightSourceRegistry } from "./light-registry";

export interface LightVolumeConfig {
  size: [number, number, number];
  resolution: number;
}

const defaultConfig: LightVolumeConfig = {
  size: [128, 64, 128],
  resolution: 1,
};

export class LightVolume {
  private config: LightVolumeConfig;
  private texture: Data3DTexture;
  private data: Uint8Array;
  private texWidth = 0;
  private texHeight = 0;
  private texDepth = 0;
  private halfSizeX = 0;
  private halfSizeY = 0;
  private halfSizeZ = 0;
  private volumeMin = new Vector3();
  private volumeSize = new Vector3();
  private lastCenterX = NaN;
  private lastCenterY = NaN;
  private lastCenterZ = NaN;
  private lastRegistryVersion = -1;
  private registryVersion = 0;

  private tempVolumeMax = new Vector3();
  private tempLocalPos = new Vector3();
  private lightsInRegionBuffer: DynamicLight[] = [];

  constructor(config: Partial<LightVolumeConfig> = {}) {
    this.config = { ...defaultConfig, ...config };

    const [width, height, depth] = this.config.size;
    const res = this.config.resolution;
    this.texWidth = Math.ceil(width / res);
    this.texHeight = Math.ceil(height / res);
    this.texDepth = Math.ceil(depth / res);
    const texWidth = this.texWidth;
    const texHeight = this.texHeight;
    const texDepth = this.texDepth;

    this.data = new Uint8Array(texWidth * texHeight * texDepth * 4);
    this.data.fill(255);

    this.texture = new Data3DTexture(this.data, texWidth, texHeight, texDepth);
    this.texture.format = RGBAFormat;
    this.texture.type = UnsignedByteType;
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.wrapS = ClampToEdgeWrapping;
    this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.wrapR = ClampToEdgeWrapping;
    this.texture.needsUpdate = true;

    this.volumeSize.set(width, height, depth);
    this.halfSizeX = width * 0.5;
    this.halfSizeY = height * 0.5;
    this.halfSizeZ = depth * 0.5;
  }

  markDirty() {
    this.registryVersion++;
  }

  updateCenter(center: Vector3): boolean {
    const newMinX = Math.floor(center.x - this.halfSizeX);
    const newMinY = Math.floor(center.y - this.halfSizeY);
    const newMinZ = Math.floor(center.z - this.halfSizeZ);

    const moved =
      newMinX !== this.lastCenterX ||
      newMinY !== this.lastCenterY ||
      newMinZ !== this.lastCenterZ;

    if (moved) {
      this.volumeMin.set(newMinX, newMinY, newMinZ);
      this.lastCenterX = newMinX;
      this.lastCenterY = newMinY;
      this.lastCenterZ = newMinZ;
      this.registryVersion++;
    }

    return moved;
  }

  updateFromRegistry(registry: LightSourceRegistry): boolean {
    const hasDirtyRegions = registry.hasDirtyRegions();

    if (hasDirtyRegions) {
      this.registryVersion++;
      registry.clearDirtyRegions();
    }

    if (this.registryVersion === this.lastRegistryVersion) {
      return false;
    }
    this.lastRegistryVersion = this.registryVersion;

    this.tempVolumeMax.copy(this.volumeMin).add(this.volumeSize);
    const lights = this.lightsInRegionBuffer;
    const lightCount = registry.getLightsInRegionInto(
      this.volumeMin,
      this.tempVolumeMax,
      lights
    );

    this.data.fill(0);

    const texWidth = this.texWidth;
    const texHeight = this.texHeight;
    const texDepth = this.texDepth;

    for (let lightIndex = 0; lightIndex < lightCount; lightIndex++) {
      this.accumulateLight(lights[lightIndex], texWidth, texHeight, texDepth);
    }

    this.texture.needsUpdate = true;
    return true;
  }

  private accumulateLight(
    light: DynamicLight,
    texWidth: number,
    texHeight: number,
    texDepth: number
  ) {
    const res = this.config.resolution;
    const radius = light.radius;
    if (radius <= 0) {
      return;
    }
    const radiusSq = radius * radius;
    const falloff = light.falloffExponent;

    this.tempLocalPos.copy(light.position).sub(this.volumeMin);

    const minX = Math.max(0, Math.floor((this.tempLocalPos.x - radius) / res));
    const maxX = Math.min(
      texWidth - 1,
      Math.ceil((this.tempLocalPos.x + radius) / res)
    );
    const minY = Math.max(0, Math.floor((this.tempLocalPos.y - radius) / res));
    const maxY = Math.min(
      texHeight - 1,
      Math.ceil((this.tempLocalPos.y + radius) / res)
    );
    const minZ = Math.max(0, Math.floor((this.tempLocalPos.z - radius) / res));
    const maxZ = Math.min(
      texDepth - 1,
      Math.ceil((this.tempLocalPos.z + radius) / res)
    );

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const worldX = x * res + res * 0.5;
          const worldY = y * res + res * 0.5;
          const worldZ = z * res + res * 0.5;

          const dx = worldX - this.tempLocalPos.x;
          const dy = worldY - this.tempLocalPos.y;
          const dz = worldZ - this.tempLocalPos.z;
          const distSq = dx * dx + dy * dy + dz * dz;
          if (distSq > radiusSq) continue;

          const dist = Math.sqrt(distSq);
          const attenuation = Math.pow(Math.max(0, 1 - dist / radius), falloff);
          const intensity = light.intensity * attenuation;

          const idx = (x + y * texWidth + z * texWidth * texHeight) * 4;

          this.data[idx + 0] = Math.min(
            255,
            this.data[idx + 0] + Math.round(light.color.r * 255 * intensity)
          );
          this.data[idx + 1] = Math.min(
            255,
            this.data[idx + 1] + Math.round(light.color.g * 255 * intensity)
          );
          this.data[idx + 2] = Math.min(
            255,
            this.data[idx + 2] + Math.round(light.color.b * 255 * intensity)
          );
          this.data[idx + 3] = 255;
        }
      }
    }
  }

  getTexture(): Data3DTexture {
    return this.texture;
  }

  getVolumeMin(target?: Vector3): Vector3 {
    if (target) {
      return target.copy(this.volumeMin);
    }
    return this.volumeMin.clone();
  }

  getVolumeSize(target?: Vector3): Vector3 {
    if (target) {
      return target.copy(this.volumeSize);
    }
    return this.volumeSize.clone();
  }

  getResolution(): Vector3 {
    return new Vector3(this.texWidth, this.texHeight, this.texDepth);
  }

  dispose() {
    this.texture.dispose();
  }
}
