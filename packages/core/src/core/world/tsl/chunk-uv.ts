import { abs, float, floor, fract, If, mix, vec2, vec3, vec4 } from "three/tsl";
import type { Node } from "three/webgpu";

export function computeChunkUV(params: {
  isGreedy: Node;
  worldPosition: Node;
  worldNormal: Node;
  baseUV: Node;
  atlasSize: Node;
}): Node {
  const { isGreedy, worldPosition, worldNormal, baseUV, atlasSize } = params;

  const finalUv = vec2(baseUV).toVar();

  If(isGreedy.greaterThan(0.5), () => {
    const cellSize = float(1.0).div(atlasSize);
    const padding = cellSize.div(4.0);
    const absNormal = abs(worldNormal);
    const localUv = vec2(0.0).toVar();

    If(absNormal.y.greaterThan(0.5), () => {
      If(worldNormal.y.greaterThan(0.0), () => {
        localUv.assign(
          vec2(float(1.0).sub(fract(worldPosition.x)), fract(worldPosition.z)),
        );
      }).Else(() => {
        localUv.assign(
          vec2(fract(worldPosition.x), float(1.0).sub(fract(worldPosition.z))),
        );
      });
    })
      .ElseIf(absNormal.x.greaterThan(0.5), () => {
        If(worldNormal.x.greaterThan(0.0), () => {
          localUv.assign(
            vec2(
              float(1.0).sub(fract(worldPosition.z)),
              fract(worldPosition.y),
            ),
          );
        }).Else(() => {
          localUv.assign(vec2(fract(worldPosition.z), fract(worldPosition.y)));
        });
      })
      .Else(() => {
        If(worldNormal.z.greaterThan(0.0), () => {
          localUv.assign(vec2(fract(worldPosition.x), fract(worldPosition.y)));
        }).Else(() => {
          localUv.assign(
            vec2(
              float(1.0).sub(fract(worldPosition.x)),
              fract(worldPosition.y),
            ),
          );
        });
      });

    const cellMin = floor(baseUV.div(cellSize)).mul(cellSize);
    const innerMin = cellMin.add(padding);
    const innerSize = cellSize.sub(padding.mul(2.0));
    finalUv.assign(innerMin.add(localUv.mul(innerSize)));
  });

  return finalUv;
}

export function applyGreedyDebug(params: {
  color: Node;
  isGreedy: Node;
  isShowDebug: Node;
}): Node {
  const { color, isGreedy, isShowDebug } = params;

  const result = vec4(color).toVar();

  If(isShowDebug.greaterThan(0.5), () => {
    const debugTarget = vec3(1.0, 0.0, 0.0).toVar();
    If(isGreedy.greaterThan(0.5), () => {
      debugTarget.assign(vec3(0.0, 1.0, 0.0));
    });
    result.assign(vec4(mix(result.rgb, debugTarget, 0.4), result.a));
  });

  return result;
}
