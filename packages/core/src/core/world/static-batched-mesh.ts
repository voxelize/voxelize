import {
  BatchedMesh,
  BufferGeometry,
  Camera,
  DataTexture,
  Frustum,
  Material,
  Matrix4,
  Sphere,
  Vector3,
} from "three/webgpu";

import { writeTextureRows } from "../../utils/gpu-texture-writes";

/** The private BatchedMesh state the cached path reads (three 0.187). */
type BatchedMeshInternals = {
  _instanceInfo: { visible: boolean; active: boolean; geometryIndex: number }[];
  _geometryInfo: { start: number; count: number }[];
  _multiDrawStarts: Int32Array;
  _multiDrawCounts: Int32Array;
  _multiDrawCount: number;
  _mergedDrawStarts: Int32Array;
  _mergedDrawCounts: Int32Array;
  _mergedDrawInstanceCounts: Int32Array;
  _mergedDrawCount: number;
  _multiDrawBytesPerElement: number;
  _indirectTexture: DataTexture;
  _visibilityChanged: boolean;
  _updateDrawParameters(
    camera: Camera,
    geometry: BufferGeometry,
    material: Material,
    drawFormat: "multiDraw" | "merged",
  ): void;
};

/** Sort distances are exact to within this many blocks either way. */
const SORT_RANGE_BITS = 21;
const SORT_RANGE = 2 ** SORT_RANGE_BITS;

const _matrix = new Matrix4();
const _frustum = new Frustum();
const _sphere = new Sphere();
const _camera = new Vector3();
const _forward = new Vector3();

/**
 * A `BatchedMesh` whose instances rarely move: chunk sections in a region
 * arena, far-terrain tiles in a page. It culls and sorts each pass exactly
 * as three does, but three redoes, for every instance on every pass, work
 * whose answer only changes when an instance moves or is rewritten, and
 * re-uploads the draw list every pass whether it changed or not:
 *
 * - each instance's world bounding sphere is kept until its matrix or its
 *   geometry is set again, instead of being read back from the matrix
 *   texture and transformed each pass;
 * - the indirect texture (draw index to instance) uploads only when the
 *   list in it changed. A still camera draws the same list frame after
 *   frame, and every texture upload is a staged copy.
 *
 * An array camera, a wireframe material or a custom sort take three's own
 * path. The state read here is three 0.187's; a three without it throws at
 * construction rather than drawing a stale list.
 */
export class StaticBatchedMesh extends BatchedMesh {
  /** Per instance: bounding sphere centre and radius in the local frame. */
  private spheres = new Float32Array(0);

  /** Per instance: 1 while its sphere must be taken again. */
  private isSphereStale = new Uint8Array(0);

  /** Visible instances of the pass being built. */
  private order: number[] = [];
  /**
   * Every active section's sphere in one, in the batch's frame: a pass whose
   * frustum holds it whole draws every visible section untested, and one
   * that misses it draws none. Taken again when a section's sphere is.
   */
  private readonly bounds = new Sphere();
  private isBoundsStale = true;

  /**
   * Sort keys packing each visible instance's distance with its index (see
   * `sortOrder`), sorted as plain numbers: an array sort with a comparator
   * copies the array on every call.
   */
  private sortKeys = new Float64Array(0);

  /** The indirect texture whose GPU copy matches its array. */
  private uploaded: DataTexture | null = null;

  constructor(...args: ConstructorParameters<typeof BatchedMesh>) {
    super(...args);
    const internals = this as unknown as Partial<BatchedMeshInternals>;
    if (
      !Array.isArray(internals._instanceInfo) ||
      !Array.isArray(internals._geometryInfo) ||
      !internals._multiDrawStarts ||
      !internals._multiDrawCounts ||
      !internals._mergedDrawStarts ||
      !internals._indirectTexture ||
      typeof internals._updateDrawParameters !== "function"
    ) {
      throw new Error(
        "[StaticBatchedMesh] this three's BatchedMesh lacks the draw-list state (three 0.187's) the cached cull reads",
      );
    }
  }

  override setMatrixAt(instanceId: number, matrix: Matrix4) {
    this.markStale(instanceId);
    return super.setMatrixAt(instanceId, matrix);
  }

  override setGeometryAt(geometryId: number, geometry: BufferGeometry) {
    const id = super.setGeometryAt(geometryId, geometry);
    const info = (this as unknown as BatchedMeshInternals)._instanceInfo;
    for (let i = 0; i < info.length; i++) {
      if (info[i].geometryIndex === geometryId) this.markStale(i);
    }
    return id;
  }

  override addInstance(geometryId: number) {
    const id = super.addInstance(geometryId);
    this.markStale(id);
    return id;
  }

  /** The renderer drawing this pass, for the draw list's own upload. */
  private drawingRenderer: unknown = null;

  /**
   * three's WebGPU path flags the indirect texture for upload here on every
   * culled or sorted pass; `_updateDrawParameters` uploads it only when the
   * list in it changed. Kept for the renderer, which that call is not given.
   */
  override onBeforeRender(renderer: unknown) {
    this.drawingRenderer = renderer;
  }

  /**
   * Builds the pass's draw list: three's, from the cached spheres. Called
   * by the batch node once per drawn object per pass, with the camera of
   * that pass (a cascade's for the sun's shadow).
   */
  _updateDrawParameters(
    camera: Camera,
    geometry: BufferGeometry,
    material: Material,
    drawFormat: "multiDraw" | "merged" = "multiDraw",
  ) {
    const state = this as unknown as BatchedMeshInternals;
    if (
      (camera as { isArrayCamera?: boolean }).isArrayCamera ||
      (material as { wireframe?: boolean }).wireframe ||
      this.customSort !== null
    ) {
      // Three's path rewrites the list and uploads it whatever we kept.
      this.uploaded = null;
      state._indirectTexture.needsUpdate = true;
      (
        BatchedMesh.prototype as unknown as BatchedMeshInternals
      )._updateDrawParameters.call(this, camera, geometry, material, drawFormat);
      return;
    }
    if (
      !state._visibilityChanged &&
      !this.perObjectFrustumCulled &&
      !this.sortObjects
    ) {
      return;
    }

    const instances = state._instanceInfo;
    const count = instances.length;
    this.ensureCapacity(count);
    const spheres = this.spheres;
    const stale = this.isSphereStale;
    for (let i = 0; i < count; i++) {
      if (stale[i] === 0 || !instances[i].active) continue;
      this.getMatrixAt(i, _matrix);
      this.getBoundingSphereAt(
        instances[i].geometryIndex,
        _sphere,
      ).applyMatrix4(_matrix);
      spheres[i * 4] = _sphere.center.x;
      spheres[i * 4 + 1] = _sphere.center.y;
      spheres[i * 4 + 2] = _sphere.center.z;
      spheres[i * 4 + 3] = _sphere.radius;
      stale[i] = 0;
      this.isBoundsStale = true;
    }
    if (this.isBoundsStale) this.takeBounds(count);

    let isCulled = this.perObjectFrustumCulled;
    let isMissed = false;
    if (isCulled) {
      _matrix
        .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
        .multiply(this.matrixWorld);
      _frustum.setFromProjectionMatrix(
        _matrix,
        camera.coordinateSystem,
        (camera as { reversedDepth?: boolean }).reversedDepth,
      );
      // The whole batch first: a shadow cascade mostly holds a page whole.
      const { center, radius } = this.bounds;
      let isWhole = radius >= 0;
      for (let p = 0; p < 6 && radius >= 0; p++) {
        const distance = _frustum.planes[p].distanceToPoint(center);
        if (distance < -radius) {
          isMissed = true;
          break;
        }
        if (distance < radius) isWhole = false;
      }
      if (isWhole) isCulled = false;
    }
    const planes = _frustum.planes;

    const order = this.order;
    order.length = 0;
    for (let i = 0; i < count && !isMissed; i++) {
      const instance = instances[i];
      if (!instance.visible || !instance.active) continue;
      if (isCulled) {
        const x = spheres[i * 4];
        const y = spheres[i * 4 + 1];
        const z = spheres[i * 4 + 2];
        const radius = spheres[i * 4 + 3];
        let isInside = true;
        for (let p = 0; p < 6; p++) {
          const { normal, constant } = planes[p];
          if (normal.x * x + normal.y * y + normal.z * z + constant < -radius) {
            isInside = false;
            break;
          }
        }
        if (!isInside) continue;
      }
      order.push(i);
    }

    // Opaque sections under an orthographic camera (a shadow cascade's
    // pass) are drawn unsorted: front to back only saves overdraw a
    // perspective view has, and sorting every visible section again for
    // each cascade cost more than culling them. A blended pass keeps its
    // order whatever the camera, unless it writes no colour: a depth pass
    // blends nothing (a blended bucket's caster depth, which three marks
    // transparent like the bucket).
    const isBlended = material.transparent && material.colorWrite !== false;
    const isSorted =
      this.sortObjects &&
      (isBlended ||
        (camera as { isOrthographicCamera?: boolean }).isOrthographicCamera !==
          true);
    if (isSorted) {
      // Distance along the view direction, in the local frame, as three's.
      _matrix.copy(this.matrixWorld).invert();
      _camera.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(_matrix);
      _forward
        .set(0, 0, -1)
        .transformDirection(camera.matrixWorld)
        .transformDirection(_matrix);
      this.sortOrder(count, material.transparent);
    }

    const index = geometry.getIndex();
    const bytesPerElement = index === null ? 1 : index.array.BYTES_PER_ELEMENT;
    const isMerged = drawFormat === "merged";
    const starts = isMerged ? state._mergedDrawStarts : state._multiDrawStarts;
    const counts = isMerged ? state._mergedDrawCounts : state._multiDrawCounts;
    const instanceCounts = state._mergedDrawInstanceCounts;
    const texture = state._indirectTexture;
    const indirect = texture.image.data as Uint32Array;
    const geometries = state._geometryInfo;
    let isChanged = this.uploaded !== texture;
    let drawCount = 0;
    for (let k = 0; k < order.length; k++) {
      const i = order[k];
      const info = geometries[instances[i].geometryIndex];
      const start = info.start * bytesPerElement;
      if (
        isMerged &&
        drawCount > 0 &&
        starts[drawCount - 1] === start &&
        counts[drawCount - 1] === info.count
      ) {
        // The same geometry again draws as one more instance of the last.
        instanceCounts[drawCount - 1]++;
      } else {
        starts[drawCount] = start;
        counts[drawCount] = info.count;
        if (isMerged) instanceCounts[drawCount] = 1;
        drawCount++;
      }
      if (indirect[k] !== i) {
        indirect[k] = i;
        isChanged = true;
      }
    }
    if (isChanged) {
      // Only the rows the list reaches, straight to the GPU queue: a flagged
      // texture went through three's whole texture update, all of it, for
      // every pass whose camera saw a different set of sections (~15 a
      // frame in flight). The first upload, or one before the texture is on
      // the GPU, is three's.
      const width = texture.image.width;
      const isWritten =
        this.uploaded === texture &&
        writeTextureRows(
          this.drawingRenderer,
          texture,
          indirect,
          width,
          Uint32Array.BYTES_PER_ELEMENT,
          0,
          Math.max(1, Math.ceil(order.length / width)),
        );
      if (!isWritten) texture.needsUpdate = true;
      this.uploaded = texture;
    }
    state._multiDrawCount = order.length;
    if (isMerged) state._mergedDrawCount = drawCount;
    state._multiDrawBytesPerElement = bytesPerElement;
    state._visibilityChanged = false;
  }

  /**
   * Sorts `order` nearest first (farthest first when transparent), ties in
   * index order as three's stable sort leaves them. Each key is the
   * distance, offset positive and scaled to the finest step that still
   * fits, times a power of two above every index, plus the index: one
   * exact integer per instance under 2^52, sorted natively in place and
   * read back by its low bits. Distances reach `SORT_RANGE` blocks; with a
   * region's thousand sections the step is about two millionths of a block.
   */
  private sortOrder(instanceCount: number, isFarthestFirst: boolean) {
    const order = this.order;
    const spheres = this.spheres;
    const bits = Math.max(1, Math.ceil(Math.log2(instanceCount + 1)));
    const span = 2 ** bits;
    const scale = 2 ** (52 - bits - SORT_RANGE_BITS - 1);
    if (this.sortKeys.length < order.length) {
      this.sortKeys = new Float64Array(Math.max(order.length, 64) * 2);
    }
    const keys = this.sortKeys;
    for (let k = 0; k < order.length; k++) {
      const i = order[k];
      const distance =
        (spheres[i * 4] - _camera.x) * _forward.x +
        (spheres[i * 4 + 1] - _camera.y) * _forward.y +
        (spheres[i * 4 + 2] - _camera.z) * _forward.z;
      const signed = isFarthestFirst ? -distance : distance;
      const clamped = Math.min(SORT_RANGE, Math.max(-SORT_RANGE, signed));
      keys[k] = Math.floor((clamped + SORT_RANGE) * scale) * span + i;
    }
    const sorted = keys.subarray(0, order.length).sort();
    for (let k = 0; k < sorted.length; k++) order[k] = sorted[k] % span;
  }

  /** {@link bounds} from the cached sphere of every active section. */
  private takeBounds(count: number) {
    const instances = (this as unknown as BatchedMeshInternals)._instanceInfo;
    const spheres = this.spheres;
    this.bounds.makeEmpty();
    for (let i = 0; i < count; i++) {
      if (!instances[i].active) continue;
      _sphere.center.set(spheres[i * 4], spheres[i * 4 + 1], spheres[i * 4 + 2]);
      _sphere.radius = spheres[i * 4 + 3];
      this.bounds.union(_sphere);
    }
    this.isBoundsStale = false;
  }

  private markStale(instanceId: number) {
    if (instanceId < 0) return;
    this.ensureCapacity(instanceId + 1);
    this.isSphereStale[instanceId] = 1;
    // The batch's own sphere places it in the render list's sort (the three
    // patch: a batch sorts by it, not by its shared geometry's every
    // reserved vertex); taken again, from cached per-geometry spheres, by
    // the next pass that sorts it.
    this.boundingSphere = null;
  }

  /** Grows the per-instance arrays; new instances start stale. */
  private ensureCapacity(count: number) {
    if (this.isSphereStale.length >= count) return;
    const size = Math.max(count, this.isSphereStale.length * 2, 16);
    const spheres = new Float32Array(size * 4);
    spheres.set(this.spheres);
    this.spheres = spheres;
    const stale = new Uint8Array(size).fill(1);
    stale.set(this.isSphereStale);
    this.isSphereStale = stale;
  }
}
