/**
 * The far layer's tile meshes in a few BatchedMeshes (pages), each drawn
 * with one multi-draw call instead of one call per tile: at the full reach
 * that was about two hundred draws, and their per-draw CPU cost was nearly
 * all the layer cost.
 *
 * Pages rather than one batch because of what an upload costs on a Mac.
 * ANGLE's Metal backend (every browser there) answers a `bufferSubData`
 * into a buffer the GPU still draws from by allocating a new buffer of the
 * whole size and copying all of the old one into it. The layer is drawn
 * every frame and takes tiles all through a flight, so one batch of every
 * resident tile (hundreds of megabytes at the game's finest step, crowns
 * above all) copied itself whole for each tile and backed the GPU up: a
 * pan in the world viewer ran at 15 fps. A tile landing now copies only its
 * page, `FAR_PAGE_VERTICES` vertices.
 *
 * In a page a tile takes a slot of the smallest power-of-two vertex count
 * that holds it, or a free one up to `REUSE_SLACK` times that, and only its
 * own vertices are drawn. A slot a dropped tile leaves is reused in place;
 * nothing is ever compacted. Each tile's fade rides in the instance colour
 * (red its opacity, green 1 while drawn), which the far shader reads by
 * draw id.
 */

import {
  BatchedMesh,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Material,
  Matrix4,
  Sphere,
  Vector3,
} from "three";

import { FAR_POSITION_SIZE, type FarMeshData } from "./far-terrain-mesh";
import { StaticBatchedMesh } from "./static-batched-mesh";

/** One tile mesh's place in the batch. */
export type FarBatchSlot = {
  /** The page the slot is in. */
  readonly page: BatchedMesh;
  readonly geometryId: number;
  readonly instanceId: number;
  /** Vertices the slot holds. */
  readonly capacity: number;
  /** Debug name, `far-terrain-<tile id>` or `far-terrain-sky-<tile id>`. */
  name: string;
  /** Vertices the tile draws, three a triangle. */
  vertexCount: number;
  visible: boolean;
  opacity: number;
  isDrawn: boolean;
};

/**
 * Vertices a page holds, about 5 MB at 20 bytes a vertex: what one tile
 * landing copies on a Mac. A tile larger than that gets a page of its own.
 */
export const FAR_PAGE_VERTICES = 1 << 20;

/** The smallest slot, in vertices. */
const MIN_SLOT = 1024;

/** How many times a tile's own slot size a free slot it reuses may be. */
const REUSE_SLACK = 4;

/** Instances a new page starts with; the table doubles when it fills. */
const PAGE_INSTANCES = 64;

const slotCapacity = (vertices: number) => {
  let capacity = MIN_SLOT;
  while (capacity < vertices) capacity *= 2;
  return capacity;
};

/**
 * Draw a slot's first `count` vertices only. A BatchedMesh without an index
 * draws a geometry's whole reserved range, the slot's zero padding with it
 * (a third of its vertices on average); three 0.183 keeps the range on
 * `_geometryInfo`, and a three without it throws here.
 */
const setDrawCount = (page: BatchedMesh, geometryId: number, count: number) => {
  const info = (page as unknown as { _geometryInfo?: { count: number }[] })
    ._geometryInfo?.[geometryId];
  if (!info) {
    throw new Error(
      "[far-terrain] BatchedMesh has no _geometryInfo; the far batch cannot trim its draws",
    );
  }
  info.count = count;
};

const matrix = new Matrix4();
const color = new Color();

export class FarBatch {
  /** Every page, as one object for the far layer to add to its scene. */
  readonly root = new Group();

  private pageList: BatchedMesh[] = [];

  /** Slots no tile holds, by capacity. */
  private free = new Map<number, FarBatchSlot[]>();

  /** Padded attribute arrays per capacity, reused for every copy in. */
  private scratch = new Map<number, BufferGeometry>();

  private slotCount = 0;

  constructor(
    readonly material: Material,
    private readonly pageVertices = FAR_PAGE_VERTICES,
  ) {
    this.root.name = "far-terrain-batch";
  }

  /** Slots made so far, held or free. */
  get slots() {
    return this.slotCount;
  }

  /** The pages, one draw call each. */
  get pages(): readonly BatchedMesh[] {
    return this.pageList;
  }

  /**
   * Put a tile mesh into a free slot that holds it, or a new one, at
   * `(originX, 0, originZ)`. It starts hidden: `setFade` shows it.
   */
  add(
    data: FarMeshData,
    originX: number,
    originZ: number,
    span: number,
    name: string,
  ): FarBatchSlot {
    const vertices = data.position.length / FAR_POSITION_SIZE;
    let slot = this.takeFree(vertices);
    if (slot) {
      slot.page.setGeometryAt(
        slot.geometryId,
        this.fill(data, slot.capacity, span),
      );
    } else {
      const capacity = slotCapacity(vertices);
      const page = this.pageWithRoom(capacity);
      const geometryId = page.addGeometry(
        this.fill(data, capacity, span),
        capacity,
      );
      if (page.instanceCount >= page.maxInstanceCount) {
        page.setInstanceCount(page.maxInstanceCount * 2);
      }
      const instanceId = page.addInstance(geometryId);
      this.slotCount += 1;
      slot = {
        page,
        geometryId,
        instanceId,
        capacity,
        name,
        vertexCount: 0,
        visible: true,
        opacity: -1,
        isDrawn: false,
      };
    }
    setDrawCount(slot.page, slot.geometryId, vertices);
    slot.name = name;
    slot.vertexCount = vertices;
    slot.page.setMatrixAt(
      slot.instanceId,
      matrix.makeTranslation(originX, 0, originZ),
    );
    slot.visible = true;
    slot.opacity = -1;
    this.setFade(slot, 0, false);
    return slot;
  }

  /** Hide a slot and give it back for the next tile it holds. */
  remove(slot: FarBatchSlot) {
    this.setFade(slot, 0, false);
    let list = this.free.get(slot.capacity);
    if (!list) {
      list = [];
      this.free.set(slot.capacity, list);
    }
    list.push(slot);
  }

  /**
   * A slot's opacity and whether it is the tile being dissolved in (the
   * shader's `uFarFade`, per instance); hidden at opacity 0. Writes only
   * on a change, since each write re-uploads the page's instance colours.
   */
  setFade(slot: FarBatchSlot, opacity: number, isDrawn: boolean) {
    const visible = opacity > 0;
    if (visible !== slot.visible) {
      slot.page.setVisibleAt(slot.instanceId, visible);
      slot.visible = visible;
    }
    if (opacity === slot.opacity && isDrawn === slot.isDrawn) return;
    slot.opacity = opacity;
    slot.isDrawn = isDrawn;
    slot.page.setColorAt(
      slot.instanceId,
      color.setRGB(opacity, isDrawn ? 1 : 0, 0),
    );
  }

  dispose() {
    for (const page of this.pageList) {
      page.dispose();
      this.root.remove(page);
    }
    this.pageList = [];
    for (const geometry of this.scratch.values()) geometry.dispose();
    this.scratch.clear();
    this.free.clear();
  }

  /** The smallest free slot that holds `vertices`, within REUSE_SLACK. */
  private takeFree(vertices: number): FarBatchSlot | null {
    const own = slotCapacity(vertices);
    for (let capacity = own; capacity <= own * REUSE_SLACK; capacity *= 2) {
      const slot = this.free.get(capacity)?.pop();
      if (slot) return slot;
    }
    return null;
  }

  /** A page with room for a slot of `capacity`, opened when none has. */
  private pageWithRoom(capacity: number): BatchedMesh {
    for (const page of this.pageList) {
      if (page.unusedVertexCount >= capacity) return page;
    }
    const page = new StaticBatchedMesh(
      PAGE_INSTANCES,
      Math.max(this.pageVertices, capacity),
      0,
      this.material,
    );
    page.name = `far-terrain-page-${this.pageList.length}`;
    // Each tile is culled on its own; a page as a whole never is.
    page.frustumCulled = false;
    page.perObjectFrustumCulled = true;
    page.sortObjects = false;
    page.castShadow = false;
    page.receiveShadow = false;
    this.pageList.push(page);
    this.root.add(page);
    return page;
  }

  /**
   * The tile's data padded to the slot, so BatchedMesh copies each
   * attribute with one `set` and has no tail to clear by hand; bounds
   * from the tile's own extent, so none are computed from the vertices.
   */
  private fill(data: FarMeshData, capacity: number, span: number) {
    let geometry = this.scratch.get(capacity);
    if (!geometry) {
      geometry = new BufferGeometry();
      geometry.setAttribute(
        "position",
        new BufferAttribute(
          new Int16Array(capacity * FAR_POSITION_SIZE),
          FAR_POSITION_SIZE,
        ),
      );
      geometry.setAttribute(
        "aFarColumn",
        new BufferAttribute(new Int16Array(capacity * 2), 2),
      );
      geometry.setAttribute(
        "aFarMaterial",
        new BufferAttribute(new Uint8Array(capacity * 4), 4),
      );
      geometry.setAttribute(
        "aFarTint",
        new BufferAttribute(new Uint8Array(capacity * 4), 4),
      );
      this.scratch.set(capacity, geometry);
    }
    const copy = (name: string, source: ArrayLike<number>) => {
      const array = geometry.getAttribute(name).array as
        | Int16Array
        | Uint8Array;
      array.set(source);
      array.fill(0, source.length);
    };
    copy("position", data.position);
    copy("aFarColumn", data.column);
    copy("aFarMaterial", data.material);
    copy("aFarTint", data.tint);
    const box = new Box3(
      new Vector3(0, data.minY, 0),
      new Vector3(span, data.maxY, span),
    );
    geometry.boundingBox = box;
    geometry.boundingSphere = box.getBoundingSphere(new Sphere());
    return geometry;
  }
}
