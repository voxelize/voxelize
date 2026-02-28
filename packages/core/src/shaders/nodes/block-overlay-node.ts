import { Fn, float, vec4, mix } from "three/tsl";

type NodeRef = ReturnType<typeof float>;

export const blockOverlayNode = /* @__PURE__ */ Fn(
  ([inputColor, overlayColor, opacity]: [NodeRef, NodeRef, NodeRef]) => {
    return vec4(mix(inputColor.xyz, overlayColor, opacity), inputColor.w);
  },
);
