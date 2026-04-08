import {
  abs,
  clamp,
  cos,
  dot,
  float,
  Fn,
  fract,
  If,
  Loop,
  max,
  min,
  mix,
  sin,
  smoothstep,
  textureSize,
  vec2,
  vec3,
} from "three/tsl";
import type { Node } from "three/webgpu";

type TSLTexture = Node & {
  uv(uvNode: Node): Node;
};

const POISSON_DISK: Node[] = [
  vec2(-0.94201624, -0.39906216),
  vec2(0.94558609, -0.76890725),
  vec2(-0.094184101, -0.9293887),
  vec2(0.34495938, 0.2938776),
  vec2(-0.91588581, 0.45771432),
  vec2(-0.81544232, -0.87912464),
  vec2(0.97484398, 0.75648379),
  vec2(0.44323325, -0.97511554),
];

function sampleDepth(tex: Node, uv: Node): Node {
  return (tex as TSLTexture).uv(uv).r;
}

function computeTexelSize(tex: Node): Node {
  return vec2(1.0).div(vec2(textureSize(tex as TSLTexture)));
}

function projectAndRemap(sc: Node): Node {
  return sc.xyz.div(sc.w).mul(0.5).add(0.5);
}

function isOutOfBounds(coord: Node): Node {
  return min(coord.x, min(coord.y, coord.z))
    .lessThan(0.0)
    .or(max(coord.x, max(coord.y, coord.z)).greaterThan(1.0));
}

function shadowCompare(tex: Node, uv: Node, biasedZ: Node): Node {
  return biasedZ.lessThanEqual(sampleDepth(tex, uv)).toFloat();
}

function occlusionTest(diff: Node, bias: Node, minOccluder: Node): Node {
  return diff.greaterThan(bias).and(diff.greaterThanEqual(minOccluder));
}

export const shadowMapEdgeFade = /*@__PURE__*/ Fn(([coordNode]: [Node]) => {
  const coord = vec3(coordNode);
  const fw = float(0.08);
  const fx = smoothstep(float(0.0), fw, coord.x).mul(
    smoothstep(float(0.0), fw, float(1.0).sub(coord.x)),
  );
  const fy = smoothstep(float(0.0), fw, coord.y).mul(
    smoothstep(float(0.0), fw, float(1.0).sub(coord.y)),
  );
  return fx.mul(fy);
});

export const sampleShadowMapFast = /*@__PURE__*/ Fn(
  ([mapNode, coordNode, biasNode]: [Node, Node, Node]) => {
    const coord = projectAndRemap(coordNode).toVar();
    const result = float(1.0).toVar();

    If(isOutOfBounds(coord).not(), () => {
      const ts = computeTexelSize(mapNode);
      const bz = coord.z.sub(biasNode);

      const shadow = shadowCompare(mapNode, coord.xy, bz).toVar();
      shadow.addAssign(
        shadowCompare(mapNode, coord.xy.add(ts.mul(vec2(-1, -1))), bz),
      );
      shadow.addAssign(
        shadowCompare(mapNode, coord.xy.add(ts.mul(vec2(1, -1))), bz),
      );
      shadow.addAssign(
        shadowCompare(mapNode, coord.xy.add(ts.mul(vec2(-1, 1))), bz),
      );
      shadow.addAssign(
        shadowCompare(mapNode, coord.xy.add(ts.mul(vec2(1, 1))), bz),
      );
      shadow.divAssign(5.0);

      result.assign(mix(float(1.0), shadow, shadowMapEdgeFade(coord)));
    });

    return result;
  },
);

export const sampleShadowMapWeighted = /*@__PURE__*/ Fn(
  ([mapNode, coordNode, biasNode]: [Node, Node, Node]) => {
    const coord = projectAndRemap(coordNode).toVar();
    const result = float(1.0).toVar();

    If(isOutOfBounds(coord).not(), () => {
      const ts = computeTexelSize(mapNode);
      const bz = coord.z.sub(biasNode);
      const shadow = float(0.0).toVar();
      const totalWeight = float(0.0).toVar();

      Loop(5, 5, ({ i, j }: { i: Node; j: Node }) => {
        const x = i.toFloat().sub(2.0);
        const y = j.toFloat().sub(2.0);
        const w = float(3.0)
          .sub(abs(x))
          .mul(float(3.0).sub(abs(y)));
        shadow.addAssign(
          w.mul(shadowCompare(mapNode, coord.xy.add(vec2(x, y).mul(ts)), bz)),
        );
        totalWeight.addAssign(w);
      });

      shadow.divAssign(totalWeight);
      result.assign(mix(float(1.0), shadow, shadowMapEdgeFade(coord)));
    });

    return result;
  },
);

export const sampleShadowMapPCSS = /*@__PURE__*/ Fn(
  ([mapNode, coordNode, biasNode, minOccluderNode]: [
    Node,
    Node,
    Node,
    Node,
  ]) => {
    const coord = projectAndRemap(coordNode).toVar();
    const result = float(1.0).toVar();

    If(isOutOfBounds(coord).not(), () => {
      const ts = computeTexelSize(mapNode);
      const searchRadius = float(3.0);
      const blockerSum = float(0.0).toVar();
      const blockerCount = float(0.0).toVar();

      for (const idx of [0, 2, 4, 6]) {
        const offset = POISSON_DISK[idx].mul(ts).mul(searchRadius);
        const depth = sampleDepth(mapNode, coord.xy.add(offset));
        const diff = coord.z.sub(depth);
        const isBlocker = occlusionTest(
          diff,
          biasNode,
          minOccluderNode,
        ).toFloat();
        blockerSum.addAssign(isBlocker.mul(depth));
        blockerCount.addAssign(isBlocker);
      }

      If(blockerCount.greaterThanEqual(0.5), () => {
        const avgBlocker = blockerSum.div(blockerCount);
        const penumbra = coord.z.sub(avgBlocker).div(avgBlocker);
        const filterRadius = clamp(penumbra.mul(2.0), 1.0, 3.0);

        const noise = fract(
          sin(dot(coord.xy, vec2(12.9898, 78.233))).mul(43758.5453),
        );
        const angle = noise.mul(6.283185);
        const c = cos(angle);
        const s = sin(angle);

        const centerDiff = coord.z.sub(sampleDepth(mapNode, coord.xy));
        const shadow = occlusionTest(centerDiff, biasNode, minOccluderNode)
          .not()
          .toFloat()
          .toVar();

        for (let k = 0; k < 8; k++) {
          const px = POISSON_DISK[k].x;
          const py = POISSON_DISK[k].y;
          const rotated = vec2(
            c.mul(px).sub(s.mul(py)),
            s.mul(px).add(c.mul(py)),
          );
          const offset = rotated.mul(ts).mul(filterRadius);
          const diff = coord.z.sub(sampleDepth(mapNode, coord.xy.add(offset)));
          shadow.addAssign(
            occlusionTest(diff, biasNode, minOccluderNode).not().toFloat(),
          );
        }

        shadow.divAssign(9.0);
        result.assign(mix(float(1.0), shadow, shadowMapEdgeFade(coord)));
      });
    });

    return result;
  },
);

export interface ChunkShadowParams {
  shadowMaps: [Node, Node, Node];
  shadowCoords: [Node, Node, Node];
  cascadeSplits: [Node, Node, Node];
  viewDepth: Node;
  worldNormal: Node;
  sunDirection: Node;
  lightAlpha: Node;
  shadowBias: Node;
  shadowStrength: Node;
}

export function getChunkShadow(params: ChunkShadowParams): Node {
  const {
    shadowMaps,
    shadowCoords,
    cascadeSplits,
    viewDepth,
    worldNormal,
    sunDirection,
    lightAlpha,
    shadowBias,
    shadowStrength,
  } = params;

  return Fn(() => {
    const result = float(1.0).toVar();
    const ndotl = dot(worldNormal, sunDirection);
    const blendRegion = float(0.1);

    If(ndotl.lessThanEqual(0.0), () => {
      result.assign(mix(float(1.0), float(0.0), shadowStrength));
    })
      .ElseIf(shadowStrength.lessThan(0.01), () => {
        result.assign(float(1.0));
      })
      .ElseIf(lightAlpha.lessThan(0.05), () => {
        result.assign(mix(float(1.0), float(0.0), shadowStrength));
      })
      .Else(() => {
        const slopeBias = max(
          float(0.005).mul(float(1.0).sub(ndotl)),
          float(0.001),
        );
        const rawShadow = float(1.0).toVar();
        const bias0 = shadowBias.add(slopeBias);
        const bias1 = shadowBias.add(slopeBias.mul(1.5));
        const bias2 = slopeBias.mul(2.0);

        If(viewDepth.lessThan(cascadeSplits[0]), () => {
          const s0 = sampleShadowMapWeighted(
            shadowMaps[0],
            shadowCoords[0],
            bias0,
          );
          const blendStart = cascadeSplits[0].mul(float(1.0).sub(blendRegion));

          If(viewDepth.greaterThan(blendStart), () => {
            const s1 = sampleShadowMapWeighted(
              shadowMaps[1],
              shadowCoords[1],
              bias1,
            );
            const t = viewDepth
              .sub(blendStart)
              .div(cascadeSplits[0].sub(blendStart));
            rawShadow.assign(mix(s0, s1, t));
          }).Else(() => {
            rawShadow.assign(s0);
          });
        })
          .ElseIf(viewDepth.lessThan(cascadeSplits[1]), () => {
            const s1 = sampleShadowMapWeighted(
              shadowMaps[1],
              shadowCoords[1],
              bias1,
            );
            const blendStart = cascadeSplits[1].mul(
              float(1.0).sub(blendRegion),
            );

            If(viewDepth.greaterThan(blendStart), () => {
              const s2 = sampleShadowMapFast(
                shadowMaps[2],
                shadowCoords[2],
                bias2,
              );
              const t = viewDepth
                .sub(blendStart)
                .div(cascadeSplits[1].sub(blendStart));
              rawShadow.assign(mix(s1, s2, t));
            }).Else(() => {
              rawShadow.assign(s1);
            });
          })
          .ElseIf(viewDepth.lessThan(cascadeSplits[2]), () => {
            const s2 = sampleShadowMapFast(
              shadowMaps[2],
              shadowCoords[2],
              bias2,
            );
            const fadeStart = cascadeSplits[2].mul(float(1.0).sub(blendRegion));

            If(viewDepth.greaterThan(fadeStart), () => {
              const t = viewDepth
                .sub(fadeStart)
                .div(cascadeSplits[2].sub(fadeStart));
              rawShadow.assign(mix(s2, float(1.0), t));
            }).Else(() => {
              rawShadow.assign(s2);
            });
          });

        result.assign(mix(float(1.0), rawShadow, shadowStrength));
      });

    return result;
  })();
}
