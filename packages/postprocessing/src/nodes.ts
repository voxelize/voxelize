import {
  DepthTexture,
  FloatType,
  type Node,
  type Texture,
  type TextureNode,
  type UniformNode,
  Vector2,
} from "three/webgpu";
import { dot, texture, uniform, vec3 } from "three/tsl";

/** Typed TSL node aliases. */
export type FloatNode = Node<"float">;
export type Vec2Node = Node<"vec2">;
export type Vec3Node = Node<"vec3">;
export type Vec4Node = Node<"vec4">;

/** A live value a pass writes and a shader reads. */
export type Uniform<T> = UniformNode<
  T extends number ? "float" : T extends Vector2 ? "vec2" : "vec4",
  T
>;

export const floatUniform = (value: number) =>
  uniform(value) as unknown as UniformNode<"float", number>;

export const vec2Uniform = (value = new Vector2()) =>
  uniform(value) as unknown as UniformNode<"vec2", Vector2>;

/**
 * A texture input whose texture changes from frame to frame (a ping-pong
 * buffer, a resized target). Never merged with another input's binding.
 */
export function textureInput(initial?: Texture | null): TextureNode {
  const node = texture(initial ?? undefined) as unknown as TextureNode;
  node.mergeable = false;
  return node;
}

let placeholderDepth: DepthTexture | null = null;

/**
 * A depth texture input (a float depth texture, sampled as depth): its
 * placeholder is a depth texture too, so the binding is built as one.
 */
export function depthInput(initial?: DepthTexture | null): TextureNode {
  placeholderDepth ??= Object.assign(new DepthTexture(1, 1), { type: FloatType });
  return textureInput(initial ?? placeholderDepth);
}

/** three's `luminance`: Rec. 709 weights on linear colour. */
export const luminance = (rgb: Vec3Node): FloatNode =>
  dot(rgb, vec3(0.2126729, 0.7151522, 0.072175));

/** Linear colour to sRGB-encoded (the output's transfer). */
export { linearToSrgb } from "./encoding";
