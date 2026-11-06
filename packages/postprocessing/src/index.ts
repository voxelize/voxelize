/**
 * Screen-space effects for three.js's WebGPURenderer, written in TSL.
 *
 * An {@link EffectComposer} runs a frame as passes: a {@link ScenePass}
 * draws the scene into a target with depth, then each enabled pass reads
 * what the one before drew, and the last one draws to the screen, encoding
 * sRGB itself. An {@link EffectPass} merges several {@link Effect}s into
 * one draw. The effects port pmndrs postprocessing's (bloom by mipmap blur,
 * FXAA, vignette, brightness and contrast), so a chain built with them
 * looks as it did there.
 */
export * from "./composer";
export * from "./effect";
export * from "./effect-pass";
export * from "./effects/bloom";
export * from "./effects/fxaa";
export * from "./effects/grade";
export * from "./effects/overlay";
export * from "./encoding";
export {
  depthInput,
  floatUniform,
  luminance,
  textureInput,
  vec2Uniform,
  type FloatNode,
  type Vec2Node,
  type Vec3Node,
  type Vec4Node,
} from "./nodes";
export * from "./pass";
