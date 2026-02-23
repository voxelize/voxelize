import {
  add,
  cameraPosition,
  exp,
  float,
  max,
  mix,
  mul,
  smoothstep,
  sqrt,
  sub,
} from "three/tsl";

type TslNode = ReturnType<typeof float>;

export type VoxelFogParams = {
  inputColor: TslNode;
  worldPosition: TslNode;
  fogColor: TslNode;
  fogNear: TslNode;
  fogFar: TslNode;
  fogHeightOrigin: TslNode;
  fogHeightDensity: TslNode;
};

export const voxelFogNode = ({
  inputColor,
  worldPosition,
  fogColor,
  fogNear,
  fogFar,
  fogHeightOrigin,
  fogHeightDensity,
}: VoxelFogParams) => {
  const fogDiff = sub(worldPosition.xz, cameraPosition.xz);
  const depth = sqrt(add(mul(fogDiff.x, fogDiff.x), mul(fogDiff.y, fogDiff.y)));

  const distFog = smoothstep(fogNear, fogFar, depth);
  const heightDiff = max(0.0, sub(fogHeightOrigin, worldPosition.y));
  const heightFog = sub(1.0, exp(mul(mul(-1.0, fogHeightDensity), heightDiff)));
  const heightDistScale = smoothstep(
    mul(fogNear, 0.3),
    mul(fogFar, 0.6),
    depth,
  );
  const fogFactor = max(distFog, mul(heightFog, heightDistScale));

  return mix(inputColor, fogColor, fogFactor);
};
