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
  private volumeMin = new Vector3();
  private volumeSize = new Vector3();
  private dirtyRegions = new Set<string>();
  private pendingUpdate = false;
  private maxUpdatesPerFrame = 4;

  constructor(config: Partial<LightVolumeConfig> = {}) {
    this.config = { ...defaultConfig, ...config };

    const [width, height, depth] = this.config.size;
    const res = this.config.resolution;
    const texWidth = Math.ceil(width / res);
    const texHeight = Math.ceil(height / res);
    const texDepth = Math.ceil(depth / res);

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
  }

  updateCenter(center: Vector3) {
    const halfSize = this.volumeSize.clone().multiplyScalar(0.5);
    this.volumeMin.copy(center).sub(halfSize);

    this.volumeMin.x = Math.floor(this.volumeMin.x);
    this.volumeMin.y = Math.floor(this.volumeMin.y);
    this.volumeMin.z = Math.floor(this.volumeMin.z);
  }

  updateFromRegistry(registry: LightSourceRegistry) {
    const volumeMax = this.volumeMin.clone().add(this.volumeSize);
    const lights = registry.getLightsInRegion(this.volumeMin, volumeMax);

    this.data.fill(0);

    const [width, height, depth] = this.config.size;
    const res = this.config.resolution;
    const texWidth = Math.ceil(width / res);
    const texHeight = Math.ceil(height / res);
    const texDepth = Math.ceil(depth / res);

    for (const light of lights) {
      this.accumulateLight(light, texWidth, texHeight, texDepth);
    }

    this.texture.needsUpdate = true;
  }

  private accumulateLight(
    light: DynamicLight,
    texWidth: number,
    texHeight: number,
    texDepth: number
  ) {
    const res = this.config.resolution;
    const radius = light.radius;
    const falloff = light.falloffExponent;

    const localPos = light.position.clone().sub(this.volumeMin);

    const minX = Math.max(0, Math.floor((localPos.x - radius) / res));
    const maxX = Math.min(texWidth - 1, Math.ceil((localPos.x + radius) / res));
    const minY = Math.max(0, Math.floor((localPos.y - radius) / res));
    const maxY = Math.min(
      texHeight - 1,
      Math.ceil((localPos.y + radius) / res)
    );
    const minZ = Math.max(0, Math.floor((localPos.z - radius) / res));
    const maxZ = Math.min(texDepth - 1, Math.ceil((localPos.z + radius) / res));

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const worldX = x * res + res * 0.5;
          const worldY = y * res + res * 0.5;
          const worldZ = z * res + res * 0.5;

          const dx = worldX - localPos.x;
          const dy = worldY - localPos.y;
          const dz = worldZ - localPos.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (dist > radius) continue;

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

  getVolumeMin(): Vector3 {
    return this.volumeMin.clone();
  }

  getVolumeSize(): Vector3 {
    return this.volumeSize.clone();
  }

  getResolution(): Vector3 {
    const [width, height, depth] = this.config.size;
    const res = this.config.resolution;
    return new Vector3(
      Math.ceil(width / res),
      Math.ceil(height / res),
      Math.ceil(depth / res)
    );
  }

  dispose() {
    this.texture.dispose();
  }
}
