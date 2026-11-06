import * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import {
  abs,
  attribute,
  diffuseColor,
  dot,
  float,
  floor,
  If,
  int,
  ivec2,
  mat3,
  mat4,
  max,
  min,
  mix,
  mod,
  modelWorldMatrix,
  normalGeometry,
  normalize,
  normalLocal,
  positionGeometry,
  positionLocal,
  referenceAttribute,
  select,
  transformNormal,
  uv,
  varyingProperty,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

import {
  createEntityShadowUniforms,
  type EntityShadowUniforms,
  sharedEntityShadowUniforms,
} from "../../core/world/entity-shadow-uniforms";
import {
  type LightConeUniforms,
  LightCones,
  markLightConesCovered,
} from "../../core/world/light-cones";
import {
  entityShadow,
  shadowBoundsToWorld,
} from "../../core/world/shading/entity-shadow";
import { lightConeShading } from "../../core/world/shading/light-cones";
import { skyFog, type SkyFogInputs } from "../../core/world/shading/sky-fog";
import {
  type FloatNode,
  type Mat4Node,
  materialValue,
  type Vec2Node,
  type Vec3Node,
  type Vec4Node,
} from "../../core/world/shading/types";
import {
  materialTexture,
  ownUniform,
  perDrawInputs,
} from "../../core/world/shading/uniforms";

export type EntityFaceShades = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];

/// One brightness per axis direction, in the shader's face order
/// (`faceIndexOf`): +x, -x, +y, -y, +z, -z. The shading blends them over
/// world axes by squared normal components, so an animating or yawing body
/// shifts shade smoothly instead of popping at 45 degrees.
///
/// Top-anchored at 1.0, so a top face in full sun keeps its painted
/// brightness and a pale coat cannot clip past white. Flanks and bellies
/// drop toward the chunk shading's face grammar without going that far:
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
   * Face indices follow `faceIndexOf`: 0=+x, 1=-x, 2=+y, 3=-y, 4=+z, 5=-z.
   */
  emissiveFace?: {
    partIndex: number;
    faceIndex: number;
    color: THREE.Color;
  };
  /**
   * Whether the material reads the live world's atmosphere (fog, sky fog,
   * underwater submersion, light cones). In-world entities want true;
   * offscreen studio renders (portraits, thumbnails) want false, or a bake
   * taken while the camera is underwater ships tinted forever. The local
   * fallback values are neutral at portrait range.
   *
   * It also decides the shadow inputs: bound materials share the one
   * {@link sharedEntityShadowUniforms} block the world lighting is copied
   * into once a frame; studio materials share one never-updated block of
   * their own, so a portrait renderer never binds the world's shadow maps.
   */
  isEnvironmentBound?: boolean;
  /**
   * Slack in blocks around the drawn geometry's bounding sphere, which
   * bounds each instance's own body for its shadows: room for limbs that
   * swing past their rest pose and for the body's own shadow imprint, which
   * is redrawn only every few frames as it moves. Defaults to
   * {@link ENTITY_SHADOW_SELF_BOUNDS_MARGIN}.
   */
  shadowSelfBoundsMargin?: number;
  /** Per-axis face brightness; {@link DEFAULT_ENTITY_FACE_SHADES} if unset. */
  faceShades?: EntityFaceShades;
}

/** {@link InstancedSkinnedMaterialOptions.shadowSelfBoundsMargin}'s default. */
export const ENTITY_SHADOW_SELF_BOUNDS_MARGIN = 0.15;


/**
 * The live world's atmosphere for entity materials: its sky fog, the
 * camera's water, and the light cones. The same nodes the chunks read.
 */
export type EntityFogUniforms = SkyFogInputs & {
  lightCones: LightConeUniforms;
};

let sharedEntityFogUniforms: EntityFogUniforms | null = null;

/** The world whose atmosphere entity materials made from now on read. */
export function setSharedEntityFogUniforms(fog: EntityFogUniforms): void {
  sharedEntityFogUniforms = fog;
}

/** The live world's atmosphere, or null before any world set it. */
export function sharedEntityFog(): EntityFogUniforms | null {
  return sharedEntityFogUniforms;
}

let standInLightCones: LightCones | null = null;

/**
 * The page's light cones (the shared entity block's), for a material
 * outside the instanced pools that shades with them. Before any world has
 * set them, a cone-less stand-in, so a warmup builds the same program.
 */
export function sharedLightCones(): LightConeUniforms {
  const cones = sharedEntityFogUniforms?.lightCones;
  if (cones) return cones;
  standInLightCones ??= new LightCones();
  return standInLightCones.uniforms;
}

let studioFog: EntityFogUniforms | null = null;
let studioShadowUniforms: EntityShadowUniforms | null = null;

/**
 * Atmosphere values for materials not bound to the world: clear air at
 * portrait range, dry, no cones. One block for them all, never written, so
 * every studio variant shares one graph.
 */
function studioAtmosphere(): EntityFogUniforms {
  studioFog ??= {
    fogColor: ownUniform(new THREE.Color("#B1CCFD")),
    fogNear: ownUniform(100),
    fogFar: ownUniform(200),
    fogHeightOrigin: ownUniform(80),
    fogHeightDensity: ownUniform(0.005),
    fogVerticalBlend: ownUniform(0),
    skyFogTopColor: ownUniform(new THREE.Color(0.4, 0.6, 0.9)),
    skyFogMiddleColor: ownUniform(new THREE.Color(0.7, 0.8, 0.95)),
    skyFogBottomColor: ownUniform(new THREE.Color(0.15, 0.18, 0.25)),
    skyFogOffset: ownUniform(0),
    skyFogVoidOffset: ownUniform(1200),
    skyFogExponent: ownUniform(0.6),
    skyFogExponent2: ownUniform(1.2),
    skyFogDimension: ownUniform(2000),
    skyFogStrength: ownUniform(1.0),
    skyGlowSunDirection: ownUniform(new THREE.Vector3(0, 1, 0)),
    skyGlowColor: ownUniform(new THREE.Color(0, 0, 0)),
    skySunHaloColor: ownUniform(new THREE.Color(0, 0, 0)),
    skyMoonHaloColor: ownUniform(new THREE.Color(0, 0, 0)),
    skySunDiscColor: ownUniform(new THREE.Color(0, 0, 0)),
    skyMoonDiscColor: ownUniform(new THREE.Color(0, 0, 0)),
    skyDiscRadii: ownUniform(new THREE.Vector2(0.07, 0.07)),
    cameraSubmersion: ownUniform(0),
    cameraWaterPlaneY: ownUniform(0),
    underwaterAmbient: ownUniform(new THREE.Color(0, 0, 0)),
    underwaterViewScale: ownUniform(1),
    directSunlight: ownUniform(1),
    lightCones: new LightCones().uniforms,
  } as unknown as EntityFogUniforms;
  return studioFog;
}

/** The shadow inputs of materials not bound to the world: never written. */
function studioShadows(): EntityShadowUniforms {
  studioShadowUniforms ??= createEntityShadowUniforms();
  return studioShadowUniforms;
}

/**
 * A stable name for each uniform block a family's graph reads, for its key:
 * a graph built on one world's atmosphere must not serve another's.
 */
const blockIds = new WeakMap<object, number>();
let blockCount = 0;
function blockId(block: object): number {
  let id = blockIds.get(block);
  if (id === undefined) {
    id = ++blockCount;
    blockIds.set(block, id);
  }
  return id;
}


/**
 * A skinned instance's bone matrix `boneIndex`: four texels of the bone
 * texture, read at integer coordinates (exact, no filtering).
 */
function boneMatrix(
  bones: THREE.TextureNode,
  width: FloatNode,
  offset: FloatNode,
  boneIndex: FloatNode,
): Mat4Node {
  const pixel = offset.add(boneIndex).mul(4);
  const row = int(floor(pixel.div(width)));
  const col = int(mod(pixel, width));
  const column = (i: number) =>
    bones.load(ivec2(col.add(i), row)) as unknown as Vec4Node;
  return mat4(column(0), column(1), column(2), column(3));
}

/** The geometry's skin, applied to the rest position and normal. */
function skin(
  bones: THREE.TextureNode,
  width: FloatNode,
  boneOffset: FloatNode,
) {
  const index = attribute("skinIndex", "vec4") as unknown as Vec4Node;
  const weight = attribute("skinWeight", "vec4") as unknown as Vec4Node;
  const matrix = boneMatrix(bones, width, boneOffset, index.x)
    .mul(weight.x)
    .add(boneMatrix(bones, width, boneOffset, index.y).mul(weight.y))
    .add(boneMatrix(bones, width, boneOffset, index.z).mul(weight.z))
    .add(boneMatrix(bones, width, boneOffset, index.w).mul(weight.w));
  const pivot = attribute("pivotOffset", "vec3") as unknown as Vec3Node;
  const position = matrix
    .mul(vec4(positionGeometry.sub(pivot), 1))
    .xyz.add(pivot);
  const normal = normalize(mat3(matrix).mul(normalGeometry));
  return { position, normal };
}

/**
 * The instance's own matrix, bound per object. three's `instancedMesh`
 * falls back to a per-object program when a geometry has more than a few
 * attributes (it counts attributes, not the buffers they share), and the
 * packed pools have twelve in three buffers; binding it here keeps every
 * pool on one program.
 */
const instanceMatrixOf = () =>
  referenceAttribute("instanceMatrix", "mat4") as unknown as Mat4Node;

/** Moves the skinned body into its instance's place. */
function placeInstance(withNormal: boolean): Mat4Node {
  const matrix = instanceMatrixOf();
  positionLocal.assign(matrix.mul(vec4(positionLocal, 1)).xyz);
  if (withNormal) normalLocal.assign(transformNormal(normalLocal, matrix));
  return matrix;
}

/** A body's face from its rest normal: 0=+x, 1=-x, 2=+y, 3=-y, 4=+z, 5=-z. */
function faceIndexOf(normal: Vec3Node): FloatNode {
  const a = abs(normal);
  const peak = max(a.x, max(a.y, a.z)).sub(0.01);
  return select(
    a.x.greaterThanEqual(peak),
    select(normal.x.greaterThan(0), float(0), float(1)),
    select(
      a.y.greaterThanEqual(peak),
      select(normal.y.greaterThan(0), float(2), float(3)),
      select(normal.z.greaterThan(0), float(4), float(5)),
    ),
  );
}

/** The drawn material's skin: its bone texture and its texture's width. */
function skinOf(material: { boneTexture: THREE.DataTexture; boneTextureWidth: number }) {
  return skin(
    materialTexture("float", material, "boneTexture"),
    materialValue("boneTextureWidth", "float"),
    attribute("instanceBoneOffset", "float") as unknown as FloatNode,
  );
}

let white: THREE.DataTexture | null = null;

/** The face atlas of a material made without one. */
function whiteTexture(): THREE.DataTexture {
  if (!white) {
    white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    white.needsUpdate = true;
  }
  return white;
}

const vUv = varyingProperty("vec2", "vEntityUv");
const vRestNormal = varyingProperty("vec3", "vEntityRestNormal");
const vWorldPosition = varyingProperty("vec3", "vEntityWorldPosition");
const vWorldNormal = varyingProperty("vec3", "vEntityWorldNormal");
/** (hit effect, emissive, part index, unused) */
const vInstance = varyingProperty("vec4", "vEntityInstance");
const vLightColor = varyingProperty("vec3", "vEntityLightColor");
const vVertexColor = varyingProperty("vec3", "vEntityVertexColor");
const vSelfBounds = varyingProperty("vec4", "vEntitySelfBounds");

/** Parts sit a hair apart; a few depth steps per part give each pair a winner. */
const PART_DEPTH_BIAS = 3e-7;

/**
 * Every instanced, skinned entity (creatures, boats, drops): bones from a
 * shared texture, each instance's light, hit flash and emissive face from
 * its own attributes, the body's face atlas, and the world's sun shadow,
 * cones and fog. Its program is one per option set; what varies per
 * material is uniform.
 */
export class InstancedSkinnedMaterial extends THREE.NodeMaterial {
  static override get type() {
    return "InstancedSkinnedMaterial";
  }

  public shadowUniforms: EntityShadowUniforms;

  // Per-material inputs, plain values read before each draw: every variant
  // (one material per creature kind and coat) shares one graph.
  boneTexture: THREE.DataTexture;
  boneTextureWidth: number;
  boneTextureHeight: number;
  bonesPerInstance: number;
  /** The drawn geometry's bounding sphere, which bounds each body. */
  readonly shadowSelfSphere = new THREE.Vector4(0, 0, 0, 0);
  shadowSelfBoundsMargin: number;
  colorMap: THREE.Texture;
  readonly tint: THREE.Color;
  opacityValue: number;
  readonly hitColor = new THREE.Color(1, 0, 0);
  maxBrightness = 1.0;
  receiveShadowsValue: number;
  // The atlas grid, the face shades and the emissive face: numbers, so
  // bodies that differ only in them share a graph.
  readonly atlasGrid = new THREE.Vector2(6, 5);
  /** +x, +y, +z and -x, -y, -z face brightness (`faceShades`). */
  readonly faceShadesPositive = new THREE.Vector3();
  readonly faceShadesNegative = new THREE.Vector3();
  /** (part, face) of the emissive face (`emissiveFace`). */
  readonly emissiveFace = new THREE.Vector2(-1, -1);
  readonly emissiveColor = new THREE.Color();
  readonly perDrawNode = perDrawInputs;

  private shadowSelfGeometry: THREE.BufferGeometry | null = null;
  /** Set while building: setupModelViewProjection runs after setupPosition. */
  private hasPartIndex = false;
  private readonly options: InstancedSkinnedMaterialOptions;
  private readonly atmosphere: EntityFogUniforms;

  constructor(
    boneTexture: THREE.DataTexture,
    boneTextureWidth: number,
    boneTextureHeight: number,
    bonesPerInstance: number,
    options: InstancedSkinnedMaterialOptions = {},
  ) {
    super();
    this.options = options;
    const isEnvironmentBound = options.isEnvironmentBound ?? true;
    this.shadowUniforms = isEnvironmentBound
      ? sharedEntityShadowUniforms
      : studioShadows();
    this.atmosphere =
      (isEnvironmentBound ? sharedEntityFogUniforms : null) ??
      studioAtmosphere();

    this.boneTexture = boneTexture;
    this.boneTextureWidth = boneTextureWidth;
    this.boneTextureHeight = boneTextureHeight;
    this.bonesPerInstance = bonesPerInstance;
    this.shadowSelfBoundsMargin =
      options.shadowSelfBoundsMargin ?? ENTITY_SHADOW_SELF_BOUNDS_MARGIN;
    this.colorMap = options.map ?? whiteTexture();
    this.tint = options.color ?? new THREE.Color(1, 1, 1);
    this.opacityValue = options.opacity ?? 1.0;
    this.receiveShadowsValue = options.receiveShadows ? 1 : 0;
    this.atlasGrid.set(options.atlasGridCols ?? 6, options.atlasGridRows ?? 5);
    const shades = options.faceShades ?? DEFAULT_ENTITY_FACE_SHADES;
    this.faceShadesPositive.set(shades[0], shades[2], shades[4]);
    this.faceShadesNegative.set(shades[1], shades[3], shades[5]);
    if (options.emissiveFace) {
      this.emissiveFace.set(
        options.emissiveFace.partIndex,
        options.emissiveFace.faceIndex,
      );
      this.emissiveColor.copy(options.emissiveFace.color);
    }

    // Its lighting takes the light cones per pixel.
    markLightConesCovered(this);
    this.transparent = options.transparent ?? false;
    this.side = options.side ?? THREE.FrontSide;
    this.depthWrite = options.depthWrite ?? true;
    this.fog = false;
    this.lights = false;
  }

  override customProgramCacheKey(): string {
    const o = this.options;
    return [
      "instanced-skinned",
      o.useFaceUV ? 1 : 0,
      o.useVertexColor ? 1 : 0,
      o.emissiveFace ? 1 : 0,
      blockId(this.shadowUniforms),
      blockId(this.atmosphere),
      super.customProgramCacheKey(),
    ].join("|");
  }

  override setupPosition(builder: THREE.NodeBuilder) {
    const object = builder.object as THREE.InstancedMesh;
    const has = (name: string) => builder.geometry.hasAttribute(name);
    this.hasPartIndex = has("partIndex");
    const skinned = skinOf(this);
    positionLocal.assign(skinned.position);
    normalLocal.assign(skinned.normal);
    const instance = object.isInstancedMesh ? placeInstance(true) : null;

    vUv.assign(uv());
    vRestNormal.assign(normalGeometry);
    vWorldPosition.assign(modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz);
    vWorldNormal.assign(normalize(mat3(modelWorldMatrix).mul(normalLocal)));
    vInstance.assign(
      vec4(
        attribute("instanceHitEffect", "float"),
        has("instanceEmissive") ? attribute("instanceEmissive", "float") : float(0),
        has("partIndex") ? attribute("partIndex", "float") : float(0),
        0,
      ),
    );
    vLightColor.assign(attribute("instanceLightColor", "vec3"));
    vVertexColor.assign(has("vertexColor") ? attribute("vertexColor", "vec3") : vec3(1));

    // Each instance is bounded by its own body (the geometry's sphere in
    // the instance's space, plus slack); radius 0 means no bounds yet.
    vSelfBounds.assign(
      instance
        ? shadowBoundsToWorld(
            modelWorldMatrix.mul(instance),
            materialValue("shadowSelfSphere", "vec4"),
            materialValue("shadowSelfBoundsMargin", "float"),
          )
        : vec4(0),
    );
    return positionLocal;
  }

  /**
   * Parts of one body sit a hair apart or swing through each other, and two
   * nearly coplanar faces flicker as depth precision and pose change: a few
   * depth steps per part give every such pair a fixed winner.
   */
  override setupModelViewProjection() {
    const clip = super.setupModelViewProjection() as unknown as Vec4Node;
    const part = this.hasPartIndex
      ? (attribute("partIndex", "float") as unknown as FloatNode)
      : float(0);
    return vec4(
      clip.xy,
      clip.z.sub(part.mul(PART_DEPTH_BIAS).mul(clip.w)),
      clip.w,
    ) as unknown as ReturnType<THREE.NodeMaterial["setupModelViewProjection"]>;
  }

  override setupDiffuseColor() {
    const o = this.options;
    let uvNode: Vec2Node = vUv as unknown as Vec2Node;
    if (o.useFaceUV) {
      const grid = materialValue("atlasGrid", "vec2");
      const cell = vInstance.z.mul(6).add(faceIndexOf(vRestNormal as unknown as Vec3Node));
      const col = mod(cell, grid.x);
      const row = floor(cell.div(grid.x));
      const flipped = vec2(uvNode.x, uvNode.y.oneMinus());
      const padded = mix(vec2(0.03), vec2(0.97), flipped);
      uvNode = padded.div(grid).add(vec2(col, row).div(grid));
    }
    const texel = materialTexture("color", this, "colorMap").sample(uvNode);
    let albedo: Vec3Node = texel.rgb.mul(materialValue("tint", "color"));
    if (o.useVertexColor) albedo = albedo.mul(vVertexColor);
    const alpha = texel.a.mul(materialValue("opacityValue", "float"));
    alpha.lessThan(0.01).discard();
    diffuseColor.assign(vec4(albedo, alpha));
  }

  override setupLighting() {
    const o = this.options;
    const albedo = diffuseColor.rgb as unknown as Vec3Node;
    const normal = vWorldNormal as unknown as Vec3Node;
    const position = vWorldPosition as unknown as Vec3Node;

    const positives = max(normal, 0);
    const negatives = max(normal.negate(), 0);
    const p2 = positives.mul(positives);
    const n2 = negatives.mul(negatives);
    const coverage = dot(p2.add(n2), vec3(1));
    const faceShade = dot(p2, materialValue("faceShadesPositive", "vec3"))
      .add(dot(n2, materialValue("faceShadesNegative", "vec3")))
      .div(max(coverage, 0.0001));

    const color = albedo
      .mul(min(vLightColor, vec3(materialValue("maxBrightness", "float"))))
      .mul(faceShade)
      .toVar("entityColor");
    If(materialValue("receiveShadowsValue", "float").greaterThan(0.5), () => {
      // A face turned from the sun is not shaded by the body it belongs to,
      // while a deck or a canopy past the body's bounds still shades it.
      color.mulAssign(
        entityShadow(this.shadowUniforms).within(
          normalize(normal),
          position,
          vSelfBounds as unknown as Vec4Node,
        ),
      );
    });
    color.addAssign(albedo.mul(lightConeShading(this.atmosphere.lightCones).surface(position, normal)));

    if (o.emissiveFace) {
      // An emissive face (a lit headlight lens): full albedo boosted past
      // the scene lighting, immune to darkness and shadows.
      const face = materialValue("emissiveFace", "vec2");
      If(
        abs(vInstance.z.sub(face.x))
          .lessThan(0.5)
          .and(vInstance.y.greaterThan(0.5))
          .and(abs(faceIndexOf(vRestNormal as unknown as Vec3Node).sub(face.y)).lessThan(0.5)),
        () => {
          color.assign(albedo.mul(materialValue("emissiveColor", "color")));
        },
      );
    }
    return mix(color, materialValue("hitColor", "color"), vInstance.x);
  }

  override setupOutput(builder: THREE.NodeBuilder, outputNode: Vec4Node) {
    const position = vWorldPosition as unknown as Vec3Node;
    const fogged = skyFog(this.atmosphere).apply(outputNode.rgb, position, float(1));
    const lit = lightConeShading(this.atmosphere.lightCones).applyScatter(fogged, position);
    return super.setupOutput(builder, vec4(lit, outputNode.a));
  }

  /**
   * Bounds every instance by the geometry about to be drawn: its bounding
   * sphere, in the space the instance matrix carries into the world. three
   * keeps the sphere on the geometry, so this measures once per geometry.
   */
  override onBeforeRender(
    _renderer: unknown,
    _scene: THREE.Scene,
    _camera: THREE.Camera,
    geometry: THREE.BufferGeometry,
  ): void {
    if (geometry === this.shadowSelfGeometry) return;
    this.shadowSelfGeometry = geometry;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere;
    const target = this.shadowSelfSphere;
    if (sphere && Number.isFinite(sphere.radius) && sphere.radius > 0) {
      target.set(sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius);
    } else {
      target.set(0, 0, 0, 0);
    }
  }

  setMaxBrightness(maxBrightness: number): void {
    this.maxBrightness = maxBrightness;
  }

  updateBoneTexture(texture: THREE.DataTexture): void {
    this.boneTexture = texture;
  }

  setReceiveShadows(receive: boolean): void {
    this.receiveShadowsValue = receive ? 1 : 0;
  }

  /** The face atlas (`options.map`), swapped in place. */
  setColorMap(map: THREE.Texture): void {
    this.colorMap = map;
  }
}

/**
 * The depth an instanced, skinned body casts into the sun's cascades: the
 * same skinning, depth alone. With `alphaCutMap` (an atlas the mesh's uvs
 * address directly), empty texels cast nothing, so a cut-out fin shadows
 * as its outline rather than its bounding quad.
 */
export class InstancedSkinnedDepthMaterial extends THREE.NodeMaterial {
  static override get type() {
    return "InstancedSkinnedDepthMaterial";
  }

  boneTexture: THREE.DataTexture;
  boneTextureWidth: number;
  readonly alphaCutMap: THREE.Texture | null;
  readonly perDrawNode = perDrawInputs;

  constructor(
    boneTexture: THREE.DataTexture,
    boneTextureWidth: number,
    _boneTextureHeight: number,
    alphaCutMap?: THREE.Texture,
  ) {
    super();
    this.boneTexture = boneTexture;
    this.boneTextureWidth = boneTextureWidth;
    this.alphaCutMap = alphaCutMap ?? null;
    this.side = THREE.DoubleSide;
    this.colorWrite = false;
    this.fog = false;
    this.lights = false;
    if (this.alphaCutMap) {
      // The cut texels leave no depth behind.
      this.colorNode = alphaCutColor();
      this.alphaTest = 0.5;
    } else {
      this.fragmentNode = depthOnlyColor;
    }
  }

  override customProgramCacheKey(): string {
    return `instanced-skinned-depth|${this.alphaCutMap ? 1 : 0}|${super.customProgramCacheKey()}`;
  }

  override setupPosition(builder: THREE.NodeBuilder) {
    const object = builder.object as THREE.InstancedMesh;
    positionLocal.assign(skinOf(this).position);
    if (object.isInstancedMesh) placeInstance(false);
    return positionLocal;
  }

  updateBoneTexture(texture: THREE.DataTexture): void {
    this.boneTexture = texture;
  }
}

/** A depth-only body's colour: nothing, it writes depth alone. */
const depthOnlyColor = /*@__PURE__*/ vec4(0);

let alphaCut: Vec4Node | null = null;

/** The cut-out body's colour: the drawn material's atlas alpha at its uvs. */
function alphaCutColor(): Vec4Node {
  alphaCut ??= vec4(
    1,
    1,
    1,
    materialValue("alphaCutMap", "texture").a,
  );
  return alphaCut;
}
