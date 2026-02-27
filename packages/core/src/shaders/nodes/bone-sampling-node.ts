import type { Texture } from "three";
import { Fn, float, vec2, vec4, texture } from "three/tsl";

type NodeRef = ReturnType<typeof float>;

export const getBoneColumns = /* @__PURE__ */ Fn(
  ([boneIdx, boneOffset, boneTexture, texWidth, texHeight]: [
    NodeRef,
    NodeRef,
    NodeRef,
    NodeRef,
    NodeRef,
  ]) => {
    const globalIdx = boneOffset.add(boneIdx);
    const pixelIdx = globalIdx.mul(4.0);
    const row = pixelIdx.div(texWidth).floor();
    const col = pixelIdx.sub(row.mul(texWidth));

    const halfW = float(0.5).div(texWidth);
    const halfH = float(0.5).div(texHeight);

    const baseU = col.div(texWidth).add(halfW);
    const baseV = row.div(texHeight).add(halfH);
    const stepU = float(1).div(texWidth);

    const c0 = texture(boneTexture as Texture, vec2(baseU, baseV));
    const c1 = texture(boneTexture as Texture, vec2(baseU.add(stepU), baseV));
    const c2 = texture(
      boneTexture as Texture,
      vec2(baseU.add(stepU.mul(2)), baseV),
    );
    const c3 = texture(
      boneTexture as Texture,
      vec2(baseU.add(stepU.mul(3)), baseV),
    );

    return vec4(c0.x, c1.x, c2.x, c3.x);
  },
);

export const skinPosition = /* @__PURE__ */ Fn(
  ([
    position,
    pivotOffset,
    skinIndex,
    skinWeight,
    boneOffset,
    boneTexture,
    texWidth,
    texHeight,
  ]: [
    NodeRef,
    NodeRef,
    NodeRef,
    NodeRef,
    NodeRef,
    NodeRef,
    NodeRef,
    NodeRef,
  ]) => {
    const localPos = position.sub(pivotOffset);

    const transformBone = (boneIdx: NodeRef, weight: NodeRef) => {
      const globalIdx = boneOffset.add(boneIdx);
      const pixelBase = globalIdx.mul(4.0);
      const row = pixelBase.div(texWidth).floor();
      const col = pixelBase.sub(row.mul(texWidth));

      const halfW = float(0.5).div(texWidth);
      const halfH = float(0.5).div(texHeight);
      const baseU = col.div(texWidth).add(halfW);
      const baseV = row.div(texHeight).add(halfH);
      const stepU = float(1).div(texWidth);

      const col0 = texture(boneTexture as Texture, vec2(baseU, baseV));
      const col1 = texture(
        boneTexture as Texture,
        vec2(baseU.add(stepU), baseV),
      );
      const col2 = texture(
        boneTexture as Texture,
        vec2(baseU.add(stepU.mul(2)), baseV),
      );
      const col3 = texture(
        boneTexture as Texture,
        vec2(baseU.add(stepU.mul(3)), baseV),
      );

      const tx = col0
        .mul(localPos.x)
        .add(col1.mul(localPos.y))
        .add(col2.mul(localPos.z))
        .add(col3);

      return tx.xyz.mul(weight);
    };

    const result = transformBone(skinIndex.x, skinWeight.x)
      .add(transformBone(skinIndex.y, skinWeight.y))
      .add(transformBone(skinIndex.z, skinWeight.z))
      .add(transformBone(skinIndex.w, skinWeight.w));

    return result.add(pivotOffset);
  },
);
