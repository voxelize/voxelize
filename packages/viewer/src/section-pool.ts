/**
 * One material's chunk geometry, drawn as one multi-draw per page per pass
 * (the main view and each shadow cascade) instead of one draw per chunk.
 *
 * Pages are `BatchedMesh`es of a fixed size. A section takes a slot of the
 * smallest power-of-two vertex count that holds it, and the slot a chunk
 * leaves behind is reused in place by the next section of its size, so once
 * the pool covers the resident set a pan only copies real bytes into
 * buffers that already exist. Nothing is ever regrown: three uploads a new
 * buffer whole, zeros and all, and a 30-70 MB one held a frame for a tenth
 * of a second.
 */
import {
  BatchedMesh,
  type BufferAttribute,
  type Box3,
  type BufferGeometry,
  type Camera,
  DataTexture,
  Group,
  type Material,
  type Matrix4,
  RedIntegerFormat,
  type Scene,
  type Sphere,
  UnsignedIntType,
  type WebGLRenderer,
} from "three";

/** The slice of a `BatchedMesh` geometry entry `setGeometryAt` writes (three 0.183). */
type GeometryInfo = {
  vertexStart: number;
  vertexCount: number;
  reservedVertexCount: number;
  indexStart: number;
  indexCount: number;
  reservedIndexCount: number;
  start: number;
  count: number;
  boundingBox: Box3 | null;
  boundingSphere: Sphere | null;
};

/** Draw lists a page cycles through: four passes a frame, two frames in flight. */
const DRAW_LIST_RING = 8;

/**
 * A `BatchedMesh` tuned for a pool:
 *
 * - `setGeometryAt` copies with typed-array `set` and one index loop, and
 *   uploads only the section's own bytes. Three's zero-fills the rest of the
 *   slot and rebases every index through `setComponent`/`setX`, about 400k
 *   calls for a chunk: in a power-of-two slot that was most of a pan's
 *   main-thread time. The tail it skips is never drawn (a draw covers the
 *   section's own indices).
 * - Each pass (the main view and every shadow cascade culls the page for
 *   its own camera) writes its draw list into the next texture of a ring.
 *   With one texture, every pass rewrote the list the pass before had just
 *   drawn with, and the driver waited for that draw: 10-35 ms a frame.
 */
export class PoolPage extends BatchedMesh {
  private drawLists: DataTexture[] = [];

  private nextDrawList = 0;

  override onBeforeRender(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    geometry: BufferGeometry,
    material: Material,
    group: unknown,
  ) {
    const self = this as unknown as { _indirectTexture: DataTexture };
    if (this.drawLists.length === 0) {
      const first = self._indirectTexture;
      const size = first.image.width;
      this.drawLists.push(first);
      while (this.drawLists.length < DRAW_LIST_RING) {
        this.drawLists.push(
          new DataTexture(
            new Uint32Array(size * size),
            size,
            size,
            RedIntegerFormat,
            UnsignedIntType,
          ),
        );
      }
    }
    self._indirectTexture = this.drawLists[this.nextDrawList];
    this.nextDrawList = (this.nextDrawList + 1) % this.drawLists.length;
    super.onBeforeRender(
      renderer,
      scene,
      camera,
      geometry,
      material,
      group as never,
    );
  }

  override dispose() {
    const self = this as unknown as { _indirectTexture: DataTexture | null };
    for (const list of this.drawLists) {
      if (list !== self._indirectTexture) list.dispose();
    }
    this.drawLists = [];
    return super.dispose();
  }

  override setGeometryAt(geometryId: number, geometry: BufferGeometry) {
    const self = this as unknown as {
      _geometryInfo: GeometryInfo[];
      _validateGeometry(geometry: BufferGeometry): void;
      _visibilityChanged: boolean;
    };
    self._validateGeometry(geometry);
    const info = self._geometryInfo[geometryId];
    const vertexCount = geometry.getAttribute("position").count;
    const sourceIndex = geometry.getIndex();
    const targetIndex = this.geometry.getIndex();
    if (!sourceIndex || !targetIndex) {
      throw new Error("a pool page holds indexed geometry only");
    }
    if (
      vertexCount > info.reservedVertexCount ||
      sourceIndex.count > info.reservedIndexCount
    ) {
      throw new Error(
        `a section of ${vertexCount} vertices and ${sourceIndex.count} indices overflows its slot`,
      );
    }
    const start = info.vertexStart;
    for (const name in this.geometry.attributes) {
      const target = this.geometry.getAttribute(name) as BufferAttribute;
      const source = geometry.getAttribute(name) as BufferAttribute;
      if (source.array.constructor !== target.array.constructor) {
        throw new Error(
          `${name} is ${source.array.constructor.name} here and ${target.array.constructor.name} in the page`,
        );
      }
      target.array.set(source.array, start * target.itemSize);
      target.addUpdateRange(
        start * target.itemSize,
        vertexCount * target.itemSize,
      );
      target.needsUpdate = true;
    }
    const from = sourceIndex.array;
    const to = targetIndex.array;
    const indexStart = info.indexStart;
    for (let i = 0; i < from.length; i++) to[indexStart + i] = from[i] + start;
    targetIndex.addUpdateRange(indexStart, from.length);
    targetIndex.needsUpdate = true;
    info.vertexCount = vertexCount;
    info.indexCount = sourceIndex.count;
    info.start = indexStart;
    info.count = sourceIndex.count;
    info.boundingBox = geometry.boundingBox?.clone() ?? null;
    info.boundingSphere = geometry.boundingSphere?.clone() ?? null;
    self._visibilityChanged = true;
    return geometryId;
  }
}

type Page = {
  mesh: PoolPage;
  vertices: number;
  indices: number;
  usedVertices: number;
  usedIndices: number;
};

/** A section's place in a pool. */
export type SectionSlot = {
  readonly page: Page;
  readonly geometryId: number;
  readonly instanceId: number;
  /** Vertices and indices the slot holds. */
  readonly vertices: number;
  readonly indices: number;
};

export type SectionPoolStats = {
  pages: number;
  slots: number;
  freeSlots: number;
  /** Vertices the pages hold, and those the held slots reserve. */
  capacity: number;
  reserved: number;
};

/** The smallest slot, in vertices. */
const MIN_SLOT = 256;

/**
 * Sections a page holds at most. Each pass re-uploads a page's draw list
 * and each change its matrices, both sized by this, so it stays near what a
 * page holds rather than its smallest slots' count.
 */
const MAX_SECTIONS = 512;

/**
 * A page is sized for about this many sections like the one that opens it,
 * up to `MAX_PAGE` vertices: every page is a draw call and a draw-list
 * upload a pass, and pages sized for the smallest material put a leaf-heavy
 * chunk's foliage alone in a page (417 pages for 2008 sections).
 */
const SECTIONS_PER_PAGE = 128;
const MAX_PAGE = 1 << 20;

/** Quads: six indices for four vertices. */
const INDICES_PER_VERTEX = 1.5;

const slotSize = (count: number) => {
  let size = MIN_SLOT;
  while (size < count) size *= 2;
  return size;
};

export class SectionPool {
  readonly group = new Group();

  /** Bytes of GPU buffer the pool has made since the caller last took them. */
  private madeBytes = 0;

  private pages: Page[] = [];

  /** Slots no section holds, by `${vertices}:${indices}`. */
  private free = new Map<string, SectionSlot[]>();

  private held = 0;

  private reserved = 0;

  constructor(
    private readonly material: Material,
    /** The fewest vertices a page holds. */
    private readonly pageVertices: number,
    /** Sort a page's sections by depth each pass (blended materials). */
    private readonly isSorted: boolean,
  ) {
    this.group.matrixAutoUpdate = false;
  }

  /** Put a section in a free slot of its size, or a new one, at `matrix`. */
  add(geometry: BufferGeometry, matrix: Matrix4): SectionSlot {
    const vertexCount = geometry.getAttribute("position").count;
    const indexCount = geometry.getIndex()?.count ?? 0;
    const vertices = slotSize(vertexCount);
    const indices = Math.max(
      Math.ceil(vertices * INDICES_PER_VERTEX),
      slotSize(indexCount),
    );
    let slot = this.free.get(`${vertices}:${indices}`)?.pop();
    if (slot) {
      slot.page.mesh.setGeometryAt(slot.geometryId, geometry);
      slot.page.mesh.setVisibleAt(slot.instanceId, true);
    } else {
      const page = this.pageWithRoom(vertices, indices, geometry);
      const geometryId = page.mesh.addGeometry(geometry, vertices, indices);
      const instanceId = page.mesh.addInstance(geometryId);
      page.usedVertices += vertices;
      page.usedIndices += indices;
      slot = { page, geometryId, instanceId, vertices, indices };
    }
    slot.page.mesh.setMatrixAt(slot.instanceId, matrix);
    this.held += 1;
    this.reserved += vertices;
    return slot;
  }

  /** Hide a section and keep its slot for the next one of its size. */
  remove(slot: SectionSlot) {
    slot.page.mesh.setVisibleAt(slot.instanceId, false);
    const key = `${slot.vertices}:${slot.indices}`;
    const list = this.free.get(key);
    if (list) list.push(slot);
    else this.free.set(key, [slot]);
    this.held -= 1;
    this.reserved -= slot.vertices;
  }

  /** Bytes of GPU buffer made since the last call: they count against an upload budget. */
  takeMadeBytes() {
    const bytes = this.madeBytes;
    this.madeBytes = 0;
    return bytes;
  }

  get stats(): SectionPoolStats {
    let freeSlots = 0;
    for (const list of this.free.values()) freeSlots += list.length;
    return {
      pages: this.pages.length,
      slots: this.held,
      freeSlots,
      capacity: this.pages.reduce((sum, page) => sum + page.vertices, 0),
      reserved: this.reserved,
    };
  }

  dispose() {
    for (const page of this.pages) {
      this.group.remove(page.mesh);
      page.mesh.dispose();
    }
    this.pages = [];
    this.free.clear();
  }

  private pageWithRoom(
    vertices: number,
    indices: number,
    geometry: BufferGeometry,
  ): Page {
    for (const page of this.pages) {
      if (
        page.vertices - page.usedVertices >= vertices &&
        page.indices - page.usedIndices >= indices &&
        page.mesh.instanceCount < page.mesh.maxInstanceCount
      )
        return page;
    }
    const pageVertices = Math.max(
      this.pageVertices,
      vertices,
      Math.min(MAX_PAGE, vertices * SECTIONS_PER_PAGE),
    );
    const pageIndices = Math.max(
      Math.ceil(pageVertices * INDICES_PER_VERTEX),
      indices,
    );
    const mesh = new PoolPage(
      Math.min(MAX_SECTIONS, Math.ceil(pageVertices / MIN_SLOT)),
      pageVertices,
      pageIndices,
      this.material,
    );
    mesh.name = `${this.group.name}-page-${this.pages.length}`;
    // Each section is culled on its own, against whichever camera draws it.
    mesh.frustumCulled = false;
    mesh.perObjectFrustumCulled = true;
    mesh.sortObjects = this.isSorted;
    mesh.matrixAutoUpdate = false;
    mesh.castShadow = this.material.userData.skipShadow !== true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    mesh.updateMatrixWorld();
    let vertexBytes = 0;
    for (const attribute of Object.values(geometry.attributes)) {
      vertexBytes += attribute.itemSize * attribute.array.BYTES_PER_ELEMENT;
    }
    this.madeBytes += pageVertices * vertexBytes + pageIndices * 4;
    const page: Page = {
      mesh,
      vertices: pageVertices,
      indices: pageIndices,
      usedVertices: 0,
      usedIndices: 0,
    };
    this.pages.push(page);
    return page;
  }
}
