import type { CubeTexture } from "three";
import {
  float,
  vec3,
  vec4,
  dot,
  normalize,
  cross,
  mix,
  max,
  step,
  sin,
  cos,
  cubeTexture,
} from "three/tsl";

type NodeRef = ReturnType<typeof float>;

function unpackRGBAToDepth(v: NodeRef): NodeRef {
  return dot(v, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0));
}

interface PointShadowParams {
  shadowMap: CubeTexture;
  worldPos: NodeRef;
  lightPos: NodeRef;
  near: NodeRef;
  far: NodeRef;
  bias: NodeRef;
  enabled: NodeRef;
}

export function pointShadowNode(params: PointShadowParams): NodeRef {
  const { shadowMap, worldPos, lightPos, near, far, bias, enabled } = params;

  const lightToFrag = worldPos.sub(lightPos);
  const currentDepth = lightToFrag.length();
  const sampleDir = normalize(lightToFrag);

  const shadowSample = cubeTexture(shadowMap, sampleDir);
  const closestDepth = unpackRGBAToDepth(shadowSample).mul(far);

  const dynamicBias = bias.mul(float(1).add(currentDepth.mul(0.1)));
  const inShadow = step(closestDepth, currentDepth.sub(dynamicBias));
  const rawShadow = mix(float(1), float(0.3), inShadow);

  const inRange = step(currentDepth, far);

  return mix(float(1), rawShadow, enabled.mul(inRange));
}

export function pointShadowSoftNode(params: PointShadowParams): NodeRef {
  const { shadowMap, worldPos, lightPos, far, bias, enabled } = params;

  const lightToFrag = worldPos.sub(lightPos);
  const currentDepth = lightToFrag.length();
  const sampleDir = normalize(lightToFrag);
  const inRange = step(currentDepth, far);

  const diskRadius = float(0.02).mul(currentDepth).div(far);

  const rawTangent = normalize(cross(sampleDir, vec3(0, 1, 0)));
  const fallbackTangent = normalize(cross(sampleDir, vec3(1, 0, 0)));
  const tangentLen = cross(sampleDir, vec3(0, 1, 0)).length();
  const tangent = mix(
    fallbackTangent,
    rawTangent,
    step(float(0.001), tangentLen),
  );
  const bitangent = cross(sampleDir, tangent);

  const dynamicBias = bias.mul(float(1).add(currentDepth.mul(0.1)));

  const OFFSETS = [0.25, 0.5, 0.75, 1.0];
  const ANGLES = [0.0, 1.57, 3.14, 4.71];

  let shadow = float(0);
  for (let i = 0; i < 4; i++) {
    const r = diskRadius.mul(OFFSETS[i]);
    const a = float(ANGLES[i]).add(currentDepth);
    const offset = tangent
      .mul(cos(a))
      .mul(r)
      .add(bitangent.mul(sin(a)).mul(r));
    const dir = normalize(sampleDir.add(offset));
    const sample = cubeTexture(shadowMap, dir);
    const depth = unpackRGBAToDepth(sample).mul(far);
    shadow = shadow.add(
      float(1).sub(step(depth, currentDepth.sub(dynamicBias))),
    );
  }

  shadow = shadow.div(4.0);
  const result = mix(float(0.3), float(1), shadow);

  return mix(float(1), result, enabled.mul(inRange));
}
