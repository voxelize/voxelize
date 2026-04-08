import {
  cameraPosition,
  dot,
  exp,
  float,
  If,
  max,
  mix,
  smoothstep,
  sqrt,
  vec3,
} from "three/tsl";
import type { Node } from "three/webgpu";

export function applyChunkFog(params: {
  color: Node;
  worldPosition: Node;
  fogColor: Node;
  fogNear: Node;
  fogFar: Node;
  fogHeightOrigin: Node;
  fogHeightDensity: Node;
}): Node {
  const {
    color,
    worldPosition,
    fogColor,
    fogNear,
    fogFar,
    fogHeightOrigin,
    fogHeightDensity,
  } = params;

  const fogDiff = worldPosition.xz.sub(cameraPosition.xz);
  const depth = sqrt(dot(fogDiff, fogDiff));
  const distFog = smoothstep(fogNear, fogFar, depth);
  const heightFog = float(1.0).sub(
    exp(
      fogHeightDensity
        .negate()
        .mul(max(fogHeightOrigin.sub(worldPosition.y), 0.0)),
    ),
  );
  const heightDistScale = smoothstep(fogNear.mul(0.3), fogFar.mul(0.6), depth);
  const fogFactor = max(distFog, heightFog.mul(heightDistScale));

  return mix(color, fogColor, fogFactor);
}

export function applyShadowDebug(params: {
  color: Node;
  debugMode: Node;
  shadow: Node;
  worldNormal: Node;
  sunDirection: Node;
  ao: Node;
  viewDepth: Node;
  cascadeSplits: [Node, Node, Node];
  sunExposure: Node;
  tunnelDarkening: Node;
}): Node {
  const {
    color,
    debugMode,
    shadow,
    worldNormal,
    sunDirection,
    ao,
    viewDepth,
    cascadeSplits,
    sunExposure,
    tunnelDarkening,
  } = params;

  const result = vec3(color).toVar();

  If(debugMode.greaterThan(0.5), () => {
    If(debugMode.lessThan(1.5), () => {
      result.assign(vec3(shadow));
    })
      .ElseIf(debugMode.lessThan(2.5), () => {
        result.assign(vec3(max(dot(worldNormal, sunDirection), 0.0)));
      })
      .ElseIf(debugMode.lessThan(3.5), () => {
        result.assign(vec3(ao));
      })
      .ElseIf(debugMode.lessThan(4.5), () => {
        If(viewDepth.lessThan(cascadeSplits[0]), () => {
          result.assign(vec3(1.0, 0.0, 0.0));
        })
          .ElseIf(viewDepth.lessThan(cascadeSplits[1]), () => {
            result.assign(vec3(0.0, 1.0, 0.0));
          })
          .ElseIf(viewDepth.lessThan(cascadeSplits[2]), () => {
            result.assign(vec3(0.0, 0.0, 1.0));
          })
          .Else(() => {
            result.assign(vec3(1.0, 1.0, 0.0));
          });
      })
      .ElseIf(debugMode.lessThan(5.5), () => {
        const ndotL = dot(worldNormal, sunDirection);
        const slopeBias = max(float(0.005).mul(float(1.0).sub(ndotL)), 0.001);
        result.assign(vec3(slopeBias.mul(100.0)));
      })
      .ElseIf(debugMode.lessThan(6.5), () => {
        result.assign(vec3(sunExposure));
      })
      .ElseIf(debugMode.lessThan(7.5), () => {
        result.assign(vec3(tunnelDarkening));
      });
  });

  return result;
}
