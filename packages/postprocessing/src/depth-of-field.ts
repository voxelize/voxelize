import {
  abs,
  clamp,
  cos,
  float,
  Fn,
  If,
  interleavedGradientNoise,
  Loop,
  max,
  min,
  mix,
  pow,
  screenCoordinate,
  screenUV,
  select,
  sin,
  smoothstep,
  sqrt,
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
 * How a {@link DepthOfFieldPass} focuses and blurs. It is a thin lens: one
 * opening (`aperture`, in world units) and the circle of confusion that
 * follows from it. Defocus is measured in dioptres (1 / distance), the
 * unit a lens blurs by: two units and four are as far apart as four and
 * the horizon, so a look at the distance leaves the whole distance sharp
 * and only what stands close to the eye soft. The blur's size on screen
 * follows the camera's field of view, as it does through a lens: a narrow
 * view magnifies the blur with everything else.
 *
 * Every field can change while the pass runs, but `rings` and the reach of
 * `maxNearBlur` (lowered live, never raised past what the pass was made
 * with); `maxBlurRows` is read when the frame is sized.
 */
export type DepthOfFieldOptions = {
  /** Scale on the aperture: 0 leaves the frame sharp, 1 is the lens as set. */
  strength: number;
  /**
   * Whether the focus follows what the centre of the frame looks at. False
   * holds it at `focusDistance`.
   */
  isAutoFocus: boolean;
  /** The focal plane's distance while `isAutoFocus` is false. */
  focusDistance: number;
  /**
   * The lens's opening, in world units: a point one dioptre out of focus
   * blurs to a disc half of this across, as an angle in radians. A real
   * 50 mm lens at f/1.4 opens 0.036 m.
   */
  aperture: number;
  /**
   * Dioptres of defocus over which the blur comes in: within it the blur
   * grows from nothing with no edge to where it starts, and well past it
   * it grows by the aperture. With 0.35, a focus five units out or
   * further leaves everything behind it sharp to the pixel.
   */
  sharpZone: number;
  /** The blur radius behind the focal plane levels off toward this share of the frame's height. */
  maxFarBlur: number;
  /** The blur radius in front of the focal plane levels off toward this share of the frame's height. */
  maxNearBlur: number;
  /**
   * Seconds the focus takes to close two thirds of the way onto a nearer
   * subject. Long, so the world softens gradually behind what is looked at
   * and a near thing crossing the centre for a moment barely pulls it.
   */
  focusNearSeconds: number;
  /** Seconds the focus takes to close two thirds of the way back out to a farther subject. */
  focusFarSeconds: number;
  /**
   * Seconds the distance under the centre is smoothed over before the
   * focus follows it: a one-frame flicker of the target never starts a
   * move.
   */
  focusSettleSeconds: number;
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
   * brightness a light would have kept. At 0 a blur is a plain average:
   * a patterned surface keeps its pattern's colours.
   */
  highlightGain: number;
  /**
   * Rings of each blur kernel: 2, 3 or 4, for 22, 43 or 71 taps a blur
   * texel behind the focal plane, and as many again where something in
   * front of it blurs. Fixed when the pass is made.
   */
  rings: 2 | 3 | 4;
  /**
   * The most rows the blur buffers have. The frame's height is divided by
   * the smallest whole number, 2 at the least, that fits under it, so the
   * blur costs the same on a 4K screen as at 1080p.
   */
  maxBlurRows: number;
};

export const DEFAULT_DEPTH_OF_FIELD: DepthOfFieldOptions = {
  strength: 1,
  isAutoFocus: true,
  focusDistance: 8,
  aperture: 0.04,
  sharpZone: 0.35,
  maxFarBlur: 0.02,
  maxNearBlur: 0.025,
  focusNearSeconds: 0.75,
  focusFarSeconds: 0.16,
  focusSettleSeconds: 0.04,
  focusSpot: 0.012,
  nearPriority: 0.35,
  minFocusDistance: 0.3,
  highlightThreshold: 0.75,
  highlightGain: 0,
  rings: 3,
  maxBlurRows: 540,
};

/** Where a {@link DepthOfFieldPass}'s focus is, read back from the GPU. */
export type DepthOfFieldFocus = {
  /** The focal plane's distance now. */
  distance: number;
  /** The distance it is closing on: what the centre of the frame looks at. */
  targetDistance: number;
};

/**
 * The camera values the pass reads: a perspective camera's planes, and its
 * projection (three's `PerspectiveCamera` as it is).
 */
export type DepthOfFieldCamera = {
  near: number;
  far: number;
  projectionMatrix: { elements: ArrayLike<number> };
};

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
 * The share of the way a value closes on its target in `delta` seconds,
 * when it closes two thirds (1 - 1/e) of the way in `seconds`: an ease
 * that starts at once and slows as it arrives, the same at any frame time.
 */
export function easeShare(delta: number, seconds: number): number {
  if (!(delta > 0)) return 0;
  if (!(seconds > 0)) return 1;
  return 1 - Math.exp(-delta / seconds);
}

/**
 * The blur radius of a point `defocus` dioptres from the focal plane, as a
 * share of the frame's height, before the caps: the thin lens's circle of
 * confusion (half the aperture times the defocus, as an angle) through a
 * projection whose `[1][1]` is `projectionScale`, with the blur coming in
 * smoothly over `sharpZone`.
 */
export function blurShare(
  defocus: number,
  aperture: number,
  sharpZone: number,
  projectionScale: number,
): number {
  const x = Math.abs(defocus);
  const eased = Math.sqrt(x * x + sharpZone * sharpZone) - sharpZone;
  return (aperture / 2) * eased * (projectionScale / 2);
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
 * Blur radii, in blur texels, between which a pixel behind the focal plane
 * goes from the sharp frame to the blurred one. The blur buffers cannot
 * hold a blur finer than a texel or so; under that the two cross-fade.
 */
const FAR_BLEND_FROM = 0.25;
const FAR_BLEND_TO = 1.5;

/**
 * A side of a tile of the blur buffer, in blur texels. Each tile knows the
 * widest blur in front of the focal plane that can reach it, which is how
 * far a texel in it looks for one.
 */
const TILE = 16;

/**
 * Frames in a row drawn with no time passing before the pass says so. A
 * frame drawn twice (a capture) passes no time; a host that never hands
 * the composer its frame time has a focus that cannot move.
 */
const STILL_FRAMES_BEFORE_WARNING = 120;

/**
 * Depth of field with a focus that follows the eye: whatever the centre of
 * the frame looks at comes into focus, eased, and the scene blurs as it
 * would through a lens focused there. A pass of its own: disabled it costs
 * nothing.
 *
 * The focus is read from the scene's depth over a small disc at the centre
 * (so the edge of a surface does not flick it back and forth) and eases
 * onto that distance in dioptres, starting at once and slowing as it
 * arrives: slowly onto something nearer, quickly back out. It lives on the
 * GPU, in one texel: nothing is read back to follow it. The sky is the far
 * plane, which in dioptres is as good as infinity.
 *
 * The blur is gathered at a fraction of the frame's size, in two layers.
 * Behind the focal plane each texel gathers a disc of its own radius, from
 * the taps whose own blur reaches it, so nothing sharp and nothing in
 * front bleeds into the blur. In front of the plane each surface spreads
 * over what its radius reaches, sharp surfaces included, and lands over
 * them by the share of each pixel its disc covers: its edge softens about
 * where the edge is, and what shows through its rim is filled in from the
 * scene beside it. Where nothing blurs, the frame is passed through
 * untouched. It needs the scene's depth, drawn by a perspective camera
 * with a standard depth range (neither reversed nor logarithmic); without
 * a depth the pass leaves the frame alone.
 *
 * Put it after anti-aliasing and before bloom, so a blurred light blooms
 * as the disc it became.
 *
 * @example
 * ```ts
 * const composer = new EffectComposer(renderer);
 * composer.addPass(new ScenePass((r, target) => world.renderFrame(r, camera, target)));
 * composer.addPass(new EffectPass(new FxaaEffect()));
 * const depthOfField = new DepthOfFieldPass(camera, { aperture: 0.05 });
 * composer.addPass(depthOfField);
 * composer.addPass(new EffectPass(new BloomEffect()));
 *
 * // Each frame: the delta eases the focus.
 * composer.render(delta);
 *
 * // A held focus, for a photograph.
 * depthOfField.options.isAutoFocus = false;
 * depthOfField.options.focusDistance = 12;
 * ```
 */
export class DepthOfFieldPass extends Pass {
  /** The pass's settings; see {@link DepthOfFieldOptions} for what changes live. */
  readonly options: DepthOfFieldOptions;

  /** Each blur kernel's taps a blur texel, the centre included. */
  readonly tapCount: number;

  private readonly kernel: KernelTap[];
  /** The kernel's rings, as the pass was made: its shaders are built around them. */
  private readonly rings: number;
  /** The widest blur in front of the focal plane the pass was made for, as a share of the frame's height. */
  private readonly nearReach: number;
  /** Texels either side of a tile its widest near blur is looked for over. */
  private readonly tileMargin: number;

  private readonly input = textureInput();
  private readonly depth = depthInput();
  private readonly focus = textureInput();
  private readonly focusPrevious = textureInput();
  private readonly prefiltered = textureInput();
  private readonly tiles = textureInput();
  private readonly gathered = textureInput();

  private readonly u = {
    /** Dioptres at the camera's near and far planes: depth runs linearly between them. */
    dioptreNear: floatUniform(10),
    dioptreFar: floatUniform(0.001),
    maxDioptre: floatUniform(1),
    heldDioptre: floatUniform(0),
    isAutoFocus: floatUniform(1),
    isSnapping: floatUniform(1),
    /** The share of the way each ease closes this frame. */
    settleShare: floatUniform(1),
    nearShare: floatUniform(1),
    farShare: floatUniform(1),
    nearPriority: floatUniform(0),
    /** The focus spot's radius in uv, x and y. */
    focusSpot: vec2Uniform(),
    sharpZone: floatUniform(0),
    /** Blur texels per dioptre of defocus past the sharp zone, the strength included. */
    texelsPerDioptre: floatUniform(0),
    /** The radii the blur levels off toward, in blur texels. */
    maxFar: floatUniform(1),
    maxNear: floatUniform(1),
    /** One blur texel in uv. */
    texel: vec2Uniform(),
    highlightThreshold: floatUniform(1),
    highlightGain: floatUniform(0),
  };

  private readonly focusTargets: [RenderTarget, RenderTarget];
  private readonly prefilterTarget: RenderTarget;
  private readonly tileTarget: RenderTarget;
  private readonly gatherTarget: RenderTarget;
  private focusIndex = 0;
  private hasFocus = false;
  private size = { width: 1, height: 1, rows: 1 };
  private hasWarnedNoDepth = false;
  private stillFrames = 0;

  private readonly focusQuad: QuadMesh;
  private readonly prefilterQuad: QuadMesh;
  private readonly tileQuad: QuadMesh;
  private readonly gatherQuad: QuadMesh;
  private readonly quad: QuadMesh;
  private readonly screenQuad: QuadMesh;

  constructor(
    /** The camera the scene is drawn with: its planes turn depth into distance, its projection sizes the blur. */
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
    this.nearReach = Math.max(this.options.maxNearBlur, 0);
    this.tileMargin = Math.max(
      1,
      Math.ceil(this.nearReach * Math.max(this.options.maxBlurRows, 1)),
    );

    const target = (
      name: string,
      filter: typeof NearestFilter | typeof LinearFilter,
    ) => {
      const made = new RenderTarget(1, 1, {
        type: HalfFloatType,
        depthBuffer: false,
        generateMipmaps: false,
        magFilter: filter,
        minFilter: filter,
      });
      made.texture.name = name;
      return made;
    };
    this.focusTargets = [
      target("DepthOfField.focus0", NearestFilter),
      target("DepthOfField.focus1", NearestFilter),
    ];
    this.prefilterTarget = target("DepthOfField.prefiltered", LinearFilter);
    this.tileTarget = target("DepthOfField.tiles", NearestFilter);
    this.gatherTarget = target("DepthOfField.gathered", LinearFilter);
    this.focus.value = this.focusTargets[0].texture;
    this.focusPrevious.value = this.focusTargets[1].texture;
    this.prefiltered.value = this.prefilterTarget.texture;
    this.tiles.value = this.tileTarget.texture;
    this.gathered.value = this.gatherTarget.texture;

    this.focusQuad = stage("DepthOfField.focus", () => this.focusState());
    this.prefilterQuad = stage("DepthOfField.prefilter", () =>
      this.prefilter(),
    );
    this.tileQuad = stage("DepthOfField.tiles", () => this.nearReachOfTile());
    this.gatherQuad = stage("DepthOfField.gather", () => this.gather());
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

  /** A radius that grows as `radius` and levels off toward `limit`, with no corner where it does. */
  private leveled(radius: FloatNode, limit: FloatNode): FloatNode {
    const ratio = radius.div(limit);
    const quad = ratio.mul(ratio).mul(ratio).mul(ratio);
    return radius.div(sqrt(sqrt(quad.add(1)))) as unknown as FloatNode;
  }

  /**
   * A stored depth as a signed blur radius in blur texels: under 0 in
   * front of the focal plane, over 0 behind it. Depth runs linearly in
   * dioptres between the camera's planes; the radius is the thin lens's,
   * coming in smoothly over the sharp zone and levelling off at the caps.
   */
  private blurRadius(depth: FloatNode, focus: FloatNode): FloatNode {
    const u = this.u;
    const defocus = focus.sub(mix(u.dioptreNear, u.dioptreFar, depth));
    const eased = sqrt(
      defocus.mul(defocus).add(u.sharpZone.mul(u.sharpZone)),
    ).sub(u.sharpZone);
    const radius = eased.mul(u.texelsPerDioptre) as unknown as FloatNode;
    return select(
      defocus.greaterThan(0),
      this.leveled(radius, u.maxFar),
      this.leveled(radius, u.maxNear).negate(),
    ) as unknown as FloatNode;
  }

  private depthAt(uv: Vec2Node): FloatNode {
    return (this.depth.sample(uv).level(float(0)) as unknown as Vec4Node).r;
  }

  /** The prefiltered frame at a uv, readable inside a branch. */
  private prefilteredAt(uv: Vec2Node): Vec4Node {
    return this.prefiltered.sample(uv).level(float(0)) as unknown as Vec4Node;
  }

  /**
   * One texel: the focus in dioptres, the settled target it follows, and
   * the raw target under the centre. The target is the focus spot's
   * surfaces, each weighed by where it sits in the spot and how near it
   * is, smoothed a moment; the focus eases onto that, by one share toward
   * a nearer subject and another back out. Neither can overshoot.
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
    const settled = mix(previous.y, target, u.settleShare).toVar("dofSettled");
    const share = select(
      settled.greaterThan(previous.x),
      u.nearShare,
      u.farShare,
    );
    const focus = clamp(mix(previous.x, settled, share), 0, u.maxDioptre);
    // Selected, never mixed: a buffer nothing has drawn may hold anything.
    const isSnapping = u.isSnapping.greaterThan(0.5);
    return vec4(
      select(isSnapping, target, focus),
      select(isSnapping, target, settled),
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

  /**
   * One texel a tile: the widest blur in front of the focal plane, in blur
   * texels, on the tile or within reach of it. A texel of the tile gathers
   * that far for surfaces spreading over it, and no further.
   */
  private nearReachOfTile(): Vec4Node {
    const u = this.u;
    const span = TILE + this.tileMargin * 2;
    const corner = screenCoordinate.xy
      .floor()
      .mul(TILE)
      .sub(this.tileMargin)
      .toVar("dofTileCorner");
    const widest = float(0).toVar("dofWidest");
    const side = { start: 0, end: span, type: "int" } as const;
    Loop(side, side, ({ i, j }) => {
      const uv = corner
        .add(vec2(float(i), float(j)))
        .add(0.5)
        .mul(u.texel);
      widest.assign(
        max(widest, this.prefilteredAt(uv as unknown as Vec2Node).a.negate()),
      );
    });
    return vec4(min(widest, u.maxNear), 0, 0, 1) as unknown as Vec4Node;
  }

  /** How much more a colour weighs in a blur than a dim one: 1, or more for a highlight. */
  private highlight(rgb: Vec3Node): FloatNode {
    const u = this.u;
    return smoothstep(u.highlightThreshold, 1, luminance(rgb))
      .mul(u.highlightGain)
      .add(1);
  }

  /**
   * The blur, in two layers.
   *
   * Behind the focal plane a texel gathers a disc of its own radius: a tap
   * counts by the smaller of its radius and the texel's, so nothing sharp,
   * and nothing in front, bleeds into the blur behind it.
   *
   * In front of the plane a tap spreads over every texel its radius
   * reaches, sharp ones included, by the share of its disc that one tap
   * stands for. Those shares add up to the texel's coverage: the alpha the
   * blurred surface lands over the rest with, a half at its true edge. A
   * texel of the blurred surface itself shows, through what its coverage
   * leaves, the scene beside the surface: what lies behind it was never
   * drawn.
   *
   * Each texel turns its kernel by a noise of its own, so the gaps between
   * taps fall in a different place on every texel and the combine's filter
   * closes them. A texel nothing blurs takes neither loop.
   */
  private gather(): Vec4Node {
    const u = this.u;
    const rings = this.rings;
    const center = this.prefilteredAt(screenUV).toVar("dofCenter");
    const reach = (
      this.tiles.sample(screenUV).level(float(0)) as unknown as Vec4Node
    ).r.toVar("dofReach");
    const turn = interleavedGradientNoise(screenCoordinate.xy).mul(Math.PI * 2);
    const turnCos = cos(turn).toVar("dofTurnCos");
    const turnSin = sin(turn).toVar("dofTurnSin");
    /** A kernel tap's offset in uv, turned, at `radius` blur texels. */
    const offset = (tap: KernelTap, radius: FloatNode) =>
      vec2(
        turnCos.mul(tap.x).sub(turnSin.mul(tap.y)),
        turnSin.mul(tap.x).add(turnCos.mul(tap.y)),
      )
        .mul(radius)
        .mul(u.texel);
    /** 0..1 as a blur of radius `radius` grows across a ring `distance` out, rings `spacing` apart. */
    const reaches = (
      radius: FloatNode,
      distance: FloatNode,
      spacing: FloatNode,
    ) => clamp(radius.sub(distance).div(spacing).add(0.5), 0, 1);
    const spreads = (near: FloatNode) =>
      smoothstep(NEAR_SPREAD_FROM, NEAR_SPREAD_TO, near);

    const centerLight = this.highlight(center.rgb).toVar("dofCenterLight");

    // Behind the focal plane.
    const farRadius = max(center.a, 0).toVar("dofFarRadius");
    const behind = vec4(center.rgb, 1).mul(centerLight).toVar("dofBehind");
    If(farRadius.greaterThan(FAR_BLEND_FROM), () => {
      const spacing = farRadius.div(rings + 0.5).toVar("dofFarSpacing");
      for (const [index, tap] of this.kernel.entries()) {
        const sample = this.prefilteredAt(
          screenUV.add(offset(tap, farRadius)) as unknown as Vec2Node,
        ).toVar(`dofFar${index}`);
        const radius = max(min(center.a, sample.a), 0);
        const weight = reaches(radius, farRadius.mul(tap.reach), spacing).mul(
          this.highlight(sample.rgb),
        );
        behind.addAssign(vec4(sample.rgb, 1).mul(weight));
      }
    });

    // In front of it.
    const front = vec4(0).toVar("dofFront");
    const beside = vec4(0).toVar("dofBeside");
    const coverage = float(0).toVar("dofCoverage");
    const centerNear = max(center.a.negate(), 0).toVar("dofCenterNear");
    If(reach.greaterThan(NEAR_SPREAD_FROM), () => {
      const spacing = reach.div(rings + 0.5).toVar("dofNearSpacing");
      // The centre stands for a disc half a spacing wide; a wider blur
      // lands only that share of itself here.
      const centerShare = min(
        spacing.div(max(centerNear, 1e-3)).mul(0.5).pow(2),
        1,
      ).mul(spreads(centerNear));
      front.addAssign(vec4(center.rgb, 1).mul(centerLight.mul(centerShare)));
      coverage.addAssign(centerShare);
      for (const [index, tap] of this.kernel.entries()) {
        const sample = this.prefilteredAt(
          screenUV.add(offset(tap, reach)) as unknown as Vec2Node,
        ).toVar(`dofNear${index}`);
        const near = max(sample.a.negate(), 0);
        const spread = spreads(near);
        // A ring tap stands for 2/7 of a spacing squared, over the blur's disc.
        const share = reaches(near, reach.mul(tap.reach), spacing)
          .mul(spacing.div(max(near, spacing.mul(0.5))).pow(2))
          .mul(2 / RING_TAPS)
          .mul(spread);
        front.addAssign(
          vec4(sample.rgb, 1).mul(share.mul(this.highlight(sample.rgb))),
        );
        coverage.addAssign(share);
        // What stands beside the blurred surface, the nearer taps first.
        beside.addAssign(
          vec4(sample.rgb, 1).mul(spread.oneMinus().div(tap.reach)),
        );
      }
    });

    const alpha = clamp(coverage, 0, 1).toVar("dofAlpha");
    const behindColor = mix(
      behind.rgb.div(behind.a),
      beside.rgb.div(max(beside.a, 1e-4)),
      spreads(centerNear).mul(smoothstep(0, 1, beside.a)),
    );
    const frontColor = front.rgb.div(max(front.a, 1e-4));
    return vec4(
      mix(behindColor, frontColor, alpha),
      alpha,
    ) as unknown as Vec4Node;
  }

  /**
   * The blur over the sharp frame. A pixel nothing blurs is the frame's
   * own. Elsewhere the gathered blur is read through four taps that close
   * the gaps its kernel left, each counted by how close its blur is to the
   * pixel's own (read at the frame's size, so a sharp edge stays one), and
   * the frame's own detail is put back by what stays sharp: all of it in
   * focus and uncovered, none of it where the pixel is blurred.
   */
  private combine(toScreen: boolean): Vec4Node {
    const u = this.u;
    const focus = (this.focus.sample(vec2(0.5)) as unknown as Vec4Node).x;
    const color = this.input.sample(screenUV) as unknown as Vec4Node;
    const radius = this.blurRadius(this.depthAt(screenUV), focus).toVar(
      "dofOwnRadius",
    );
    const far = smoothstep(FAR_BLEND_FROM, FAR_BLEND_TO, radius).toVar(
      "dofFar",
    );
    const near = smoothstep(
      NEAR_SPREAD_FROM,
      NEAR_SPREAD_TO,
      radius.negate(),
    ).toVar("dofNear");
    const reach = (
      this.tiles.sample(screenUV).level(float(0)) as unknown as Vec4Node
    ).r;
    const result = color.rgb.toVar("dofResult");
    If(far.add(near).add(reach).greaterThan(0), () => {
      const blurred = vec4(0).toVar("dofBlurred");
      const plain = vec3(0).toVar("dofPlain");
      const weight = float(0).toVar("dofWeight");
      for (const [x, y] of [
        [-0.5, -0.5],
        [0.5, -0.5],
        [-0.5, 0.5],
        [0.5, 0.5],
      ] as const) {
        const uv = screenUV.add(vec2(x, y).mul(u.texel)) as unknown as Vec2Node;
        const low = this.prefilteredAt(uv);
        const w = float(1).div(abs(low.a.sub(radius)).add(1));
        blurred.addAssign(
          (this.gathered.sample(uv).level(float(0)) as unknown as Vec4Node).mul(
            w,
          ),
        );
        plain.addAssign(low.rgb.mul(w));
        weight.addAssign(w);
      }
      blurred.divAssign(weight);
      plain.divAssign(weight);
      const sharp = far
        .oneMinus()
        .mul(near.oneMinus())
        .mul(blurred.a.oneMinus());
      result.assign(blurred.rgb.add(color.rgb.sub(plain).mul(sharp)));
    });
    return vec4(
      toScreen ? linearToSrgb(result) : result,
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
    const step = Math.max(delta, 0);
    u.settleShare.value = easeShare(step, o.focusSettleSeconds);
    u.nearShare.value = easeShare(step, o.focusNearSeconds);
    u.farShare.value = easeShare(step, o.focusFarSeconds);
    u.nearPriority.value = Math.min(Math.max(o.nearPriority, 0), 1);
    u.focusSpot.value.set(
      (o.focusSpot * this.size.height) / this.size.width,
      o.focusSpot,
    );
    u.sharpZone.value = Math.max(o.sharpZone, 0);
    // The projection's [1][1] is 1 / tan(half the vertical field of view).
    const projectionScale = Math.abs(this.camera.projectionMatrix.elements[5]);
    u.texelsPerDioptre.value =
      blurShare(
        1,
        Math.max(o.strength, 0) * Math.max(o.aperture, 0),
        0,
        projectionScale,
      ) * rows;
    u.maxFar.value = Math.max(o.maxFarBlur * rows, 1e-3);
    u.maxNear.value = Math.max(
      Math.min(o.maxNearBlur, this.nearReach) * rows,
      1e-3,
    );
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

    renderer.setRenderTarget(this.prefilterTarget);
    if (!drew(renderer, () => this.prefilterQuad.render(renderer)))
      return false;
    renderer.setRenderTarget(this.tileTarget);
    if (!drew(renderer, () => this.tileQuad.render(renderer))) return false;
    renderer.setRenderTarget(this.gatherTarget);
    if (!drew(renderer, () => this.gatherQuad.render(renderer))) return false;

    renderer.setRenderTarget(output);
    const quad = output ? this.quad : this.screenQuad;
    return drew(renderer, () => quad.render(renderer));
  }

  setSize(width: number, height: number) {
    const divisor = blurDivisor(height, this.options.maxBlurRows);
    const blurWidth = Math.max(1, Math.round(width / divisor));
    const rows = Math.max(1, Math.round(height / divisor));
    this.size = { width, height, rows };
    this.prefilterTarget.setSize(blurWidth, rows);
    this.gatherTarget.setSize(blurWidth, rows);
    this.tileTarget.setSize(
      Math.ceil(blurWidth / TILE),
      Math.ceil(rows / TILE),
    );
    this.u.texel.value.set(1 / blurWidth, 1 / rows);
  }

  dispose() {
    for (const target of [
      ...this.focusTargets,
      this.prefilterTarget,
      this.tileTarget,
      this.gatherTarget,
    ]) {
      target.dispose();
    }
    for (const quad of [
      this.focusQuad,
      this.prefilterQuad,
      this.tileQuad,
      this.gatherQuad,
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
