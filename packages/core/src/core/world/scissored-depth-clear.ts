import { positionGeometry, uniform, vec4 } from "three/tsl";
import {
  AlwaysDepth,
  NodeMaterial,
  QuadMesh,
  type Renderer,
  type RenderTarget,
} from "three/webgpu";

/**
 * Clears the depth of the bound render target inside its viewport only.
 *
 * A WebGPU clear is a render pass's load op: `renderer.clear()` and
 * `autoClear` both wipe the whole attachment, whatever the scissor (WebGL's
 * `gl.clear` stopped at the scissor box). A target that keeps several
 * cells, each redrawn on its own (a shadow atlas), clears a cell by drawing
 * over it instead: a full-screen quad, which the target's viewport and
 * scissor confine to the cell, writing the clear depth everywhere it lands
 * and no colour.
 */
export class ScissoredDepthClear {
  private readonly depth = uniform(1);
  private readonly material = new NodeMaterial();
  private readonly quad: QuadMesh;
  private readonly prepared = new WeakMap<Renderer, Promise<void>>();

  constructor() {
    const material = this.material;
    material.name = "voxelize-scissored-depth-clear";
    material.colorWrite = false;
    material.depthTest = true;
    material.depthFunc = AlwaysDepth;
    material.depthWrite = true;
    material.depthNode = this.depth;
    // The quad's full-screen triangle in clip space, set here for good:
    // `QuadMesh.render` swaps a vertex node in for the draw alone, which
    // keys a graph no build ahead of time (`prepare`) can match.
    material.vertexNode = vec4(positionGeometry.xy, 0, 1);
    this.quad = new QuadMesh(material);
  }

  /**
   * Builds the quad's pipeline for targets in `target`'s formats ahead of
   * its first clear, which would otherwise build it in the frame (and the
   * frames a pipeline takes draw no clear). Once per renderer.
   */
  prepare(renderer: Renderer, target: RenderTarget): Promise<void> {
    const pending = this.prepared.get(renderer);
    if (pending) return pending;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    let compiled: Promise<void>;
    try {
      // compileAsync reads the bound target synchronously.
      compiled = renderer
        .compileAsync(this.quad, this.quad.camera)
        .catch(() => {
          this.prepared.delete(renderer);
        });
    } finally {
      renderer.setRenderTarget(previous);
    }
    this.prepared.set(renderer, compiled);
    return compiled;
  }

  /** Clears the depth under the bound target's viewport to the clear depth. */
  clear(renderer: Renderer): void {
    this.depth.value = renderer.getClearDepth();
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    try {
      renderer.render(this.quad, this.quad.camera);
    } finally {
      renderer.autoClear = autoClear;
    }
  }

  dispose(): void {
    this.material.dispose();
  }
}
