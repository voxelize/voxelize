import type { Material } from "three/webgpu";
import { Color, Matrix4, Vector3, Vector4 } from "three/webgpu";
import { float, mat4, vec3, vec4 } from "three/tsl";

import { ShaderLightingUniforms } from "./chunk-renderer";
import {
  type FloatNode,
  type Mat4Node,
  materialValue,
  type Vec3Node,
  type Vec4Node,
} from "./shading/types";
import { ownUniform, textureSlot, worldUniform } from "./shading/uniforms";

export type { ShaderLightingUniforms };

/**
 * The world's lighting as an entity's shadow reads it: the sun, the
 * cascades and their maps. What belongs to one body (its bounds, where it
 * is drawn from) is its {@link EntityShadowBody}.
 */
export type EntityShadowUniforms = ReturnType<typeof createEntityShadowUniforms>;

/**
 * A lighting block. `make` places its values: the world's shared block is
 * written every frame as the sun moves, so it lives in the world group (one
 * buffer, uploaded once a render); in each material's own group, every
 * creature draw rewrote its buffer for the sun alone (~80 writes a frame in a
 * crowd of 500). A never-written block (the studio's) keeps the default.
 */
export function createEntityShadowUniforms(
  make: typeof ownUniform = ownUniform,
) {
  return {
    uShadowMap0: textureSlot("depth"),
    uShadowMap1: textureSlot("depth"),
    uShadowMap2: textureSlot("depth"),
    uShadowMatrix0: make(new Matrix4()),
    uShadowMatrix1: make(new Matrix4()),
    uShadowMatrix2: make(new Matrix4()),
    uCascadeSplit0: make(16),
    uCascadeSplit1: make(48),
    uCascadeSplit2: make(128),
    uShadowBias: make(0.0005),
    uShadowNormalBias: make(0.01),
    uShadowStrength: make(1.0),
    uSunlightIntensity: make(1.0),
    uSunDirection: make(new Vector3(0.5, 1.0, 0.3).normalize()),
    uSunColor: make(new Color(1, 1, 1)),
    uShadowDepthPerBlock: make(0.0),
  };
}

/**
 * The one copy of the world's lighting every in-world entity material
 * reads (creatures, characters, the arm, drops, accessories): the World
 * writes it each frame (`updateShaderLighting`, then the cascade matrices
 * again once the maps are drawn), so no owner copies it, and one graph
 * serves every material that reads it.
 */
export const sharedEntityShadowUniforms: EntityShadowUniforms =
  createEntityShadowUniforms(worldUniform);

export function updateEntityShadowUniforms(
  target: EntityShadowUniforms,
  source: ShaderLightingUniforms,
): void {
  target.uShadowMap0.value = source.shadowMap0.value;
  target.uShadowMap1.value = source.shadowMap1.value;
  target.uShadowMap2.value = source.shadowMap2.value;
  target.uShadowMatrix0.value.copy(source.shadowMatrix0.value);
  target.uShadowMatrix1.value.copy(source.shadowMatrix1.value);
  target.uShadowMatrix2.value.copy(source.shadowMatrix2.value);
  target.uCascadeSplit0.value = source.cascadeSplit0.value;
  target.uCascadeSplit1.value = source.cascadeSplit1.value;
  target.uCascadeSplit2.value = source.cascadeSplit2.value;
  target.uShadowBias.value = source.shadowBias.value;
  target.uShadowStrength.value = source.shadowStrength.value;
  target.uSunlightIntensity.value = source.sunlightIntensity.value;
  target.uSunDirection.value.copy(source.sunDirection.value);
  target.uSunColor.value.copy(source.sunColor.value);
  target.uShadowDepthPerBlock.value = source.shadowDepthPerBlock.value;
}

/**
 * What one body's shadow reads besides the world's lighting. Every
 * material of the body holds the same record (`setShadowBody`), so one write
 * reaches all its parts, and the parts of every body share one graph.
 */
export type EntityShadowBody = {
  /**
   * The body's bounding sphere in world space (centre, radius): the slope
   * bias that keeps a sun-averted face out of its own body's shadow never
   * reaches past it. Radius 0: no bounds.
   */
  selfBounds: Vector4;
  /** Shadow-map depth an occluder must lie past to shade (0: any). */
  minOccluderDepth: number;
  /** 1: nothing inside `selfBounds` shades any face (a placed viewmodel). */
  ignoresSelf: number;
  /** From where the body is drawn to where it is shaded, plus `worldOffset`. */
  worldMatrix: Matrix4;
  worldOffset: Vector3;
};

export function createEntityShadowBody(
  // Radius 0: no bounds (a Vector4 starts at w = 1, a unit sphere).
  selfBounds: Vector4 = new Vector4(0, 0, 0, 0),
): EntityShadowBody {
  return {
    selfBounds,
    minOccluderDepth: 0,
    ignoresSelf: 0,
    worldMatrix: new Matrix4(),
    worldOffset: new Vector3(),
  };
}

/** A body's inputs as a shader reads them. */
export type EntityShadowBodyInputs = {
  selfBounds: Vec4Node;
  minOccluderDepth: FloatNode;
  ignoresSelf: FloatNode;
  worldMatrix: Mat4Node;
  worldOffset: Vec3Node;
};

let unplaced: EntityShadowBodyInputs | null = null;

/**
 * A body shaded where it is drawn, with no bounds of its own (or bounds a
 * shader passes in itself, as an instanced creature does).
 */
export function unplacedShadowBody(): EntityShadowBodyInputs {
  unplaced ??= {
    selfBounds: vec4(0),
    minOccluderDepth: float(0),
    ignoresSelf: float(0),
    worldMatrix: mat4(new Matrix4()),
    worldOffset: vec3(0),
  } as unknown as EntityShadowBodyInputs;
  return unplaced;
}

let drawnBody: EntityShadowBodyInputs | null = null;

/**
 * The body of whichever material is drawn: its `userData.shadowBody`
 * ({@link setShadowBody}), read before each draw.
 */
export function materialShadowBody(): EntityShadowBodyInputs {
  drawnBody ??= {
    selfBounds: materialValue("userData.shadowBody.selfBounds", "vec4"),
    minOccluderDepth: materialValue("userData.shadowBody.minOccluderDepth", "float"),
    ignoresSelf: materialValue("userData.shadowBody.ignoresSelf", "float"),
    worldMatrix: materialValue("userData.shadowBody.worldMatrix", "mat4"),
    worldOffset: materialValue("userData.shadowBody.worldOffset", "vec3"),
  };
  return drawnBody;
}

/**
 * Has `material` shade as part of `body`. A material that reads
 * {@link materialShadowBody} must hold one; a clone holds a copy of the
 * record, frozen, until it is pointed at its body again.
 */
export function setShadowBody(material: Material, body: EntityShadowBody): void {
  material.userData.shadowBody = body;
}

/**
 * How far the depth stored in a shadow map moves per block along the light:
 * the map is an orthographic projection, so this is one number per cascade,
 * the depth component of the light direction carried through its matrix,
 * in stored units: WebGPU stores clip depth as is (`clipToStored` 1), WebGL
 * maps its -1..1 to 0..1 (0.5).
 */
export function shadowDepthPerBlock(
  shadowMatrix: Matrix4,
  lightDirection: Vector3,
  clipToStored: number,
): number {
  const e = shadowMatrix.elements;
  const clipDepth =
    e[2] * lightDirection.x +
    e[6] * lightDirection.y +
    e[10] * lightDirection.z;
  return Math.abs(clipToStored * clipDepth);
}
