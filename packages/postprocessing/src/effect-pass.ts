import {
  type DepthTexture,
  NodeMaterial,
  QuadMesh,
  type Renderer,
  type RenderTarget,
  type TextureNode,
} from "three/webgpu";
import { clamp, Fn, screenUV, vec4 } from "three/tsl";

import { blend, type Effect } from "./effect";
import { linearToSrgb } from "./encoding";
import { depthInput, textureInput, vec2Uniform, type Vec4Node } from "./nodes";
import { Pass, type PassContext } from "./pass";

/**
 * Several effects merged into one full-screen draw: the input at each
 * pixel, through each effect in order (blended by its function and
 * opacity), then encoded to sRGB when the pass draws to the screen. Built
 * once: switch the pass, not its effects, to turn them on and off without a
 * new shader.
 */
export class EffectPass extends Pass {
  readonly effects: readonly Effect[];

  private readonly input = textureInput();
  private readonly depth = depthInput();
  private readonly texelSize = vec2Uniform();
  private readonly resolution = vec2Uniform();
  private readonly quad: QuadMesh;
  private readonly screenQuad: QuadMesh;

  constructor(...effects: Effect[]) {
    super(`EffectPass(${effects.map((effect) => effect.name).join(", ")})`);
    this.effects = effects;
    this.quad = new QuadMesh(this.material(false));
    this.screenQuad = new QuadMesh(this.material(true));
  }

  private material(toScreen: boolean): NodeMaterial {
    const material = new NodeMaterial();
    material.name = `${this.name}${toScreen ? " → screen" : ""}`;
    material.depthTest = false;
    material.depthWrite = false;
    material.fragmentNode = Fn(() => {
      const uv = screenUV;
      let color = (this.input.sample(uv) as unknown as Vec4Node).toVar(
        "effectColor",
      ) as unknown as Vec4Node;
      for (const [index, effect] of this.effects.entries()) {
        const y = effect.fragment({
          color,
          uv,
          input: this.input,
          depth: this.depth as TextureNode,
          texelSize: this.texelSize,
          resolution: this.resolution,
        });
        // A shader identifier: letters, digits and underscores only.
        const variable = `effect${index}_${effect.name.replace(/[^A-Za-z0-9_]/g, "_")}`;
        color = blend(effect.blendFunction, color, y, effect.opacity).toVar(
          variable,
        ) as unknown as Vec4Node;
      }
      const alpha = clamp(color.a, 0, 1);
      return toScreen ? vec4(linearToSrgb(color.rgb), alpha) : vec4(color.rgb, alpha);
    })();
    return material;
  }

  render(
    renderer: Renderer,
    input: RenderTarget,
    output: RenderTarget | null,
    context: PassContext,
  ) {
    for (const effect of this.effects) effect.update(renderer, input, context);
    this.input.value = input.texture;
    if (context.depth) this.depth.value = context.depth as DepthTexture;
    renderer.setRenderTarget(output);
    (output ? this.quad : this.screenQuad).render(renderer);
  }

  setSize(width: number, height: number) {
    this.texelSize.value.set(1 / width, 1 / height);
    this.resolution.value.set(width, height);
    for (const effect of this.effects) effect.setSize(width, height);
  }

  dispose() {
    for (const effect of this.effects) effect.dispose();
    (this.quad.material as NodeMaterial).dispose();
    (this.screenQuad.material as NodeMaterial).dispose();
  }
}
