import {
  abs,
  clamp,
  float,
  Fn,
  max,
  min,
  mix,
  pow,
  screenUV,
  select,
  smoothstep,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  DataUtils,
  type DepthTexture,
  HalfFloatType,
  LinearFilter,
  NearestFilter,
  NodeMaterial,
  QuadMesh,
  type Renderer,
  RenderTarget,
} from "three/webgpu";

import { linearToSrgb } from "./encoding";
import {
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
import { drew, Pass, type PassContext } from "./pass";

/**
 * How a {@link DepthOfFieldPass} focuses and blurs. Distances are world
 * units; blur sizes are shares of the frame's height, so the look holds at
 * every resolution. Defocus is measured in dioptres (1 / distance), the
 * unit a lens blurs by: two metres and four are as far apart as four and
 * the horizon. Every field but `rings` can change while the pass runs;
 * `maxBlurRows` is read when the frame is sized.
 */
export type DepthOfFieldOptions = {
  /** Scale on every blur radius: 0 leaves the frame sharp, 1 is the look as set. */
  strength: number;
  /**
   * Whether the focus follows what the centre of the frame looks at. False
   * holds it at `focusDistance`.
   */
  isAutoFocus: boolean;
  /** The focal plane's distance while `isAutoFocus` is false. */
  focusDistance: number;
  /** Blur radius per dioptre of defocus, as a share of the frame's height. */
  blurPerDioptre: number;
  /**
   * Dioptres of defocus left sharp on each side of the focal plane. At 0.04
   * a focus 25 units out or further keeps everything behind it sharp.
   */
  focusTolerance: number;
  /** The largest blur radius behind the focal plane, as a share of the frame's height. */
  maxFarBlur: number;
  /** The largest blur radius in front of the focal plane, as a share of the frame's height. */
  maxNearBlur: number;
  /** Seconds the focus takes to close most of the way onto a nearer subject. */
  focusNearSeconds: number;
  /** Seconds the focus takes to close most of the way onto a farther subject. */
  focusFarSeconds: number;
  /** Radius of the disc at the frame's centre the focus is read over, as a share of the frame's height. */
  focusSpot: number;
  /**
   * How far a near surface in the focus spot outweighs a far one, 0..1. At 0
   * the spot's surfaces count by the area they cover; higher, a subject
   * holds the focus until the spot has all but left it.
   */
  nearPriority: number;
  /** The nearest distance the focus closes to. */
  minFocusDistance: number;
  /** Linear luminance over which a blurred pixel counts as a highlight. */
  highlightThreshold: number;
  /**
   * How much more a highlight weighs in a blur than its surroundings. The
   * frame is clamped to what the screen shows, so this stands in for the
   * brightness a light would have kept: its blur stays a bright disc
   * instead of fading into the pixels around it.
   */
  highlightGain: number;
  /**
   * Rings of the blur kernel: 2, 3 or 4, for 22, 43 or 71 taps a blur
   * texel. Fixed when the pass is made.
   */
  rings: 2 | 3 | 4;
  /**
   * The most rows the blur buffers have. The frame's height is divided by
   * the smallest whole number, 2 at the least, that fits under it, so the
   * blur costs the same on a 4K screen as at 720p. It also sets how far
   * apart the kernel's taps land: at 360 rows three rings sit under three
   * texels apart and a small light blurs into a smooth disc; at 540 the
   * same rings stand over four apart and the disc shows them as a lattice.
   * Raise it together with `rings`.
   */
  maxBlurRows: number;
};

export const DEFAULT_DEPTH_OF_FIELD: DepthOfFieldOptions = {
  strength: 1,
  isAutoFocus: true,
  focusDistance: 8,
  blurPerDioptre: 0.05,
  focusTolerance: 0.04,
  maxFarBlur: 0.022,
  maxNearBlur: 0.028,
  focusNearSeconds: 0.22,
  focusFarSeconds: 0.32,
  focusSpot: 0.012,
  nearPriority: 0.35,
  minFocusDistance: 0.75,
  highlightThreshold: 0.75,
  highlightGain: 3,
  rings: 3,
  maxBlurRows: 360,
};

/** Where a {@link DepthOfFieldPass}'s focus is, read back from the GPU. */
export type DepthOfFieldFocus = {
  /** The focal plane's distance now. */
  distance: number;
  /** The distance it is closing on: what the centre of the frame looks at. */
  targetDistance: number;
};

/** The camera values the pass reads: a perspective camera's planes. */
export type DepthOfFieldCamera = { near: number; far: number };

/** A tap of the blur kernel on the unit disc, and its distance from the centre. */
export type KernelTap = { x: number; y: number; reach: number };

/** Taps on the first ring; ring `n` has `n` times as many. */
const RING_TAPS = 7;

/**
 * The blur kernel on the unit disc: rings of 7, 14, 21... taps about the
 * centre, spaced so every tap stands for the same area, alternate rings
 * turned half a step. The outermost ring sits half a spacing inside the
 * rim: with the centre, the taps tile the whole disc.
 */
export function bokehKernel(rings: number): KernelTap[] {
  const taps: KernelTap[] = [];
  const spacing = 1 / (rings + 0.5);
  for (let ring = 1; ring <= rings; ring++) {
    const count = RING_TAPS * ring;
    const reach = ring * spacing;
    const turn = ring % 2 === 0 ? Math.PI / count : 0;
    for (let i = 0; i < count; i++) {
      const angle = turn + (i / count) * Math.PI * 2;
      taps.push({
        x: Math.cos(angle) * reach,
        y: Math.sin(angle) * reach,
        reach,
      });
    }
  }
  return taps;
}

/**
 * How many times smaller than the frame the blur buffers are: the smallest
 * whole number, 2 at the least, that brings `height` under `maxRows`.
 */
export function blurDivisor(height: number, maxRows: number): number {
  return Math.max(2, Math.ceil(height / Math.max(1, maxRows)));
}

/**
 * The focus spot's taps on the unit disc with their weights: the centre,
 * then two rings that count for less the further out they sit.
 */
const FOCUS_TAPS: readonly (readonly [number, number, number])[] = (() => {
  const taps: [number, number, number][] = [[0, 0, 1]];
  const ring = (
    count: number,
    radius: number,
    weight: number,
    turn: number,
  ) => {
    for (let i = 0; i < count; i++) {
      const angle = turn + (i / count) * Math.PI * 2;
      taps.push([Math.cos(angle) * radius, Math.sin(angle) * radius, weight]);
    }
  };
  ring(6, 0.5, 0.75, 0);
  ring(8, 1, 0.4, Math.PI / 8);
  return taps;
})();

/** Keeps a surface at the far plane from weighing nothing at all in the focus spot. */
const FOCUS_WEIGHT_FLOOR = 1e-4;

/** Blur radii, in blur texels, over which a near surface starts to spread. */
const NEAR_SPREAD_FROM = 0.5;
const NEAR_SPREAD_TO = 1.5;

/**
 * Scale on a near surface's coverage. A blurred edge covers half of the
 * pixel it stood on; doubled, the surface's own pixels are all blur (what
 * lies behind them was never drawn) and the edge fades from there.
 */
const NEAR_COVERAGE = 2;

/**
 * Blur radii, in blur texels, between which a pixel behind the focal plane
 * goes from the sharp frame to the blurred one. The blur buffers cannot
 * hold a blur finer than a texel or so; under that the two cross-fade.
 */
const FAR_BLEND_FROM = 0.25;
const FAR_BLEND_TO = 1.5;

/**
 * Frames in a row drawn with no time passing before the pass says so. A
 * frame drawn twice (a capture) passes no time; a host that never hands
 * the composer its frame time has a focus that cannot move.
 */
const STILL_FRAMES_BEFORE_WARNING = 120;

/**
 * Depth of field with a focus that follows the eye: whatever the centre of
 * the frame looks at comes into focus, eased, and the scene blurs by how
 * far each pixel's depth lies from that plane, in front of it and behind.
 * A pass of its own: disabled it costs nothing.
 *
 * The focus is read from the scene's depth over a small disc at the centre
 * (so the edge of a surface does not flick it back and forth) and closes
 * on that distance as a critically damped spring, in dioptres. It lives on
 * the GPU, in one texel: nothing is read back to follow it. The sky is the
 * far plane, which in dioptres is as good as infinity.
 *
 * The blur is gathered at a fraction of the frame's size: the frame is
 * downsampled with each texel's blur radius, gathered over a disc of taps
 * (a pixel takes the taps whose own blur reaches it, so nothing sharp
 * bleeds into the blur behind it, and a blurred surface in front spreads
 * over the sharp ones behind), smoothed, and laid over the sharp frame by
 * each pixel's own radius. It needs the scene's depth, drawn by a
 * perspective camera with a standard depth range (neither reversed nor
 * logarithmic); without a depth the pass leaves the frame alone.
 *
 * Put it after anti-aliasing and before bloom, so a blurred light blooms
 * as the disc it became.
 *
 * @example
 * ```ts
 * const composer = new EffectComposer(renderer);
 * composer.addPass(new ScenePass((r, target) => world.renderFrame(r, camera, target)));
 * composer.addPass(new EffectPass(new FxaaEffect()));
 * const depthOfField = new DepthOfFieldPass(camera, { strength: 0.8 });
 * composer.addPass(depthOfField);
 * composer.addPass(new EffectPass(new BloomEffect()));
 *
 * // Each frame: the delta drives the focus.
 * composer.render(delta);
 *
 * // A held focus, for a photograph.
 * depthOfField.options.isAutoFocus = false;
 * depthOfField.options.focusDistance = 12;
 * ```
 */
export class DepthOfFieldPass extends Pass {
  /** The pass's settings; change any but `rings` at any time. */
  readonly options: DepthOfFieldOptions;

  /** The blur kernel's taps a blur texel, the centre included. */
  readonly tapCount: number;

  private readonly kernel: KernelTap[];
  /** The kernel's rings, as the pass was made: its shaders are built around them. */
  private readonly rings: number;

  private readonly input = textureInput();
  private readonly depth = depthInput();
  private readonly focus = textureInput();
  private readonly focusPrevious = textureInput();
  private readonly prefiltered = textureInput();
  private readonly gathered = textureInput();
  private readonly blurred = textureInput();

  private readonly u = {
    /** Dioptres at the camera's near and far planes: depth runs linearly between them. */
    dioptreNear: floatUniform(10),
    dioptreFar: floatUniform(0.001),
    maxDioptre: floatUniform(1),
    heldDioptre: floatUniform(0),
    isAutoFocus: floatUniform(1),
    isSnapping: floatUniform(1),
    delta: floatUniform(0),
    nearSeconds: floatUniform(0.2),
    farSeconds: floatUniform(0.3),
    nearPriority: floatUniform(0),
    /** The focus spot's radius in uv, x and y. */
    focusSpot: vec2Uniform(),
    tolerance: floatUniform(0),
    /** Blur texels per dioptre of defocus, the strength included. */
    texelsPerDioptre: floatUniform(0),
    /** The largest radii in blur texels, and the kernel's. */
    maxFar: floatUniform(1),
    maxNear: floatUniform(1),
    kernelRadius: floatUniform(1),
    /** One blur texel in uv. */
    texel: vec2Uniform(),
    highlightThreshold: floatUniform(1),
    highlightGain: floatUniform(0),
  };

  private readonly focusTargets: [RenderTarget, RenderTarget];
  private readonly blurTargets: [RenderTarget, RenderTarget];
  private focusIndex = 0;
  private hasFocus = false;
  private size = { width: 1, height: 1, rows: 1 };
  private hasWarnedNoDepth = false;
  private stillFrames = 0;

  private readonly focusQuad: QuadMesh;
  private readonly prefilterQuad: QuadMesh;
  private readonly gatherQuad: QuadMesh;
  private readonly fillQuad: QuadMesh;
  private readonly quad: QuadMesh;
  private readonly screenQuad: QuadMesh;

  constructor(
    /** The camera the scene is drawn with: its planes turn depth into distance. */
    public camera: DepthOfFieldCamera,
    options: Partial<DepthOfFieldOptions> = {},
  ) {
    super("DepthOfFieldPass");
    this.options = { ...DEFAULT_DEPTH_OF_FIELD, ...options };
    const { rings } = this.options;
    if (rings !== 2 && rings !== 3 && rings !== 4) {
      throw new Error(
        `[postprocessing] depth of field takes 2, 3 or 4 rings, not ${String(rings)}`,
      );
    }
    this.rings = rings;
    this.kernel = bokehKernel(rings);
    this.tapCount = this.kernel.length + 1;

    const focusTarget = (name: string) => {
      const target = new RenderTarget(1, 1, {
        type: HalfFloatType,
        depthBuffer: false,
        generateMipmaps: false,
        magFilter: NearestFilter,
        minFilter: NearestFilter,
      });
      target.texture.name = name;
      return target;
    };
    this.focusTargets = [
      focusTarget("DepthOfField.focus0"),
      focusTarget("DepthOfField.focus1"),
    ];
    const blurTarget = (name: string) => {
      const target = new RenderTarget(1, 1, {
        type: HalfFloatType,
        depthBuffer: false,
        generateMipmaps: false,
        magFilter: LinearFilter,
        minFilter: LinearFilter,
      });
      target.texture.name = name;
      return target;
    };
    this.blurTargets = [
      blurTarget("DepthOfField.blur0"),
      blurTarget("DepthOfField.blur1"),
    ];
    this.focus.value = this.focusTargets[0].texture;
    this.focusPrevious.value = this.focusTargets[1].texture;
    this.prefiltered.value = this.blurTargets[0].texture;
    this.gathered.value = this.blurTargets[1].texture;
    this.blurred.value = this.blurTargets[0].texture;

    this.focusQuad = stage("DepthOfField.focus", () => this.focusState());
    this.prefilterQuad = stage("DepthOfField.prefilter", () =>
      this.prefilter(),
    );
    this.gatherQuad = stage("DepthOfField.gather", () => this.gather());
    this.fillQuad = stage("DepthOfField.fill", () => this.fill());
    this.quad = stage("DepthOfField.combine", () => this.combine(false));
    this.screenQuad = stage("DepthOfField.combine → screen", () =>
      this.combine(true),
    );
  }

  /** The blur buffers' size, and how many times smaller than the frame they are. */
  get blurSize(): { width: number; height: number; divisor: number } {
    const divisor = blurDivisor(this.size.height, this.options.maxBlurRows);
    return {
      width: Math.max(1, Math.round(this.size.width / divisor)),
      height: this.size.rows,
      divisor,
    };
  }

  /**
   * Puts the focus straight on what the centre looks at with the next
   * frame, with no ease: for the frame a host switches the pass on, or
   * cuts the camera to another place.
   */
  resetFocus(): void {
    this.hasFocus = false;
  }

  /**
   * Where the focus is, read back from the GPU: for a readout or a test,
   * not for every frame. Null before the pass has drawn.
   */
  async readFocus(renderer: Renderer): Promise<DepthOfFieldFocus | null> {
    if (!this.hasFocus) return null;
    const target = this.focusTargets[this.focusIndex];
    const pixels = (await renderer.readRenderTargetPixelsAsync(
      target,
      0,
      0,
      1,
      1,
    )) as ArrayLike<number>;
    const read = (index: number) =>
      pixels instanceof Uint16Array
        ? DataUtils.fromHalfFloat(pixels[index])
        : pixels[index];
    const distanceOf = (dioptre: number) => 1 / Math.max(dioptre, 1e-6);
    return {
      distance: distanceOf(read(0)),
      targetDistance: distanceOf(read(2)),
    };
  }

  /**
   * A stored depth as a signed blur radius in blur texels: under 0 in
   * front of the focal plane, over 0 behind it. Depth runs linearly in
   * dioptres between the camera's planes.
   */
  private blurRadius(depth: FloatNode, focus: FloatNode): FloatNode {
    const u = this.u;
    const defocus = focus.sub(mix(u.dioptreNear, u.dioptreFar, depth));
    const radius = max(abs(defocus).sub(u.tolerance), 0).mul(
      u.texelsPerDioptre,
    );
    return select(
      defocus.greaterThan(0),
      min(radius, u.maxFar),
      min(radius, u.maxNear).negate(),
    ) as unknown as FloatNode;
  }

  private depthAt(uv: Vec2Node): FloatNode {
    return (this.depth.sample(uv).level(float(0)) as unknown as Vec4Node).r;
  }

  /**
   * One texel: the focus in dioptres, its speed, and the dioptres it is
   * closing on. The target is the focus spot's surfaces, each weighed by
   * where it sits in the spot and how near it is; the focus follows as a
   * critically damped spring, exact at any frame time.
   */
  private focusState(): Vec4Node {
    const u = this.u;
    let sum: FloatNode = float(0);
    let weight: FloatNode = float(0);
    for (const [x, y, tapWeight] of FOCUS_TAPS) {
      const uv = vec2(0.5).add(
        vec2(x, y).mul(u.focusSpot),
      ) as unknown as Vec2Node;
      const dioptre = min(
        mix(u.dioptreNear, u.dioptreFar, this.depthAt(uv)),
        u.maxDioptre,
      );
      const w = pow(dioptre.add(FOCUS_WEIGHT_FLOOR), u.nearPriority).mul(
        tapWeight,
      );
      sum = sum.add(dioptre.mul(w));
      weight = weight.add(w);
    }
    const target = mix(u.heldDioptre, sum.div(weight), u.isAutoFocus).toVar(
      "dofTarget",
    );
    const previous = (
      this.focusPrevious.sample(vec2(0.5)) as unknown as Vec4Node
    ).toVar("dofPrevious");
    const position = previous.x;
    const velocity = previous.y;
    const seconds = max(
      select(target.greaterThan(position), u.nearSeconds, u.farSeconds),
      1e-3,
    );
    const omega = float(2).div(seconds).toVar("dofOmega");
    const x = omega.mul(u.delta).toVar("dofStep");
    const decay = float(1).div(
      x.mul(x).mul(x).mul(0.235).add(x.mul(x).mul(0.48)).add(x).add(1),
    );
    const change = position.sub(target);
    const push = velocity.add(omega.mul(change)).mul(u.delta).toVar("dofPush");
    const nextVelocity = velocity.sub(omega.mul(push)).mul(decay);
    const nextPosition = clamp(
      target.add(change.add(push).mul(decay)),
      0,
      u.maxDioptre,
    );
    // Selected, never mixed: a buffer nothing has drawn may hold anything.
    const isSnapping = u.isSnapping.greaterThan(0.5);
    return vec4(
      select(isSnapping, target, nextPosition),
      select(isSnapping, float(0), nextVelocity),
      target,
      1,
    ) as unknown as Vec4Node;
  }

  /**
   * The frame at the blur buffers' size: four taps a texel, each with its
   * blur radius. The texel takes the nearest tap's radius, and its colour
   * mostly from the taps that share it, so a sharp edge's colour stays out
   * of the blurred texel beside it.
   */
  private prefilter(): Vec4Node {
    const u = this.u;
    const focus = (this.focus.sample(vec2(0.5)) as unknown as Vec4Node).x.toVar(
      "dofFocus",
    );
    const taps = (
      [
        [-0.25, -0.25],
        [0.25, -0.25],
        [-0.25, 0.25],
        [0.25, 0.25],
      ] as const
    ).map(([x, y], index) => {
      const uv = screenUV.add(vec2(x, y).mul(u.texel)) as unknown as Vec2Node;
      return {
        color: (this.input.sample(uv) as unknown as Vec4Node).rgb,
        radius: this.blurRadius(this.depthAt(uv), focus).toVar(
          `dofTapRadius${index}`,
        ),
      };
    });
    const nearest = min(
      min(taps[0].radius, taps[1].radius),
      min(taps[2].radius, taps[3].radius),
    ).toVar("dofNearest");
    let sum: Vec3Node = vec3(0);
    let weight: FloatNode = float(0);
    for (const tap of taps) {
      const w = float(1).div(abs(tap.radius.sub(nearest)).add(1));
      sum = sum.add(tap.color.mul(w));
      weight = weight.add(w);
    }
    return vec4(sum.div(weight), nearest) as unknown as Vec4Node;
  }

  /** How much more a colour weighs in a blur than a dim one: 1, or more for a highlight. */
  private highlight(rgb: Vec3Node): FloatNode {
    const u = this.u;
    return smoothstep(u.highlightThreshold, 1, luminance(rgb))
      .mul(u.highlightGain)
      .add(1);
  }

  /**
   * The blur: each texel's colour as the taps whose own blur reaches it.
   * Behind the focal plane a tap counts by the smaller of its radius and
   * the texel's, so nothing sharp, and nothing in front, bleeds into the
   * blur behind it. In front of the plane a tap spreads over every texel
   * its radius reaches, sharp ones included, by the share of its disc that
   * one tap stands for; those shares add up to the texel's coverage, the
   * alpha the blurred surface is laid over the rest with.
   */
  private gather(): Vec4Node {
    const u = this.u;
    const center = (
      this.prefiltered.sample(screenUV) as unknown as Vec4Node
    ).toVar("dofCenter");
    /** Blur texels between the kernel's rings. */
    const spacing = u.kernelRadius.div(this.rings + 0.5).toVar("dofSpacing");
    /** 0..1 as a blur of radius `radius` grows across the ring at `reach`. */
    const reaches = (radius: FloatNode, reach: FloatNode) =>
      clamp(radius.sub(reach).div(spacing).add(0.5), 0, 1);
    const spreads = (near: FloatNode) =>
      smoothstep(NEAR_SPREAD_FROM, NEAR_SPREAD_TO, near);

    const centerHighlight = this.highlight(center.rgb).toVar("dofCenterLight");
    const centerNear = max(center.a.negate(), 0);
    // The centre stands for a disc half a spacing wide; a wider blur lands
    // only that share of itself here.
    const centerShare = min(
      spacing.div(max(centerNear, 1e-3)).mul(0.5).pow(2),
      1,
    ).mul(spreads(centerNear));

    const behind = vec4(center.rgb, 1).mul(centerHighlight).toVar("dofBehind");
    const front = vec4(center.rgb, 1)
      .mul(centerHighlight.mul(centerShare))
      .toVar("dofFront");
    const coverage = centerShare.toVar("dofCoverage");

    for (const [index, tap] of this.kernel.entries()) {
      const uv = screenUV.add(
        vec2(tap.x, tap.y).mul(u.kernelRadius).mul(u.texel),
      ) as unknown as Vec2Node;
      const sample = (this.prefiltered.sample(uv) as unknown as Vec4Node).toVar(
        `dofTap${index}`,
      );
      const reach = u.kernelRadius.mul(tap.reach);
      const light = this.highlight(sample.rgb);
      const color = vec4(sample.rgb, 1);

      const behindRadius = max(min(center.a, sample.a), 0);
      behind.addAssign(color.mul(reaches(behindRadius, reach).mul(light)));

      const near = max(sample.a.negate(), 0);
      // A ring tap stands for 2/7 of a spacing squared, over the blur's disc.
      const share = reaches(near, reach)
        .mul(spacing.div(max(near, spacing.mul(0.5))).pow(2))
        .mul(2 / RING_TAPS)
        .mul(spreads(near));
      front.addAssign(color.mul(share.mul(light)));
      coverage.addAssign(share);
    }

    const alpha = clamp(coverage.mul(NEAR_COVERAGE), 0, 1);
    const behindColor = behind.rgb.div(behind.a);
    const frontColor = front.rgb.div(max(front.a, 1e-4));
    return vec4(
      mix(behindColor, frontColor, alpha),
      alpha,
    ) as unknown as Vec4Node;
  }

  /** A nine-tap tent over the gathered blur, as four taps: closes the gaps between the kernel's taps. */
  private fill(): Vec4Node {
    const u = this.u;
    const tap = (x: number, y: number) =>
      this.gathered.sample(
        screenUV.add(vec2(x, y).mul(u.texel)) as unknown as Vec2Node,
      ) as unknown as Vec4Node;
    return tap(-0.5, -0.5)
      .add(tap(0.5, -0.5))
      .add(tap(-0.5, 0.5))
      .add(tap(0.5, 0.5))
      .mul(0.25) as unknown as Vec4Node;
  }

  /**
   * The blur over the sharp frame: behind the focal plane by the pixel's
   * own radius, read at the frame's size so a sharp edge stays one, and in
   * front of it by the coverage the blurred surfaces spread.
   */
  private combine(toScreen: boolean): Vec4Node {
    const focus = (this.focus.sample(vec2(0.5)) as unknown as Vec4Node).x;
    const color = this.input.sample(screenUV) as unknown as Vec4Node;
    const blurred = this.blurred.sample(screenUV) as unknown as Vec4Node;
    const radius = this.blurRadius(this.depthAt(screenUV), focus);
    const far = smoothstep(FAR_BLEND_FROM, FAR_BLEND_TO, radius);
    const alpha = far.add(blurred.a).sub(far.mul(blurred.a));
    const rgb = mix(color.rgb, blurred.rgb, alpha);
    return vec4(
      toScreen ? linearToSrgb(rgb) : rgb,
      color.a,
    ) as unknown as Vec4Node;
  }

  /** The settings and the camera, as the values the shaders read. */
  private sync(delta: number) {
    const u = this.u;
    const o = this.options;
    const rows = this.size.rows;
    const near = Math.max(this.camera.near, 1e-6);
    const far = Math.max(this.camera.far, near);
    u.dioptreNear.value = 1 / near;
    u.dioptreFar.value = 1 / far;
    u.maxDioptre.value = 1 / Math.max(o.minFocusDistance, near);
    u.heldDioptre.value = 1 / Math.max(o.focusDistance, near);
    u.isAutoFocus.value = o.isAutoFocus ? 1 : 0;
    u.isSnapping.value = this.hasFocus ? 0 : 1;
    u.delta.value = Math.max(delta, 0);
    u.nearSeconds.value = o.focusNearSeconds;
    u.farSeconds.value = o.focusFarSeconds;
    u.nearPriority.value = Math.min(Math.max(o.nearPriority, 0), 1);
    u.focusSpot.value.set(
      (o.focusSpot * this.size.height) / this.size.width,
      o.focusSpot,
    );
    u.tolerance.value = Math.max(o.focusTolerance, 0);
    u.texelsPerDioptre.value =
      Math.max(o.strength, 0) * Math.max(o.blurPerDioptre, 0) * rows;
    const maxFar = Math.max(o.maxFarBlur, 0) * rows;
    const maxNear = Math.max(o.maxNearBlur, 0) * rows;
    u.maxFar.value = maxFar;
    u.maxNear.value = maxNear;
    u.kernelRadius.value = Math.max(maxFar, maxNear, 1);
    u.highlightThreshold.value = o.highlightThreshold;
    u.highlightGain.value = Math.max(o.highlightGain, 0);
  }

  render(
    renderer: Renderer,
    input: RenderTarget,
    output: RenderTarget | null,
    context: PassContext,
  ) {
    if (!context.depth) {
      if (!this.hasWarnedNoDepth) {
        this.hasWarnedNoDepth = true;
        console.warn(
          "[postprocessing] depth of field needs the scene's depth: add a ScenePass before it. The frame is left sharp.",
        );
      }
      return false;
    }
    if (context.delta > 0) {
      this.stillFrames = 0;
    } else if (++this.stillFrames === STILL_FRAMES_BEFORE_WARNING) {
      console.warn(
        `[postprocessing] depth of field has drawn ${STILL_FRAMES_BEFORE_WARNING} frames in a row with a frame time of 0, so its focus cannot ease: render the composer with the seconds since the last frame, composer.render(delta).`,
      );
    }
    this.sync(context.delta);
    this.depth.value = context.depth as DepthTexture;
    this.input.value = input.texture;

    // The focus: read from the texel the last frame wrote, into the other.
    const written = 1 - this.focusIndex;
    this.focusPrevious.value = this.focusTargets[this.focusIndex].texture;
    renderer.setRenderTarget(this.focusTargets[written]);
    if (!drew(renderer, () => this.focusQuad.render(renderer))) return false;
    this.focusIndex = written;
    this.focus.value = this.focusTargets[written].texture;
    this.hasFocus = true;

    const [first, second] = this.blurTargets;
    renderer.setRenderTarget(first);
    if (!drew(renderer, () => this.prefilterQuad.render(renderer)))
      return false;
    renderer.setRenderTarget(second);
    if (!drew(renderer, () => this.gatherQuad.render(renderer))) return false;
    renderer.setRenderTarget(first);
    if (!drew(renderer, () => this.fillQuad.render(renderer))) return false;

    renderer.setRenderTarget(output);
    const quad = output ? this.quad : this.screenQuad;
    return drew(renderer, () => quad.render(renderer));
  }

  setSize(width: number, height: number) {
    const divisor = blurDivisor(height, this.options.maxBlurRows);
    const blurWidth = Math.max(1, Math.round(width / divisor));
    const rows = Math.max(1, Math.round(height / divisor));
    this.size = { width, height, rows };
    for (const target of this.blurTargets) target.setSize(blurWidth, rows);
    this.u.texel.value.set(1 / blurWidth, 1 / rows);
  }

  dispose() {
    for (const target of [...this.focusTargets, ...this.blurTargets]) {
      target.dispose();
    }
    for (const quad of [
      this.focusQuad,
      this.prefilterQuad,
      this.gatherQuad,
      this.fillQuad,
      this.quad,
      this.screenQuad,
    ]) {
      (quad.material as NodeMaterial).dispose();
    }
  }
}

/** A full-screen draw of `color`, opaque, no depth: one stage of the pass. */
function stage(name: string, color: () => Vec4Node): QuadMesh {
  const material = new NodeMaterial();
  material.name = name;
  material.depthTest = false;
  material.depthWrite = false;
  material.fragmentNode = Fn(color)();
  return new QuadMesh(material);
}
