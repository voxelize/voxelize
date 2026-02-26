import { Fn, mix, vec4 } from "three/tsl";

export const blockOverlayPassFn = Fn(([inputColor, overlayColor, opacity]) => {
  return vec4(mix(inputColor.rgb, overlayColor, opacity), inputColor.a);
});
