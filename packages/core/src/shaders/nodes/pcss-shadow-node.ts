import type { Texture } from "three";
import {
  float,
  vec2,
  texture,
  smoothstep,
  mix,
  step,
  sin,
  cos,
  fract,
  dot,
  clamp,
  max,
} from "three/tsl";

type NodeRef = ReturnType<typeof float>;

const POISSON_DISK: [number, number][] = [
  [-0.94201624, -0.39906216],
  [0.94558609, -0.76890725],
  [-0.094184101, -0.9293887],
  [0.34495938, 0.2938776],
  [-0.91588581, 0.45771432],
  [-0.81544232, -0.87912464],
  [0.97484398, 0.75648379],
  [0.44323325, -0.97511554],
];

function shadowEdgeFade(coord: NodeRef): NodeRef {
  const fw = float(0.08);
  const fx = smoothstep(float(0), fw, coord.x).mul(
    smoothstep(float(0), fw, float(1).sub(coord.x)),
  );
  const fy = smoothstep(float(0), fw, coord.y).mul(
    smoothstep(float(0), fw, float(1).sub(coord.y)),
  );
  return fx.mul(fy);
}

function inBoundsCheck(coord: NodeRef): NodeRef {
  return step(float(0), coord.x)
    .mul(step(coord.x, float(1)))
    .mul(step(float(0), coord.y))
    .mul(step(coord.y, float(1)))
    .mul(step(float(0), coord.z))
    .mul(step(coord.z, float(1)));
}

export interface PCSSShadowParams {
  shadowMap: Texture;
  shadowCoord: NodeRef;
  bias: NodeRef;
  texelSize: NodeRef;
  minOccluderDepth: NodeRef;
}

export function sampleShadowPCSS(params: PCSSShadowParams): NodeRef {
  const { shadowMap, shadowCoord, bias, texelSize, minOccluderDepth } = params;

  const coord = shadowCoord.xyz.div(shadowCoord.w).mul(0.5).add(0.5);
  const bounds = inBoundsCheck(coord);

  const zBiased = coord.z;
  const searchRadius = float(3.0);

  let blockerSum = float(0);
  let blockerCount = float(0);
  for (let i = 0; i < 4; i++) {
    const offset = vec2(POISSON_DISK[i * 2][0], POISSON_DISK[i * 2][1])
      .mul(texelSize)
      .mul(searchRadius);
    const sampleDepth = texture(shadowMap, coord.xy.add(offset)).x;
    const blockerDiff = zBiased.sub(sampleDepth);
    const isBlocker = step(bias, blockerDiff).mul(
      step(minOccluderDepth, blockerDiff),
    );
    blockerSum = blockerSum.add(sampleDepth.mul(isBlocker));
    blockerCount = blockerCount.add(isBlocker);
  }

  const hasBlockers = step(float(0.5), blockerCount);
  const safeCount = max(blockerCount, float(1));
  const avgBlockerDepth = blockerSum.div(safeCount);
  const penumbraSize = zBiased
    .sub(avgBlockerDepth)
    .div(max(avgBlockerDepth, float(0.001)));
  const filterRadius = clamp(penumbraSize.mul(2.0), float(1.0), float(3.0));

  const spatialNoise = fract(
    sin(dot(coord.xy, vec2(12.9898, 78.233))).mul(43758.5453),
  );
  const angle = spatialNoise.mul(6.283185);
  const s = sin(angle);
  const c = cos(angle);

  const centerDepth = texture(shadowMap, coord.xy).x;
  const centerDiff = zBiased.sub(centerDepth);
  let shadow = float(1).sub(
    step(bias, centerDiff).mul(step(minOccluderDepth, centerDiff)),
  );

  for (let i = 0; i < 8; i++) {
    const px = float(POISSON_DISK[i][0]);
    const py = float(POISSON_DISK[i][1]);
    const rotX = c.mul(px).sub(s.mul(py));
    const rotY = s.mul(px).add(c.mul(py));
    const offset = vec2(rotX, rotY).mul(texelSize).mul(filterRadius);
    const depth = texture(shadowMap, coord.xy.add(offset)).x;
    const depthDiff = zBiased.sub(depth);
    shadow = shadow.add(
      float(1).sub(
        step(bias, depthDiff).mul(step(minOccluderDepth, depthDiff)),
      ),
    );
  }

  shadow = shadow.div(9.0);
  const faded = mix(float(1), shadow, shadowEdgeFade(coord));

  return mix(float(1), faded, bounds.mul(hasBlockers));
}
