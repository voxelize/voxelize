import { Color, Vector3 } from "three";

export interface DynamicLight {
  id: string;
  position: Vector3;
  color: Color;
  intensity: number;
  radius: number;
  falloffExponent: number;
}

export interface LightRegion {
  min: Vector3;
  max: Vector3;
}

export class LightSourceRegistry {
  private lights = new Map<string, DynamicLight>();
  private dirtyRegions = new Set<string>();
  private onLightChangedCallbacks: ((light: DynamicLight) => void)[] = [];

  addLight(id: string, light: Omit<DynamicLight, "id">): DynamicLight {
    const fullLight: DynamicLight = { id, ...light };
    this.lights.set(id, fullLight);
    this.markRegionDirty(light.position, light.radius);
    this.notifyLightChanged(fullLight);
    return fullLight;
  }

  removeLight(id: string): boolean {
    const light = this.lights.get(id);
    if (light) {
      this.markRegionDirty(light.position, light.radius);
      this.lights.delete(id);
      return true;
    }
    return false;
  }

  updateLight(id: string, updates: Partial<Omit<DynamicLight, "id">>): boolean {
    const light = this.lights.get(id);
    if (!light) return false;

    this.markRegionDirty(light.position, light.radius);

    if (updates.position) light.position.copy(updates.position);
    if (updates.color) light.color.copy(updates.color);
    if (updates.intensity !== undefined) light.intensity = updates.intensity;
    if (updates.radius !== undefined) light.radius = updates.radius;
    if (updates.falloffExponent !== undefined)
      light.falloffExponent = updates.falloffExponent;

    this.markRegionDirty(light.position, light.radius);
    this.notifyLightChanged(light);
    return true;
  }

  getLight(id: string): DynamicLight | undefined {
    return this.lights.get(id);
  }

  getAllLights(): DynamicLight[] {
    const lights = new Array<DynamicLight>(this.lights.size);
    let index = 0;
    let lightEntries = this.lights.values();
    let lightEntry = lightEntries.next();
    while (!lightEntry.done) {
      lights[index] = lightEntry.value;
      index++;
      lightEntry = lightEntries.next();
    }
    return lights;
  }

  getLightsInRegion(min: Vector3, max: Vector3): DynamicLight[] {
    const result: DynamicLight[] = [];
    this.getLightsInRegionInto(min, max, result);
    return result;
  }

  getLightsInRegionInto(
    min: Vector3,
    max: Vector3,
    out: DynamicLight[]
  ): number {
    let count = 0;
    let lightEntries = this.lights.values();
    let lightEntry = lightEntries.next();
    while (!lightEntry.done) {
      const light = lightEntry.value;
      const pos = light.position;
      const r = light.radius;

      if (
        pos.x + r >= min.x &&
        pos.x - r <= max.x &&
        pos.y + r >= min.y &&
        pos.y - r <= max.y &&
        pos.z + r >= min.z &&
        pos.z - r <= max.z
      ) {
        out[count] = light;
        count++;
      }
      lightEntry = lightEntries.next();
    }

    out.length = count;
    return count;
  }

  getLightsNearPoint(point: Vector3, maxDistance: number): DynamicLight[] {
    const result: DynamicLight[] = [];
    this.getLightsNearPointInto(point, maxDistance, result);
    return result;
  }

  getLightsNearPointInto(
    point: Vector3,
    maxDistance: number,
    out: DynamicLight[]
  ): number {
    let count = 0;

    let lightEntries = this.lights.values();
    let lightEntry = lightEntries.next();
    while (!lightEntry.done) {
      const light = lightEntry.value;
      const maxDist = maxDistance + light.radius;
      const dx = light.position.x - point.x;
      const dy = light.position.y - point.y;
      const dz = light.position.z - point.z;
      if (dx * dx + dy * dy + dz * dz <= maxDist * maxDist) {
        out[count] = light;
        count++;
      }
      lightEntry = lightEntries.next();
    }

    out.length = count;
    return count;
  }

  private markRegionDirty(center: Vector3, radius: number) {
    const regionSize = 16;
    const minX = Math.floor((center.x - radius) / regionSize);
    const maxX = Math.floor((center.x + radius) / regionSize);
    const minY = Math.floor((center.y - radius) / regionSize);
    const maxY = Math.floor((center.y + radius) / regionSize);
    const minZ = Math.floor((center.z - radius) / regionSize);
    const maxZ = Math.floor((center.z + radius) / regionSize);

    for (let x = minX; x <= maxX; x++) {
      const xPrefix = `${x}|`;
      for (let y = minY; y <= maxY; y++) {
        const xyPrefix = `${xPrefix}${y}|`;
        for (let z = minZ; z <= maxZ; z++) {
          this.dirtyRegions.add(`${xyPrefix}${z}`);
        }
      }
    }
  }

  getDirtyRegions(): string[] {
    const dirtyRegions = new Array<string>(this.dirtyRegions.size);
    let index = 0;
    let regionEntries = this.dirtyRegions.values();
    let regionEntry = regionEntries.next();
    while (!regionEntry.done) {
      dirtyRegions[index] = regionEntry.value;
      index++;
      regionEntry = regionEntries.next();
    }
    return dirtyRegions;
  }

  hasDirtyRegions(): boolean {
    return this.dirtyRegions.size > 0;
  }

  clearDirtyRegions() {
    this.dirtyRegions.clear();
  }

  onLightChanged(callback: (light: DynamicLight) => void) {
    this.onLightChangedCallbacks.push(callback);
  }

  private notifyLightChanged(light: DynamicLight) {
    for (
      let callbackIndex = 0;
      callbackIndex < this.onLightChangedCallbacks.length;
      callbackIndex++
    ) {
      this.onLightChangedCallbacks[callbackIndex](light);
    }
  }

  get lightCount(): number {
    return this.lights.size;
  }

  clear() {
    this.lights.clear();
    this.dirtyRegions.clear();
  }
}
