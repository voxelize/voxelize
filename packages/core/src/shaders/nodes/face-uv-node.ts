import { Fn, float, vec2, abs, step, max, floor, mod } from "three/tsl";

type NodeRef = ReturnType<typeof float>;

export const faceUVNode = /* @__PURE__ */ Fn(
  ([baseUV, localNormal, partIndex, atlasCols, atlasRows]: [
    NodeRef,
    NodeRef,
    NodeRef,
    NodeRef,
    NodeRef,
  ]) => {
    const absN = abs(localNormal);
    const maxComp = max(absN.x, max(absN.y, absN.z));

    const isX = step(maxComp.sub(float(0.01)), absN.x);
    const isY = step(maxComp.sub(float(0.01)), absN.y).mul(float(1).sub(isX));
    const isZ = float(1).sub(isX).sub(isY);

    const posX = step(float(0), localNormal.x);
    const posY = step(float(0), localNormal.y);
    const posZ = step(float(0), localNormal.z);

    const faceIdx = isX
      .mul(float(1).sub(posX))
      .add(isY.mul(float(2).add(float(1).sub(posY))))
      .add(isZ.mul(float(4).add(float(1).sub(posZ))));

    const cellsPerPart = float(6);
    const globalCellIdx = partIndex.mul(cellsPerPart).add(faceIdx);

    const col = mod(globalCellIdx, atlasCols);
    const row = floor(globalCellIdx.div(atlasCols));

    const cellScale = vec2(float(1).div(atlasCols), float(1).div(atlasRows));
    const flippedUV = vec2(baseUV.x, float(1).sub(baseUV.y));
    const scaledUV = flippedUV.mul(cellScale);
    const offset = vec2(col.div(atlasCols), row.div(atlasRows));

    return scaledUV.add(offset);
  },
);
