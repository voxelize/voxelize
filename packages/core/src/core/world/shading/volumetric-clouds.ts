import {
  Data3DTexture,
  NoBlending,
  NodeMaterial,
  NormalBlending,
  Vector2,
  Vector3,
  Vector4,
} from "three/webgpu";
import {
  abs,
  Break,
  cameraFar,
  cameraNear,
  cameraPosition,
  cameraProjectionMatrixInverse,
  cameraWorldMatrix,
  clamp,
  Discard,
  dot,
  exp,
  float,
  floor,
  fract,
  Fn,
  If,
  int,
  ivec2,
  length,
  Loop,
  mat3,
  max,
  min,
  mix,
  normalize,
  positionGeometry,
  pow,
  screenCoordinate,
  screenUV,
  select,
  sign,
  smoothstep,
  texture3D,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

import { perspectiveDepthToViewZ } from "./conventions";
import { skyFog, type SkyFogInputs } from "./sky-fog";
import type {
  BoolNode,
  FloatNode,
  IntNode,
  IVec2Node,
  Vec2Node,
  Vec3Node,
  Vec4Node,
} from "./types";
import { ownUniform, textureSlot, uniformArray } from "./uniforms";

export const VOLUMETRIC_CLOUD_MAX_LAYERS = 2;
const VOXEL_STEPS = 256;
const SOFT_STEPS = 64;

/** What a volumetric deck reads from the classic deck and the world. */
export type VolumetricCloudsSharedInputs = {
  /** The deck's atmosphere: the world's sky fog at the deck's own range. */
  atmosphere: SkyFogInputs;
  cloudColor: Vec3Node;
  sideShade: FloatNode;
  bottomShade: FloatNode;
  fogDistanceScale: FloatNode;
  sunDirection: Vec3Node;
  sunColor: Vec3Node;
  sunlightIntensity: FloatNode;
};

const layerVectors = (fill: () => Vector4) =>
  Array.from({ length: VOLUMETRIC_CLOUD_MAX_LAYERS }, fill);

/** The deck's own uniforms, written by `VolumetricClouds`. */
/** A one-texel volume the noise slot holds until the worker's lands. */
function placeholderVolume(): Data3DTexture {
  const volume = new Data3DTexture(new Uint8Array(4), 1, 1, 1);
  volume.needsUpdate = true;
  return volume;
}

export function createVolumetricCloudUniforms() {
  const noise = texture3D(placeholderVolume());
  // Each deck's own volume: never merged with another slot's binding.
  noise.mergeable = false;
  return {
    noise,
    noiseSize: ownUniform(new Vector3(1, 1, 1)),
    sceneDepth: textureSlot("depth"),
    sceneDepthReady: ownUniform(0),
    /**
     * The see-through layers (glass, portals, water, particles) composite
     * over the scene in one pass, and nothing records where they stand, so
     * a deck drawn after them would paint over a pane in front of it. With
     * them in view the deck draws in two halves split at their distance: 1
     * marches the part behind them, under their composite; 2 the part in
     * front, over it; 0 marches the whole ray. The split comes from the
     * accumulation's weight target: its alpha-weighted sum (r) and that sum
     * times each layer's view depth (g).
     */
    blendedSplit: ownUniform(0),
    blendedLayers: textureSlot("float"),
    /**
     * The deck marched at half the frame's size this frame (premultiplied
     * colour and alpha), and whether it was: see
     * {@link createVolumetricCloudCoarseMaterial}.
     */
    coarse: textureSlot("float"),
    coarseReady: ownUniform(0),
    coarseSize: ownUniform(new Vector2(1, 1)),
    /**
     * When a pixel takes the half-size march's blend instead of marching:
     * its four neighbours there must end within `x` of its own reach (a
     * share of it, plus `COARSE_REACH_SLACK` blocks: the same sky, or the
     * same slope), and their premultiplied colours must all lie within the
     * contrast `y` of each other, their alphas within `y` (open sky, the
     * inside of a face). Past either the pixel is on an outline, a crease
     * or where the land cuts the deck, and marches for itself, so `y` is
     * the most a blend is off by: at 0.04, under two levels of 255 on screen.
     */
    coarseTolerance: ownUniform(new Vector2(0.02, 0.04)),
    /** The size of the frame the deck draws into, in pixels. */
    frameSize: ownUniform(new Vector2(1, 1)),
    /** 0: voxel (each texel of the volume is a cloud cube), 1: soft. */
    style: ownUniform(0),
    maxDistance: ownUniform(2400),
    fadeStart: ownUniform(1200),
    layerCount: ownUniform(0),
    /** bottom, top, coverage, extinction per block at full density */
    layerSpan: uniformArray(layerVectors(() => new Vector4()), "vec4"),
    /** cell size in blocks (x, y, z), coverage scale in tiles */
    layerCell: uniformArray(layerVectors(() => new Vector4(1, 1, 1, 1)), "vec4"),
    /** bottom rounding, top rounding, shade floor, noise offset */
    layerShape: uniformArray(layerVectors(() => new Vector4()), "vec4"),
    /**
     * The slab's drift, wrapped on the CPU so it stays small at any clock:
     * the cell grid's shift within one cell (x, z), in xy. A raw drift is
     * the shared clock times the speed, far past what a float32 can step
     * smoothly.
     */
    layerGridShift: uniformArray(layerVectors(() => new Vector4()), "vec4"),
    /** The detail noise's and the coverage map's shifts, each in its own tiles (x, z, x, z). */
    layerNoiseShift: uniformArray(layerVectors(() => new Vector4()), "vec4"),
  };
}

export type VolumetricCloudUniforms = ReturnType<
  typeof createVolumetricCloudUniforms
>;

/** Blocks of slack on a half-size neighbour's reach (`coarseTolerance.x`). */
const COARSE_REACH_SLACK = 0.5;
/** The level under which two premultiplied colours count as one. */
const COARSE_DARKEST = 0.004;

/**
 * Clouds marched through a tileable noise volume, drawn as one screen
 * triangle. See `VolumetricClouds`.
 *
 * `"frame"` is the deck's draw into the frame. With the half-size march
 * ready (`coarseReady`), a pixel whose four neighbours there agree takes
 * their blend and marches nothing; a pixel on a cloud's outline, on a
 * crease between two faces, where the land cuts the deck or under a
 * see-through layer marches its own ray, exactly as it does with no
 * half-size march at all. `"coarse"` is that half-size march: every texel
 * marched as the frame pixel under its centre would be, written
 * premultiplied.
 */
function createCloudMaterial(
  u: VolumetricCloudUniforms,
  shared: VolumetricCloudsSharedInputs,
  mode: "frame" | "coarse",
): NodeMaterial {
  const vec4At = (array: typeof u.layerSpan, i: IntNode) =>
    array.element(i) as unknown as Vec4Node;
  const isSoft = u.style.greaterThan(0.5);

  /**
   * Density at p. `stepped` makes the voxel style's cells all-or-nothing,
   * for deciding where a cube stands; unstepped, the filtered field is
   * smooth, for light, which must never see the cell grid.
   */
  const layerDensity = (i: IntNode, p: Vec3Node, stepped: boolean): FloatNode => {
    const span = vec4At(u.layerSpan, i);
    const cell = vec4At(u.layerCell, i);
    const shape = vec4At(u.layerShape, i);
    const shift = vec4At(u.layerNoiseShift, i);
    const h = p.y.sub(span.x).div(span.y.sub(span.x));
    const q = vec3(p.x, p.y.sub(span.x), p.z).div(cell.xyz);
    // Whole-texel offset, so voxel cell centres stay on texel centres.
    const still = q
      .add(vec3(shape.w, 0, floor(shape.w.mul(1.7))))
      .div(u.noiseSize);
    // Explicit level: the march runs in divergent control flow.
    const n = u.noise
      .sample(still.add(vec3(shift.x, 0, shift.y)))
      .level(float(0));
    const coverageMap = u.noise
      .sample(
        vec3(
          still.x.div(cell.w).add(shift.z).add(0.31),
          0.5,
          still.z.div(cell.w).add(shift.w).add(0.17),
        ),
      )
      .level(float(0)).b;
    // Rounded underside and top, so a bank is a billow and not a slab.
    const profile = smoothstep(0, shape.x, h).mul(
      smoothstep(shape.y.oneMinus(), 1, h).oneMinus(),
    );
    const coverage = clamp(span.z.mul(coverageMap.mul(1.5).add(0.25)), 0, 1);
    const raw = clamp(
      n.r.mul(profile).sub(coverage.oneMinus()).div(max(coverage, 1e-3)),
      0,
      1,
    );
    // The soft style frays its edges with the finer cells.
    const frayed = clamp(raw.sub(n.g.oneMinus().mul(0.35).mul(raw.oneMinus())), 0, 1);
    const d = stepped
      ? select(isSoft, frayed, select(raw.greaterThan(0.06), float(1), float(0)))
      : select(isSoft, frayed, raw);
    const isInside = h.greaterThanEqual(0).and(h.lessThanEqual(1));
    return select(isInside, d.mul(span.w), float(0));
  };

  const henyeyGreenstein = (cosTheta: FloatNode, g: number): FloatNode =>
    float(1 - g * g).div(
      pow(float(1 + g * g).sub(cosTheta.mul(2 * g)), 1.5).mul(12.566),
    );

  const toSun = normalize(shared.sunDirection);
  const topTint = shared.atmosphere.skyFogTopColor;
  const skyTint = topTint.div(max(max(topTint.r, max(topTint.g, topTint.b)), 1e-3));
  const shadowColor = mix(vec3(1), skyTint, 0.12).mul(0.9);

  /**
   * How much sun reaches p through the cloud toward it, through the smooth
   * field so the shadow falls in gradients, not cell by cell.
   */
  const sunVisibility = (i: IntNode, p: Vec3Node): FloatNode => {
    const stepLength = max(vec4At(u.layerCell, i).y, 3);
    let opticalDepth: FloatNode = float(0);
    for (let k = 1; k <= 4; k++) {
      const along = stepLength.mul(k * k * 0.75);
      opticalDepth = opticalDepth.add(
        layerDensity(i, p.add(toSun.mul(along)), false).mul(
          stepLength.mul((2 * k - 1) * 0.75),
        ),
      );
    }
    return exp(opticalDepth.mul(-0.5));
  };

  /**
   * Light leaving a cloud at p toward the eye. `thickness` is the optical
   * depth of the cloud around p: thin cloud lets the sun through.
   */
  const cloudLight = (
    i: IntNode,
    p: Vec3Node,
    normal: Vec3Node,
    hasNormal: FloatNode,
    rd: Vec3Node,
    thickness: FloatNode,
  ): Vec3Node => {
    const span = vec4At(u.layerSpan, i);
    const h = clamp(p.y.sub(span.x).div(span.y.sub(span.x)), 0, 1);
    // A whisper of the cube's faces, so the outline reads as voxels; the
    // light across a face is what carries the volume.
    const face = select(
      normal.y.greaterThan(0.5),
      float(1),
      select(normal.y.lessThan(-0.5), shared.bottomShade, shared.sideShade),
    );
    const shade = select(hasNormal.greaterThan(0.5), mix(1, face, 0.3), float(1));
    // Skylight falls on the tops; the underside of a thick bank is greyer.
    const ambient = mix(vec4At(u.layerShape, i).z, 1, smoothstep(0, 1, h));
    const sunVis = select(
      toSun.y.greaterThan(-0.05),
      sunVisibility(i, p.add(normal.mul(hasNormal))),
      float(0),
    ).toVar();
    const facing = select(
      hasNormal.greaterThan(0.5),
      dot(normal, toSun).mul(0.5).add(0.5),
      float(0.75),
    );
    const direct = sunVis.mul(mix(0.5, 1, facing));
    // What the sun does not reach is lit by the sky above: a touch cooler,
    // barely darker. Fair-weather cloud stays white underneath; a deep grey
    // underside reads as rain on the way.
    const lit = mix(shadowColor, vec3(1), direct).mul(ambient).mul(shade);
    const sunLight = shared.sunColor
      .mul(shared.sunlightIntensity)
      .mul(shared.atmosphere.directSunlight);
    const cosTheta = dot(rd, toSun);
    // Sun shining through: a cloud between the eye and the sun glows, the
    // thinner the brighter, and its sunlit rim silvers.
    const through = henyeyGreenstein(cosTheta, 0.72).mul(exp(thickness.mul(-0.45)));
    const rim = henyeyGreenstein(cosTheta, 0.5).mul(sunVis);
    return shared.cloudColor
      .mul(lit)
      .add(sunLight.mul(through.mul(0.55).add(rim.mul(0.3))));
  };

  type MarchState = {
    color: Vec3Node;
    transmittance: FloatNode;
    weightedDistance: FloatNode;
  };

  /**
   * Voxel style: the cells decide where cloud stands, so the outline is
   * cubes; each surface the ray meets is lit and made see-through from the
   * smooth field, so no cell edge shows across a face.
   */
  const marchVoxel = (
    i: IntNode,
    ro: Vec3Node,
    rd: Vec3Node,
    t0: FloatNode,
    t1: FloatNode,
    resumed: BoolNode,
    s: MarchState,
  ) => {
    const span = vec4At(u.layerSpan, i);
    const cell = vec4At(u.layerCell, i).xyz.toVar();
    const gridShift = vec4At(u.layerGridShift, i);
    const origin = vec3(gridShift.x.negate(), span.x, gridShift.y.negate()).toVar();

    const og = ro.sub(origin).div(cell);
    const dg = rd.div(cell);
    const safeDg = sign(dg).mul(max(abs(dg), vec3(1e-6))).toVar();
    const stepSign = sign(safeDg).toVar();

    const t = float(t0).toVar();
    const idx = floor(og.add(dg.mul(t.add(1e-3)))).toVar();
    const tDelta = abs(vec3(1).div(safeDg)).toVar();
    const nextBoundary = idx.add(max(stepSign, 0)).sub(og).div(safeDg).toVar();

    const normal = vec3(0, sign(rd.y).negate(), 0).toVar();
    const hasNormal = select(t0.greaterThan(0), float(1), float(0)).toVar();

    // Whether the cell `idx` holds cloud: `layerDensity(centre, stepped)`
    // above zero, with what holds for the whole march worked out once, and
    // the coverage map read only where the noise could reach it. A step
    // through open air is most of a march, and this is all it does.
    const shape = vec4At(u.layerShape, i).toVar();
    const noiseShift = vec4At(u.layerNoiseShift, i).toVar();
    const coverageScale = vec4At(u.layerCell, i).w.toVar();
    const coverageAmount = span.z.toVar();
    // Cell index to noise texel, less the half cell: the grid's drift
    // within a cell, and the layer's own whole-texel offset.
    const texelBias = vec3(
      gridShift.x.negate().div(cell.x).add(shape.w).add(0.5),
      0.5,
      gridShift.y.negate().div(cell.z).add(floor(shape.w.mul(1.7))).add(0.5),
    ).toVar();
    const heightStep = cell.y.div(span.y.sub(span.x)).toVar();
    // No coverage lifts noise at or under this into cloud: `raw` is above
    // zero only where the noise beats one less the coverage, and coverage
    // tops out at 1.75 of the layer's amount.
    const noiseFloor = clamp(coverageAmount.mul(1.75), 0, 1).oneMinus().toVar();
    const isCloudyAt = (cellIndex: Vec3Node): BoolNode => {
      const cloudy = float(0).toVar();
      const h = cellIndex.y.add(0.5).mul(heightStep);
      If(h.greaterThanEqual(0).and(h.lessThanEqual(1)), () => {
        const still = cellIndex.add(texelBias).div(u.noiseSize).toVar();
        const noise = u.noise
          .sample(still.add(vec3(noiseShift.x, 0, noiseShift.y)))
          .level(float(0)).r;
        const profile = smoothstep(0, shape.x, h).mul(
          smoothstep(shape.y.oneMinus(), 1, h).oneMinus(),
        );
        const shaped = noise.mul(profile).toVar();
        If(shaped.greaterThan(noiseFloor), () => {
          const coverageMap = u.noise
            .sample(
              vec3(
                still.x.div(coverageScale).add(noiseShift.z).add(0.31),
                0.5,
                still.z.div(coverageScale).add(noiseShift.w).add(0.17),
              ),
            )
            .level(float(0)).b;
          const coverage = clamp(
            coverageAmount.mul(coverageMap.mul(1.5).add(0.25)),
            0,
            1,
          );
          const raw = clamp(
            shaped.sub(coverage.oneMinus()).div(max(coverage, 1e-3)),
            0,
            1,
          );
          cloudy.assign(select(raw.greaterThan(0.06), float(1), float(0)));
        });
      });
      return cloudy.greaterThan(0.5);
    };

    // A march that picks up where the front half stopped, inside a bank,
    // goes on through its mist instead of meeting a face at the split.
    const wasCloudy = resumed.and(isCloudyAt(idx)).toVar();
    const probe = min(cell.x, cell.y);

    Loop(VOXEL_STEPS, () => {
      const cloudy = isCloudyAt(idx).toVar();

      // Only where the ray comes out of open air into cloud: the walls
      // between two cloudy cells are inside it.
      If(cloudy.and(wasCloudy.not()), () => {
        const p = ro.add(rd.mul(t)).toVar();
        const thickness = layerDensity(i, p.add(rd.mul(probe)), false)
          .add(layerDensity(i, p.add(rd.mul(probe.mul(2.5))), false))
          .add(layerDensity(i, p.add(rd.mul(probe.mul(5))), false))
          .mul(probe)
          .mul(1.7)
          .toVar();
        // The outline stays a crisp cube: even a thin edge is mostly
        // opaque, and only a little of what is behind it shows through. A
        // face right at the eye (walking into a bank) fades in, so the
        // cloud closes around you as mist instead of a wall.
        const alpha = mix(0.8, 1, exp(thickness.negate()).oneMinus())
          .mul(smoothstep(1, 28, t))
          .toVar();
        const absorbed = s.transmittance.mul(alpha);
        s.color.addAssign(
          absorbed.mul(cloudLight(i, p, normal, hasNormal, rd, thickness)),
        );
        s.weightedDistance.addAssign(absorbed.mul(t));
        s.transmittance.mulAssign(alpha.oneMinus());
      });
      If(s.transmittance.lessThan(0.01), () => {
        Break();
      });
      const tExit = min(min(nextBoundary.x, nextBoundary.y), nextBoundary.z).toVar();

      // Inside the cloud the air is mist: thick, but seen through for a few
      // dozen blocks. Lit by the sky alone, which is cheap and close enough
      // in the grey of a cloud's interior.
      If(cloudy.and(wasCloudy), () => {
        const segment = min(tExit, t1).sub(t);
        const p = ro.add(rd.mul(t.add(segment.mul(0.5))));
        const mist = exp(segment.mul(-0.03)).oneMinus().toVar();
        const h = clamp(p.y.sub(span.x).div(span.y.sub(span.x)), 0, 1);
        const mistColor = shared.cloudColor.mul(mix(shadowColor, vec3(0.97), h));
        const absorbed = s.transmittance.mul(mist);
        s.color.addAssign(absorbed.mul(mistColor));
        s.weightedDistance.addAssign(absorbed.mul(t.add(segment.mul(0.5))));
        s.transmittance.mulAssign(mist.oneMinus());
      });
      If(s.transmittance.lessThan(0.01), () => {
        Break();
      });
      wasCloudy.assign(cloudy);

      t.assign(tExit);
      If(t.greaterThanEqual(t1), () => {
        Break();
      });

      hasNormal.assign(1);
      If(
        nextBoundary.x
          .lessThanEqual(nextBoundary.y)
          .and(nextBoundary.x.lessThanEqual(nextBoundary.z)),
        () => {
          idx.x.addAssign(stepSign.x);
          nextBoundary.x.addAssign(tDelta.x);
          normal.assign(vec3(stepSign.x.negate(), 0, 0));
        },
      )
        .ElseIf(nextBoundary.y.lessThanEqual(nextBoundary.z), () => {
          idx.y.addAssign(stepSign.y);
          nextBoundary.y.addAssign(tDelta.y);
          normal.assign(vec3(0, stepSign.y.negate(), 0));
        })
        .Else(() => {
          idx.z.addAssign(stepSign.z);
          nextBoundary.z.addAssign(tDelta.z);
          normal.assign(vec3(0, 0, stepSign.z.negate()));
        });
    });
  };

  const marchSoft = (
    i: IntNode,
    ro: Vec3Node,
    rd: Vec3Node,
    t0: FloatNode,
    t1: FloatNode,
    jitter: FloatNode,
    s: MarchState,
  ) => {
    const stepLength = max(t1.sub(t0).div(SOFT_STEPS), 2).toVar();
    const t = t0.add(stepLength.mul(jitter)).toVar();
    Loop(SOFT_STEPS, () => {
      If(t.greaterThanEqual(t1), () => {
        Break();
      });
      const p = ro.add(rd.mul(t)).toVar();
      const d = layerDensity(i, p, false).toVar();
      If(d.greaterThan(0), () => {
        const sampleTransmit = exp(d.negate().mul(stepLength)).toVar();
        const absorbed = s.transmittance.mul(sampleTransmit.oneMinus());
        s.color.addAssign(
          absorbed.mul(
            cloudLight(i, p, vec3(0), float(0), rd, d.mul(stepLength).mul(4)),
          ),
        );
        s.weightedDistance.addAssign(absorbed.mul(t));
        s.transmittance.mulAssign(sampleTransmit);
      });
      If(s.transmittance.lessThan(0.01), () => {
        Break();
      });
      t.addAssign(stepLength);
    });
  };

  const layerSegment = (
    i: IntNode,
    ro: Vec3Node,
    rd: Vec3Node,
    start: FloatNode,
    limit: FloatNode,
  ) => {
    const span = vec4At(u.layerSpan, i);
    const inv = float(1).div(select(abs(rd.y).greaterThan(1e-5), rd.y, float(1e-5)));
    const ta = span.x.sub(ro.y).mul(inv);
    const tb = span.y.sub(ro.y).mul(inv);
    return vec2(max(min(ta, tb), start), min(max(ta, tb), limit));
  };

  // One triangle covering the screen; the ray through each pixel is
  // rebuilt from the camera instead of rasterized from geometry.
  const viewFar = cameraProjectionMatrixInverse.mul(vec4(positionGeometry.xy, 1, 1));
  const viewRayVertex = viewFar.xyz.div(viewFar.w);
  const vRay = varying(mat3(cameraWorldMatrix).mul(viewRayVertex), "vCloudRay");
  const vViewRay = varying(viewRayVertex, "vCloudViewRay");

  const fog = skyFog(shared.atmosphere);

  /** View depth along a pixel's ray, as a distance; `maxDistance` for sky. */
  const reachAt = (uv: Vec2Node, alongRay: FloatNode): FloatNode => {
    const z = u.sceneDepth.sample(uv).level(float(0)).r;
    return select(
      u.sceneDepthReady.greaterThan(0.5).and(z.lessThan(0.99999)),
      min(
        u.maxDistance,
        perspectiveDepthToViewZ(z, cameraNear, cameraFar).div(alongRay),
      ),
      u.maxDistance,
    );
  };

  /**
   * The march of one ray from `start` to `limit`: straight colour and
   * alpha, fogged and faded as the frame takes them. Alpha 0: no cloud.
   */
  const marchRay = (
    ro: Vec3Node,
    rd: Vec3Node,
    start: FloatNode,
    limit: FloatNode,
  ): Vec4Node => {
    const out = vec4(0).toVar("cloudOut");
    // Interleaved gradient noise: steps start at a per-pixel offset so the
    // soft style's banding becomes a fine, fixed grain.
    const jitter = fract(
      fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715))).mul(52.9829189),
    );

    const state: MarchState = {
      color: vec3(0).toVar("cloudColor"),
      transmittance: float(1).toVar("cloudTransmittance"),
      weightedDistance: float(0).toVar("cloudWeightedDistance"),
    };

    // Front to back: the layer the ray reaches first composites first.
    const segA = select(
      u.layerCount.greaterThan(0.5),
      layerSegment(int(0), ro, rd, start, limit),
      vec2(1, 0),
    ).toVar("cloudSegA");
    const segB = select(
      u.layerCount.greaterThan(1.5),
      layerSegment(int(1), ro, rd, start, limit),
      vec2(1, 0),
    ).toVar("cloudSegB");
    const first = select(segB.x.lessThan(segA.x), int(1), int(0)).toVar("cloudFirst");

    Loop(VOLUMETRIC_CLOUD_MAX_LAYERS, ({ i: k }) => {
      const i = select(int(k).equal(0), first, int(1).sub(first)).toVar();
      const seg = select(i.equal(0), segA, segB).toVar();
      If(seg.x.lessThan(seg.y).and(state.transmittance.greaterThanEqual(0.01)), () => {
        If(isSoft, () => {
          marchSoft(i, ro, rd, seg.x, seg.y, jitter, state);
        }).Else(() => {
          marchVoxel(
            i,
            ro,
            rd,
            seg.x,
            seg.y,
            start.greaterThan(0).and(seg.x.lessThanEqual(start)),
            state,
          );
        });
      });
    });

    const alpha = state.transmittance.oneMinus().toVar("cloudAlpha");
    If(alpha.greaterThanEqual(0.003), () => {
      const meanDistance = state.weightedDistance.div(alpha);
      const worldPosition = ro.add(rd.mul(meanDistance)).toVar("cloudWorldPosition");
      const flatDistance = length(worldPosition.xz.sub(cameraPosition.xz)).div(
        max(shared.fogDistanceScale, 0.001),
      );
      const fogged = fog.apply(
        state.color.div(alpha),
        worldPosition,
        float(1),
        false,
        flatDistance,
        false,
      );
      const endFade = smoothstep(u.fadeStart, u.maxDistance, meanDistance);
      out.assign(
        vec4(
          fog.haze(fogged, rd, endFade, false),
          alpha.mul(endFade.oneMinus()),
        ),
      );
    });
    return out;
  };

  /**
   * Where the see-through layers stand along the ray of the frame pixel
   * `pixel`, as a distance; `fallback` where there are none.
   */
  const splitAt = (
    pixel: IVec2Node,
    alongRay: FloatNode,
    fallback: FloatNode,
  ) => {
    const layers = u.blendedLayers.load(pixel).rg;
    const hasLayers = layers.r.greaterThan(1e-6);
    return {
      hasLayers,
      distance: select(hasLayers, layers.g.div(layers.r).div(alongRay), fallback),
    };
  };

  const coarseFragment = Fn(() => {
    const ro = cameraPosition;
    const rd = normalize(vRay).toVar("cloudRd");
    const viewRay = normalize(vViewRay).toVar("cloudViewRay");
    const alongRay = max(viewRay.z.negate(), 1e-4);

    // The frame pixel under this texel's centre: its depth, its layers.
    const pixel = floor(screenCoordinate.xy.mul(u.frameSize).div(u.coarseSize)).toVar(
      "cloudPixel",
    );
    const limit = reachAt(pixel.add(0.5).div(u.frameSize), alongRay).toVar("cloudLimit");
    // The front half only: the half behind the layers marches in the frame.
    If(u.blendedSplit.greaterThan(1.5), () => {
      limit.assign(min(limit, splitAt(ivec2(pixel), alongRay, limit).distance));
    });
    const marched = marchRay(ro, rd, float(0), limit);
    return vec4(marched.rgb.mul(marched.a), marched.a);
  });

  const frameFragment = Fn(() => {
    const ro = cameraPosition;
    const rd = normalize(vRay).toVar("cloudRd");
    const viewRay = normalize(vViewRay).toVar("cloudViewRay");
    const alongRay = max(viewRay.z.negate(), 1e-4);

    const limit = reachAt(screenUV, alongRay).toVar("cloudLimit");
    const start = float(0).toVar("cloudStart");
    const hasLayers = float(0).toVar("cloudHasLayers");
    If(u.blendedSplit.greaterThan(0.5), () => {
      // Their mean view depth, weighted as the composite weighs them, as a
      // distance along this pixel's ray. None here: the front half is all.
      const split = splitAt(ivec2(screenCoordinate.xy), alongRay, limit);
      hasLayers.assign(select(split.hasLayers, float(1), float(0)));
      If(u.blendedSplit.lessThan(1.5), () => {
        start.assign(split.distance);
      }).Else(() => {
        limit.assign(min(limit, split.distance));
      });
    });
    // How far along this ray any slab reaches: land past it is as good as
    // sky, and a ray that ends before the first slab holds no cloud at all.
    const reachA = select(
      u.layerCount.greaterThan(0.5),
      layerSegment(int(0), ro, rd, start, u.maxDistance),
      vec2(1, 0),
    );
    const reachB = select(
      u.layerCount.greaterThan(1.5),
      layerSegment(int(1), ro, rd, start, u.maxDistance),
      vec2(1, 0),
    );
    const slabNear = min(
      select(reachA.x.lessThan(reachA.y), reachA.x, u.maxDistance),
      select(reachB.x.lessThan(reachB.y), reachB.x, u.maxDistance),
    ).toVar("cloudSlabNear");
    const slabFar = max(
      select(reachA.x.lessThan(reachA.y), reachA.y, float(0)),
      select(reachB.x.lessThan(reachB.y), reachB.y, float(0)),
    ).toVar("cloudSlabFar");

    const result = vec4(0).toVar("cloudResult");
    // A discard lets the rest of the shader run on (it only stops the
    // write), so a pixel with no cloud to find is branched around instead:
    // most of a frame is ground.
    const isMarching = select(
      start.lessThan(limit).and(limit.greaterThan(slabNear)),
      float(1),
      float(0),
    ).toVar("cloudIsMarching");
    // The half-size march holds the whole ray of the voxel style, where no
    // see-through layer stands on the pixel.
    If(
      isMarching
        .greaterThan(0.5)
        .and(u.coarseReady.greaterThan(0.5))
        .and(isSoft.not())
        .and(start.lessThanEqual(0))
        .and(hasLayers.lessThan(0.5)),
      () => {
        const reach = min(limit, slabFar).toVar("cloudReach");
        const tolerance = reach.mul(u.coarseTolerance.x).add(COARSE_REACH_SLACK);
        // This pixel's centre among the half-size march's texel centres.
        const at = screenCoordinate.xy.mul(u.coarseSize).div(u.frameSize).sub(0.5);
        const base = floor(at).toVar("cloudCoarseBase");
        const weight = at.sub(base).toVar("cloudCoarseWeight");
        const last = u.coarseSize.sub(1);
        const isFlat = float(1).toVar("cloudIsFlat");
        const low = vec4(1e9).toVar("cloudCoarseLow");
        const high = vec4(-1e9).toVar("cloudCoarseHigh");
        const blend = vec4(0).toVar("cloudCoarseBlend");
        for (const [dx, dy] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ]) {
          const texel = clamp(base.add(vec2(dx, dy)), vec2(0), last);
          const pixel = floor(texel.add(0.5).mul(u.frameSize).div(u.coarseSize));
          const theirs = reachAt(pixel.add(0.5).div(u.frameSize), alongRay).toVar();
          If(u.blendedSplit.greaterThan(1.5), () => {
            const split = splitAt(ivec2(pixel), alongRay, theirs);
            If(split.hasLayers, () => {
              isFlat.assign(0);
            });
          });
          If(abs(min(theirs, slabFar).sub(reach)).greaterThan(tolerance), () => {
            isFlat.assign(0);
          });
          const sample = (u.coarse.load(ivec2(texel)) as unknown as Vec4Node).toVar();
          low.assign(min(low, sample));
          high.assign(max(high, sample));
          const wx = dx === 0 ? weight.x.oneMinus() : weight.x;
          const wy = dy === 0 ? weight.y.oneMinus() : weight.y;
          blend.addAssign(sample.mul(wx.mul(wy)));
        }
        // Colour by contrast, not by level: the eye tells two dark greys
        // apart as readily as two near whites, and a night deck is dark.
        const spread = high.sub(low);
        const contrast = max(max(spread.r, spread.g), spread.b).div(
          max(max(max(high.r, high.g), high.b), COARSE_DARKEST),
        );
        If(max(contrast, spread.a).greaterThan(u.coarseTolerance.y), () => {
          isFlat.assign(0);
        });
        If(isFlat.greaterThan(0.5), () => {
          isMarching.assign(0);
          result.assign(vec4(blend.rgb.div(max(blend.a, 1e-4)), blend.a));
        });
      },
    );
    If(isMarching.greaterThan(0.5), () => {
      result.assign(marchRay(ro, rd, start, limit));
    });
    Discard(result.a.lessThan(0.003));
    return result;
  });

  const material = new NodeMaterial();
  material.vertexNode = vec4(positionGeometry.xy, 0, 1);
  material.depthTest = false;
  material.depthWrite = false;
  material.fog = false;
  material.lights = false;
  if (mode === "coarse") {
    material.name = "volumetric-clouds-coarse";
    material.fragmentNode = coarseFragment() as unknown as Vec4Node;
    material.transparent = false;
    material.blending = NoBlending;
  } else {
    material.name = "volumetric-clouds";
    material.fragmentNode = frameFragment() as unknown as Vec4Node;
    material.transparent = true;
    material.blending = NormalBlending;
  }
  return material;
}

/** The deck's draw into the frame. See {@link createCloudMaterial}. */
export function createVolumetricCloudMaterial(
  u: VolumetricCloudUniforms,
  shared: VolumetricCloudsSharedInputs,
): NodeMaterial {
  return createCloudMaterial(u, shared, "frame");
}

/**
 * The deck marched at half the frame's size, into a target of its own, for
 * the frame's draw to take its even stretches from. A march costs by the
 * pixel (a ray near the horizon steps through a couple of hundred cells),
 * and most of a sky is open air or the inside of a face, where one ray in
 * four says as much as all of them.
 */
export function createVolumetricCloudCoarseMaterial(
  u: VolumetricCloudUniforms,
  shared: VolumetricCloudsSharedInputs,
): NodeMaterial {
  return createCloudMaterial(u, shared, "coarse");
}
