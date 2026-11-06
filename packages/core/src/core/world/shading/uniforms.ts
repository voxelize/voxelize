import {
  type Color,
  DataTexture,
  NodeUpdateType,
  DepthTexture,
  FloatType,
  type Matrix3,
  type Matrix4,
  NearestFilter,
  RedIntegerFormat,
  RGBAFormat,
  type Texture,
  type UniformNode,
  UnsignedByteType,
  UnsignedIntType,
  type Vector2,
  type Vector3,
  type Vector4,
} from "three/webgpu";
import {
  float,
  OnObjectUpdate,
  renderGroup,
  sharedUniformGroup,
  texture as textureNode,
  uniform,
  uniformArray as objectUniformArray,
} from "three/tsl";

import { markMaterialPropertyRead } from "./draw-refresh";

/**
 * The world's shading inputs that every chunk material (and the far layer,
 * entities, effects) reads alike: fog, sky, sun, shadows, water, wind,
 * clock. One shared group, so they live in one uniform buffer per render
 * context, written once a render instead of once a draw. A shared group's
 * buffer is uploaded only when its version moves, so it updates per render
 * (as three's own `renderGroup`): without one it would hold its first
 * values for good.
 */
export const worldShadingGroup = /*@__PURE__*/ sharedUniformGroup(
  "voxelizeWorld",
  0,
  NodeUpdateType.RENDER,
);

/**
 * The TSL type a uniform of value `T` takes in shading code. A `Color`
 * uniform is built as `color` and generates as a vec3; typing it as one
 * lets colours mix with the vectors they are lit by.
 */
export type UniformTypeOf<T> = T extends Color
  ? "vec3"
  : T extends Matrix4
    ? "mat4"
    : T extends Matrix3
      ? "mat3"
      : T extends Vector4
        ? "vec4"
        : T extends Vector3
          ? "vec3"
          : T extends Vector2
            ? "vec2"
            : T extends number
              ? "float"
              : never;

/** Number literals widen: a uniform made from `100` holds any number. */
type Widen<T> = T extends number ? number : T;

export type ValueUniform<T> = UniformNode<UniformTypeOf<T>, Widen<T>>;

/** A uniform owned by one material or object (per-draw group). */
export function ownUniform<T extends number | Vector2 | Vector3 | Vector4 | Color | Matrix3 | Matrix4>(
  value: T,
  type?: "int" | "uint",
): ValueUniform<T> {
  const make = uniform as unknown as (value: T, type?: string) => unknown;
  return make(value, type) as ValueUniform<T>;
}

/**
 * A uniform that holds for one render pass, in three's shared `render`
 * group (beside the camera's): one buffer for every draw, uploaded once a
 * render. A value changed mid-render must move the group on
 * (`renderGroup.needsUpdate = true`) to reach the draws after it.
 */
export function passUniform<T extends number | Vector2 | Vector3 | Vector4 | Color | Matrix3 | Matrix4>(
  value: T,
  type?: "int" | "uint",
): ValueUniform<T> {
  const node = ownUniform(value, type);
  node.setGroup(renderGroup);
  return node;
}

/**
 * A world-wide uniform. The node is the value's home: `node.value` is what
 * the CPU writes, exactly as the `{ value }` records it replaces.
 */
export function worldUniform<T extends number | Vector2 | Vector3 | Vector4 | Color | Matrix3 | Matrix4>(
  value: T,
  type?: "int" | "uint",
): ValueUniform<T> {
  const node = ownUniform(value, type);
  node.setGroup(worldShadingGroup);
  return node;
}

/**
 * A uniform array of world-wide data (light cones, the clustered lights'
 * air members, the biome and pigment tables, the sway table), in the
 * world's group: written once a render. In TSL's default group, the
 * object's, three writes the whole array again for every draw that reads
 * it, unchanged or not: ~600 writes a frame over a large world's chunk
 * draws.
 * Its values must hold still within a render, as every world uniform's do.
 */
export const uniformArray: typeof objectUniformArray = (values, nodeType) => {
  const node = objectUniformArray(values, nodeType);
  node.setGroup(worldShadingGroup);
  return node;
};

/** What kind of texture a slot will hold, which fixes its binding type. */
export type TextureSlotKind =
  | "color"
  | "depth"
  | "float"
  | "uint";

const placeholders = new Map<TextureSlotKind, Texture>();

/**
 * A 1x1 stand-in of the right kind for a slot whose texture comes later (a
 * shadow map before the first cascade, the light grid before the first
 * scan). A binding's type is fixed when its shader is built, so a depth
 * slot has to start with a depth texture, an integer slot with an integer
 * one.
 */
export function placeholderTexture(kind: TextureSlotKind): Texture {
  const cached = placeholders.get(kind);
  if (cached) return cached;
  let texture: Texture;
  switch (kind) {
    case "depth": {
      texture = new DepthTexture(1, 1);
      break;
    }
    case "float": {
      texture = new DataTexture(
        new Float32Array(4),
        1,
        1,
        RGBAFormat,
        FloatType,
      );
      break;
    }
    case "uint": {
      texture = new DataTexture(
        new Uint32Array(1),
        1,
        1,
        RedIntegerFormat,
        UnsignedIntType,
      );
      break;
    }
    default: {
      texture = new DataTexture(
        new Uint8Array([255, 255, 255, 255]),
        1,
        1,
        RGBAFormat,
        UnsignedByteType,
      );
    }
  }
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  texture.name = `voxelize-placeholder-${kind}`;
  placeholders.set(kind, texture);
  return texture;
}

/**
 * A texture input whose texture can be swapped at runtime (`node.value =
 * texture`), starting from `initial` or a placeholder of `kind`.
 */
export function textureSlot(kind: TextureSlotKind, initial?: Texture | null) {
  const node = textureNode(initial ?? placeholderTexture(kind));
  // A slot is its own binding: merged by texture (three's default), every
  // slot still holding the shared placeholder would bind as one, and the
  // shadow maps assigned later would all read the first.
  node.mergeable = false;
  // A slot's textures are data and atlases, never offset or repeated: with
  // three's default every sample of it would transform its uv by the
  // texture matrix, a mat3 uniform rewritten per draw (seven or more per
  // chunk draw). Samples keep this (three patch: `TextureNode.clone`).
  node.updateMatrix = false;
  return node;
}

/*
 * Material families with one graph.
 *
 * three keys a node material's graph by the identity of the nodes the
 * material holds (`NodeMaterial.customProgramCacheKey` hashes each node
 * property's id). A family whose every material makes its own uniform nodes
 * (one material per creature variant, say) therefore builds one graph per
 * material, each the same shader: hundreds of builds at load and one more
 * for every variant met in play. Instead, such a family keeps its inputs as
 * plain values on the material and reads them per draw, from nodes made
 * while the graph builds (`materialValue`, `materialTexture`); three's own
 * `map` and `color` work the same way.
 */

/**
 * A texture the drawn material holds in `property`, of `kind`: built from
 * the building material's texture and re-pointed before each draw at the
 * drawn one's. Call it while the graph builds (inside a setup method).
 */
export function materialTexture(
  kind: TextureSlotKind,
  material: object,
  property: string,
) {
  const read = (owner: object) =>
    ((owner as Record<string, unknown>)[property] as Texture | null) ??
    placeholderTexture(kind);
  const node = textureSlot(kind, read(material));
  const repoint = OnObjectUpdate(({ material: drawn }) => {
    if (drawn) node.value = read(drawn);
  });
  // It reads nothing but this property: a draw can skip it while the
  // property holds the texture it last bound (`narrowRefresh`).
  markMaterialPropertyRead(repoint, property);
  return node;
}

/**
 * The node a material whose inputs are plain values holds. three re-uploads
 * a node material's bindings each draw only while the material holds a node
 * of its own (`NodeMaterialObserver.containsNode`), and otherwise only when
 * one of three's own material properties changes; every material of a
 * family shares this one, so it keeps their one graph.
 */
export const perDrawInputs = /*@__PURE__*/ float(0);
