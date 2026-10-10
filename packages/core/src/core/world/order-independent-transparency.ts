import {
  AddEquation,
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  type Camera,
  Color,
  CustomBlending,
  GLSL3,
  HalfFloatType,
  type Material,
  Mesh,
  NearestFilter,
  NormalBlending,
  type Object3D,
  OneFactor,
  OneMinusSrcAlphaFactor,
  type PerspectiveCamera,
  RedFormat,
  RGBAFormat,
  type Scene,
  ShaderMaterial,
  SrcAlphaFactor,
  type Texture,
  Vector2,
  Vector4,
  type WebGLRenderer,
  WebGLRenderTarget,
  ZeroFactor,
} from "three";

/**
 * The depth weight of a blended fragment, by its distance from the camera
 * in blocks: `scale / (ε + (d / nearDistance)³ + (d / farDistance)⁶)`,
 * clamped to `[min, max]`. A layer twice as far as another weighs an eighth
 * of it out to `farDistance`, past which the weight falls off faster; the
 * clamp keeps the half-float sums in range.
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
      nearDistance: 10,
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
 * and no depth, and is written in a shader dialect the encoder can wrap.
 */
export function blendedKindOf(material: Material): BlendedKind | null {
  if (!material.transparent || material.depthWrite || !material.colorWrite) {
    return null;
  }
  if (material.userData?.[ORDER_INDEPENDENT_KEY] === false) return null;
  const shader = material as ShaderMaterial & { isRawShaderMaterial?: boolean };
  if (shader.isRawShaderMaterial || shader.glslVersion === GLSL3) return null;
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

const SHADE_FUNCTION = "orderIndependentShade";
const KEY_MARK = "|order-independent-";

/**
 * The accumulation encoder around a material's fragment stage. The source's
 * `main` is renamed by the preprocessor, not by editing its text, so a hook
 * that later finds `void main() {` still edits the material's own body.
 * The new `main` first drops what the pass does not keep (the far or near
 * side of the separating surface's nearest face), before any of the
 * material's own work. It then runs the body and (while the accumulation is
 * open) turns its colour into the weighted sums: premultiplied colour times
 * the weight into the first target (its alpha keeps the product of
 * transmittances through the blend state), alpha times the weight into the
 * second.
 */
export function orderIndependentFragment(source: string, kind: BlendedKind) {
  const premultiplied =
    kind === "premultiplied"
      ? "gl_FragColor.rgb"
      : "gl_FragColor.rgb * oitAlpha";
  const keep = `float oitSeparator = texture2D(uOitSeparatorDepth, gl_FragCoord.xy / uOitViewport).r;
    bool oitIsBehind = oitDistanceAt(gl_FragCoord.z)
      > oitDistanceAt(oitSeparator) + uOitSeparatorBias;
    if (oitIsBehind != (uOitPhase < ${(OIT_PHASE_BEHIND + 0.5).toFixed(1)})) discard;`;
  return `#define main ${SHADE_FUNCTION}
${source}
#undef main
uniform float uOitActive;
uniform float uOitPhase;
uniform vec2 uOitClip;
uniform vec2 uOitViewport;
uniform vec4 uOitWeight;
uniform vec2 uOitWeightRange;
uniform sampler2D uOitSeparatorDepth;
uniform float uOitSeparatorBias;
layout(location = 1) out highp vec4 pc_fragOitWeight;
float oitDistanceAt(float depth) {
  return uOitClip.x * uOitClip.y
    / (uOitClip.y - depth * (uOitClip.y - uOitClip.x));
}
void main() {
  if (uOitActive > 0.5 && uOitPhase > ${(OIT_PHASE_ALL + 0.5).toFixed(1)}) {
    ${keep}
  }
  ${SHADE_FUNCTION}();
  pc_fragOitWeight = vec4(0.0);
  if (uOitActive < 0.5) return;
  float oitAlpha = clamp(gl_FragColor.a, 0.0, 1.0);
  if (oitAlpha <= 0.0) discard;
  float oitDistance = oitDistanceAt(gl_FragCoord.z);
  float oitDepthWeight = clamp(
    uOitWeight.x / (1e-5
      + pow(oitDistance / uOitWeight.y, 3.0)
      + pow(oitDistance / uOitWeight.z, 6.0)),
    uOitWeightRange.x,
    uOitWeightRange.y
  );
  float oitWeight = oitAlpha * oitDepthWeight;
  gl_FragColor = vec4(${premultiplied} * oitWeight, oitAlpha);
  pc_fragOitWeight = vec4(oitAlpha * oitWeight, 0.0, 0.0, 0.0);
}
`;
}

const COMPOSITE_VERTEX = `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const COMPOSITE_FRAGMENT = `
uniform sampler2D tAccumulation;
uniform sampler2D tWeight;
void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  vec4 accumulation = texelFetch(tAccumulation, pixel, 0);
  float coverage = 1.0 - accumulation.a;
  if (coverage <= 0.0) discard;
  float weight = texelFetch(tWeight, pixel, 0).r;
  gl_FragColor = vec4(accumulation.rgb / max(weight, 1e-5) * coverage, coverage);
}
`;

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
  /** Materials wrapped with the encoder. */
  adopted: number;
  /**
   * Materials wrapped after they had compiled: each one compiled again on
   * a frame mid-play, the hitch a warmup is for.
   */
  lateAdopted: string[];
  /** Blended materials that cannot accumulate and draw over the composite. */
  drawnAfter: string[];
};

type Adoption = { kind: BlendedKind; version: number };

const SKIP_MESSAGES: Record<OrderIndependentSkipReason, string> = {
  canvas:
    "the scene rendered straight to the canvas; render it into a target with a depth texture",
  "no-depth-texture":
    "the scene's target has no depth texture to share with the accumulation (EffectComposer: a pass that needs depth, or createDepthTexture())",
  multisampled:
    "the scene's target is multisampled; its depth and colour are not resolved mid-render",
  "not-perspective":
    "the camera is not a perspective camera; the depth weights need its clip planes",
  "special-depth":
    "the renderer uses a logarithmic or reversed depth buffer, which the depth weights cannot read",
};

const BLACK = new Color(0, 0, 0);
const CLEAR_ACCUMULATION = [0, 0, 0, 1];
const CLEAR_WEIGHT = [0, 0, 0, 0];

/** What a render item of three's transparent list carries to a draw. */
type ListItem = {
  object: Object3D;
  geometry: BufferGeometry;
  material: Material;
  group: Parameters<Object3D["onBeforeRender"]>[5];
};

/**
 * Weighted blended order-independent transparency for one scene.
 *
 * Marker objects bracket the blended band of the scene's transparent list.
 * The opening one (after the sky and the depth writers) hands the scene's
 * colour to whoever samples it mid-render (the water's refraction),
 * switches the render to an accumulation target that shares the scene's
 * depth texture, and forces the accumulation blend state on every adopted
 * material; the closing one switches back and draws the composite. With a
 * separating surface in view, the band first keeps only what lies behind
 * that surface, the split marker composites it and draws the band again
 * for the rest. Adopted materials draw their ordinary colour in any other
 * render, so a material shared with an inventory scene or drawn into a
 * shadow map is untouched.
 */
export class OrderIndependentTransparency {
  readonly open: Mesh;
  readonly split: Mesh;
  readonly close: Mesh;
  readonly uniforms = {
    uOitActive: { value: 0 },
    uOitPhase: { value: OIT_PHASE_ALL },
    uOitClip: { value: new Vector2(0.1, 1000) },
    uOitViewport: { value: new Vector2(1, 1) },
    uOitWeight: { value: new Vector4() },
    uOitWeightRange: { value: new Vector2() },
    uOitSeparatorDepth: { value: null as Texture | null },
    uOitSeparatorBias: { value: 0 },
  };
  readonly stats: OrderIndependentStats = {
    opened: 0,
    skipped: {},
    adopted: 0,
    lateAdopted: [],
    drawnAfter: [],
  };

  private readonly adopted = new WeakMap<Material, Adoption>();
  private readonly declined = new WeakSet<Material>();
  private readonly composite: ShaderMaterial;
  private readonly compositeGeometry: BufferGeometry;
  private accumulation: WebGLRenderTarget | null = null;
  private accumulationDepthHandle: unknown = null;
  private sceneTarget: WebGLRenderTarget | null = null;
  private camera: Camera | null = null;
  private renderer: WebGLRenderer | null = null;
  private restoreSetMaterial: (() => void) | null = null;
  private readonly reportedSkips = new Set<OrderIndependentSkipReason>();
  private isAccumulating = false;
  /** Whether an object is in the scene, asked once per armed frame. */
  private readonly membership = new WeakMap<
    Object3D,
    { frame: number; isMember: boolean }
  >();
  private armedFrame = 0;

  constructor(
    /** The scene whose renders accumulate; it holds {@link open} and {@link close}. */
    private readonly scene: Object3D,
    options: OrderIndependentTransparencyOptions,
    private readonly hooks: {
      /**
       * The scene's colour as blended layers are about to draw over it:
       * once as the accumulation opens, and again after a split, when it
       * also holds what lies behind the separating surface.
       */
      onOpen?: (renderer: WebGLRenderer, target: WebGLRenderTarget) => void;
      separator?: OrderIndependentSeparator;
    } = {},
  ) {
    this.setWeights(options.weights);
    this.uniforms.uOitSeparatorBias.value = hooks.separator?.bias ?? 0;

    const marker = new BufferGeometry();
    marker.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(9), 3),
    );
    marker.setDrawRange(0, 0);
    const markerMaterial = new ShaderMaterial({
      vertexShader: "void main() { gl_Position = vec4(0.0); }",
      fragmentShader: "void main() {}",
      transparent: true,
      depthTest: false,
      depthWrite: false,
      colorWrite: false,
    });
    this.open = new Mesh(marker, markerMaterial);
    this.open.name = "OrderIndependent.open";
    this.open.frustumCulled = false;
    this.open.renderOrder = OIT_OPEN_RENDER_ORDER;
    this.open.onBeforeRender = (renderer, scene, camera) =>
      this.begin(renderer, scene, camera);
    this.split = new Mesh(marker, markerMaterial);
    this.split.name = "OrderIndependent.split";
    this.split.frustumCulled = false;
    this.split.renderOrder = OIT_SPLIT_RENDER_ORDER;
    this.split.onBeforeRender = (renderer, scene, camera) =>
      this.splitAtSeparator(renderer, scene as Scene, camera);

    this.compositeGeometry = new BufferGeometry();
    this.compositeGeometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    );
    this.compositeGeometry.setDrawRange(0, 0);
    this.composite = new ShaderMaterial({
      vertexShader: COMPOSITE_VERTEX,
      fragmentShader: COMPOSITE_FRAGMENT,
      uniforms: {
        tAccumulation: { value: null as Texture | null },
        tWeight: { value: null as Texture | null },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: OneFactor,
    });
    this.close = new Mesh(this.compositeGeometry, this.composite);
    this.close.name = "OrderIndependent.close";
    this.close.frustumCulled = false;
    this.close.renderOrder = OIT_CLOSE_RENDER_ORDER;
    this.close.onBeforeRender = (renderer) => this.end(renderer);
    this.close.onAfterRender = () => this.compositeGeometry.setDrawRange(0, 0);
    this.declined.add(this.open.material as Material);
    this.declined.add(this.composite);
  }

  /** Whether this render's blended layers are accumulating right now. */
  get isOpen() {
    return this.isAccumulating;
  }

  setWeights(weights: OrderIndependentWeights) {
    this.uniforms.uOitWeight.value.set(
      weights.scale,
      weights.nearDistance,
      weights.farDistance,
      0,
    );
    this.uniforms.uOitWeightRange.value.set(weights.min, weights.max);
  }

  /**
   * The camera whose renders of the scene accumulate. Renders with any other
   * camera (shadow cascades, a portrait) draw their blended layers in list
   * order. Call it before each frame's render.
   */
  arm(renderer: WebGLRenderer, camera: Camera) {
    if (this.isAccumulating) this.abandon();
    this.renderer = renderer;
    this.camera = camera;
    this.armedFrame += 1;
  }

  /**
   * Wraps `material` with the encoder if it can accumulate; returns whether
   * it draws in the blended band. Call it before the material first
   * compiles (a warmup), or it compiles twice.
   */
  adopt(material: Material): boolean {
    const adoption = this.adopted.get(material);
    if (adoption) {
      if (adoption.version !== material.version)
        this.verify(material, adoption);
      return true;
    }
    if (this.declined.has(material)) return false;
    const kind = blendedKindOf(material);
    if (!kind) {
      this.declined.add(material);
      if (material.transparent && !material.depthWrite) {
        const isAdditive =
          material.blending === AdditiveBlending ||
          (material.blending === CustomBlending &&
            material.blendDst === OneFactor);
        if (!isAdditive) this.stats.drawnAfter.push(describe(material));
      }
      return false;
    }
    this.wrap(material, kind);
    return true;
  }

  /**
   * {@link adopt} for a warmup: a material that already compiled is left to
   * the sort. Every blended item this scene draws is adopted before its
   * first draw, so one compiled unadopted was drawn outside the band (the
   * sky, an overlay) or in another scene; wrapping it would only compile it
   * again.
   */
  adoptBeforeCompile(material: Material): boolean {
    if (this.adopted.has(material)) return true;
    if (this.renderer?.properties.has(material)) return false;
    return this.adopt(material);
  }

  /**
   * The band of a transparent item of this scene (see
   * {@link OIT_BLENDED_RENDER_ORDER}), or undefined to place it by its own
   * render order: an item of another scene, the sky, an overlay.
   */
  bandOf(object: Object3D, material: Material | undefined): number | undefined {
    if (object === this.open) return OIT_OPEN_RENDER_ORDER;
    if (object === this.split) return OIT_SPLIT_RENDER_ORDER;
    if (object === this.close) return OIT_CLOSE_RENDER_ORDER;
    if (!material) return undefined;
    const order = object.renderOrder;
    if (order < 0 || order >= OIT_CLOSE_RENDER_ORDER) return undefined;
    if (!this.isInScene(object)) return undefined;
    if (material.depthWrite) return OIT_DEPTH_WRITING_RENDER_ORDER;
    return this.adopt(material)
      ? OIT_BLENDED_RENDER_ORDER
      : OIT_AFTER_RENDER_ORDER;
  }

  private isInScene(object: Object3D) {
    const known = this.membership.get(object);
    if (known?.frame === this.armedFrame) return known.isMember;
    let root = object;
    while (root.parent) root = root.parent;
    const isMember = root === this.scene;
    if (known) {
      known.frame = this.armedFrame;
      known.isMember = isMember;
    } else {
      this.membership.set(object, { frame: this.armedFrame, isMember });
    }
    return isMember;
  }

  dispose() {
    if (this.isAccumulating) this.abandon();
    this.releaseAccumulation();
    this.compositeGeometry.dispose();
    this.composite.dispose();
    this.open.geometry.dispose();
    (this.open.material as Material).dispose();
  }

  private wrap(material: Material, kind: BlendedKind) {
    const previousCompile = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey;
    const uniforms = this.uniforms;
    const compile: Material["onBeforeCompile"] = function (
      this: Material,
      shader,
      renderer,
    ) {
      previousCompile.call(this, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = orderIndependentFragment(
        shader.fragmentShader,
        kind,
      );
    };
    compile.toString = () => previousCompile.toString();
    material.onBeforeCompile = compile;
    material.customProgramCacheKey = function (this: Material) {
      return `${previousKey.call(this)}${KEY_MARK}${kind}`;
    };
    // Accumulation needs no back-to-front pass: one draw of both sides.
    material.forceSinglePass = true;
    if (this.renderer?.properties.has(material)) {
      this.stats.lateAdopted.push(describe(material));
      console.warn(
        `[order-independent] ${describe(material)} compiled before it was adopted; it compiles again now (adopt it before the warmup)`,
      );
    }
    material.needsUpdate = true;
    this.adopted.set(material, { kind, version: material.version });
    this.stats.adopted += 1;
  }

  /**
   * Someone touched the material since: if the encoder is no longer in its
   * program key, a hook replaced the wrapper rather than wrapping it, and
   * the material would draw unencoded colour into the accumulation.
   */
  private verify(material: Material, adoption: Adoption) {
    if (material.customProgramCacheKey().includes(KEY_MARK)) {
      adoption.version = material.version;
      return;
    }
    this.adopted.delete(material);
    this.wrap(material, adoption.kind);
  }

  private begin(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    this.isAccumulating = false;
    if (camera !== this.camera || scene.overrideMaterial) return;
    const target = renderer.getRenderTarget() as WebGLRenderTarget | null;
    const reason = skipReasonOf(renderer, target, camera);
    if (reason || !target) {
      this.skip(reason ?? "canvas");
      return;
    }

    this.hooks.onOpen?.(renderer, target);
    this.accumulationFor(renderer, target);
    this.sceneTarget = target;
    const perspective = camera as PerspectiveCamera;
    this.uniforms.uOitClip.value.set(perspective.near, perspective.far);
    this.uniforms.uOitViewport.value.set(target.width, target.height);
    const separatorDepth = this.hooks.separator?.depth() ?? null;
    this.uniforms.uOitSeparatorDepth.value = separatorDepth;
    this.openAccumulation(
      renderer,
      separatorDepth ? OIT_PHASE_BEHIND : OIT_PHASE_ALL,
    );
    this.isAccumulating = true;
    this.stats.opened += 1;
  }

  private openAccumulation(renderer: WebGLRenderer, phase: number) {
    renderer.setRenderTarget(this.accumulation);
    const gl = renderer.getContext() as WebGL2RenderingContext;
    renderer.state.buffers.color.setMask(true);
    gl.clearBufferfv(gl.COLOR, 0, CLEAR_ACCUMULATION);
    gl.clearBufferfv(gl.COLOR, 1, CLEAR_WEIGHT);
    this.uniforms.uOitPhase.value = phase;
    this.uniforms.uOitActive.value = 1;
    this.forceAccumulationBlending(renderer);
  }

  /**
   * After the layers behind the separating surface accumulated: composite
   * them into the scene, hand the scene over again (the surface reads it as
   * it draws), and draw the blended band once more for the surface and
   * what lies in front of it. The band comes from three's list for this
   * render; drawn here, each item goes through the steps three's own draw
   * of it takes.
   */
  private splitAtSeparator(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
  ) {
    if (
      !this.isAccumulating ||
      this.uniforms.uOitPhase.value !== OIT_PHASE_BEHIND ||
      !this.sceneTarget
    ) {
      return;
    }
    const list = (
      renderer as unknown as {
        renderLists: {
          get: (scene: Scene, depth: number) => { transparent: ListItem[] };
        };
      }
    ).renderLists.get(scene, 0);
    const items = list.transparent;
    if (!items.some((item) => item.object === this.split)) {
      // Not the list being drawn: draw the rest as one pass.
      this.uniforms.uOitPhase.value = OIT_PHASE_ALL;
      return;
    }
    this.composeInto(renderer, camera, scene);
    this.hooks.onOpen?.(renderer, this.sceneTarget);
    this.openAccumulation(renderer, OIT_PHASE_FRONT);
    for (const { object, geometry, material, group } of items) {
      if (this.bandOf(object, material) !== OIT_BLENDED_RENDER_ORDER) continue;
      object.onBeforeRender(renderer, scene, camera, geometry, material, group);
      object.modelViewMatrix.multiplyMatrices(
        camera.matrixWorldInverse,
        object.matrixWorld,
      );
      object.normalMatrix.getNormalMatrix(object.modelViewMatrix);
      material.onBeforeRender(renderer, scene, camera, geometry, object, group);
      renderer.renderBufferDirect(
        camera,
        scene,
        geometry,
        material,
        object,
        group,
      );
      object.onAfterRender(renderer, scene, camera, geometry, material, group);
    }
  }

  /** Draws the accumulation over the scene target, as the close does. */
  private composeInto(renderer: WebGLRenderer, camera: Camera, scene: Scene) {
    if (!this.accumulation) return;
    this.restoreSetMaterial?.();
    this.restoreSetMaterial = null;
    this.uniforms.uOitActive.value = 0;
    renderer.setRenderTarget(this.sceneTarget);
    this.composite.uniforms.tAccumulation.value = this.accumulation.textures[0];
    this.composite.uniforms.tWeight.value = this.accumulation.textures[1];
    this.compositeGeometry.setDrawRange(0, 3);
    renderer.renderBufferDirect(
      camera,
      scene,
      this.compositeGeometry,
      this.composite,
      this.close,
      null,
    );
    this.compositeGeometry.setDrawRange(0, 0);
  }

  private end(renderer: WebGLRenderer) {
    if (!this.isAccumulating || !this.accumulation) return;
    this.abandon();
    renderer.setRenderTarget(this.sceneTarget);
    this.composite.uniforms.tAccumulation.value = this.accumulation.textures[0];
    this.composite.uniforms.tWeight.value = this.accumulation.textures[1];
    this.compositeGeometry.setDrawRange(0, 3);
  }

  /** Leaves the accumulation without compositing (or before it). */
  private abandon() {
    this.restoreSetMaterial?.();
    this.restoreSetMaterial = null;
    this.uniforms.uOitActive.value = 0;
    this.uniforms.uOitPhase.value = OIT_PHASE_ALL;
    this.isAccumulating = false;
  }

  /**
   * three sets each draw's blend state from its material; during the
   * accumulation an adopted material blends into the sums instead: colour
   * added, the target's alpha multiplied by one minus the fragment's.
   */
  private forceAccumulationBlending(renderer: WebGLRenderer) {
    const state = renderer.state;
    const setMaterial = state.setMaterial;
    const adopted = this.adopted;
    state.setMaterial = (...args: Parameters<typeof setMaterial>) => {
      setMaterial(...args);
      if (!adopted.has(args[0])) return;
      (state.setBlending as unknown as (...args: unknown[]) => void)(
        CustomBlending,
        AddEquation,
        OneFactor,
        OneFactor,
        AddEquation,
        ZeroFactor,
        OneMinusSrcAlphaFactor,
        BLACK,
        0,
        false,
      );
    };
    this.restoreSetMaterial = () => {
      state.setMaterial = setMaterial;
    };
  }

  private accumulationFor(renderer: WebGLRenderer, target: WebGLRenderTarget) {
    const depthTexture = target.depthTexture;
    const depthHandle = depthTexture
      ? (renderer.properties.get(depthTexture) as { __webglTexture?: unknown })
          .__webglTexture
      : null;
    const current = this.accumulation;
    if (
      current &&
      current.depthTexture === depthTexture &&
      current.width === target.width &&
      current.height === target.height &&
      this.accumulationDepthHandle === depthHandle
    ) {
      return current;
    }
    this.releaseAccumulation();
    const accumulation = new WebGLRenderTarget(target.width, target.height, {
      count: 2,
      type: HalfFloatType,
      format: RGBAFormat,
      depthBuffer: true,
      depthTexture,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
    });
    accumulation.textures[0].name = "OrderIndependent.accumulation";
    accumulation.textures[1].name = "OrderIndependent.weight";
    accumulation.textures[1].format = RedFormat;
    this.accumulation = accumulation;
    this.accumulationDepthHandle = depthHandle;
    return accumulation;
  }

  /** Frees the accumulation target but never the depth texture it borrows. */
  private releaseAccumulation() {
    if (!this.accumulation) return;
    this.accumulation.depthTexture = null;
    this.accumulation.dispose();
    this.accumulation = null;
    this.accumulationDepthHandle = null;
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

function skipReasonOf(
  renderer: WebGLRenderer,
  target: WebGLRenderTarget | null,
  camera: Camera,
): OrderIndependentSkipReason | null {
  if (!target) return "canvas";
  if (!target.depthTexture) return "no-depth-texture";
  if (target.samples > 0) return "multisampled";
  if (!(camera as PerspectiveCamera).isPerspectiveCamera) {
    return "not-perspective";
  }
  const capabilities = renderer.capabilities as {
    logarithmicDepthBuffer?: boolean;
    reversedDepthBuffer?: boolean;
  };
  if (capabilities.logarithmicDepthBuffer || capabilities.reversedDepthBuffer) {
    return "special-depth";
  }
  return null;
}

function describe(material: Material) {
  return material.name ? `${material.type} "${material.name}"` : material.type;
}
