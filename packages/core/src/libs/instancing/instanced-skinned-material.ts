import * as THREE from "three";

import {
  createEntityShadowUniforms,
  ENTITY_SHADOW_BOUNDS_VERTEX_FUNCTIONS,
  ENTITY_SHADOW_FRAGMENT_PARS,
  ENTITY_SHADOW_VERTEX_MAIN,
  ENTITY_SHADOW_VERTEX_PARS,
  EntityShadowUniforms,
} from "../../core/world/entity-shadow-uniforms";
import {
  LIGHT_CONES_FUNCTIONS,
  LIGHT_CONES_SCATTER_FRAGMENT,
  LIGHT_CONES_UNIFORM_DECLARATIONS,
  LightConeUniforms,
  LightCones,
} from "../../core/world/light-cones";
import {
  bindSkyGlowUniforms,
  type SkyGlowUniforms,
} from "../../core/world/sky";
import {
  SKY_FOG_COMMON_UNIFORM_DECLARATIONS,
  SKY_FOG_FRAGMENT,
} from "../../core/world/sky-fog";

export type EntityFaceShades = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];

/// One brightness per axis direction, in the shader's face order
/// (`getFaceIndex`): +x, -x, +y, -y, +z, -z. The shader blends them over
/// world axes by squared normal components, so an animating or yawing body
/// shifts shade smoothly instead of popping at 45 degrees.
///
/// Top-anchored at 1.0, so a top face in full sun keeps its painted
/// brightness and a pale coat cannot clip past white. Flanks and bellies
/// drop toward the chunk shader's face grammar without going that far:
/// chunk-strength contrast on an entity-sized body reads as dirt, not light.
export const DEFAULT_ENTITY_FACE_SHADES: EntityFaceShades = [
  0.86, 0.78, 1, 0.6, 0.94, 0.72,
];

export interface InstancedSkinnedMaterialOptions {
  map?: THREE.Texture;
  color?: THREE.Color;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  depthWrite?: boolean;
  useFaceUV?: boolean;
  atlasGridCols?: number;
  atlasGridRows?: number;
  partCount?: number;
  receiveShadows?: boolean;
  useVertexColor?: boolean;
  /**
   * One face of one part that glows at full albedo when an instance's
   * `instanceEmissive` attribute is set (e.g. a headlight lens).
   * Face indices follow the shader's getFaceIndex order:
   * 0=+x, 1=-x, 2=+y, 3=-y, 4=+z, 5=-z.
   */
  emissiveFace?: {
    partIndex: number;
    faceIndex: number;
    color: THREE.Color;
  };
  /**
   * Whether the material shares the live scene's atmosphere uniforms (fog,
   * sky fog, underwater submersion, light cones). In-world entities want
   * true; offscreen studio renders (portraits, thumbnails) want false, or a
   * bake taken while the camera is underwater ships tinted forever. The
   * local fallback uniforms are neutral at portrait range.
   *
   * It also decides the shadow uniforms: bound materials share the one
   * {@link sharedEntityShadowUniforms} block the world lighting is copied
   * into once a frame; studio materials keep a private, never-updated block,
   * so a portrait renderer never binds the world's shadow maps.
   */
  isEnvironmentBound?: boolean;
  /**
   * Slack in blocks around the drawn geometry's bounding sphere, which
   * bounds each instance's own body for its shadows (`uShadowSelfSphere`):
   * room for limbs that swing past their rest pose and for the body's own
   * shadow imprint, which is redrawn only every few frames as it moves.
   * Defaults to {@link ENTITY_SHADOW_SELF_BOUNDS_MARGIN}.
   */
  shadowSelfBoundsMargin?: number;
  /** Per-axis face brightness; {@link DEFAULT_ENTITY_FACE_SHADES} if unset. */
  faceShades?: EntityFaceShades;
}

/** {@link InstancedSkinnedMaterialOptions.shadowSelfBoundsMargin}'s default. */
export const ENTITY_SHADOW_SELF_BOUNDS_MARGIN = 0.15;

/**
 * The shadow uniform block every in-world instanced entity material shares.
 * One block per warmed variant would need the frame's lighting (three
 * matrices, two colors, eight scalars) copied into each, empty variants
 * included; shared, the copy is one `updateEntityShadowUniforms` call a
 * frame. Nothing writes these uniforms per material (per-object offsets live
 * on CanvasBox, not here), which is what makes sharing them safe.
 */
export const sharedEntityShadowUniforms: EntityShadowUniforms =
  createEntityShadowUniforms();

const vertexShader = `
precision highp float;

attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute float instanceBoneOffset;
attribute float instanceHitEffect;
attribute float instanceEmissive;
attribute vec3 instanceLightColor;
attribute float partIndex;
attribute vec3 pivotOffset;
attribute vec3 vertexColor;

uniform sampler2D uBoneTexture;
uniform float uBoneTextureWidth;
uniform float uBoneTextureHeight;
uniform float uBonesPerInstance;
uniform float uTime;
uniform vec4 uShadowSelfSphere;
uniform float uShadowSelfBoundsMargin;

${ENTITY_SHADOW_VERTEX_PARS}

${ENTITY_SHADOW_BOUNDS_VERTEX_FUNCTIONS}

varying vec4 vShadowSelfBounds;
varying vec2 vUv;
varying float vHitEffect;
varying float vEmissive;
varying vec3 vLightColor;
varying vec3 vNormal;
varying vec3 vLocalNormal;
varying float vPartIndex;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
varying vec3 vOrigNormal;
varying vec3 vVertexColor;

mat4 getBoneMatrix(float boneIdx) {
  float globalBoneIdx = instanceBoneOffset + boneIdx;
  float pixelIdx = globalBoneIdx * 4.0;

  float row = floor(pixelIdx / uBoneTextureWidth);
  float col = mod(pixelIdx, uBoneTextureWidth);

  vec2 uv0 = vec2((col + 0.5) / uBoneTextureWidth, (row + 0.5) / uBoneTextureHeight);
  vec2 uv1 = vec2((col + 1.5) / uBoneTextureWidth, (row + 0.5) / uBoneTextureHeight);
  vec2 uv2 = vec2((col + 2.5) / uBoneTextureWidth, (row + 0.5) / uBoneTextureHeight);
  vec2 uv3 = vec2((col + 3.5) / uBoneTextureWidth, (row + 0.5) / uBoneTextureHeight);

  vec4 col0 = texture2D(uBoneTexture, uv0);
  vec4 col1 = texture2D(uBoneTexture, uv1);
  vec4 col2 = texture2D(uBoneTexture, uv2);
  vec4 col3 = texture2D(uBoneTexture, uv3);

  return mat4(col0, col1, col2, col3);
}

void main() {
  vUv = uv;
  vHitEffect = instanceHitEffect;
  vEmissive = instanceEmissive;
  vLightColor = instanceLightColor;
  vPartIndex = partIndex;
  vOrigNormal = normal;
  vVertexColor = vertexColor;

  mat4 boneMatX = getBoneMatrix(skinIndex.x);
  mat4 boneMatY = getBoneMatrix(skinIndex.y);
  mat4 boneMatZ = getBoneMatrix(skinIndex.z);
  mat4 boneMatW = getBoneMatrix(skinIndex.w);

  mat4 skinMatrix = boneMatX * skinWeight.x
                  + boneMatY * skinWeight.y
                  + boneMatZ * skinWeight.z
                  + boneMatW * skinWeight.w;

  vec3 localPos = position - pivotOffset;
  vec4 skinnedPosition = skinMatrix * vec4(localPos, 1.0);
  skinnedPosition.xyz += pivotOffset;

  mat3 skinNormalMatrix = mat3(skinMatrix);
  vec3 skinnedNormal = normalize(skinNormalMatrix * normal);

  vLocalNormal = skinnedNormal;

  mat3 instanceNormalMatrix = mat3(instanceMatrix);
  vNormal = normalize(instanceNormalMatrix * skinnedNormal);
  vWorldNormal = vNormal;

  vec4 worldPosition = instanceMatrix * skinnedPosition;
  vWorldPosition = worldPosition.xyz;
  vShadowSelfBounds = entityShadowBoundsToWorld(instanceMatrix, uShadowSelfSphere);
  // Radius 0 means no bounds yet, and has to stay 0 (unbounded).
  if (vShadowSelfBounds.w > 0.0) vShadowSelfBounds.w += uShadowSelfBoundsMargin;

  ${ENTITY_SHADOW_VERTEX_MAIN}

  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const fragmentShader = `
precision highp float;

uniform sampler2D uColorMap;
uniform vec3 uColor;
uniform float uOpacity;
uniform vec3 uHitColor;
uniform float uMaxBrightness;
uniform bool uUseFaceUV;
uniform bool uUseVertexColor;
uniform float uAtlasCols;
uniform float uAtlasRows;
uniform float uPartCount;
uniform bool uReceiveShadows;
uniform float uEmissivePartIndex;
uniform float uEmissiveFaceIndex;
uniform vec3 uEmissiveColor;
uniform vec3 uFaceShadesPos;
uniform vec3 uFaceShadesNeg;

${SKY_FOG_COMMON_UNIFORM_DECLARATIONS}

${LIGHT_CONES_UNIFORM_DECLARATIONS}

${ENTITY_SHADOW_FRAGMENT_PARS}

varying vec4 vShadowSelfBounds;
varying vec2 vUv;
varying float vHitEffect;
varying float vEmissive;
varying vec3 vLightColor;
varying vec3 vNormal;
varying vec3 vLocalNormal;
varying float vPartIndex;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
varying vec3 vOrigNormal;
varying vec3 vVertexColor;

int getFaceIndex(vec3 normal) {
  vec3 absNormal = abs(normal);
  float maxComp = max(absNormal.x, max(absNormal.y, absNormal.z));

  if (absNormal.x >= maxComp - 0.01) {
    return normal.x > 0.0 ? 0 : 1;
  }
  else if (absNormal.y >= maxComp - 0.01) {
    return normal.y > 0.0 ? 2 : 3;
  }
  else {
    return normal.z > 0.0 ? 4 : 5;
  }
}

float faceShade(vec3 worldNormal) {
  vec3 positives = max(worldNormal, 0.0);
  vec3 negatives = max(-worldNormal, 0.0);
  positives *= positives;
  negatives *= negatives;
  float coverage = dot(positives + negatives, vec3(1.0));
  float shade = dot(positives, uFaceShadesPos) + dot(negatives, uFaceShadesNeg);
  return shade / max(coverage, 0.0001);
}

${LIGHT_CONES_FUNCTIONS}

vec2 getFaceUV(vec2 baseUV, vec3 normal) {
  if (!uUseFaceUV) {
    return baseUV;
  }

  int faceIdx = getFaceIndex(normal);

  float totalCells = uAtlasCols * uAtlasRows;
  float cellsPerPart = 6.0;
  float partStartCell = vPartIndex * cellsPerPart;
  float globalCellIdx = partStartCell + float(faceIdx);

  float col = mod(globalCellIdx, uAtlasCols);
  float row = floor(globalCellIdx / uAtlasCols);

  vec2 cellScale = vec2(1.0 / uAtlasCols, 1.0 / uAtlasRows);
  vec2 flippedUV = vec2(baseUV.x, 1.0 - baseUV.y);
  vec2 paddedUV = mix(vec2(0.03), vec2(0.97), flippedUV);
  vec2 scaledUV = paddedUV * cellScale;
  vec2 offset = vec2(col / uAtlasCols, row / uAtlasRows);

  return scaledUV + offset;
}

void main() {
  vec2 finalUV = getFaceUV(vUv, vOrigNormal);
  vec4 texColor = texture2D(uColorMap, finalUV);

  vec3 color = texColor.rgb * uColor;
  if (uUseVertexColor) {
    color *= vVertexColor;
  }
  vec3 albedo = color;

  vec3 clampedLight = min(vLightColor, vec3(uMaxBrightness));
  color *= clampedLight;
  color *= faceShade(vWorldNormal);

  if (uReceiveShadows) {
    // Each instance is bounded by its own body, so a face turned from the
    // sun is not shaded by the body it belongs to, while a deck or a
    // canopy past those bounds still shades it.
    float shadow = getEntityShadowWithin(
      normalize(vWorldNormal),
      vWorldPosition,
      vShadowSelfBounds
    );
    color *= shadow;
  }

  color += albedo * lightConeSurface(vWorldPosition, vWorldNormal);

  // Emissive face (e.g. a lit headlight lens): full albedo boosted past the
  // scene lighting, immune to darkness and shadows.
  if (uEmissivePartIndex >= 0.0
      && abs(vPartIndex - uEmissivePartIndex) < 0.5
      && vEmissive > 0.5
      && getFaceIndex(vOrigNormal) == int(uEmissiveFaceIndex)) {
    color = albedo * uEmissiveColor;
  }

  color = mix(color, uHitColor, vHitEffect);

  gl_FragColor = vec4(color, texColor.a * uOpacity);

  if (gl_FragColor.a < 0.01) discard;

  ${SKY_FOG_FRAGMENT}

  ${LIGHT_CONES_SCATTER_FRAGMENT}
}
`;

export type EntityFogUniforms = {
  fogNear: { value: number };
  fogFar: { value: number };
  fogColor: { value: THREE.Color };
  fogHeightOrigin: { value: number };
  fogHeightDensity: { value: number };
  fogVerticalBlend?: { value: number };
  skyFogTopColor: { value: THREE.Color };
  skyFogMiddleColor: { value: THREE.Color };
  skyFogBottomColor: { value: THREE.Color };
  skyFogOffset: { value: number };
  skyFogVoidOffset: { value: number };
  skyFogExponent: { value: number };
  skyFogExponent2: { value: number };
  skyFogDimension: { value: number };
  skyFogStrength: { value: number };
  cameraSubmersion: { value: number };
  cameraWaterPlaneY: { value: number };
  underwaterAmbient: { value: THREE.Color };
  waterLevel: { value: number };
  /** The share of the sun reaching the world as a beam (the weather's). */
  directSunlight: { value: number };
  /** The sky's own light (`world.sky.glow`); black when absent. */
  skyGlow?: SkyGlowUniforms;
  lightCones: LightConeUniforms;
};

let sharedEntityFogUniforms: EntityFogUniforms | null = null;

export function setSharedEntityFogUniforms(fog: EntityFogUniforms): void {
  sharedEntityFogUniforms = fog;
}

export function makeSharedEntityFogUniformBindings(): Record<
  string,
  THREE.IUniform
> | null {
  const fog = sharedEntityFogUniforms;
  if (!fog) return null;
  return {
    uFogNear: fog.fogNear,
    uFogFar: fog.fogFar,
    uFogColor: fog.fogColor,
    uFogHeightOrigin: fog.fogHeightOrigin,
    uFogHeightDensity: fog.fogHeightDensity,
    uFogVerticalBlend: fog.fogVerticalBlend ?? { value: 0 },
    uSkyFogTopColor: fog.skyFogTopColor,
    uSkyFogMiddleColor: fog.skyFogMiddleColor,
    uSkyFogBottomColor: fog.skyFogBottomColor,
    uSkyFogOffset: fog.skyFogOffset,
    uSkyFogVoidOffset: fog.skyFogVoidOffset,
    uSkyFogExponent: fog.skyFogExponent,
    uSkyFogExponent2: fog.skyFogExponent2,
    uSkyFogDimension: fog.skyFogDimension,
    uSkyFogStrength: fog.skyFogStrength,
    uCameraSubmersion: fog.cameraSubmersion,
    uCameraWaterPlaneY: fog.cameraWaterPlaneY,
    uUnderwaterAmbient: fog.underwaterAmbient,
    uDirectSunlight: fog.directSunlight,
    ...bindSkyGlowUniforms(fog.skyGlow),
    uConeCount: fog.lightCones.coneCount,
    uConeOrigins: fog.lightCones.coneOrigins,
    uConeDirections: fog.lightCones.coneDirections,
    uConeColors: fog.lightCones.coneColors,
    uConeShapes: fog.lightCones.coneShapes,
  };
}

export class InstancedSkinnedMaterial extends THREE.ShaderMaterial {
  public shadowUniforms: EntityShadowUniforms;
  private shadowSelfGeometry: THREE.BufferGeometry | null = null;

  constructor(
    boneTexture: THREE.DataTexture,
    boneTextureWidth: number,
    boneTextureHeight: number,
    bonesPerInstance: number,
    options: InstancedSkinnedMaterialOptions = {},
  ) {
    const defaultTexture = new THREE.DataTexture(
      new Uint8Array([255, 255, 255, 255]),
      1,
      1,
    );
    defaultTexture.needsUpdate = true;
    const faceShades = options.faceShades ?? DEFAULT_ENTITY_FACE_SHADES;

    const isEnvironmentBound = options.isEnvironmentBound ?? true;
    const shadowUniforms = isEnvironmentBound
      ? sharedEntityShadowUniforms
      : createEntityShadowUniforms();
    const fogBindings = isEnvironmentBound
      ? makeSharedEntityFogUniformBindings() ?? {}
      : {};

    super({
      vertexShader,
      fragmentShader,
      uniforms: {
        uBoneTexture: { value: boneTexture },
        uBoneTextureWidth: { value: boneTextureWidth },
        uBoneTextureHeight: { value: boneTextureHeight },
        uBonesPerInstance: { value: bonesPerInstance },
        uTime: { value: 0 },
        uShadowSelfSphere: { value: new THREE.Vector4(0, 0, 0, 0) },
        uShadowSelfBoundsMargin: {
          value:
            options.shadowSelfBoundsMargin ?? ENTITY_SHADOW_SELF_BOUNDS_MARGIN,
        },
        uColorMap: { value: options.map ?? defaultTexture },
        uColor: { value: options.color ?? new THREE.Color(1, 1, 1) },
        uOpacity: { value: options.opacity ?? 1.0 },
        uHitColor: { value: new THREE.Color(1, 0, 0) },
        uMaxBrightness: { value: 1.0 },
        uUseFaceUV: { value: options.useFaceUV ?? false },
        uUseVertexColor: { value: options.useVertexColor ?? false },
        uAtlasCols: { value: options.atlasGridCols ?? 6 },
        uAtlasRows: { value: options.atlasGridRows ?? 5 },
        uPartCount: { value: options.partCount ?? 5 },
        uReceiveShadows: { value: options.receiveShadows ?? false },
        uEmissivePartIndex: { value: options.emissiveFace?.partIndex ?? -1 },
        uEmissiveFaceIndex: { value: options.emissiveFace?.faceIndex ?? -1 },
        uEmissiveColor: {
          value: options.emissiveFace?.color ?? new THREE.Color(0, 0, 0),
        },
        uFaceShadesPos: {
          value: new THREE.Vector3(faceShades[0], faceShades[2], faceShades[4]),
        },
        uFaceShadesNeg: {
          value: new THREE.Vector3(faceShades[1], faceShades[3], faceShades[5]),
        },
        uFogColor: { value: new THREE.Color("#B1CCFD") },
        uFogNear: { value: 100 },
        uFogFar: { value: 200 },
        uFogHeightOrigin: { value: 80 },
        uFogHeightDensity: { value: 0.005 },
        uSkyFogTopColor: { value: new THREE.Color(0.4, 0.6, 0.9) },
        uSkyFogMiddleColor: { value: new THREE.Color(0.7, 0.8, 0.95) },
        uSkyFogBottomColor: { value: new THREE.Color(0.15, 0.18, 0.25) },
        uSkyFogOffset: { value: 0 },
        uSkyFogVoidOffset: { value: 1200 },
        uSkyFogExponent: { value: 0.6 },
        uSkyFogExponent2: { value: 1.2 },
        uSkyFogDimension: { value: 2000 },
        uSkyFogStrength: { value: 1.0 },
        uCameraSubmersion: { value: 0 },
        uCameraWaterPlaneY: { value: 0 },
        uUnderwaterAmbient: { value: new THREE.Color(0, 0, 0) },
        uDirectSunlight: { value: 1 },
        uChunkReveal: { value: 1 },
        ...new LightCones().uniformBindings,
        ...shadowUniforms,
        ...fogBindings,
      },
      transparent: options.transparent ?? false,
      side: options.side ?? THREE.FrontSide,
      depthWrite: options.depthWrite ?? true,
    });

    this.shadowUniforms = shadowUniforms;
    const defaultAttributeValues = this
      .defaultAttributeValues as typeof this.defaultAttributeValues & {
      vertexColor: [number, number, number];
      instanceEmissive: [number];
    };
    defaultAttributeValues.vertexColor = [1, 1, 1];
    defaultAttributeValues.instanceEmissive = [0];
  }

  /**
   * Bounds every instance by the geometry about to be drawn: its bounding
   * sphere, in the space the instance matrix carries into the world, fills
   * `uShadowSelfSphere`. Three keeps the sphere on the geometry, so this
   * costs one measurement per geometry, ever.
   */
  override onBeforeRender(
    _renderer: THREE.WebGLRenderer,
    _scene: THREE.Scene,
    _camera: THREE.Camera,
    geometry: THREE.BufferGeometry,
  ): void {
    if (geometry === this.shadowSelfGeometry) return;
    this.shadowSelfGeometry = geometry;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere;
    const target = this.uniforms.uShadowSelfSphere.value as THREE.Vector4;
    if (sphere && Number.isFinite(sphere.radius) && sphere.radius > 0) {
      target.set(
        sphere.center.x,
        sphere.center.y,
        sphere.center.z,
        sphere.radius,
      );
    } else {
      target.set(0, 0, 0, 0);
    }
    // A material drawn for more than one geometry has to re-upload.
    this.uniformsNeedUpdate = true;
  }

  setTime(time: number): void {
    this.uniforms.uTime.value = time;
  }

  setMaxBrightness(maxBrightness: number): void {
    this.uniforms.uMaxBrightness.value = maxBrightness;
  }

  updateBoneTexture(texture: THREE.DataTexture): void {
    this.uniforms.uBoneTexture.value = texture;
  }

  setReceiveShadows(receive: boolean): void {
    this.uniforms.uReceiveShadows.value = receive;
  }
}

const depthVertexShader = `
precision highp float;

#ifdef USE_ALPHA_CUT
varying vec2 vUv;
#endif

attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute float instanceBoneOffset;
attribute vec3 pivotOffset;

uniform sampler2D uBoneTexture;
uniform float uBoneTextureWidth;
uniform float uBoneTextureHeight;

mat4 getBoneMatrix(float boneIdx) {
  float globalBoneIdx = instanceBoneOffset + boneIdx;
  float pixelIdx = globalBoneIdx * 4.0;

  float row = floor(pixelIdx / uBoneTextureWidth);
  float col = mod(pixelIdx, uBoneTextureWidth);

  vec2 uv0 = vec2((col + 0.5) / uBoneTextureWidth, (row + 0.5) / uBoneTextureHeight);
  vec2 uv1 = vec2((col + 1.5) / uBoneTextureWidth, (row + 0.5) / uBoneTextureHeight);
  vec2 uv2 = vec2((col + 2.5) / uBoneTextureWidth, (row + 0.5) / uBoneTextureHeight);
  vec2 uv3 = vec2((col + 3.5) / uBoneTextureWidth, (row + 0.5) / uBoneTextureHeight);

  vec4 col0 = texture2D(uBoneTexture, uv0);
  vec4 col1 = texture2D(uBoneTexture, uv1);
  vec4 col2 = texture2D(uBoneTexture, uv2);
  vec4 col3 = texture2D(uBoneTexture, uv3);

  return mat4(col0, col1, col2, col3);
}

void main() {
  mat4 boneMatX = getBoneMatrix(skinIndex.x);
  mat4 boneMatY = getBoneMatrix(skinIndex.y);
  mat4 boneMatZ = getBoneMatrix(skinIndex.z);
  mat4 boneMatW = getBoneMatrix(skinIndex.w);

  mat4 skinMatrix = boneMatX * skinWeight.x
                  + boneMatY * skinWeight.y
                  + boneMatZ * skinWeight.z
                  + boneMatW * skinWeight.w;

  vec3 localPos = position - pivotOffset;
  vec4 skinnedPosition = skinMatrix * vec4(localPos, 1.0);
  skinnedPosition.xyz += pivotOffset;

  vec4 worldPosition = instanceMatrix * skinnedPosition;

  #ifdef USE_ALPHA_CUT
  vUv = uv;
  #endif

  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const depthFragmentShader = `
precision highp float;

#include <packing>

#ifdef USE_ALPHA_CUT
uniform sampler2D uAlphaMap;
varying vec2 vUv;
#endif

void main() {
  #ifdef USE_ALPHA_CUT
  if (texture2D(uAlphaMap, vUv).a < 0.5) discard;
  #endif
  gl_FragColor = packDepthToRGBA(gl_FragCoord.z);
}
`;

export class InstancedSkinnedDepthMaterial extends THREE.ShaderMaterial {
  /// `alphaCutMap`: an atlas the mesh's UVs address directly (packed-UV
  /// surfaces only), whose empty texels cast no shadow, so a cut-out fin
  /// shadows as its outline rather than its bounding quad.
  constructor(
    boneTexture: THREE.DataTexture,
    boneTextureWidth: number,
    boneTextureHeight: number,
    alphaCutMap?: THREE.Texture,
  ) {
    super({
      vertexShader: depthVertexShader,
      fragmentShader: depthFragmentShader,
      uniforms: {
        uBoneTexture: { value: boneTexture },
        uBoneTextureWidth: { value: boneTextureWidth },
        uBoneTextureHeight: { value: boneTextureHeight },
        ...(alphaCutMap ? { uAlphaMap: { value: alphaCutMap } } : {}),
      },
      defines: alphaCutMap ? { USE_ALPHA_CUT: "" } : {},
      side: THREE.DoubleSide,
    });
  }

  updateBoneTexture(texture: THREE.DataTexture): void {
    this.uniforms.uBoneTexture.value = texture;
  }
}
