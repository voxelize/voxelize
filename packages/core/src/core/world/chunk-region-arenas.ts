import {
  BatchedMesh,
  BufferGeometry,
  Color,
  Matrix4,
  Object3D,
  Quaternion,
  Vector3,
} from "three";

import { CustomChunkShaderMaterial } from "./chunk-materials";
import { StaticBatchedMesh } from "./static-batched-mesh";
import { POSITION_BLOCK_BIAS } from "./vertex-quantization";
import { ChunkRegionArenasOptions } from "./world-options";

const _transform = new Matrix4();
const _position = new Vector3();
const _rotation = new Quaternion();
const _scale = new Vector3();
// The per-instance batching color is a data channel for the chunk shader,
// not a tint: R carries the section's fog reveal (see vChunkReveal), the
// rest stays 1 (setRGB in the working color space writes the raw values).
// Written on every allocation, so every region owns a color texture from
// its first section and the shader program variant is fixed at load instead
// of recompiling mid-play the first time a fade fires.
const _sectionColor = new Color(1, 1, 1);

type ArenaPage = {
  mesh: BatchedMesh;
  vertexCapacity: number;
  indexCapacity: number;
  /** Vertices and indices reserved by the page's live slots. */
  usedVertexCount: number;
  usedIndexCount: number;
  slotCount: number;
};

type SectionSlot = {
  regionKey: string;
  page: ArenaPage;
  geometryId: number;
  instanceId: number;
  reservedVertexCount: number;
  reservedIndexCount: number;
};

type RegionArena = {
  pages: ArenaPage[];
};

/**
 * Region buffer arenas for batched chunk buckets, adapted from Sodium's
 * region-arena renderer. Every section of the bucket inside an NxN block of
 * chunk columns lives as one slot of the region's pages, so a region draws
 * as one multi-draw call per page per pass instead of one draw per
 * (section x bucket) mesh, and a remesh rewrites a slot in place
 * (`setGeometryAt`) instead of disposing and recreating GPU buffers.
 *
 * A region is pages of `pageVertexCapacity` vertices that never grow: a
 * region that fills opens another page. Growing one buffer instead meant
 * rebuilding and re-uploading the whole region in one frame, tens of
 * megabytes once a forest region passed a million vertices, which landed
 * as a hitch every time a region crossed a threshold. Opening a page
 * uploads one page, and a page that ran out of room between freed slots
 * is compacted (`optimize`), which also moves one page at most.
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
    private positionUnitsPerBlock: number,
    /**
     * Told of each page mesh as it joins the scene (`true`) and before it
     * leaves (`false`), for a host that registers the meshes it draws (the
     * shadow casters it hides, the see-through surfaces it plans).
     */
    private onRegionMesh?: (mesh: BatchedMesh, isAdded: boolean) => void,
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

    if (
      existing &&
      vertexCount <= existing.reservedVertexCount &&
      index.count <= existing.reservedIndexCount
    ) {
      existing.page.mesh.setGeometryAt(existing.geometryId, geometry);
      return;
    }

    const regionKey = this.regionKeyFor(cx, cz);
    const region = this.regions.get(regionKey) ?? { pages: [] };
    this.regions.set(regionKey, region);
    if (existing) {
      this.releaseSlot(region, existing);
      this.sections.delete(sectionKey);
    }

    const { slotSlack } = this.options;
    const reservedVertexCount = Math.ceil(vertexCount * slotSlack);
    const reservedIndexCount = Math.ceil(index.count * slotSlack);
    const page = this.pageWithRoom(
      region,
      reservedVertexCount,
      reservedIndexCount,
    );
    const geometryId = page.mesh.addGeometry(
      geometry,
      reservedVertexCount,
      reservedIndexCount,
    );
    const instanceId = page.mesh.addInstance(geometryId);
    page.mesh.setMatrixAt(instanceId, this.sectionTransform(geometry, x, y, z));
    page.mesh.setColorAt(instanceId, _sectionColor.setRGB(1, 1, 1));
    page.usedVertexCount += reservedVertexCount;
    page.usedIndexCount += reservedIndexCount;
    page.slotCount += 1;

    this.sections.set(sectionKey, {
      regionKey,
      page,
      geometryId,
      instanceId,
      reservedVertexCount,
      reservedIndexCount,
    });
  }

  setSectionVisible(cx: number, cz: number, level: number, isVisible: boolean) {
    const slot = this.sections.get(`${cx},${cz},${level}`);
    if (!slot) return;
    slot.page.mesh.setVisibleAt(slot.instanceId, isVisible);
  }

  /**
   * How much of a section shows through its own fog color, 0 (pure fog
   * tint) to 1 (drawn as itself). Rides the slot's batching color, so a
   * remesh that rewrites the slot in place keeps the value; a slot
   * allocated fresh starts at 1.
   */
  setSectionReveal(cx: number, cz: number, level: number, reveal: number) {
    const slot = this.sections.get(`${cx},${cz},${level}`);
    if (!slot) return false;
    slot.page.mesh.setColorAt(
      slot.instanceId,
      _sectionColor.setRGB(Math.min(1, Math.max(0, reveal)), 1, 1),
    );
    return true;
  }

  clearSection(cx: number, cz: number, level: number) {
    const sectionKey = `${cx},${cz},${level}`;
    const slot = this.sections.get(sectionKey);
    if (!slot) return;

    const region = this.regions.get(slot.regionKey);
    if (region) {
      this.releaseSlot(region, slot);
      if (region.pages.length === 0) this.regions.delete(slot.regionKey);
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
    for (const region of this.regions.values()) {
      for (const page of region.pages) this.disposePage(page);
    }
    this.regions.clear();
    this.sections.clear();
  }

  get stats() {
    let pages = 0;
    for (const region of this.regions.values()) pages += region.pages.length;
    return {
      regions: this.regions.size,
      pages,
      sections: this.sections.size,
    };
  }

  /**
   * Quantized sections store positions as biased fixed-point counts; the
   * instance matrix carries the mapping back to block space so every camera
   * that renders the arena — main pass or the CSM depth passes with their
   * scene-wide override material — sees correct world positions.
   */
  private sectionTransform(
    geometry: BufferGeometry,
    x: number,
    y: number,
    z: number,
  ) {
    const isQuantized =
      geometry.getAttribute("position").array instanceof Uint16Array;
    if (!isQuantized) {
      return _transform.makeTranslation(x, y, z);
    }

    _position.set(
      x - POSITION_BLOCK_BIAS,
      y - POSITION_BLOCK_BIAS,
      z - POSITION_BLOCK_BIAS,
    );
    _scale.setScalar(1 / this.positionUnitsPerBlock);
    return _transform.compose(_position, _rotation.identity(), _scale);
  }

  private regionKeyFor(cx: number, cz: number) {
    const { regionSizeInChunks } = this.options;
    const rx = Math.floor(cx / regionSizeInChunks);
    const rz = Math.floor(cz / regionSizeInChunks);
    return `${rx},${rz}`;
  }

  /**
   * A page of `region` with room for a slot of this size: the first with
   * room at its end, else the first whose freed slots add up to it once
   * compacted, else a new page (as large as the slot when the slot is
   * larger than a page).
   */
  private pageWithRoom(
    region: RegionArena,
    vertexCount: number,
    indexCount: number,
  ): ArenaPage {
    for (const page of region.pages) {
      if (
        page.mesh.unusedVertexCount >= vertexCount &&
        page.mesh.unusedIndexCount >= indexCount
      ) {
        return page;
      }
    }
    for (const page of region.pages) {
      if (
        page.vertexCapacity - page.usedVertexCount >= vertexCount &&
        page.indexCapacity - page.usedIndexCount >= indexCount
      ) {
        page.mesh.optimize();
        return page;
      }
    }
    const { pageVertexCapacity, indexPerVertexRatio } = this.options;
    const vertexCapacity = Math.max(pageVertexCapacity, vertexCount);
    const indexCapacity = Math.max(
      Math.ceil(pageVertexCapacity * indexPerVertexRatio),
      indexCount,
    );
    const mesh = new StaticBatchedMesh(
      this.maxSectionsPerRegion,
      vertexCapacity,
      indexCapacity,
      this.getMaterial(),
    );
    mesh.frustumCulled = false;
    mesh.perObjectFrustumCulled = true;
    mesh.sortObjects = true;
    mesh.matrixAutoUpdate = false;
    mesh.userData.isChunkRegionArena = true;
    this.parent.add(mesh);
    this.onRegionMesh?.(mesh, true);
    const page: ArenaPage = {
      mesh,
      vertexCapacity,
      indexCapacity,
      usedVertexCount: 0,
      usedIndexCount: 0,
      slotCount: 0,
    };
    region.pages.push(page);
    return page;
  }

  /** Frees a slot's space in its page; a page left empty is dropped. */
  private releaseSlot(region: RegionArena, slot: SectionSlot) {
    const { page } = slot;
    page.mesh.deleteGeometry(slot.geometryId);
    page.usedVertexCount -= slot.reservedVertexCount;
    page.usedIndexCount -= slot.reservedIndexCount;
    page.slotCount -= 1;
    if (page.slotCount > 0) return;
    region.pages.splice(region.pages.indexOf(page), 1);
    this.disposePage(page);
  }

  private disposePage(page: ArenaPage) {
    this.onRegionMesh?.(page.mesh, false);
    this.parent.remove(page.mesh);
    page.mesh.dispose();
  }
}
