import {
  BatchedMesh,
  BufferGeometry,
  Camera,
  DataTexture,
  Frustum,
  Group,
  Material,
  Matrix4,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer,
} from "three";

/** The private BatchedMesh state the cached path reads (three 0.183). */
type BatchedMeshInternals = {
  _instanceInfo: { visible: boolean; active: boolean; geometryIndex: number }[];
  _geometryInfo: { start: number; count: number }[];
  _multiDrawStarts: Int32Array;
  _multiDrawCounts: Int32Array;
  _multiDrawCount: number;
  _indirectTexture: DataTexture;
  _visibilityChanged: boolean;
};

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
 *   frame, and on a Mac (ANGLE's Metal backend) every texture upload is a
 *   staged copy.
 *
 * An array camera, a wireframe material or a custom sort take three's own
 * path. The state read here is three 0.183's; a three without it throws at
 * construction rather than drawing a stale list.
 */
export class StaticBatchedMesh extends BatchedMesh {
  /** Per instance: bounding sphere centre and radius in the local frame. */
  private spheres = new Float32Array(0);

  /** Per instance: 1 while its sphere must be taken again. */
  private isSphereStale = new Uint8Array(0);

  /** Visible instances of the pass being built, and their sort keys. */
  private order: number[] = [];
  private keys = new Float32Array(0);

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
      !internals._indirectTexture
    ) {
      throw new Error(
        "[StaticBatchedMesh] this three's BatchedMesh lacks the draw-list state (three 0.183's) the cached cull reads",
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

  override onBeforeRender(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    geometry: BufferGeometry,
    material: Material,
    group: Group,
  ) {
    if (
      (camera as { isArrayCamera?: boolean }).isArrayCamera ||
      (material as { wireframe?: boolean }).wireframe ||
      this.customSort !== null
    ) {
      // Three's path rewrites the list and uploads it whatever we kept.
      this.uploaded = null;
      super.onBeforeRender(renderer, scene, camera, geometry, material, group);
      return;
    }
    const state = this as unknown as BatchedMeshInternals;
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
    }

    const isCulled = this.perObjectFrustumCulled;
    if (isCulled) {
      _matrix
        .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
        .multiply(this.matrixWorld);
      _frustum.setFromProjectionMatrix(
        _matrix,
        camera.coordinateSystem,
        (camera as { reversedDepth?: boolean }).reversedDepth,
      );
    }
    const planes = _frustum.planes;

    const order = this.order;
    order.length = 0;
    for (let i = 0; i < count; i++) {
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

    if (this.sortObjects) {
      // Distance along the view direction, in the local frame, as three's.
      _matrix.copy(this.matrixWorld).invert();
      _camera.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(_matrix);
      _forward
        .set(0, 0, -1)
        .transformDirection(camera.matrixWorld)
        .transformDirection(_matrix);
      const keys = this.keys;
      for (let k = 0; k < order.length; k++) {
        const i = order[k];
        keys[i] =
          (spheres[i * 4] - _camera.x) * _forward.x +
          (spheres[i * 4 + 1] - _camera.y) * _forward.y +
          (spheres[i * 4 + 2] - _camera.z) * _forward.z;
      }
      if (material.transparent) order.sort((a, b) => keys[b] - keys[a]);
      else order.sort((a, b) => keys[a] - keys[b]);
    }

    const index = geometry.getIndex();
    const bytesPerElement = index === null ? 1 : index.array.BYTES_PER_ELEMENT;
    const starts = state._multiDrawStarts;
    const counts = state._multiDrawCounts;
    const texture = state._indirectTexture;
    const indirect = texture.image.data as Uint32Array;
    const geometries = state._geometryInfo;
    let isChanged = this.uploaded !== texture;
    for (let k = 0; k < order.length; k++) {
      const i = order[k];
      const info = geometries[instances[i].geometryIndex];
      starts[k] = info.start * bytesPerElement;
      counts[k] = info.count;
      if (indirect[k] !== i) {
        indirect[k] = i;
        isChanged = true;
      }
    }
    if (isChanged) {
      texture.needsUpdate = true;
      this.uploaded = texture;
    }
    state._multiDrawCount = order.length;
    state._visibilityChanged = false;
  }

  private markStale(instanceId: number) {
    if (instanceId < 0) return;
    this.ensureCapacity(instanceId + 1);
    this.isSphereStale[instanceId] = 1;
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
    const keys = new Float32Array(size);
    keys.set(this.keys);
    this.keys = keys;
  }
}
