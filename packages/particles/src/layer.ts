import { AABB } from "@voxelize/aabb";
import { RigidBody } from "@voxelize/physics-engine";
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  FrontSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  NormalBlending,
  PlaneGeometry,
  Texture,
} from "three";

import type {
  ParticleBlendMode,
  ParticlePhysics,
  ParticleShape,
} from "./types";

export type LayerSpec = {
  key: string;
  blend: ParticleBlendMode;
  shape: ParticleShape;
  map: Texture | null;
  physics: ParticlePhysics | null;
  isCutout: boolean;
  /**
   * The three.js layer channel to join so a selective bloom can mask this
   * layer out, or null when bloom may take it.
   */
  bloomExemptLayer: number | null;
  /**
   * A double-sided quad layer draws in one pass instead of three's
   * back-then-front pair (see `ParticleSystemOptions.isQuadSinglePass`).
   */
  isSinglePass?: boolean;
  /** The layer mesh's render order (see `softLayerRenderOrder`). */
  renderOrder?: number;
};

/** The default channel bloom-exempt particle meshes join. */
export const PARTICLE_BLOOM_EXEMPT_LAYER = 30;

/**
 * The `userData` key a see-through object names its medium under, which
 * `@voxelize/core`'s transparent sort reads to draw it on the right side of
 * the water's surface.
 */
export const TRANSPARENT_MEDIUM_KEY = "transparentMedium";

/** Below this the silhouette is a hole, above it the texel is the particle. */
const CUTOUT_ALPHA_TEST = 0.5;

/** A voxel no particle stands in, so the first frame always looks it up. */
const UNSEEN_VOXEL = 0x7fffffff;

const WHITE = new Color(0xffffff);

/** One instanced draw of a layer, and the slots it fills this frame. */
type LayerDraw = {
  mesh: InstancedMesh<BufferGeometry, MeshBasicMaterial>;
  alpha: InstancedBufferAttribute;
  /** Per-instance atlas window (offsetU, offsetV, spanU, spanV). */
  uvRect: InstancedBufferAttribute | null;
  count: number;
};

/**
 * SoA storage plus one InstancedMesh for a single blend/shape/texture/physics
 * combination. A layer is a draw call and a capacity of its own, so an
 * ambient effect that saturates its layer can never starve explosions of
 * theirs.
 *
 * A soft layer draws twice: its particles in water through `wetMesh` and the
 * rest through `mesh`. Writing no depth, a soft particle is ordered against
 * the water by the medium it is in (see {@link TRANSPARENT_MEDIUM_KEY}), and
 * one layer's particles are on both sides of a surface at once: mist over a
 * pool, sparks on its bed.
 */
export class ParticleLayer {
  readonly mesh: InstancedMesh<BufferGeometry, MeshBasicMaterial>;
  readonly wetMesh: InstancedMesh<BufferGeometry, MeshBasicMaterial> | null;
  private readonly dry: LayerDraw;
  private readonly wet: LayerDraw | null;
  /** Each particle's atlas window, copied into its slot every frame. */
  private readonly uvRects: Float32Array | null;
  /** The voxel each particle's medium was last read in. */
  readonly mediumVoxel: Int32Array;
  /** Whether that voxel holds water. */
  readonly isWet: Uint8Array;
  /**
   * One body per slot, allocated with the layer. A physics layer is
   * homogeneous by construction — its parameters are part of its key — so
   * bodies are interchangeable and a fragment storm reuses them in place.
   */
  readonly bodies: RigidBody[] | null;
  alive = 0;

  readonly posX: Float32Array;
  readonly posY: Float32Array;
  readonly posZ: Float32Array;
  readonly velX: Float32Array;
  readonly velY: Float32Array;
  readonly velZ: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly sizeStart: Float32Array;
  readonly sizeEnd: Float32Array;
  readonly alphaStart: Float32Array;
  readonly alphaEnd: Float32Array;
  readonly alphaHold: Float32Array;
  readonly colStartR: Float32Array;
  readonly colStartG: Float32Array;
  readonly colStartB: Float32Array;
  readonly colEndR: Float32Array;
  readonly colEndG: Float32Array;
  readonly colEndB: Float32Array;
  readonly riseAccel: Float32Array;
  readonly dragPerSec: Float32Array;
  readonly turbulence: Float32Array;
  readonly spinRate: Float32Array;
  readonly spinPhase: Float32Array;
  readonly swayVelX: Float32Array;
  readonly swayVelZ: Float32Array;
  readonly swayFreq: Float32Array;
  readonly isSettling: Uint8Array;
  readonly isSettled: Uint8Array;

  constructor(
    readonly capacity: number,
    readonly spec: LayerSpec,
  ) {
    const shape: BufferGeometry =
      spec.shape === "cube"
        ? new BoxGeometry(1, 1, 1)
        : new PlaneGeometry(1, 1);
    const hasUvRects = spec.map !== null;
    this.uvRects = hasUvRects ? new Float32Array(capacity * 4) : null;
    this.mediumVoxel = new Int32Array(capacity * 3).fill(UNSEEN_VOXEL);
    this.isWet = new Uint8Array(capacity);

    const material = new MeshBasicMaterial({
      map: spec.map,
      transparent: true,
      // Cutouts take part in the depth buffer so they occlude each other;
      // soft particles stay out of it and blend in draw order.
      depthWrite: spec.isCutout,
      alphaTest: spec.isCutout ? CUTOUT_ALPHA_TEST : 0,
      // A tumbling quad shows its back half the time.
      side: spec.shape === "cube" ? FrontSide : DoubleSide,
      blending: spec.blend === "additive" ? AdditiveBlending : NormalBlending,
    });
    // A flat quad cannot cover itself, so three's two-pass draw of
    // transparent double-sided materials buys nothing here and costs a
    // second draw plus a material update (program parameters rebuilt) per
    // pass, every frame, even with no particle alive.
    material.forceSinglePass =
      spec.shape !== "cube" && (spec.isSinglePass ?? false);
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = injectChunk(
        shader.vertexShader,
        "#include <common>",
        "attribute float instanceAlpha;\nvarying float vInstanceAlpha;",
      );
      shader.vertexShader = injectChunk(
        shader.vertexShader,
        "#include <begin_vertex>",
        "vInstanceAlpha = instanceAlpha;",
      );
      shader.fragmentShader = injectChunk(
        shader.fragmentShader,
        "#include <common>",
        "varying float vInstanceAlpha;",
      );
      if (spec.isCutout) {
        // After the alpha test, not before it: the test decides where the
        // silhouette is, and a particle halfway through its fade must not
        // have its whole shape tested away.
        shader.fragmentShader = injectChunk(
          shader.fragmentShader,
          "#include <alphatest_fragment>",
          "diffuseColor.a *= vInstanceAlpha;",
        );
      } else {
        shader.fragmentShader = replaceChunk(
          shader.fragmentShader,
          "vec4 diffuseColor = vec4( diffuse, opacity );",
          "vec4 diffuseColor = vec4( diffuse, opacity * vInstanceAlpha );",
        );
      }
      if (hasUvRects) {
        shader.vertexShader = injectChunk(
          shader.vertexShader,
          "#include <common>",
          "attribute vec4 instanceUvRect;",
        );
        shader.vertexShader = injectChunk(
          shader.vertexShader,
          "#include <uv_vertex>",
          "#ifdef USE_MAP\nvMapUv = instanceUvRect.xy + vMapUv * instanceUvRect.zw;\n#endif",
        );
      }
    };

    // Shares the shape's buffers but not its instance attributes, which are
    // added to the dry draw's geometry below.
    const wetShape = spec.isCutout ? null : shareShape(shape);
    this.dry = makeDraw(shape, material, capacity, spec, hasUvRects);
    this.wet = wetShape
      ? makeDraw(wetShape, material, capacity, spec, hasUvRects)
      : null;
    this.mesh = this.dry.mesh;
    this.wetMesh = this.wet?.mesh ?? null;
    if (this.wetMesh) {
      this.mesh.userData[TRANSPARENT_MEDIUM_KEY] = "air";
      this.wetMesh.userData[TRANSPARENT_MEDIUM_KEY] = "water";
    }

    this.posX = new Float32Array(capacity);
    this.posY = new Float32Array(capacity);
    this.posZ = new Float32Array(capacity);
    this.velX = new Float32Array(capacity);
    this.velY = new Float32Array(capacity);
    this.velZ = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.sizeStart = new Float32Array(capacity);
    this.sizeEnd = new Float32Array(capacity);
    this.alphaStart = new Float32Array(capacity);
    this.alphaEnd = new Float32Array(capacity);
    this.alphaHold = new Float32Array(capacity);
    this.colStartR = new Float32Array(capacity);
    this.colStartG = new Float32Array(capacity);
    this.colStartB = new Float32Array(capacity);
    this.colEndR = new Float32Array(capacity);
    this.colEndG = new Float32Array(capacity);
    this.colEndB = new Float32Array(capacity);
    this.riseAccel = new Float32Array(capacity);
    this.dragPerSec = new Float32Array(capacity);
    this.turbulence = new Float32Array(capacity);
    this.spinRate = new Float32Array(capacity);
    this.spinPhase = new Float32Array(capacity);
    this.swayVelX = new Float32Array(capacity);
    this.swayVelZ = new Float32Array(capacity);
    this.swayFreq = new Float32Array(capacity);
    this.isSettling = new Uint8Array(capacity);
    this.isSettled = new Uint8Array(capacity);

    this.bodies = spec.physics ? makeBodies(capacity, spec.physics) : null;
  }

  /** Every mesh the layer draws through. */
  get meshes(): InstancedMesh<BufferGeometry, MeshBasicMaterial>[] {
    return this.wetMesh ? [this.mesh, this.wetMesh] : [this.mesh];
  }

  writeUvRect(
    index: number,
    offsetU: number,
    offsetV: number,
    spanU: number,
    spanV: number,
  ): void {
    if (!this.uvRects) return;
    const at = index * 4;
    this.uvRects[at] = offsetU;
    this.uvRects[at + 1] = offsetV;
    this.uvRects[at + 2] = spanU;
    this.uvRects[at + 3] = spanV;
  }

  /** A new particle in slot `index` reads its medium on its first frame. */
  forgetMedium(index: number): void {
    this.mediumVoxel[index * 3] = UNSEEN_VOXEL;
  }

  /** Starts a frame's writes: every slot is free again. */
  beginWrite(): void {
    this.dry.count = 0;
    if (this.wet) this.wet.count = 0;
  }

  /**
   * Writes particle `index`'s draw state into the next free slot of the
   * mesh for its medium; a cutout layer has one mesh for both.
   */
  writeInstance(
    index: number,
    isWet: boolean,
    matrix: Matrix4,
    red: number,
    green: number,
    blue: number,
    alpha: number,
  ): void {
    const draw = isWet && this.wet ? this.wet : this.dry;
    const slot = draw.count++;
    draw.mesh.setMatrixAt(slot, matrix);
    const colors = draw.mesh.instanceColor;
    if (colors) {
      colors.array[slot * 3] = red;
      colors.array[slot * 3 + 1] = green;
      colors.array[slot * 3 + 2] = blue;
    }
    draw.alpha.array[slot] = alpha;
    if (draw.uvRect && this.uvRects) {
      const rect = draw.uvRect.array;
      const to = slot * 4;
      const from = index * 4;
      rect[to] = this.uvRects[from];
      rect[to + 1] = this.uvRects[from + 1];
      rect[to + 2] = this.uvRects[from + 2];
      rect[to + 3] = this.uvRects[from + 3];
    }
  }

  markDirty(): void {
    markDrawDirty(this.dry);
    if (this.wet) markDrawDirty(this.wet);
  }

  /** Swap-remove keeps live particles packed so `mesh.count` can clip draw. */
  removeAt(index: number): void {
    const last = this.alive - 1;
    if (index !== last) {
      this.posX[index] = this.posX[last];
      this.posY[index] = this.posY[last];
      this.posZ[index] = this.posZ[last];
      this.velX[index] = this.velX[last];
      this.velY[index] = this.velY[last];
      this.velZ[index] = this.velZ[last];
      this.age[index] = this.age[last];
      this.life[index] = this.life[last];
      this.sizeStart[index] = this.sizeStart[last];
      this.sizeEnd[index] = this.sizeEnd[last];
      this.alphaStart[index] = this.alphaStart[last];
      this.alphaEnd[index] = this.alphaEnd[last];
      this.alphaHold[index] = this.alphaHold[last];
      this.colStartR[index] = this.colStartR[last];
      this.colStartG[index] = this.colStartG[last];
      this.colStartB[index] = this.colStartB[last];
      this.colEndR[index] = this.colEndR[last];
      this.colEndG[index] = this.colEndG[last];
      this.colEndB[index] = this.colEndB[last];
      this.riseAccel[index] = this.riseAccel[last];
      this.dragPerSec[index] = this.dragPerSec[last];
      this.turbulence[index] = this.turbulence[last];
      this.spinRate[index] = this.spinRate[last];
      this.spinPhase[index] = this.spinPhase[last];
      this.swayVelX[index] = this.swayVelX[last];
      this.swayVelZ[index] = this.swayVelZ[last];
      this.swayFreq[index] = this.swayFreq[last];
      this.isSettling[index] = this.isSettling[last];
      this.isSettled[index] = this.isSettled[last];
      this.isWet[index] = this.isWet[last];
      this.mediumVoxel[index * 3] = this.mediumVoxel[last * 3];
      this.mediumVoxel[index * 3 + 1] = this.mediumVoxel[last * 3 + 1];
      this.mediumVoxel[index * 3 + 2] = this.mediumVoxel[last * 3 + 2];
      if (this.uvRects) {
        const rect = this.uvRects;
        const to = index * 4;
        const from = last * 4;
        rect[to] = rect[from];
        rect[to + 1] = rect[from + 1];
        rect[to + 2] = rect[from + 2];
        rect[to + 3] = rect[from + 3];
      }
      if (this.bodies) {
        const held = this.bodies[index];
        this.bodies[index] = this.bodies[last];
        this.bodies[last] = held;
      }
    }
    this.alive = last;
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.mesh.material.dispose();
  }
}

/**
 * A geometry over `source`'s vertex buffers, without the instance attributes
 * each draw adds to its own.
 */
function shareShape(source: BufferGeometry): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setIndex(source.index);
  for (const name of Object.keys(source.attributes)) {
    geometry.setAttribute(name, source.getAttribute(name));
  }
  return geometry;
}

/** One instanced draw over `shape`, with its own per-instance attributes. */
function makeDraw(
  shape: BufferGeometry,
  material: MeshBasicMaterial,
  capacity: number,
  spec: LayerSpec,
  hasUvRects: boolean,
): LayerDraw {
  const alpha = new InstancedBufferAttribute(
    new Float32Array(capacity).fill(1),
    1,
  );
  alpha.setUsage(DynamicDrawUsage);
  shape.setAttribute("instanceAlpha", alpha);

  let uvRect: InstancedBufferAttribute | null = null;
  if (hasUvRects) {
    uvRect = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    uvRect.setUsage(DynamicDrawUsage);
    shape.setAttribute("instanceUvRect", uvRect);
  }

  const mesh = new InstancedMesh(shape, material, capacity);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = spec.renderOrder ?? 0;
  mesh.count = 0;
  if (spec.bloomExemptLayer !== null) {
    // Joined, not moved: the mesh still draws in the main pass on layer 0,
    // and a selective bloom that renders this channel finds it there.
    mesh.layers.enable(spec.bloomExemptLayer);
    mesh.userData.isBloomExempt = true;
  }
  // Touch instanceColor into existence so the material compiles with
  // per-instance color support from the first frame.
  for (let i = 0; i < capacity; i += 1) {
    mesh.setColorAt(i, WHITE);
  }
  return { mesh, alpha, uvRect, count: 0 };
}

function markDrawDirty(draw: LayerDraw): void {
  draw.mesh.count = draw.count;
  draw.mesh.instanceMatrix.needsUpdate = true;
  if (draw.mesh.instanceColor) draw.mesh.instanceColor.needsUpdate = true;
  draw.alpha.needsUpdate = true;
  if (draw.uvRect) draw.uvRect.needsUpdate = true;
}

function makeBodies(capacity: number, physics: ParticlePhysics): RigidBody[] {
  const bodies: RigidBody[] = [];
  for (let i = 0; i < capacity; i += 1) {
    bodies.push(
      new RigidBody(
        new AABB(0, 0, 0, physics.bodySize, physics.bodySize, physics.bodySize),
        1,
        physics.friction,
        physics.restitution,
        physics.gravityMultiplier,
        0,
      ),
    );
  }
  return bodies;
}

/**
 * Launches a pooled body from rest. Every field the engine accumulates has
 * to be cleared: a body that keeps the velocity of the particle before it
 * appears to fly out of nowhere.
 */
export function relaunchBody(
  body: RigidBody,
  x: number,
  y: number,
  z: number,
  velocityX: number,
  velocityY: number,
  velocityZ: number,
): void {
  body.velocity[0] = 0;
  body.velocity[1] = 0;
  body.velocity[2] = 0;
  body.forces[0] = 0;
  body.forces[1] = 0;
  body.forces[2] = 0;
  body.impulses[0] = 0;
  body.impulses[1] = 0;
  body.impulses[2] = 0;
  body.resting[0] = 0;
  body.resting[1] = 0;
  body.resting[2] = 0;
  body.inFluid = false;
  body.ratioInFluid = 0;
  body.setPosition([x, y, z]);
  // Mass is 1, so an impulse is a velocity.
  body.applyImpulse([velocityX, velocityY, velocityZ]);
}

function injectChunk(source: string, anchor: string, added: string): string {
  return replaceChunk(source, anchor, `${anchor}\n${added}`);
}

// The anchors are stable chunks of three's built-in shaders. A three upgrade
// that renames one is reported here rather than silently dropping the effect.
function replaceChunk(
  source: string,
  anchor: string,
  replacement: string,
): string {
  if (!source.includes(anchor)) {
    console.error(
      `[particles] shader anchor "${anchor}" is gone, so particles will ` +
        "render wrong. A three upgrade renamed it; update the injection.",
    );
    return source;
  }
  return source.replace(anchor, replacement);
}
