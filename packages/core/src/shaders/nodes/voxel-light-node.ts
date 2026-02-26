import { Fn, float, vec4 } from "three/tsl";

export const unpackVoxelLight = /* @__PURE__ */ Fn(
  ([lightVal]: [ReturnType<typeof float>]) => {
    const l = lightVal.bitAnd(0xffff);
    return vec4(
      float(l.shiftRight(8).bitAnd(0xf)).div(15.0),
      float(l.shiftRight(4).bitAnd(0xf)).div(15.0),
      float(l.bitAnd(0xf)).div(15.0),
      float(l.shiftRight(12).bitAnd(0xf)).div(15.0),
    );
  },
);

export const unpackVoxelFlags = /* @__PURE__ */ Fn(
  ([lightVal]: [ReturnType<typeof float>]) => {
    return vec4(
      float(lightVal.shiftRight(16).bitAnd(0x3)),
      float(lightVal.shiftRight(18).bitAnd(0x1)),
      float(lightVal.shiftRight(19).bitAnd(0x1)),
      float(lightVal.shiftRight(20).bitAnd(0x1)),
    );
  },
);
