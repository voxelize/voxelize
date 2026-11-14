import {
  cameraFar,
  cameraNear,
  clamp,
  Discard,
  float,
  Fn,
  If,
  ivec2,
  max,
  mrt,
  output,
  positionView,
  pow,
  renderGroup,
  screenCoordinate,
  screenUV,
  vec4,
} from "three/tsl";
import {
  AddEquation,
  AdditiveBlending,
  BlendMode,
  BoxGeometry,
  type Camera,
  Color,
  CustomBlending,
  HalfFloatType,
  type Material,
  Mesh,
  MeshBasicNodeMaterial,
  NearestFilter,
  NodeMaterial,
  NormalBlending,
  type Object3D,
  OneFactor,
  OneMinusSrcAlphaFactor,
  type PerspectiveCamera,
  QuadMesh,
  type Renderer,
  RenderTarget,
  RGBAFormat,
  RGFormat,
  Scene,
  SrcAlphaFactor,
  type Texture,
  Vector2,
  Vector4,
} from "three/webgpu";

import { type PassClears, renderClearing } from "./clearing-render";
import { exemptFromLightCones } from "./light-cones";
import { perspectiveDepthToViewZ } from "./shading/conventions";
import type { Vec4Node } from "./shading/types";
import { passUniform, textureSlot } from "./shading/uniforms";

/**
 * The depth weight of a blended fragment, by its distance from the camera
 * in blocks: `scale / (1 + d / nearDistance + (d / farDistance)⁶)`,
 * clamped to `[min, max]`. Layers within `nearDistance` weigh about the
 * same, and past it a layer twice as far weighs about half, so the alpha
 * in the weight (more opaque layers count more) decides most of a mix, as
 * compositing back to front would: a clear pane at the camera does not wash
 * out the coloured glass behind it. Past `farDistance` the weight falls off
 * fast; the clamp keeps the half-float sums in range.
 */
export type OrderIndependentWeights = {
  scale: number;
  nearDistance: number;
  farDistance: number;
  min: number;
  max: number;
};

/**
 * Order-independent transparency (weighted blended): every blended surface
 * the world draws — glass, water, cutouts' translucent texels, particles,
 * sprites, effects — accumulates into one target in any order and is
 * composited once over the scene, so no draw order can paint one layer over
 * another that is in front of it. See `World.prepareTransparency`.
 */
export type OrderIndependentTransparencyOptions = {
  /**
   * The texel alpha at or above which a see-through block's texel is solid:
   * it draws with the cutouts and writes depth instead of blending.
   */
  solidTexelAlpha: number;
  weights: OrderIndependentWeights;
};

export const defaultOrderIndependentTransparencyOptions: OrderIndependentTransparencyOptions =
  {
    solidTexelAlpha: 0.99,
    weights: {
      scale: 10,
      nearDistance: 4,
      farDistance: 200,
      min: 0.01,
      max: 1000,
    },
  };

/**
 * The bands of the transparent list while the scene renders with blended
 * layers accumulated. Anything at a negative render order (the sky, its
 * clouds) or at {@link OIT_CLOSE_RENDER_ORDER} and above (selection boxes,
 * labels) keeps its own order and draws normally around the bands.
 */
/** Transparent materials that write depth: cutouts, solid texels, masks. */
export const OIT_DEPTH_WRITING_RENDER_ORDER = -0.75;
/** Switches the scene's target to the accumulation target. */
export const OIT_OPEN_RENDER_ORDER = -0.5;
/** Every blended material, accumulated in whatever order the list has. */
export const OIT_BLENDED_RENDER_ORDER = 0;
/**
 * With a separating surface in view (see `OrderIndependentSeparator`):
 * composites what lies behind it, then draws the blended band again for
 * the surface and what lies in front of it.
 */
export const OIT_SPLIT_RENDER_ORDER = 999_998;
/** Switches back and composites the accumulation over the scene. */
export const OIT_CLOSE_RENDER_ORDER = 999_999;
/**
 * Transparent materials that cannot accumulate (additive light, which needs
 * no order, and blend modes the accumulation cannot express) draw here,
 * over the composite.
 */
export const OIT_AFTER_RENDER_ORDER = 999_999.5;

/** Set `material.userData[ORDER_INDEPENDENT_KEY] = false` to keep a material out. */
export const ORDER_INDEPENDENT_KEY = "orderIndependent";

/** How a blended material's colour reaches the accumulation. */
export type BlendedKind = "straight" | "premultiplied";

/**
 * A surface whose far side is only ever seen through it, the way water
 * refracts what lies beyond it: per pixel, every blended fragment behind
 * its nearest face (by `depth`) is composited into the scene first, so the
 * surface can read it, and the face itself and everything in front of it
 * accumulate afterwards. The surface needs no rule of its own: its nearest
 * face lies at that depth, and any face of it farther back is behind it
 * like anything else, so water seen through water is refracted too.
 */
export type OrderIndependentSeparator = {
  /** This frame's depth of the nearest separating face, or null with none in view. */
  depth: () => Texture | null;
  /** How far behind that face, in blocks, a fragment has to be to count as behind it. */
  bias: number;
};

/** Which fragments of a blended material a pass keeps. */
export const OIT_PHASE_ALL = 0;
export const OIT_PHASE_BEHIND = 1;
export const OIT_PHASE_FRONT = 2;

/**
 * Whether a material can accumulate, and how: it blends (normal blending,
 * or custom blending equal to it, straight or premultiplied), writes colour
 * and no depth, and is a node material whose output the accumulation's
 * encoder reads (three hands a `fragmentNode` material no render-target
 * outputs, so one cannot accumulate).
 */
export function blendedKindOf(material: Material): BlendedKind | null {
  if (!material.transparent || material.depthWrite || !material.colorWrite) {
    return null;
  }
  if (material.userData?.[ORDER_INDEPENDENT_KEY] === false) return null;
  const node = material as NodeMaterial;
  if (!node.isNodeMaterial || node.fragmentNode) return null;
  if (material.blending === NormalBlending) {
    return material.premultipliedAlpha ? "premultiplied" : "straight";
  }
  if (
    material.blending !== CustomBlending ||
    material.blendEquation !== AddEquation ||
    material.blendDst !== OneMinusSrcAlphaFactor
  ) {
    return null;
  }
  if (material.blendSrc === SrcAlphaFactor) return "straight";
  if (material.blendSrc === OneFactor) return "premultiplied";
  return null;
}

/** Why a render of the scene drew its blended layers in list order. */
export type OrderIndependentSkipReason =
  | "canvas"
  | "no-depth-texture"
  | "multisampled"
  | "not-perspective"
  | "special-depth";

export type OrderIndependentStats = {
  /** Renders that accumulated their blended layers. */
  opened: number;
  /** Renders with the armed camera that could not, by reason. */
  skipped: Partial<Record<OrderIndependentSkipReason, number>>;
  /** Materials found able to accumulate. */
  adopted: number;
  /** Blended materials that cannot accumulate and draw over the composite. */
  drawnAfter: string[];
};

const SKIP_MESSAGES: Record<OrderIndependentSkipReason, string> = {
  canvas:
    "the scene rendered straight to the canvas; render it into a target with a depth texture",
  "no-depth-texture":
    "the scene's target has no depth texture to share with the accumulation",
  multisampled:
    "the scene's target is multisampled; its depth and colour are not resolved mid-frame",
  "not-perspective":
    "the camera is not a perspective camera; the depth weights need its clip planes",
  "special-depth":
    "the renderer uses a logarithmic or reversed depth buffer, which the depth weights cannot read",
};

/** One draw of three's lists, kept from the scene pass to be drawn later. */
type RecordedDraw = {
  object: Object3D;
  scene: Scene;
  geometry: Parameters<Renderer["renderObject"]>[3];
  material: Material;
  group: Parameters<Renderer["renderObject"]>[5];
  lightsNode: Parameters<Renderer["renderObject"]>[6];
  clippingContext: Parameters<Renderer["renderObject"]>[7];
  passId: Parameters<Renderer["renderObject"]>[8];
};

type RenderObjectFunction = NonNullable<
  ReturnType<Renderer["getRenderObjectFunction"]>
>;

/**
 * Weighted blended order-independent transparency for one scene, as a
 * frame of passes ({@link render}):
 *
 * 1. The scene, without its blended band: three's lists draw as always,
 *    but each blended draw (and each draw that must come after them) is
 *    kept instead of drawn.
 * 2. The kept blended draws, into an accumulation target that shares the
 *    scene's depth (tested, not written), each material's own colour
 *    turned into the weighted sums by a render-target output (`mrt`) the
 *    renderer lays over every material. With a separating surface in view
 *    the band draws twice: first what lies behind the surface, composited,
 *    then the surface and what lies in front of it.
 * 3. The composite over the scene.
 * 4. The draws that come after the blended layers (additive light,
 *    overlays, labels).
 *
 * The kept draws replay through one marker object's draw, so no pass
 * walks the scene again. Adopted materials draw their ordinary colour in
 * every other render (a shadow cascade, an inventory scene): only the
 * accumulation passes carry the encoder.
 */
export class OrderIndependentTransparency {
  readonly uniforms = {
    /**
     * OIT_PHASE_*: which side of the separating surface a pass keeps. It
     * changes between the passes of one render, so it lives in the
     * render's shared group and moves it on (`setPhase`): one small write
     * a pass. In an object's own group every blended draw rewrote its
     * buffer twice a frame, ~350 writes over a lake.
     */
    phase: passUniform(OIT_PHASE_ALL),
    /** (scale, near distance, far distance, unused) of the depth weight. */
    weight: passUniform(new Vector4()),
    /** The depth weight's clamp. */
    weightRange: passUniform(new Vector2()),
    separatorDepth: textureSlot("depth"),
    separatorBias: passUniform(0),
  };
  readonly stats: OrderIndependentStats = {
    opened: 0,
    skipped: {},
    adopted: 0,
    drawnAfter: [],
  };

  private readonly kinds = new WeakMap<Material, BlendedKind | null>();
  private readonly composite: QuadMesh;
  private readonly compositeMaterial: NodeMaterial;
  private readonly compositeInputs = {
    accumulation: textureSlot("float"),
    weight: textureSlot("float"),
  };
  private readonly encoder: ReturnType<typeof mrt>;
  private accumulation: RenderTarget | null = null;
  private readonly reportedSkips = new Set<OrderIndependentSkipReason>();
  private isAccumulating = false;
  /** Whether an object is in the scene, asked once per frame. */
  private readonly membership = new WeakMap<
    Object3D,
    { frame: number; isMember: boolean }
  >();
  private frame = 0;

  /** The scene pass's kept draws, reused frame to frame. */
  private readonly blended: RecordedDraw[] = [];
  private readonly after: RecordedDraw[] = [];
  private blendedCount = 0;
  private afterCount = 0;
  /** The last draw kept of each object this frame, to drop a double pass's second. */
  private readonly lastKept = new WeakMap<
    Object3D,
    { frame: number; material: Material; group: unknown }
  >();

  /** The object whose draw replays a list of kept draws. */
  private readonly marker: Mesh;
  private readonly markerScene = new Scene();

  constructor(
    /** The scene whose renders accumulate. */
    private readonly scene: Object3D,
    options: OrderIndependentTransparencyOptions,
    private readonly hooks: {
      /**
       * The scene's colour as blended layers are about to draw over it:
       * once as the accumulation opens, and again after a split, when it
       * also holds what lies behind the separating surface.
       */
      onOpen?: (renderer: Renderer, target: RenderTarget) => void;
      /**
       * Right before the closing composite, with the scene's target bound:
       * whatever lies behind the blended layers and could not draw before
       * them (a deck of cloud marched after the scene) draws here, under
       * them. `layers` is the weight target: per pixel, the layers'
       * weighted alpha (r) and that times their view depth (g).
       */
      beforeComposite?: (
        renderer: Renderer,
        camera: Camera,
        layers: Texture,
      ) => void;
      /**
       * Between renders, with the scene's target bound, before the draws
       * kept for after the blended layers (their composite is done, or
       * there were none): a draw among them that needs a pass of its own
       * first, into another target, makes it here.
       */
      beforeAfter?: (renderer: Renderer, camera: Camera) => void;
      separator?: OrderIndependentSeparator;
    } = {},
  ) {
    this.setWeights(options.weights);
    this.uniforms.separatorBias.value = hooks.separator?.bias ?? 0;
    this.encoder = this.createEncoder();

    // Never drawn: its draw is where a replay pass draws its list.
    this.marker = new Mesh(new BoxGeometry(), new MeshBasicNodeMaterial());
    this.marker.frustumCulled = false;
    this.marker.name = "OrderIndependent.replay";
    exemptFromLightCones(this.marker, "a replay marker, never drawn");
    this.markerScene.add(this.marker);
    this.markerScene.matrixWorldAutoUpdate = false;

    const { accumulation, weight } = this.compositeInputs;
    this.compositeMaterial = new NodeMaterial();
    this.compositeMaterial.name = "OrderIndependent.composite";
    this.compositeMaterial.fragmentNode = Fn(() => {
      const pixel = ivec2(screenCoordinate.xy);
      const sums = accumulation.load(pixel) as unknown as Vec4Node;
      const coverage = clamp(sums.a, 0, 1).toVar("oitCoverage");
      Discard(coverage.lessThanEqual(0));
      const total = (weight.load(pixel) as unknown as Vec4Node).r;
      return vec4(sums.rgb.div(max(total, 1e-5)).mul(coverage), coverage);
    })();
    this.compositeMaterial.transparent = true;
    this.compositeMaterial.depthTest = false;
    this.compositeMaterial.depthWrite = false;
    this.compositeMaterial.blending = CustomBlending;
    this.compositeMaterial.blendSrc = OneFactor;
    this.compositeMaterial.blendDst = OneMinusSrcAlphaFactor;
    this.compositeMaterial.blendSrcAlpha = OneFactor;
    this.compositeMaterial.blendDstAlpha = OneMinusSrcAlphaFactor;
    this.composite = new QuadMesh(this.compositeMaterial);
  }

  /** Whether this frame's blended layers are accumulating right now. */
  get isOpen() {
    return this.isAccumulating;
  }

  setWeights(weights: OrderIndependentWeights) {
    this.uniforms.weight.value.set(
      weights.scale,
      weights.nearDistance,
      weights.farDistance,
      0,
    );
    this.uniforms.weightRange.value.set(weights.min, weights.max);
  }

  /**
   * Whether `material` draws in the blended band. The answer is kept per
   * material; nothing about the material changes.
   */
  adopt(material: Material): boolean {
    let kind = this.kinds.get(material);
    if (kind === undefined) {
      kind = blendedKindOf(material);
      this.kinds.set(material, kind);
      if (kind) {
        this.stats.adopted += 1;
      } else if (material.transparent && !material.depthWrite) {
        const isAdditive =
          material.blending === AdditiveBlending ||
          (material.blending === CustomBlending &&
            material.blendDst === OneFactor);
        if (!isAdditive) this.stats.drawnAfter.push(describe(material));
      }
    }
    return kind !== null;
  }

  /** {@link adopt}, for a warmup. */
  adoptBeforeCompile(material: Material): boolean {
    return this.adopt(material);
  }

  /**
   * The band of a transparent item of this scene (see
   * {@link OIT_BLENDED_RENDER_ORDER}), or undefined to place it by its own
   * render order: an item of another scene, the sky, an overlay.
   */
  bandOf(object: Object3D, material: Material | undefined): number | undefined {
    if (!material) return undefined;
    const order = object.renderOrder;
    if (order < 0 || order >= OIT_CLOSE_RENDER_ORDER) return undefined;
    if (!this.isInScene(object)) return undefined;
    if (material.depthWrite) return OIT_DEPTH_WRITING_RENDER_ORDER;
    return this.adopt(material)
      ? OIT_BLENDED_RENDER_ORDER
      : OIT_AFTER_RENDER_ORDER;
  }

  /**
   * Draws `scene` from `camera` into `target` (which must hold a depth
   * texture), its blended layers order-independent. A target that cannot
   * share its depth draws them in list order, and says why once.
   */
  render(
    renderer: Renderer,
    scene: Scene,
    camera: Camera,
    target: RenderTarget,
  ) {
    this.frame += 1;
    renderer.setRenderTarget(target);
    const reason = skipReasonOf(renderer, target, camera);
    if (reason) {
      this.skip(reason);
      renderer.render(scene, camera);
      return;
    }

    const autoClear = renderer.autoClear;
    const previous = renderer.getRenderObjectFunction();
    try {
      this.blendedCount = 0;
      this.afterCount = 0;
      const frame = this.frame;
      const draw: RenderObjectFunction = (
        object,
        drawScene,
        drawCamera,
        geometry,
        material,
        group,
        lightsNode,
        clippingContext,
        passId,
      ) => {
        const band = material.transparent
          ? this.bandOf(object, material)
          : undefined;
        const isAfter =
          band === OIT_AFTER_RENDER_ORDER ||
          (band === undefined &&
            material.transparent &&
            object.renderOrder >= OIT_CLOSE_RENDER_ORDER);
        if (band !== OIT_BLENDED_RENDER_ORDER && !isAfter) {
          renderer.renderObject(
            object,
            drawScene,
            drawCamera,
            geometry,
            material,
            group,
            lightsNode,
            clippingContext,
            passId,
          );
          return;
        }
        // A double-sided item draws in two passes of the list (back faces,
        // then front); its replay draws both sides at once.
        const last = this.lastKept.get(object);
        if (
          last?.frame === frame &&
          last.material === material &&
          last.group === group
        ) {
          return;
        }
        if (last) {
          last.frame = frame;
          last.material = material;
          last.group = group;
        } else {
          this.lastKept.set(object, { frame, material, group });
        }
        const list = isAfter ? this.after : this.blended;
        const index = isAfter ? this.afterCount++ : this.blendedCount++;
        const kept = list[index];
        if (kept) {
          kept.object = object;
          kept.scene = drawScene as Scene;
          kept.geometry = geometry;
          kept.material = material;
          kept.group = group;
          kept.lightsNode = lightsNode;
          kept.clippingContext = clippingContext;
          kept.passId = passId;
        } else {
          list.push({
            object,
            scene: drawScene as Scene,
            geometry,
            material,
            group,
            lightsNode,
            clippingContext,
            passId,
          });
        }
      };
      renderer.setRenderObjectFunction(draw);
      renderer.render(scene, camera);
      // The scene is recorded; what follows (the hooks, the accumulation,
      // the composite) draws as itself.
      renderer.setRenderObjectFunction(previous);
      renderer.autoClear = false;

      this.hooks.onOpen?.(renderer, target);
      if (this.blendedCount > 0) {
        this.stats.opened += 1;
        const accumulation = this.accumulationFor(target);
        const separatorDepth = this.hooks.separator?.depth() ?? null;
        if (separatorDepth) {
          this.uniforms.separatorDepth.value = separatorDepth;
          this.accumulate(renderer, camera, accumulation, OIT_PHASE_BEHIND);
          this.compose(renderer, target, accumulation);
          this.hooks.onOpen?.(renderer, target);
          this.accumulate(renderer, camera, accumulation, OIT_PHASE_FRONT);
        } else {
          this.accumulate(renderer, camera, accumulation, OIT_PHASE_ALL);
        }
        renderer.setRenderTarget(target);
        this.hooks.beforeComposite?.(
          renderer,
          camera,
          accumulation.textures[1],
        );
        this.compose(renderer, target, accumulation);
      }
      if (this.afterCount > 0) {
        renderer.setRenderTarget(target);
        this.hooks.beforeAfter?.(renderer, camera);
        renderer.setRenderTarget(target);
        this.replay(renderer, camera, this.after, this.afterCount);
      }
    } finally {
      this.isAccumulating = false;
      this.setPhase(OIT_PHASE_ALL);
      renderer.setMRT(null);
      renderer.setRenderObjectFunction(previous);
      renderer.autoClear = autoClear;
      renderer.setRenderTarget(target);
      // Kept draws hold scene objects only until the next frame's pass.
      this.release(this.blended, this.blendedCount);
      this.release(this.after, this.afterCount);
    }
  }

  /**
   * Where the accumulation draws for a scene drawn into `target`: its
   * targets and the outputs it lays over every material. For a warmup that
   * builds the blended pipelines before their first frame.
   */
  accumulationPass(target: RenderTarget) {
    return { target: this.accumulationFor(target), mrt: this.encoder };
  }

  private isInScene(object: Object3D) {
    const known = this.membership.get(object);
    if (known?.frame === this.frame) return known.isMember;
    let root = object;
    while (root.parent) root = root.parent;
    const isMember = root === this.scene;
    if (known) {
      known.frame = this.frame;
      known.isMember = isMember;
    } else {
      this.membership.set(object, { frame: this.frame, isMember });
    }
    return isMember;
  }

  dispose() {
    this.releaseAccumulation();
    this.compositeMaterial.dispose();
    this.composite.geometry.dispose();
    this.marker.geometry.dispose();
    (this.marker.material as Material).dispose();
  }

  /**
   * The render-target outputs laid over every material in an accumulation
   * pass: the material's own colour (three's `output`) turned into the
   * weighted sums. Premultiplied colour times the weight into the first
   * target, whose alpha accumulates coverage (`1 - Π(1 - a)`) through its
   * blend state; alpha times the weight into the second's red, and that
   * times the fragment's view depth into its green, so a pass after the
   * band can tell where the layers it composited stand. A pass split at
   * the separating surface first drops the fragments on the side it does
   * not keep.
   */
  private createEncoder() {
    const u = this.uniforms;
    const distance = positionView.z.negate();
    const weightOf = Fn(() => {
      const alpha = clamp(output.a, 0, 1);
      const depthWeight = clamp(
        u.weight.x.div(
          distance
            .div(u.weight.y)
            .add(pow(distance.div(u.weight.z), 6))
            .add(1),
        ),
        u.weightRange.x,
        u.weightRange.y,
      );
      return alpha.mul(depthWeight);
    });
    const color = Fn((builder) => {
      If(u.phase.greaterThan(OIT_PHASE_ALL + 0.5), () => {
        const separator = u.separatorDepth.sample(screenUV).level(float(0)).r;
        const isBehind = distance.greaterThan(
          perspectiveDepthToViewZ(separator, cameraNear, cameraFar).add(
            u.separatorBias,
          ),
        );
        const keepsBehind = u.phase.lessThan(OIT_PHASE_BEHIND + 0.5);
        // A fragment on the side this phase does not keep goes. Inverted,
        // each phase kept the other's: the layers in front of the water
        // composited first, and a portal before the sea vanished from the
        // layers the cloud deck splits on, so the clouds painted over it.
        Discard(isBehind.xor(keepsBehind));
      });
      const alpha = clamp(output.a, 0, 1).toVar("oitAlpha");
      Discard(alpha.lessThanEqual(0));
      const kind = blendedKindOf(builder.material as Material);
      const premultiplied =
        kind === "premultiplied" ? output.rgb : output.rgb.mul(alpha);
      return vec4(premultiplied.mul(weightOf()), alpha);
    })();
    const weight = Fn(() => {
      const w = clamp(output.a, 0, 1).mul(weightOf());
      return vec4(w, w.mul(distance), 0, 0);
    })();
    const encoder = mrt({ output: color, weight });
    const sums = new BlendMode(CustomBlending);
    sums.blendEquation = AddEquation;
    sums.blendSrc = OneFactor;
    sums.blendDst = OneFactor;
    sums.blendEquationAlpha = AddEquation;
    sums.blendSrcAlpha = OneFactor;
    sums.blendDstAlpha = OneMinusSrcAlphaFactor;
    encoder.setBlendMode("output", sums);
    const added = new BlendMode(CustomBlending);
    added.blendEquation = AddEquation;
    added.blendSrc = OneFactor;
    added.blendDst = OneFactor;
    added.blendEquationAlpha = AddEquation;
    added.blendSrcAlpha = OneFactor;
    added.blendDstAlpha = OneFactor;
    encoder.setBlendMode("weight", added);
    return encoder;
  }

  /** Moves the pass phase, uploading the render group once if it changed. */
  private setPhase(phase: number) {
    if (this.uniforms.phase.value === phase) return;
    this.uniforms.phase.value = phase;
    renderGroup.needsUpdate = true;
  }

  /** One accumulation pass of the kept blended draws. */
  private accumulate(
    renderer: Renderer,
    camera: Camera,
    accumulation: RenderTarget,
    phase: number,
  ) {
    renderer.setRenderTarget(accumulation);
    const clearColor = renderer.getClearColor(scratchColor);
    const clearAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    this.setPhase(phase);
    this.isAccumulating = true;
    renderer.setMRT(this.encoder);
    try {
      // The accumulation starts empty: cleared by the replay's own pass.
      this.replay(renderer, camera, this.blended, this.blendedCount, {
        color: true,
      });
    } finally {
      renderer.setClearColor(clearColor, clearAlpha);
      renderer.setMRT(null);
      this.isAccumulating = false;
    }
  }

  /** Draws the accumulation over the scene target. */
  private compose(
    renderer: Renderer,
    target: RenderTarget,
    accumulation: RenderTarget,
  ) {
    renderer.setRenderTarget(target);
    this.compositeInputs.accumulation.value = accumulation.textures[0];
    this.compositeInputs.weight.value = accumulation.textures[1];
    this.composite.render(renderer);
  }

  /**
   * Draws `count` kept draws, in the order the scene pass kept them, from
   * inside the marker's draw: the renderer is mid-render there, so each
   * draw is three's own, with the scene, lights and clipping it was kept
   * with.
   */
  private replay(
    renderer: Renderer,
    camera: Camera,
    list: RecordedDraw[],
    count: number,
    clears: PassClears = {},
  ) {
    const marker = this.marker;
    const previous = renderer.getRenderObjectFunction();
    renderer.setRenderObjectFunction((object) => {
      if (object !== marker) return;
      for (let i = 0; i < count; i++) {
        const d = list[i];
        renderer.renderObject(
          d.object,
          d.scene,
          camera,
          d.geometry,
          d.material,
          d.group,
          d.lightsNode,
          d.clippingContext,
          d.passId,
        );
      }
    });
    try {
      renderClearing(renderer, this.markerScene, camera, clears);
    } finally {
      // Left installed, it would swallow every later draw: the composite
      // quad first.
      renderer.setRenderObjectFunction(previous);
    }
  }

  /** Lets go of the kept draws' objects past `count`, and the rest's refs. */
  private release(list: RecordedDraw[], count: number) {
    for (let i = 0; i < Math.min(count, list.length); i++) {
      const d = list[i];
      d.object = this.marker;
      d.scene = this.markerScene;
      d.lightsNode = null as unknown as RecordedDraw["lightsNode"];
      d.clippingContext = null as unknown as RecordedDraw["clippingContext"];
    }
  }

  private accumulationFor(target: RenderTarget) {
    const depthTexture = target.depthTexture;
    const current = this.accumulation;
    if (
      current &&
      current.depthTexture === depthTexture &&
      current.width === target.width &&
      current.height === target.height
    ) {
      return current;
    }
    this.releaseAccumulation();
    const accumulation = new RenderTarget(target.width, target.height, {
      count: 2,
      type: HalfFloatType,
      format: RGBAFormat,
      depthBuffer: true,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
    });
    accumulation.depthTexture = depthTexture;
    accumulation.textures[0].name = "output";
    accumulation.textures[1].name = "weight";
    accumulation.textures[1].format = RGFormat;
    this.accumulation = accumulation;
    return accumulation;
  }

  /** Frees the accumulation target but never the depth texture it borrows. */
  private releaseAccumulation() {
    if (!this.accumulation) return;
    this.accumulation.depthTexture = null;
    this.accumulation.dispose();
    this.accumulation = null;
  }

  private skip(reason: OrderIndependentSkipReason) {
    this.stats.skipped[reason] = (this.stats.skipped[reason] ?? 0) + 1;
    if (this.reportedSkips.has(reason)) return;
    this.reportedSkips.add(reason);
    console.error(
      `[order-independent] blended layers drew in list order: ${SKIP_MESSAGES[reason]}`,
    );
  }
}

const scratchColor = new Color();

function skipReasonOf(
  renderer: Renderer,
  target: RenderTarget | null,
  camera: Camera,
): OrderIndependentSkipReason | null {
  if (!target) return "canvas";
  if (!target.depthTexture) return "no-depth-texture";
  if (target.samples > 1) return "multisampled";
  if (!(camera as PerspectiveCamera).isPerspectiveCamera) {
    return "not-perspective";
  }
  if (renderer.logarithmicDepthBuffer || renderer.reversedDepthBuffer) {
    return "special-depth";
  }
  return null;
}

function describe(material: Material) {
  return material.name ? `${material.type} "${material.name}"` : material.type;
}
