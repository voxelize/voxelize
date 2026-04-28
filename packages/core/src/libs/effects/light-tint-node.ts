import { Color, type Material, type Texture } from "three";
import {
  attribute,
  float,
  mix,
  texture as tslTexture,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import type { NodeMaterial } from "three/webgpu";

const colorUniform = (initial: Color) => uniform(initial);
const scalarUniform = (initial: number) => uniform(initial);

type ColorUniform = ReturnType<typeof colorUniform>;
type ScalarUniform = ReturnType<typeof scalarUniform>;

export type LightTintHandles = {
  readonly isLightTintHandles: true;
  lightUniform: ColorUniform;
  hitColorUniform: ColorUniform;
  hitAmountUniform: ScalarUniform;
};

export type NodeMaterialLike = Material & {
  readonly isNodeMaterial: boolean;
  colorNode: NodeMaterial["colorNode"];
  map?: Texture | null;
  vertexColors?: boolean;
  color?: Color;
};

export function isNodeMaterial(
  material: Material,
): material is NodeMaterialLike {
  return (material as Partial<NodeMaterialLike>).isNodeMaterial === true;
}

const HANDLES_KEY = "lightTintHandles";

export function getLightTintHandles(
  material: Material,
): LightTintHandles | null {
  const slot = material.userData[HANDLES_KEY];
  if (slot && (slot as Partial<LightTintHandles>).isLightTintHandles) {
    return slot as LightTintHandles;
  }
  return null;
}

export function attachLightTintNodes(
  material: NodeMaterialLike,
): LightTintHandles {
  const existing = getLightTintHandles(material);
  if (existing) return existing;

  const lightUniform = colorUniform(new Color(1, 1, 1));
  const hitColorUniform = colorUniform(new Color(1, 0, 0));
  const hitAmountUniform = scalarUniform(0);

  const map = material.map ?? null;
  const sampled = map ? tslTexture(map) : null;

  let baseRgb;
  let baseAlpha;
  if (sampled) {
    baseRgb = sampled.rgb;
    baseAlpha = sampled.a;
  } else if (material.vertexColors === true) {
    baseRgb = attribute("color", "vec3");
    baseAlpha = float(1);
  } else {
    baseRgb = vec3(1);
    baseAlpha = float(1);
  }

  const colorTint = material.color;
  const hasNonWhiteTint =
    colorTint !== undefined &&
    (colorTint.r !== 1 || colorTint.g !== 1 || colorTint.b !== 1);
  const tintedBase = hasNonWhiteTint
    ? baseRgb.mul(vec3(uniform(colorTint)))
    : baseRgb;

  const tinted = tintedBase.mul(vec3(lightUniform));
  const finalRgb = mix(tinted, vec3(hitColorUniform), hitAmountUniform);

  material.colorNode = vec4(finalRgb, baseAlpha);
  material.needsUpdate = true;

  const handles: LightTintHandles = {
    isLightTintHandles: true,
    lightUniform,
    hitColorUniform,
    hitAmountUniform,
  };

  material.userData[HANDLES_KEY] = handles;
  return handles;
}
