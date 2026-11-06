import {
  Data3DTexture,
  NodeMaterial,
  NormalBlending,
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
import type { BoolNode, FloatNode, IntNode, Vec3Node, Vec4Node } from "./types";
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

/**
 * Clouds marched through a tileable noise volume, drawn as one screen
 * triangle. See `VolumetricClouds`.
 */
export function createVolumetricCloudMaterial(
  u: VolumetricCloudUniforms,
  shared: VolumetricCloudsSharedInputs,
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
    // A march that picks up where the front half stopped, inside a bank,
    // goes on through its mist instead of meeting a face at the split.
    const wasCloudy = resumed
      .and(layerDensity(i, idx.add(0.5).mul(cell).add(origin), true).greaterThan(0))
      .toVar();
    const probe = min(cell.x, cell.y);

    Loop(VOXEL_STEPS, () => {
      const center = idx.add(0.5).mul(cell).add(origin);
      const cloudy = layerDensity(i, center, true).greaterThan(0).toVar();

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

  const fragment = Fn(() => {
    const ro = cameraPosition;
    const rd = normalize(vRay).toVar("cloudRd");
    const viewRay = normalize(vViewRay).toVar("cloudViewRay");
    const alongRay = max(viewRay.z.negate(), 1e-4);

    const limit = u.maxDistance.toVar("cloudLimit");
    If(u.sceneDepthReady.greaterThan(0.5), () => {
      const z = u.sceneDepth.sample(screenUV).level(float(0)).r;
      If(z.lessThan(0.99999), () => {
        const viewZ = perspectiveDepthToViewZ(z, cameraNear, cameraFar);
        limit.assign(min(limit, viewZ.div(alongRay)));
      });
    });

    const start = float(0).toVar("cloudStart");
    If(u.blendedSplit.greaterThan(0.5), () => {
      const layers = u.blendedLayers.load(ivec2(screenCoordinate.xy)).rg;
      // Their mean view depth, weighted as the composite weighs them, as a
      // distance along this pixel's ray. None here: the front half is all.
      const split = select(
        layers.r.greaterThan(1e-6),
        layers.g.div(layers.r).div(alongRay),
        limit,
      );
      If(u.blendedSplit.lessThan(1.5), () => {
        start.assign(split);
      }).Else(() => {
        limit.assign(min(limit, split));
      });
    });
    Discard(start.greaterThanEqual(limit));

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
    Discard(alpha.lessThan(0.003));

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
    );
    const endFade = smoothstep(u.fadeStart, u.maxDistance, meanDistance);
    return vec4(
      fog.haze(fogged, rd, endFade),
      alpha.mul(endFade.oneMinus()),
    );
  });

  const material = new NodeMaterial();
  material.name = "volumetric-clouds";
  material.vertexNode = vec4(positionGeometry.xy, 0, 1);
  material.fragmentNode = fragment() as unknown as Vec4Node;
  material.transparent = true;
  material.depthTest = false;
  material.depthWrite = false;
  material.blending = NormalBlending;
  material.fog = false;
  material.lights = false;
  return material;
}
