import { float, int, vec4 } from "three/tsl";
import type { Node } from "three/webgpu";

export interface UnpackedLight {
  ao: Node;
  isFluid: Node;
  isGreedy: Node;
  shouldWave: Node;
  lightVec4: Node;
}

export function unpackChunkLight(
  lightAttr: Node,
  aoTable: Node,
): UnpackedLight {
  const aoIndex = lightAttr.shiftRight(16).bitAnd(0x3);
  const ao = aoTable.element(aoIndex).div(255.0);

  const isFluid = lightAttr.shiftRight(18).bitAnd(0x1).toFloat();
  const isGreedy = lightAttr.shiftRight(19).bitAnd(0x1).toFloat();
  const shouldWave = lightAttr.shiftRight(20).bitAnd(0x1).toFloat();

  const raw = lightAttr.bitAnd(int(0xffff));
  const lightVec4 = vec4(
    raw.shiftRight(8).bitAnd(0xf).toFloat(),
    raw.shiftRight(4).bitAnd(0xf).toFloat(),
    raw.bitAnd(0xf).toFloat(),
    raw.shiftRight(12).bitAnd(0xf).toFloat(),
  ).div(float(15.0));

  return { ao, isFluid, isGreedy, shouldWave, lightVec4 };
}
