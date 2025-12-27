import { Color, Vector4 } from "three";

import { CustomChunkShaderMaterial } from ".";

export class ChunkRenderer {
  public materials: Map<string, CustomChunkShaderMaterial> = new Map();

  public uniforms: {
    fogColor: { value: Color };
    fogNear: { value: number };
    fogFar: { value: number };
    ao: { value: Vector4 };
    minLightLevel: { value: number };
    sunlightIntensity: { value: number };
    time: { value: number };
    lightIntensityAdjustment: { value: number };
    atlasSize: { value: number };
    showGreedyDebug: { value: number };
  } = {
    fogColor: { value: new Color("#B1CCFD") },
    fogNear: { value: 100 },
    fogFar: { value: 200 },
    ao: { value: new Vector4(100.0, 170.0, 210.0, 255.0) },
    minLightLevel: { value: 0 },
    sunlightIntensity: { value: 1 },
    time: { value: performance.now() },
    lightIntensityAdjustment: { value: 0.8 },
    atlasSize: { value: 16 },
    showGreedyDebug: { value: 0 },
  };
}
