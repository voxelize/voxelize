import { Color, DoubleSide, Vector4 } from "three";
import type { Texture } from "three";
import {
  attribute,
  texture,
  uniform,
  float,
  vec3,
  clamp,
  pow,
  mix,
  exp,
  step,
  positionWorld,
  normalWorld,
  uv,
} from "three/tsl";

import { greedyUVNode } from "../nodes/greedy-uv-node";
import { voxelFogNode } from "../nodes/voxel-fog-node";
import { unpackVoxelFlags, unpackVoxelLight } from "../nodes/voxel-light-node";

type NodeRef = ReturnType<typeof float>;

function lookupAOTable(aoIndex: NodeRef, aoTable: NodeRef): NodeRef {
  const is0 = float(1).sub(step(float(0.5), aoIndex));
  const is1 = step(float(0.5), aoIndex).mul(
    float(1).sub(step(float(1.5), aoIndex)),
  );
  const is2 = step(float(1.5), aoIndex).mul(
    float(1).sub(step(float(2.5), aoIndex)),
  );
  const is3 = step(float(2.5), aoIndex);
  return aoTable.x
    .mul(is0)
    .add(aoTable.y.mul(is1))
    .add(aoTable.z.mul(is2))
    .add(aoTable.w.mul(is3))
    .div(255.0);
}

interface ChunkMaterialConfig {
  atlas: Texture;
  atlasSize: number;
}

interface ChunkMaterialSetup {
  colorNode: NodeRef;
  uniforms: {
    sunlightIntensity: ReturnType<typeof uniform>;
    minLightLevel: ReturnType<typeof uniform>;
    baseAmbient: ReturnType<typeof uniform>;
    lightIntensityAdjustment: ReturnType<typeof uniform>;
    fogNear: ReturnType<typeof uniform>;
    fogFar: ReturnType<typeof uniform>;
    fogHeightOrigin: ReturnType<typeof uniform>;
    fogHeightDensity: ReturnType<typeof uniform>;
  };
}

export function buildDefaultChunkNodes(
  config: ChunkMaterialConfig,
): ChunkMaterialSetup {
  const uSunlightIntensity = uniform(1.0);
  const uMinLightLevel = uniform(0.1);
  const uBaseAmbient = uniform(0.1);
  const uLightIntensityAdjustment = uniform(1.0);
  const uAOTable = uniform(new Vector4(255, 200, 150, 100));
  const uAtlasSize = uniform(config.atlasSize);
  const uFogColor = uniform(new Color(0.7, 0.75, 0.85));
  const uFogNear = uniform(100.0);
  const uFogFar = uniform(300.0);
  const uFogHeightOrigin = uniform(64.0);
  const uFogHeightDensity = uniform(0.02);

  const lightAttr = attribute("light", "int");
  const lightVec = unpackVoxelLight(lightAttr);
  const flagVec = unpackVoxelFlags(lightAttr);
  const aoIndex = flagVec.x;
  const isFluid = flagVec.y;
  const isGreedy = flagVec.z;

  const aoValue = lookupAOTable(aoIndex, uAOTable);

  const finalUv = greedyUVNode(
    uv(),
    positionWorld,
    normalWorld,
    uAtlasSize,
    isGreedy,
  );
  const texColor = texture(config.atlas, finalUv);

  const sunlightFactor = lightVec.w
    .mul(lightVec.w)
    .mul(uSunlightIntensity)
    .mul(uLightIntensityAdjustment);
  const s = clamp(
    sunlightFactor.add(uMinLightLevel.mul(lightVec.w)).add(uBaseAmbient),
    0.0,
    1.0,
  );
  const sAdj = s.sub(s.mul(exp(s.negate())).mul(0.02));

  const torchLight = pow(
    lightVec.xyz.mul(uLightIntensityAdjustment),
    vec3(2.0),
  );
  const torchAtt = float(1).sub(sAdj.mul(0.8));
  const combinedLight = vec3(sAdj).add(torchLight.mul(torchAtt));

  const litColor = texColor.xyz.mul(combinedLight);

  const aoFactor = mix(aoValue, float(1), isFluid.mul(0.8));
  const afterAO = litColor.mul(aoFactor);

  const foggedColor = voxelFogNode(
    afterAO,
    positionWorld,
    uFogColor,
    uFogNear,
    uFogFar,
    uFogHeightOrigin,
    uFogHeightDensity,
  );

  return {
    colorNode: foggedColor,
    uniforms: {
      sunlightIntensity: uSunlightIntensity,
      minLightLevel: uMinLightLevel,
      baseAmbient: uBaseAmbient,
      lightIntensityAdjustment: uLightIntensityAdjustment,
      fogNear: uFogNear,
      fogFar: uFogFar,
      fogHeightOrigin: uFogHeightOrigin,
      fogHeightDensity: uFogHeightDensity,
    },
  };
}
