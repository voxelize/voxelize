import { materialReference } from "three/tsl";
import type { Node } from "three/webgpu";

/** Typed TSL node aliases, so shading signatures read like the GLSL they replace. */
export type FloatNode = Node<"float">;
export type IntNode = Node<"int">;
export type UintNode = Node<"uint">;
export type BoolNode = Node<"bool">;
export type Vec2Node = Node<"vec2">;
export type UVec2Node = Node<"uvec2">;
export type IVec2Node = Node<"ivec2">;
export type UVec3Node = Node<"uvec3">;
export type IVec3Node = Node<"ivec3">;
export type UVec4Node = Node<"uvec4">;
export type Vec3Node = Node<"vec3">;
export type Vec4Node = Node<"vec4">;
export type ColorNode = Node<"color">;
export type Mat3Node = Node<"mat3">;
export type Mat4Node = Node<"mat4">;

/** A live value the CPU writes and shaders read: a TSL uniform or texture node. */
export type UniformRef<T> = { value: T };

/**
 * Component `index` (a runtime int) of a vector node, as WGSL `v[i]` /
 * GLSL `v[i]`: the typings only declare `element` on arrays.
 */
export const componentOf = (
  vector: Node<"vec2"> | Node<"vec3"> | Node<"vec4">,
  index: Node<"int"> | Node<"uint">,
): Node<"float"> =>
  (
    vector as unknown as { element(index: Node): Node<"float"> }
  ).element(index);

/** The node a {@link materialValue} of each type reads as. */
type MaterialValueNodes = {
  float: Node<"float">;
  vec2: Node<"vec2">;
  vec3: Node<"vec3">;
  /** A `Color`, read as a vec3. */
  color: Node<"vec3">;
  vec4: Node<"vec4">;
  mat4: Node<"mat4">;
  /** A texture, sampled at the geometry's uvs. */
  texture: Node<"vec4">;
};

/**
 * A value the drawn material holds in `property` (a dotted path reaches
 * into an object), read through `materialReference`: updated before each
 * draw from the material being drawn, so every material of a family reads
 * its own through one shared graph. Typed as the node it generates.
 */
export const materialValue = <T extends keyof MaterialValueNodes>(
  property: string,
  type: T,
): MaterialValueNodes[T] =>
  materialReference(property, type) as unknown as MaterialValueNodes[T];
