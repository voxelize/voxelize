import { Fn, float } from "three/tsl";

type NodeRef = ReturnType<typeof float>;

export const acesTonemapNode = /* @__PURE__ */ Fn(([color]: [NodeRef]) => {
  const numerator = color.mul(color.mul(2.51).add(0.03));
  const denominator = color.mul(color.mul(2.43).add(0.59)).add(0.14);
  return numerator.div(denominator);
});
