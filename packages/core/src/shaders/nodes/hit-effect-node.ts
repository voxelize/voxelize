import { Fn, float, mix } from "three/tsl";

type NodeRef = ReturnType<typeof float>;

export const hitEffectNode = /* @__PURE__ */ Fn(
  ([color, hitColor, hitFactor]: [NodeRef, NodeRef, NodeRef]) => {
    return mix(color, hitColor, hitFactor);
  },
);
