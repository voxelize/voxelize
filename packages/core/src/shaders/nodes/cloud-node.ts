import {
  Fn,
  float,
  vec4,
  mix,
  smoothstep,
  sqrt,
  dot,
  cameraPosition,
} from "three/tsl";

type NodeRef = ReturnType<typeof float>;

export const cloudColorNode = /* @__PURE__ */ Fn(
  ([worldPosition, cloudColor, cloudAlpha, fogColor, fogNear, fogFar]: [
    NodeRef,
    NodeRef,
    NodeRef,
    NodeRef,
    NodeRef,
    NodeRef,
  ]) => {
    const fogDiff = worldPosition.xz.sub(cameraPosition.xz);
    const depth = sqrt(dot(fogDiff, fogDiff)).div(8.0);
    const fogFactor = smoothstep(fogNear, fogFar, depth);
    const color = mix(cloudColor, fogColor, fogFactor);
    return vec4(color, cloudAlpha);
  },
);
