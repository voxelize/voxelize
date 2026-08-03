import { BatchedMesh, BufferGeometry, Matrix4, Object3D } from "three";

import { CustomChunkShaderMaterial } from "./chunk-materials";
import { ChunkRegionArenasOptions } from "./world-options";

const _translation = new Matrix4();

type SectionSlot = {
  regionKey: string;
  geometryId: number;
  instanceId: number;
  reservedVertexCount: number;
  reservedIndexCount: number;
};

type RegionArena = {
  mesh: BatchedMesh;
  vertexCapacity: number;
  usedVertexCount: number;
  usedIndexCount: number;
  slotCount: number;
};

/**
 * Region buffer arenas for the shared-opaque chunk bucket, adapted from
 * Sodium's region-arena renderer. Every opaque section inside an NxN block of
 * chunk columns lives as one slot of one `BatchedMesh`, so an entire region
 * renders as a single multi-draw call per pass instead of one draw per
 * (section x bucket) mesh, and a remesh rewrites a slot in place
 * (`setGeometryAt`) instead of disposing and recreating GPU buffers.
 *
 * `BatchedMesh` culls and sorts per instance against whichever camera renders
 * it, so sections keep per-section frustum culling in the main pass while the
 * CSM depth passes — which render with the light's camera — still see every
 * caster they need. That per-pass behavior is what the whole-object
 * `chunkCullShadowSafeDistance` bypass exists to approximate for regular
 * meshes; arena sections need no such bypass.
 */
export class ChunkRegionArenas {
  private regions = new Map<string, RegionArena>();

  private sections = new Map<string, SectionSlot>();

  constructor(
    private options: ChunkRegionArenasOptions,
    private maxSectionsPerRegion: number,
    private getMaterial: () => CustomChunkShaderMaterial,
    private parent: Object3D,
  ) {}

  setSectionGeometry(
    cx: number,
    cz: number,
    level: number,
    geometry: BufferGeometry,
    x: number,
    y: number,
    z: number,
  ) {
    const vertexCount = geometry.getAttribute("position").count;
    const index = geometry.getIndex();
    if (vertexCount === 0 || !index || index.count === 0) {
      this.clearSection(cx, cz, level);
      return;
    }

    const sectionKey = `${cx},${cz},${level}`;
    const existing = this.sections.get(sectionKey);
    const region = this.getOrCreateRegion(cx, cz);

    if (
      existing &&
      vertexCount <= existing.reservedVertexCount &&
      index.count <= existing.reservedIndexCount
    ) {
      region.mesh.setGeometryAt(existing.geometryId, geometry);
      return;
    }

    if (existing) {
      this.releaseSlot(region, existing);
      this.sections.delete(sectionKey);
    }

    const { slotSlack } = this.options;
    const reservedVertexCount = Math.ceil(vertexCount * slotSlack);
    const reservedIndexCount = Math.ceil(index.count * slotSlack);
    const geometryId = this.allocateGeometry(
      region,
      geometry,
      reservedVertexCount,
      reservedIndexCount,
    );
    const instanceId = region.mesh.addInstance(geometryId);
    region.mesh.setMatrixAt(instanceId, _translation.makeTranslation(x, y, z));
    region.usedVertexCount += reservedVertexCount;
    region.usedIndexCount += reservedIndexCount;
    region.slotCount += 1;

    this.sections.set(sectionKey, {
      regionKey: this.regionKeyFor(cx, cz),
      geometryId,
      instanceId,
      reservedVertexCount,
      reservedIndexCount,
    });
  }

  setSectionVisible(cx: number, cz: number, level: number, isVisible: boolean) {
    const slot = this.sections.get(`${cx},${cz},${level}`);
    if (!slot) return;
    this.regions
      .get(slot.regionKey)
      ?.mesh.setVisibleAt(slot.instanceId, isVisible);
  }

  clearSection(cx: number, cz: number, level: number) {
    const sectionKey = `${cx},${cz},${level}`;
    const slot = this.sections.get(sectionKey);
    if (!slot) return;

    const region = this.regions.get(slot.regionKey);
    if (region) {
      this.releaseSlot(region, slot);
      if (region.slotCount === 0) {
        this.disposeRegion(slot.regionKey, region);
      }
    }

    this.sections.delete(sectionKey);
  }

  clearChunk(cx: number, cz: number) {
    const prefix = `${cx},${cz},`;
    for (const sectionKey of this.sections.keys()) {
      if (!sectionKey.startsWith(prefix)) continue;
      const [, , level] = sectionKey.split(",");
      this.clearSection(cx, cz, parseInt(level, 10));
    }
  }

  dispose() {
    for (const [regionKey, region] of this.regions) {
      this.disposeRegion(regionKey, region);
    }
    this.sections.clear();
  }

  get stats() {
    return {
      regions: this.regions.size,
      sections: this.sections.size,
    };
  }

  private regionKeyFor(cx: number, cz: number) {
    const { regionSizeInChunks } = this.options;
    const rx = Math.floor(cx / regionSizeInChunks);
    const rz = Math.floor(cz / regionSizeInChunks);
    return `${rx},${rz}`;
  }

  private getOrCreateRegion(cx: number, cz: number) {
    const regionKey = this.regionKeyFor(cx, cz);
    const existing = this.regions.get(regionKey);
    if (existing) return existing;

    const { initialVertexCapacity, indexPerVertexRatio } = this.options;
    const mesh = new BatchedMesh(
      this.maxSectionsPerRegion,
      initialVertexCapacity,
      Math.ceil(initialVertexCapacity * indexPerVertexRatio),
      this.getMaterial(),
    );
    mesh.frustumCulled = false;
    mesh.perObjectFrustumCulled = true;
    mesh.sortObjects = true;
    mesh.matrixAutoUpdate = false;
    mesh.userData.isChunkRegionArena = true;
    this.parent.add(mesh);

    const region: RegionArena = {
      mesh,
      vertexCapacity: initialVertexCapacity,
      usedVertexCount: 0,
      usedIndexCount: 0,
      slotCount: 0,
    };
    this.regions.set(regionKey, region);
    return region;
  }

  private releaseSlot(region: RegionArena, slot: SectionSlot) {
    region.mesh.deleteGeometry(slot.geometryId);
    region.usedVertexCount -= slot.reservedVertexCount;
    region.usedIndexCount -= slot.reservedIndexCount;
    region.slotCount -= 1;
  }

  private disposeRegion(regionKey: string, region: RegionArena) {
    this.parent.remove(region.mesh);
    region.mesh.dispose();
    this.regions.delete(regionKey);
  }

  /**
   * Space in a region only truly runs out at device memory; before that the
   * arena first repacks freed slots (`optimize`), then grows geometrically.
   * Every attempt is made in place so the caller never sees a partial state.
   */
  private allocateGeometry(
    region: RegionArena,
    geometry: BufferGeometry,
    reservedVertexCount: number,
    reservedIndexCount: number,
  ) {
    try {
      return region.mesh.addGeometry(
        geometry,
        reservedVertexCount,
        reservedIndexCount,
      );
    } catch {
      region.mesh.optimize();
    }

    try {
      return region.mesh.addGeometry(
        geometry,
        reservedVertexCount,
        reservedIndexCount,
      );
    } catch {
      const { growthFactor, indexPerVertexRatio } = this.options;
      const requiredVertexCount = region.usedVertexCount + reservedVertexCount;
      const capacity = Math.ceil(
        Math.max(region.vertexCapacity, requiredVertexCount) * growthFactor,
      );
      region.mesh.setGeometrySize(
        capacity,
        Math.ceil(capacity * indexPerVertexRatio),
      );
      region.vertexCapacity = capacity;
    }

    return region.mesh.addGeometry(
      geometry,
      reservedVertexCount,
      reservedIndexCount,
    );
  }
}
