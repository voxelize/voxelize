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
};

/** Below this the silhouette is a hole, above it the texel is the particle. */
const CUTOUT_ALPHA_TEST = 0.5;

const WHITE = new Color(0xffffff);

/**
 * SoA storage plus one InstancedMesh for a single blend/shape/texture/physics
 * combination. A layer is a draw call and a capacity of its own, so an
 * ambient effect that saturates its layer can never starve explosions of
 * theirs.
 */
export class ParticleLayer {
  readonly mesh: InstancedMesh<BufferGeometry, MeshBasicMaterial>;
  private readonly alphaAttr: InstancedBufferAttribute;
  /** Per-instance atlas window (offsetU, offsetV, spanU, spanV). */
  private readonly uvRectAttr: InstancedBufferAttribute | null;
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
    const geometry: BufferGeometry =
      spec.shape === "cube"
        ? new BoxGeometry(1, 1, 1)
        : new PlaneGeometry(1, 1);

    const alphas = new Float32Array(capacity).fill(1);
    this.alphaAttr = new InstancedBufferAttribute(alphas, 1);
    this.alphaAttr.setUsage(DynamicDrawUsage);
    geometry.setAttribute("instanceAlpha", this.alphaAttr);

    if (spec.map) {
      const rects = new Float32Array(capacity * 4);
      this.uvRectAttr = new InstancedBufferAttribute(rects, 4);
      this.uvRectAttr.setUsage(DynamicDrawUsage);
      geometry.setAttribute("instanceUvRect", this.uvRectAttr);
    } else {
      this.uvRectAttr = null;
    }

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
      if (this.uvRectAttr) {
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

    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    // Touch instanceColor into existence so the material compiles with
    // per-instance color support from the first frame.
    for (let i = 0; i < capacity; i += 1) {
      this.mesh.setColorAt(i, WHITE);
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

  writeAlpha(index: number, alpha: number): void {
    this.alphaAttr.array[index] = alpha;
  }

  writeUvRect(
    index: number,
    offsetU: number,
    offsetV: number,
    spanU: number,
    spanV: number,
  ): void {
    if (!this.uvRectAttr) return;
    const at = index * 4;
    const rect = this.uvRectAttr.array;
    rect[at] = offsetU;
    rect[at + 1] = offsetV;
    rect[at + 2] = spanU;
    rect[at + 3] = spanV;
  }

  markDirty(): void {
    this.mesh.count = this.alive;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
    if (this.uvRectAttr) this.uvRectAttr.needsUpdate = true;
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
      if (this.uvRectAttr) {
        const rect = this.uvRectAttr.array;
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
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
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
