import {
  abs,
  any,
  Break,
  clamp,
  Continue,
  cross,
  dot,
  exp,
  float,
  floor,
  Fn,
  greaterThanEqual,
  If,
  int,
  inverseSqrt,
  ivec2,
  ivec3,
  length,
  lessThan,
  Loop,
  max,
  min,
  mix,
  mod,
  normalize,
  select,
  smoothstep,
  sqrt,
  vec2,
  vec3,
} from "three/tsl";

import type { LocalLightAirlight } from "../local-lights/airlight";
import { AIRLIGHT_SLOTS } from "../local-lights/airlight";
import {
  GRID_CELLS_PER_ROW,
  type LightClusterGrid,
  MAX_LIGHTS_PER_CELL,
  OVERFLOW_SLOTS_PER_CELL,
  SLOT_ROW_MASK,
  SLOT_WEIGHT_SHIFT,
} from "../local-lights/clustering";
import {
  BLOCK_LIGHT_OWNERSHIP_GAIN,
  FLUID_SPECULAR_LIGHTS_PER_CELL,
  LAMBERT_WRAP,
} from "../local-lights/shader";
import { WATER_VIEW_EXTINCTION } from "../water-optics";

import {
  BLOCK_LIGHT_TRANSFER_KERNEL_CORE,
  blockLightCurve1Node,
  blockLightKernelFalloff,
  blockLightMountFade,
  luminance709,
} from "./block-light";
import type { ChunkUniforms, TextureInput } from "./chunk-uniforms";
import { glUvToTargetUv, perspectiveDepthToViewZ } from "./conventions";
import type { FloatNode, IntNode, Vec3Node, Vec4Node } from "./types";

export type LocalLightInputs = {
  grid: LightClusterGrid["uniforms"];
  shadow: {
    atlas: TextureInput;
    /** [atlas px, cell px, linear depth bias (blocks), normal bias (texels)] */
    params: Vec4Node & { value: unknown };
    /** [pcf radius (texels), shadow strength, unused, unused] */
    params2: Vec4Node & { value: unknown };
  };
  air: LocalLightAirlight["uniforms"];
};

const EXTINCTION = vec3(
  WATER_VIEW_EXTINCTION.red,
  WATER_VIEW_EXTINCTION.green,
  WATER_VIEW_EXTINCTION.blue,
);

const PCF_TAPS = [
  [-0.6, -0.2],
  [0.6, 0.2],
  [-0.2, 0.6],
  [0.2, -0.6],
] as const;

/** Light-record flags (t1.w). */
const FLAG_MASKED = 1;
const FLAG_FLICKER = 2;
const FLAG_SHADOWED = 4;
const SHAPE_SHIFT = 4;
const SHAPE_SPOT = 1;
const SHAPE_CAPSULE = 2;

/**
 * The clustered local lights (torches, lanterns, held lights) of one world.
 *
 * Record layout (one row per selected light, six RGBA32F texels):
 *   t0 = [x, y, z, range]
 *   t1 = [r*i, g*i, b*i, flags]   flags: 1 masked | 2 flicker | 4 shadowed | shape << 4
 *   t2 = spot [dir.xyz, cosOuter] / capsule [end offset.xyz, 0]
 *   t3 = [flickerSpeed, flickerAmplitude, flickerPhase, spotInvCosDelta]
 *   t4 = [shadow slot (-1 none), static face mask, dynamic face mask, near]
 *   t5 = [far, guard tanHalf, shadow fade weight, 0]
 *
 * Grid slots (R32UI): data row + 1 in the low byte (0 ends the cell's
 * list), the slot's fade weight in the high byte. Shadow lookup mirrors the
 * camera construction in `shadow-atlas.ts` (face bases, guard FOV); depth
 * compares run in linear light-space distance so bias is a world unit.
 */
export function localLightShading(
  u: LocalLightInputs,
  world: Pick<ChunkUniforms, "time" | "cameraSubmersion" | "cameraWaterPlaneY">,
) {
  const g = u.grid;
  const record = (rec: IntNode, texel: number): Vec4Node =>
    g.lightData.load(ivec2(texel, rec)) as unknown as Vec4Node;
  const flagsOf = (t1: Vec4Node): IntNode => int(floor(t1.w.add(0.5)));

  /**
   * Visibility of one shadow-mapped light at a receiver, 1 lit: both atlas
   * cells (cached static world, per-frame dynamic casters), each PCF'd with
   * four taps, the darker wins. Receivers lift off their plane by the
   * light-space texel footprint, more as the light grazes them.
   */
  const shadow = Fn(
    ([rec, pos, normal, shape, lightPos, spotDir]: [
      IntNode,
      Vec3Node,
      Vec3Node,
      IntNode,
      Vec3Node,
      Vec3Node,
    ]) => {
      const visibility = float(1).toVar();
      const t4 = record(rec, 4);
      const slot = int(floor(t4.x.add(0.5)));
      If(slot.greaterThanEqual(0), () => {
        const near = t4.w;
        const t5 = record(rec, 5);
        const far = t5.x;
        const tanHalf = t5.y;
        const params = u.shadow.params;
        const params2 = u.shadow.params2;

        const toLightDir = normalize(lightPos.sub(pos));
        const ndl = clamp(dot(normal, toLightDir), 0, 1);
        const slope = clamp(
          sqrt(ndl.mul(ndl).oneMinus()).div(max(ndl, 0.05)),
          0,
          8,
        );
        const w0 = max(length(pos.sub(lightPos)), near);
        const texelWorld = tanHalf.mul(2).mul(w0).div(params.y);
        const rel = pos
          .add(normal.mul(params.w.mul(texelWorld).mul(slope.add(1))))
          .sub(lightPos);

        const face = int(0).toVar();
        const w = float(0).toVar();
        const faceUv = vec2(0).toVar();
        const isInside = float(1).toVar();
        If(shape.equal(SHAPE_SPOT), () => {
          const upRef = select(
            abs(spotDir.y).greaterThan(0.99),
            vec3(0, 0, 1),
            vec3(0, 1, 0),
          );
          const right = normalize(cross(spotDir, upRef));
          const up = cross(right, spotDir);
          w.assign(dot(rel, spotDir));
          const ndc = vec2(dot(rel, right), dot(rel, up)).div(
            max(w, 1e-6).mul(tanHalf),
          );
          If(
            w
              .lessThanEqual(near)
              .or(abs(ndc.x).greaterThanEqual(1))
              .or(abs(ndc.y).greaterThanEqual(1)),
            () => {
              isInside.assign(0);
            },
          );
          faceUv.assign(ndc.mul(0.5).add(0.5));
        }).Else(() => {
          const a = abs(rel);
          const faceTexel = vec2(0).toVar();
          If(a.x.greaterThanEqual(a.y).and(a.x.greaterThanEqual(a.z)), () => {
            face.assign(select(rel.x.greaterThan(0), int(0), int(1)));
            w.assign(a.x);
            faceTexel.assign(
              vec2(select(rel.x.greaterThan(0), rel.z, rel.z.negate()), rel.y),
            );
          })
            .ElseIf(a.y.greaterThanEqual(a.z), () => {
              face.assign(select(rel.y.greaterThan(0), int(2), int(3)));
              w.assign(a.y);
              faceTexel.assign(
                vec2(
                  select(rel.y.greaterThan(0), rel.x, rel.x.negate()),
                  rel.z,
                ),
              );
            })
            .Else(() => {
              face.assign(select(rel.z.greaterThan(0), int(4), int(5)));
              w.assign(a.z);
              faceTexel.assign(
                vec2(
                  select(rel.z.greaterThan(0), rel.x.negate(), rel.x),
                  rel.y,
                ),
              );
            });
          If(w.lessThanEqual(near), () => {
            isInside.assign(0);
          });
          faceUv.assign(
            faceTexel.div(max(w, 1e-6).mul(tanHalf)).mul(0.5).add(0.5),
          );
        });

        If(isInside.greaterThan(0.5), () => {
          const bias = params.z.add(texelWorld.mul(slope.add(0.75)));
          const atlasPx = params.x;
          const cellPx = params.y;
          const perRow = floor(atlasPx.div(cellPx).add(0.5));
          const pcf = params2.x;
          const border = pcf.add(1).div(cellPx);
          const clamped = clamp(faceUv, vec2(border), vec2(border.oneMinus()));
          const texel = vec2(pcf.div(atlasPx));
          const masks = int(floor(t4.y.add(0.5))).bitOr(
            int(floor(t4.z.add(0.5))).shiftLeft(6),
          );
          const occlusion = float(1).toVar();
          for (let layer = 0; layer < 2; layer++) {
            const bit = int(1).shiftLeft(face.add(layer * 6));
            If(masks.bitAnd(bit).notEqual(0), () => {
              const cell = float(slot.mul(12).add(layer * 6).add(face));
              const baseUv = vec2(mod(cell, perRow), floor(cell.div(perRow)))
                .mul(cellPx)
                .add(clamped.mul(cellPx))
                .div(atlasPx);
              let hits: FloatNode = float(0);
              for (const [tx, ty] of PCF_TAPS) {
                const depth = u.shadow.atlas.sample(
                  glUvToTargetUv(baseUv.add(vec2(tx, ty).mul(texel))),
                ).r;
                const stored = perspectiveDepthToViewZ(depth, near, far);
                hits = hits.add(
                  select(w.sub(bias).greaterThan(stored), 0, 1),
                );
              }
              occlusion.assign(min(occlusion, hits.mul(0.25)));
            });
          }
          // t5.z fades a shadow in once its faces exist and out before its
          // slot is handed to another light.
          visibility.assign(mix(1, occlusion, params2.y.mul(t5.z)));
        });
      });
      return visibility;
    },
  );

  /**
   * The grid cell holding a world position, or -1 outside the window.
   * Toroidal storage: a world cell keeps its storage cell (and its slots'
   * fades) while the window scrolls around it. Integer math on purpose: a
   * float mod can return the modulus itself at exact multiples.
   */
  const cellOf = (pos: Vec3Node): IntNode => {
    const rel = pos.sub(g.gridOrigin).div(g.gridCellSize);
    const dims = ivec3(g.gridDims);
    // The storage offset is under one window, so this wraps each axis once.
    const cell = ivec3(rel).add(ivec3(g.gridStorageOffset)).mod(dims);
    const index = cell.z.mul(dims.y).add(cell.y).mul(dims.x).add(cell.x);
    const isOutside = any(lessThan(rel, vec3(0))).or(
      any(greaterThanEqual(rel, g.gridDims)),
    );
    return select(isOutside, int(-1), index);
  };

  /** A slot's data row + 1 (0 ends the list) and its fade weight 0..1. */
  const slotOf = (cell: IntNode, s: IntNode | number, perCell: number) => {
    const coord = ivec2(
      cell.mod(GRID_CELLS_PER_ROW).mul(perCell).add(s),
      cell.div(GRID_CELLS_PER_ROW),
    );
    const texture = perCell === MAX_LIGHTS_PER_CELL ? g.lightGrid : g.lightOverflow;
    const value = texture.load(coord).r.toUint();
    return {
      row: int(value.bitAnd(SLOT_ROW_MASK)),
      weight: float(value.shiftRight(SLOT_WEIGHT_SHIFT)).mul(1 / 255),
    };
  };

  const flicker = (t3: Vec4Node): FloatNode => {
    const t = world.time.mul(0.001).mul(t3.x).mul(Math.PI * 2);
    const wobble = t
      .add(t3.z)
      .sin()
      .mul(t.mul(0.531).add(t3.z.mul(1.7)).sin())
      .mul(0.5)
      .add(0.5);
    return t3.y.mul(wobble).oneMinus();
  };

  /**
   * Window-rim fade shared by the analytic output and its flood claim,
   * measured from the window's centre (which moves smoothly) and reaching 0
   * inside the extent the window always covers, so it never steps as the
   * window scrolls a cell.
   */
  const windowFade = (pos: Vec3Node): FloatNode => {
    const edge = g.gridHalf.sub(abs(pos.sub(g.gridCenter.xyz)));
    return clamp(min(min(edge.x, edge.y), edge.z).div(g.gridCenter.w), 0, 1);
  };

  const floodMask = (flood: Vec3Node): FloatNode =>
    smoothstep(0, g.maskKnee, max(max(flood.x, flood.y), flood.z));

  /**
   * One clustered light at a fragment, all but its shadow map: adds the
   * light's claim and hue, and returns its light (zero beyond its reach).
   * A cell's slots and its overflow both come through here.
   */
  const response = (
    rec: IntNode,
    pos: Vec3Node,
    normal: Vec3Node,
    mask: FloatNode,
    slotWeight: FloatNode,
    claim: FloatNode,
    lightHue: Vec3Node,
  ): Vec3Node => {
    const lit = vec3(0).toVar();
    const t0 = record(rec, 0);
    const t1 = record(rec, 1);
    const flags = flagsOf(t1);
    const shape = flags.shiftRight(SHAPE_SHIFT);

    const origin = vec3(t0.xyz).toVar();
    If(shape.equal(SHAPE_CAPSULE), () => {
      // Capsule: light from the closest point on the segment.
      const axis = record(rec, 2).xyz;
      const len2 = max(dot(axis, axis), 1e-6);
      const t = clamp(dot(pos.sub(t0.xyz), axis).div(len2), 0, 1);
      origin.assign(t0.xyz.add(axis.mul(t)));
    });

    const toLight = origin.sub(pos);
    const d2 = dot(toLight, toLight);
    lightHue.addAssign(t1.xyz.mul(slotWeight.div(d2.add(1))));
    const range = t0.w;
    If(d2.lessThan(range.mul(range)), () => {
      const dist = sqrt(max(d2, 1e-6));
      const l = toLight.div(dist);
      const isMasked = flags.bitAnd(FLAG_MASKED).notEqual(0);
      // A masked light's flood ends on the L1 diamond of its range, so the
      // window runs to the larger of the two distances and reaches zero on
      // that diamond instead of being cut there.
      const windowDist = select(
        isMasked,
        max(dist, abs(toLight.x).add(abs(toLight.y)).add(abs(toLight.z))),
        dist,
      );
      If(windowDist.lessThan(range), () => {
        // On a ceiling the light hangs just under, the falloff is flat
        // across its core: a cluster of hanging emitters lights its ceiling
        // evenly instead of painting a bright pool round itself.
        const mountCore = blockLightMountFade(toLight, normal)
          .oneMinus()
          .mul(BLOCK_LIGHT_TRANSFER_KERNEL_CORE)
          .mul(range);
        const fall = blockLightKernelFalloff(
          windowDist,
          max(d2, mountCore.mul(mountCore)),
          range,
        );
        const angular = float(1).toVar();
        If(shape.equal(SHAPE_SPOT), () => {
          const spot = clamp(
            dot(l.negate(), record(rec, 2).xyz)
              .sub(record(rec, 2).w)
              .mul(record(rec, 3).w),
            0,
            1,
          );
          angular.assign(spot.mul(spot));
        });
        // t1.rgb is colour x intensity x share: this is the light's
        // unoccluded luminance claim at the fragment.
        claim.addAssign(
          fall.mul(angular).mul(slotWeight).mul(luminance709(t1.xyz)),
        );
        const lambert = max(dot(normal, l), 0)
          .mul(1 - LAMBERT_WRAP)
          .add(LAMBERT_WRAP);
        const flickerScale = select(
          flags.bitAnd(FLAG_FLICKER).notEqual(0),
          flicker(record(rec, 3)),
          1,
        );
        // Occlusion ladder, first rung: a masked light takes the shared
        // flood mask; a shadow holder composes its atlas on top of it.
        const occlusion = select(isMasked, mask, 1);
        // Submerged emitters lose energy to the water column, measured
        // against the surface of the water the camera is in.
        const transmit = vec3(1).toVar();
        If(
          world.cameraSubmersion
            .greaterThan(0.001)
            .and(origin.y.lessThan(world.cameraWaterPlaneY)),
          () => {
            const depth = clamp(world.cameraWaterPlaneY.sub(origin.y), 0, 1);
            transmit.assign(exp(EXTINCTION.negate().mul(dist).mul(depth)));
          },
        );
        lit.assign(
          t1.xyz
            .mul(
              fall
                .mul(angular)
                .mul(lambert)
                .mul(flickerScale)
                .mul(occlusion)
                .mul(slotWeight),
            )
            .mul(transmit),
        );
      });
    });
    return lit;
  };

  /**
   * The clustered response at a surface point: the summed light of the
   * cell's slots (shadow-mapped where granted) and its overflow, the share
   * of the baked flood the fragment still keeps (`floodRemainder`, 1 where
   * no analytic light claims it), and the hue of the lights around it for
   * the flood's spent channels (`lightHue`).
   */
  const surface = (
    pos: Vec3Node,
    normal: Vec3Node,
    flood: Vec3Node,
    slotLimit: number,
    useShadows: boolean,
  ) => {
    const total = vec3(0).toVar();
    const floodRemainder = float(1).toVar();
    const lightHue = vec3(0).toVar();
    if (slotLimit === 0) return { total, floodRemainder, lightHue };

    const cell = cellOf(pos);
    If(g.clusteredCount.greaterThan(0).and(cell.greaterThanEqual(0)), () => {
      const mask = floodMask(flood);
      const fade = windowFade(pos);
      const claim = float(0).toVar();
      Loop(
        { start: int(0), end: int(Math.min(slotLimit, MAX_LIGHTS_PER_CELL)) },
        ({ i }) => {
          const slot = slotOf(cell, i, MAX_LIGHTS_PER_CELL);
          If(slot.row.equal(0), () => {
            Break();
          });
          const rec = slot.row.sub(1);
          const lit = response(
            rec,
            pos,
            normal,
            mask,
            slot.weight,
            claim,
            lightHue,
          ).toVar();
          if (useShadows) {
            // Second rung of the occlusion ladder: a granted shadow slot's
            // atlas maps, composed on the flood mask.
            const t1 = record(rec, 1);
            const flags = flagsOf(t1);
            If(
              lit.x
                .add(lit.y)
                .add(lit.z)
                .greaterThan(0)
                .and(flags.bitAnd(FLAG_SHADOWED).notEqual(0)),
              () => {
                const shape = flags.shiftRight(SHAPE_SHIFT);
                const spotDir = select(
                  shape.equal(SHAPE_SPOT),
                  record(rec, 2).xyz,
                  vec3(0),
                );
                lit.mulAssign(
                  shadow(rec, pos, normal, shape, record(rec, 0).xyz, spotDir),
                );
              },
            );
          }
          total.addAssign(lit);
        },
      );
      if (slotLimit >= MAX_LIGHTS_PER_CELL) {
        // The cell's overflow: every light reaching it past its slots, lit
        // the same way minus the shadow map, so a full cell draws no line.
        Loop(
          { start: int(0), end: int(OVERFLOW_SLOTS_PER_CELL) },
          ({ i }) => {
            const slot = slotOf(cell, i, OVERFLOW_SLOTS_PER_CELL);
            If(slot.row.equal(0), () => {
              Break();
            });
            total.addAssign(
              response(
                slot.row.sub(1),
                pos,
                normal,
                mask,
                slot.weight,
                claim,
                lightHue,
              ),
            );
          },
        );
      }
      // A true crossfade between the owned frame (analytic + its unfaded
      // remainder's flood) and the plain flood frame, by the same rim fade
      // the analytic light rides, so block light stays continuous.
      const floodSmooth = blockLightCurve1Node(max(max(flood.x, flood.y), flood.z));
      const owned = clamp(
        claim
          .mul(g.ownership)
          .mul(BLOCK_LIGHT_OWNERSHIP_GAIN)
          .div(max(floodSmooth, 1e-3)),
        0,
        1,
      ).oneMinus();
      floodRemainder.assign(mix(1, owned, fade));
      total.mulAssign(fade);
    });
    return { total, floodRemainder, lightHue };
  };

  const air = u.air;
  const airMember = (i: IntNode, field: 0 | 1): Vec4Node =>
    air.members.node.element(i.mul(2).add(field)) as unknown as Vec4Node;

  /**
   * Room fill: the few lights nearest the camera as a weak half-Lambert
   * bounce on surfaces the sky does not reach, masked by the fragment's own
   * flood (which cannot pass a wall), zero wherever the sky lights it.
   */
  const roomFill = Fn(
    ([pos, normal, skyExposure, flood]: [
      Vec3Node,
      Vec3Node,
      FloatNode,
      Vec3Node,
    ]) => {
      const fill = vec3(0).toVar();
      const fillMask = mix(
        1,
        // Eased in over the flood's outer eight levels, so the fill never
        // ends along the flood's ragged diamond edge.
        smoothstep(0, 8 / 15, max(max(flood.x, flood.y), flood.z)),
        air.fillFloodMask,
      );
      If(
        air.count
          .greaterThan(0)
          .and(skyExposure.lessThan(0.999))
          .and(fillMask.greaterThan(0)),
        () => {
          Loop({ start: int(0), end: int(AIRLIGHT_SLOTS) }, ({ i }) => {
            If(i.greaterThanEqual(air.count.toInt()), () => {
              Break();
            });
            const position = airMember(i, 0);
            const color = airMember(i, 1);
            const toLight = position.xyz.sub(pos);
            const d2 = dot(toLight, toLight);
            const reach = position.w.mul(air.fillRangeScale);
            If(d2.greaterThanEqual(reach.mul(reach)), () => {
              Continue();
            });
            const facing = dot(normal, toLight.mul(inverseSqrt(max(d2, 1e-4))))
              .mul(0.5)
              .add(0.5);
            const n2 = d2.div(reach.mul(reach));
            const core = color.w.mul(air.fillCoreScale);
            fill.addAssign(
              color.xyz.mul(
                facing
                  .mul(n2.oneMinus())
                  .mul(n2.oneMinus())
                  .div(d2.div(core.mul(core)).add(1)),
              ),
            );
          });
          fill.mulAssign(
            air.fillStrength.mul(skyExposure.oneMinus()).mul(fillMask),
          );
        },
      );
      return fill;
    },
  );

  /**
   * The strongest resident light's highlight on water (fluids already pay
   * the diffuse pass and refraction), flood-masked so it never glints
   * through a wall, faded by the window rim like the diffuse response.
   */
  const specular = Fn(
    ([pos, normal, viewDir, flood]: [Vec3Node, Vec3Node, Vec3Node, Vec3Node]) => {
      const total = vec3(0).toVar();
      const cell = cellOf(pos);
      If(
        g.clusteredCount
          .greaterThan(0)
          .and(g.specularStrength.greaterThan(0))
          .and(cell.greaterThanEqual(0)),
        () => {
          const mask = floodMask(flood);
          Loop(
            { start: int(0), end: int(FLUID_SPECULAR_LIGHTS_PER_CELL) },
            ({ i }) => {
              const slot = slotOf(cell, i, MAX_LIGHTS_PER_CELL);
              If(slot.row.equal(0), () => {
                Break();
              });
              const rec = slot.row.sub(1);
              const t0 = record(rec, 0);
              const toLight = t0.xyz.sub(pos);
              const d2 = dot(toLight, toLight);
              const range = t0.w;
              If(d2.greaterThanEqual(range.mul(range)), () => {
                Continue();
              });
              const dist = sqrt(max(d2, 1e-6));
              const fall = blockLightKernelFalloff(dist, d2, range);
              const half = normalize(toLight.div(dist).add(viewDir));
              let spec: FloatNode = max(dot(normal, half), 0);
              for (let k = 0; k < 5; k++) spec = spec.mul(spec);
              const t1 = record(rec, 1);
              const occlusion = select(
                flagsOf(t1).bitAnd(FLAG_MASKED).notEqual(0),
                mask,
                1,
              );
              total.addAssign(
                t1.xyz.mul(spec.mul(fall).mul(occlusion).mul(slot.weight)),
              );
            },
          );
          total.mulAssign(g.specularStrength.mul(windowFade(pos)));
        },
      );
      return total;
    },
  );

  /**
   * The debug views (`debugMode` 1-6): cell occupancy, the clustered light
   * alone, the flood leak mask, the shadowed lights' slots and visibility,
   * the flood-ownership remainder.
   */
  const debugColor = (
    pos: Vec3Node,
    base: Vec3Node,
    normal: Vec3Node,
    flood: Vec3Node,
    cluster: Vec3Node,
    remainder: FloatNode,
  ): Vec3Node =>
    Fn(() => {
      const mode = g.debugMode;
      const color = vec3(base).toVar();
      const cell = cellOf(pos);
      If(mode.greaterThan(5.5), () => {
        color.assign(vec3(remainder));
      })
        .ElseIf(mode.lessThan(1.5), () => {
          // Cell occupancy: black 0, green 1-2, yellow 3-5, red 6+.
          If(cell.lessThan(0), () => {
            color.assign(base.mul(0.2));
          }).Else(() => {
            const count = int(0).toVar();
            Loop(
              { start: int(0), end: int(MAX_LIGHTS_PER_CELL) },
              ({ i }) => {
                If(slotOf(cell, i, MAX_LIGHTS_PER_CELL).row.equal(0), () => {
                  Break();
                });
                count.addAssign(1);
              },
            );
            const ramp = select(
              count.equal(0),
              vec3(0.05),
              select(
                count.lessThanEqual(2),
                vec3(0.1, 0.8, 0.2),
                select(
                  count.lessThanEqual(5),
                  vec3(0.9, 0.8, 0.1),
                  vec3(0.9, 0.15, 0.1),
                ),
              ),
            );
            color.assign(mix(base, ramp, 0.75));
          });
        })
        .ElseIf(mode.lessThan(2.5), () => {
          color.assign(cluster);
        })
        .ElseIf(mode.lessThan(3.5), () => {
          color.assign(vec3(floodMask(flood)));
        })
        .Else(() => {
          // Modes 4 and 5 walk the cell's shadowed lights once.
          If(cell.lessThan(0), () => {
            color.assign(select(mode.lessThan(4.5), base.mul(0.2), vec3(1)));
          }).Else(() => {
            const tint = base.mul(0.15).toVar();
            const visAll = float(1).toVar();
            Loop(
              { start: int(0), end: int(MAX_LIGHTS_PER_CELL) },
              ({ i }) => {
                const slot = slotOf(cell, i, MAX_LIGHTS_PER_CELL);
                If(slot.row.equal(0), () => {
                  Break();
                });
                const rec = slot.row.sub(1);
                const t1 = record(rec, 1);
                const flags = flagsOf(t1);
                const t0 = record(rec, 0);
                const toLight = t0.xyz.sub(pos);
                If(
                  flags
                    .bitAnd(FLAG_SHADOWED)
                    .equal(0)
                    .or(dot(toLight, toLight).greaterThanEqual(t0.w.mul(t0.w))),
                  () => {
                    Continue();
                  },
                );
                const shape = flags.shiftRight(SHAPE_SHIFT);
                const spotDir = select(
                  shape.equal(SHAPE_SPOT),
                  record(rec, 2).xyz,
                  vec3(0),
                );
                const vis = shadow(rec, pos, normal, shape, t0.xyz, spotDir);
                visAll.mulAssign(vis);
                const slotIndex = int(floor(record(rec, 4).x.add(0.5)));
                const slotColor = select(
                  slotIndex.equal(0),
                  vec3(1, 0.3, 0.2),
                  select(
                    slotIndex.equal(1),
                    vec3(0.2, 1, 0.3),
                    select(
                      slotIndex.equal(2),
                      vec3(0.25, 0.4, 1),
                      vec3(1, 0.9, 0.2),
                    ),
                  ),
                );
                tint.addAssign(slotColor.mul(vis.mul(0.8).add(0.2)).mul(0.6));
              },
            );
            color.assign(select(mode.lessThan(4.5), tint, vec3(visAll)));
          });
        });
      return color;
    })() as Vec3Node;

  return {
    surface,
    roomFill,
    specular,
    debugColor,
    isDebugging: g.debugMode.greaterThan(0.5),
    clusteredCount: g.clusteredCount,
  };
}

export type LocalLightShading = ReturnType<typeof localLightShading>;
