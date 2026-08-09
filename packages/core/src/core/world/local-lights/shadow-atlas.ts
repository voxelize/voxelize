import {
  DepthTexture,
  Matrix4,
  NearestFilter,
  PerspectiveCamera,
  UnsignedIntType,
  Vector3,
  WebGLRenderTarget,
} from "three";

/**
 * Cube-face bases for local point-light shadows, index-matched between this
 * table (which builds the render cameras) and the reconstruction in
 * `shader.ts` (which turns a fragment position back into a face UV + depth).
 * The basis is right-handed for a camera looking down `forward`
 * (`right × up = -forward`); change neither side alone.
 *
 * Faces: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z.
 */
export const SHADOW_FACE_FORWARD: readonly [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export const SHADOW_FACE_UP: readonly [number, number, number][] = [
  [0, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [0, 0, 1],
  [0, 1, 0],
  [0, 1, 0],
];

export const SHADOW_FACE_RIGHT: readonly [number, number, number][] = [
  [0, 0, 1],
  [0, 0, -1],
  [1, 0, 0],
  [-1, 0, 0],
  [-1, 0, 0],
  [1, 0, 0],
];

/**
 * Half-FOV tangent of a point-light cube face. Exactly 90° would put shared
 * cube edges precisely on the map border, where PCF taps clamp; the 4 %
 * guard band renders a sliver past the edge so filtered lookups near a face
 * boundary still land on real depth. The sampling reconstruction uses the
 * same constant, so render and lookup always agree.
 */
export const POINT_FACE_GUARD_TAN_HALF = 1.04;

/** The same guard applied to a spot cone's authored outer angle. */
export const SPOT_GUARD_SCALE = 1.05;

/**
 * Cells (atlas sub-squares) per shadow slot: 6 cube faces of the cached
 * static world plus 6 for the per-frame dynamic-caster overlay. A fixed
 * region per slot removes the atlas allocator entirely — no fragmentation,
 * no compaction, no eviction bookkeeping beyond the slot itself.
 */
export const CELLS_PER_SHADOW_SLOT = 12;
export const DYNAMIC_CELL_OFFSET = 6;

const scratchRight = new Vector3();
const scratchUp = new Vector3();
const scratchBack = new Vector3();
const scratchMatrix = new Matrix4();

/**
 * Compute the perspective projection for a shadow face camera. Standard GL
 * frustum, aspect 1; `tanHalf` is the half-FOV tangent (guard included).
 */
export function makeShadowFaceProjection(
  out: Matrix4,
  tanHalf: number,
  near: number,
  far: number,
): Matrix4 {
  const top = near * tanHalf;
  return out.makePerspective(-top, top, top, -top, near, far);
}

/**
 * Orient `camera` for a point-light cube face using the shared basis table.
 * The camera's matrices are written directly (no lookAt) so the orientation
 * is bit-identical to what the shader reconstruction assumes.
 */
export function orientPointFaceCamera(
  camera: PerspectiveCamera,
  lightX: number,
  lightY: number,
  lightZ: number,
  face: number,
  tanHalf: number,
  near: number,
  far: number,
): void {
  const forward = SHADOW_FACE_FORWARD[face];
  const up = SHADOW_FACE_UP[face];
  const right = SHADOW_FACE_RIGHT[face];

  scratchRight.set(right[0], right[1], right[2]);
  scratchUp.set(up[0], up[1], up[2]);
  scratchBack.set(-forward[0], -forward[1], -forward[2]);

  applyShadowCameraBasis(
    camera,
    lightX,
    lightY,
    lightZ,
    scratchRight,
    scratchUp,
    scratchBack,
    tanHalf,
    near,
    far,
  );
}

/**
 * Derive the spot-light shadow basis from its direction, with the same
 * deterministic up-reference rule the shader uses: world +Y unless the axis
 * is near-vertical, then world +Z.
 */
export function orientSpotCamera(
  camera: PerspectiveCamera,
  lightX: number,
  lightY: number,
  lightZ: number,
  dirX: number,
  dirY: number,
  dirZ: number,
  tanHalf: number,
  near: number,
  far: number,
): void {
  const length = Math.hypot(dirX, dirY, dirZ) || 1;
  const fx = dirX / length;
  const fy = dirY / length;
  const fz = dirZ / length;

  const isVertical = Math.abs(fy) > 0.99;
  const upRefX = 0;
  const upRefY = isVertical ? 0 : 1;
  const upRefZ = isVertical ? 1 : 0;

  // right = normalize(forward × upRef); up = right × forward.
  scratchRight
    .set(
      fy * upRefZ - fz * upRefY,
      fz * upRefX - fx * upRefZ,
      fx * upRefY - fy * upRefX,
    )
    .normalize();
  scratchUp.set(
    scratchRight.y * fz - scratchRight.z * fy,
    scratchRight.z * fx - scratchRight.x * fz,
    scratchRight.x * fy - scratchRight.y * fx,
  );
  scratchBack.set(-fx, -fy, -fz);

  applyShadowCameraBasis(
    camera,
    lightX,
    lightY,
    lightZ,
    scratchRight,
    scratchUp,
    scratchBack,
    tanHalf,
    near,
    far,
  );
}

function applyShadowCameraBasis(
  camera: PerspectiveCamera,
  x: number,
  y: number,
  z: number,
  right: Vector3,
  up: Vector3,
  back: Vector3,
  tanHalf: number,
  near: number,
  far: number,
): void {
  camera.matrixAutoUpdate = false;
  camera.matrixWorldAutoUpdate = false;
  camera.matrixWorld.makeBasis(right, up, back);
  camera.matrixWorld.setPosition(x, y, z);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  camera.matrix.copy(camera.matrixWorld);
  camera.position.set(x, y, z);
  makeShadowFaceProjection(scratchMatrix, tanHalf, near, far);
  camera.projectionMatrix.copy(scratchMatrix);
  camera.projectionMatrixInverse.copy(scratchMatrix).invert();
  camera.near = near;
  camera.far = far;
}

/**
 * CPU mirror of the shader's face selection and UV/depth reconstruction,
 * kept next to the camera builders so a unit test can assert that a world
 * point projected through the *camera* lands on the same face UV and linear
 * depth this function (and therefore the GLSL) computes.
 *
 * Returns `null` when the point projects outside the face's guarded frustum.
 */
export function projectPointLightFragment(
  lightX: number,
  lightY: number,
  lightZ: number,
  worldX: number,
  worldY: number,
  worldZ: number,
  tanHalf: number,
): { face: number; u: number; v: number; w: number } | null {
  const rx = worldX - lightX;
  const ry = worldY - lightY;
  const rz = worldZ - lightZ;
  const ax = Math.abs(rx);
  const ay = Math.abs(ry);
  const az = Math.abs(rz);

  let face: number;
  let u: number;
  let v: number;
  let w: number;
  if (ax >= ay && ax >= az) {
    face = rx > 0 ? 0 : 1;
    w = ax;
    u = rx > 0 ? rz : -rz;
    v = ry;
  } else if (ay >= az) {
    face = ry > 0 ? 2 : 3;
    w = ay;
    u = ry > 0 ? rx : -rx;
    v = rz;
  } else {
    face = rz > 0 ? 4 : 5;
    w = az;
    u = rz > 0 ? -rx : rx;
    v = ry;
  }

  if (w <= 0) return null;
  const ndcU = u / (w * tanHalf);
  const ndcV = v / (w * tanHalf);
  if (Math.abs(ndcU) > 1 || Math.abs(ndcV) > 1) return null;

  return { face, u: ndcU * 0.5 + 0.5, v: ndcV * 0.5 + 0.5, w };
}

/** Linear view depth stored at a face texel, back from hardware depth 0..1. */
export function linearizeShadowDepth(
  depth01: number,
  near: number,
  far: number,
): number {
  const zNdc = depth01 * 2 - 1;
  return (2 * far * near) / (far + near - zNdc * (far - near));
}

/**
 * The single shared depth atlas every shadowed local light renders into and
 * every chunk material samples from. Fixed geometry: `maxSlots` shadow slots
 * of {@link CELLS_PER_SHADOW_SLOT} square cells each, laid out row-major in
 * cell units. Allocated lazily on the first shadowed light, so worlds that
 * never grant a shadow never pay its memory.
 */
export class LocalShadowAtlas {
  private renderTarget: WebGLRenderTarget | null = null;
  private atlasSize: number;
  private slotSize: number;

  constructor(atlasSize: number, slotSize: number) {
    this.atlasSize = atlasSize;
    this.slotSize = slotSize;
  }

  get size(): number {
    return this.atlasSize;
  }

  get cellSize(): number {
    return this.slotSize;
  }

  get cellsPerRow(): number {
    return Math.max(Math.floor(this.atlasSize / this.slotSize), 1);
  }

  get capacityCells(): number {
    return this.cellsPerRow * this.cellsPerRow;
  }

  /** Slots the current geometry can hold (each slot is 12 cells). */
  get capacitySlots(): number {
    return Math.floor(this.capacityCells / CELLS_PER_SHADOW_SLOT);
  }

  get isAllocated(): boolean {
    return this.renderTarget !== null;
  }

  get depthTexture(): DepthTexture | null {
    return this.renderTarget?.depthTexture ?? null;
  }

  /** Bytes of GPU memory the atlas holds once allocated (color + depth). */
  get estimatedBytes(): number {
    if (!this.renderTarget) return 0;
    return this.atlasSize * this.atlasSize * (4 + 4);
  }

  ensureAllocated(): WebGLRenderTarget {
    if (!this.renderTarget) {
      const depthTexture = new DepthTexture(this.atlasSize, this.atlasSize);
      depthTexture.type = UnsignedIntType;
      depthTexture.minFilter = NearestFilter;
      depthTexture.magFilter = NearestFilter;
      this.renderTarget = new WebGLRenderTarget(this.atlasSize, this.atlasSize, {
        depthTexture,
        generateMipmaps: false,
      });
      // The scissored face passes each clear their own cell; a full-target
      // clear between them would wipe every cached map in the atlas.
      this.renderTarget.scissorTest = true;
    }
    return this.renderTarget;
  }

  /**
   * Cell index for a slot's face. Static faces occupy the first six cells of
   * the slot's region, the dynamic overlay the next six.
   */
  cellIndex(slot: number, face: number, isDynamic: boolean): number {
    return (
      slot * CELLS_PER_SHADOW_SLOT + (isDynamic ? DYNAMIC_CELL_OFFSET : 0) + face
    );
  }

  /** Pixel-space viewport `[x, y, size]` of a cell. */
  cellViewport(cell: number, out: [number, number, number]): void {
    const perRow = this.cellsPerRow;
    out[0] = (cell % perRow) * this.slotSize;
    out[1] = Math.floor(cell / perRow) * this.slotSize;
    out[2] = this.slotSize;
  }

  /**
   * Resize for a quality-tier change. GPU memory is dropped immediately and
   * reallocated lazily; the caller invalidates every slot.
   */
  resize(atlasSize: number, slotSize: number): void {
    if (atlasSize === this.atlasSize && slotSize === this.slotSize) return;
    this.dispose();
    this.atlasSize = atlasSize;
    this.slotSize = slotSize;
  }

  dispose(): void {
    if (this.renderTarget) {
      this.renderTarget.depthTexture?.dispose();
      this.renderTarget.dispose();
      this.renderTarget = null;
    }
  }
}
