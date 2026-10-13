/**
 * The far layer's tile meshes in one BatchedMesh, drawn with one multi-draw
 * call instead of one call per tile: at the full reach that was about two
 * hundred draws, and their per-draw CPU cost was nearly all the layer cost.
 *
 * BatchedMesh only ever allocates at the end of its buffers, so the batch
 * keeps its own slots: a tile takes a slot of the smallest power-of-two
 * vertex count that holds it, and a slot a dropped tile leaves is reused in
 * place by the next tile of its size. Nothing is ever compacted, so no
 * frame re-uploads the whole buffer. Each tile's fade rides in the
 * instance colour (red its opacity, green 1 while drawn), which the far
 * shader reads by draw id.
 */

import {
  BatchedMesh,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  Material,
  Matrix4,
  Sphere,
  Vector3,
} from "three";

import type { FarMeshData } from "./far-terrain-mesh";

/** One tile mesh's place in the batch. */
export type FarBatchSlot = {
  readonly geometryId: number;
  readonly instanceId: number;
  /** Vertices the slot holds; its indices are 1.5 times as many. */
  readonly capacity: number;
  /** Debug name, `far-terrain-<tile id>` or `far-terrain-sky-<tile id>`. */
  name: string;
  /** Indices the tile drew with when it went in. */
  indexCount: number;
  visible: boolean;
  opacity: number;
  isDrawn: boolean;
};

/** The smallest slot, in vertices. */
const MIN_SLOT = 4096;

/** Every far mesh is quads: six indices for four vertices. */
const INDICES_PER_VERTEX = 1.5;

const slotCapacity = (vertices: number) => {
  let capacity = MIN_SLOT;
  while (capacity < vertices) capacity *= 2;
  return capacity;
};

const matrix = new Matrix4();
const color = new Color();

export class FarBatch {
  readonly mesh: BatchedMesh;

  /** Slots no tile holds, by capacity. */
  private free = new Map<number, FarBatchSlot[]>();

  /** Padded attribute arrays per capacity, reused for every copy in. */
  private scratch = new Map<number, BufferGeometry>();

  private slotCount = 0;

  constructor(
    material: Material,
    vertexCapacity = 1 << 20,
    instanceCapacity = 256,
  ) {
    this.mesh = new BatchedMesh(
      instanceCapacity,
      vertexCapacity,
      Math.ceil(vertexCapacity * INDICES_PER_VERTEX),
      material,
    );
    this.mesh.name = "far-terrain-batch";
    // Each tile is culled on its own; the batch as a whole never is.
    this.mesh.frustumCulled = false;
    this.mesh.perObjectFrustumCulled = true;
    this.mesh.sortObjects = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
  }

  /** Slots made so far, held or free. */
  get slots() {
    return this.slotCount;
  }

  /**
   * Put a tile mesh into a free slot of its size, or a new one, at
   * `(originX, 0, originZ)`. It starts hidden: `setFade` shows it.
   */
  add(
    data: FarMeshData,
    originX: number,
    originZ: number,
    span: number,
    name: string,
  ): FarBatchSlot {
    const vertices = data.position.length / 3;
    const capacity = slotCapacity(vertices);
    const geometry = this.fill(data, capacity, span);
    const mesh = this.mesh;
    let slot = this.free.get(capacity)?.pop();
    if (slot) {
      mesh.setGeometryAt(slot.geometryId, geometry);
    } else {
      this.reserve(capacity);
      const geometryId = mesh.addGeometry(
        geometry,
        capacity,
        Math.ceil(capacity * INDICES_PER_VERTEX),
      );
      const instanceId = mesh.addInstance(geometryId);
      this.slotCount += 1;
      slot = {
        geometryId,
        instanceId,
        capacity,
        name,
        indexCount: 0,
        visible: true,
        opacity: -1,
        isDrawn: false,
      };
    }
    slot.name = name;
    slot.indexCount = data.index.length;
    mesh.setMatrixAt(
      slot.instanceId,
      matrix.makeTranslation(originX, 0, originZ),
    );
    slot.visible = true;
    slot.opacity = -1;
    this.setFade(slot, 0, false);
    return slot;
  }

  /** Hide a slot and give it back for the next tile of its size. */
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
   * on a change, since each write re-uploads the instance colours.
   */
  setFade(slot: FarBatchSlot, opacity: number, isDrawn: boolean) {
    const visible = opacity > 0;
    if (visible !== slot.visible) {
      this.mesh.setVisibleAt(slot.instanceId, visible);
      slot.visible = visible;
    }
    if (opacity === slot.opacity && isDrawn === slot.isDrawn) return;
    slot.opacity = opacity;
    slot.isDrawn = isDrawn;
    this.mesh.setColorAt(
      slot.instanceId,
      color.setRGB(opacity, isDrawn ? 1 : 0, 0),
    );
  }

  dispose() {
    this.mesh.dispose();
    for (const geometry of this.scratch.values()) geometry.dispose();
    this.scratch.clear();
    this.free.clear();
  }

  /**
   * Room for one more slot of `capacity`: the buffers and the instance
   * table double when they would overflow. Doubling copies everything
   * once, so it is rare after the first few hundred tiles.
   */
  private reserve(capacity: number) {
    const mesh = this.mesh;
    if (
      mesh.unusedVertexCount < capacity ||
      mesh.unusedIndexCount < Math.ceil(capacity * INDICES_PER_VERTEX)
    ) {
      const vertices = Math.max(
        mesh.geometry.getAttribute("position")
          ? mesh.geometry.getAttribute("position").count * 2
          : capacity * 2,
        capacity * 2,
      );
      mesh.setGeometrySize(vertices, Math.ceil(vertices * INDICES_PER_VERTEX));
    }
    if (mesh.instanceCount >= mesh.maxInstanceCount) {
      mesh.setInstanceCount(mesh.maxInstanceCount * 2);
    }
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
        new BufferAttribute(new Int16Array(capacity * 3), 3),
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
    geometry.setIndex(new BufferAttribute(data.index, 1));
    const box = new Box3(
      new Vector3(0, data.minY, 0),
      new Vector3(span, data.maxY, span),
    );
    geometry.boundingBox = box;
    geometry.boundingSphere = box.getBoundingSphere(new Sphere());
    return geometry;
  }
}
