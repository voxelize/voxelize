import {
  CubeCamera,
  CubeTexture,
  HalfFloatType,
  MeshDepthMaterial,
  NearestFilter,
  Object3D,
  RGBADepthPacking,
  RGBAFormat,
  Scene,
  Vector3,
  WebGLCubeRenderTarget,
  WebGLRenderer,
} from "three";

export interface PointLightShadowConfig {
  shadowMapSize: number;
  near: number;
  far: number;
  bias: number;
}

const defaultConfig: PointLightShadowConfig = {
  shadowMapSize: 512,
  near: 0.1,
  far: 32,
  bias: 0.005,
};

export class PointLightShadowRenderer {
  private config: PointLightShadowConfig;
  private cubeCamera: CubeCamera;
  private cubeRenderTarget: WebGLCubeRenderTarget;
  private depthMaterial: MeshDepthMaterial;
  private lightPosition = new Vector3();
  private lastLightPosition = new Vector3();
  private needsUpdate = true;
  private frameCount = 0;
  private updateInterval = 2;

  constructor(config: Partial<PointLightShadowConfig> = {}) {
    this.config = { ...defaultConfig, ...config };

    this.cubeRenderTarget = new WebGLCubeRenderTarget(
      this.config.shadowMapSize,
      {
        format: RGBAFormat,
        type: HalfFloatType,
        minFilter: NearestFilter,
        magFilter: NearestFilter,
        generateMipmaps: false,
      },
    );

    this.cubeCamera = new CubeCamera(
      this.config.near,
      this.config.far,
      this.cubeRenderTarget,
    );

    this.depthMaterial = new MeshDepthMaterial({
      depthPacking: RGBADepthPacking,
    });
  }

  setLightPosition(position: Vector3) {
    if (!this.lightPosition.equals(position)) {
      this.lightPosition.copy(position);
      this.needsUpdate = true;
    }
  }

  getLightPosition(): Vector3 {
    return this.lightPosition.clone();
  }

  getShadowMap(): CubeTexture {
    return this.cubeRenderTarget.texture;
  }

  getNear(): number {
    return this.config.near;
  }

  getFar(): number {
    return this.config.far;
  }

  getBias(): number {
    return this.config.bias;
  }

  update(
    renderer: WebGLRenderer,
    scene: Scene,
    skipObjects: Object3D[] = [],
  ): boolean {
    this.frameCount++;

    if (!this.needsUpdate && this.frameCount % this.updateInterval !== 0) {
      return false;
    }

    if (
      this.lightPosition.distanceToSquared(this.lastLightPosition) < 0.01 &&
      !this.needsUpdate
    ) {
      return false;
    }

    this.lastLightPosition.copy(this.lightPosition);
    this.needsUpdate = false;

    this.cubeCamera.position.copy(this.lightPosition);

    const originalVisibility = new Map<Object3D, boolean>();
    for (const obj of skipObjects) {
      originalVisibility.set(obj, obj.visible);
      obj.visible = false;
    }

    const originalOverrideMaterial = scene.overrideMaterial;
    scene.overrideMaterial = this.depthMaterial;

    this.cubeCamera.update(renderer, scene);

    scene.overrideMaterial = originalOverrideMaterial;

    for (const [obj, visible] of originalVisibility) {
      obj.visible = visible;
    }

    return true;
  }

  dispose() {
    this.cubeRenderTarget.dispose();
    this.depthMaterial.dispose();
  }
}

export const POINT_LIGHT_SHADOW_PARS = `
uniform samplerCube uPointShadowMap;
uniform vec3 uPointShadowLightPos;
uniform float uPointShadowNear;
uniform float uPointShadowFar;
uniform float uPointShadowBias;
uniform bool uPointShadowEnabled;

float unpackRGBAToDepth(vec4 v) {
  return dot(v, vec4(1.0, 1.0/255.0, 1.0/65025.0, 1.0/16581375.0));
}

float samplePointShadow(vec3 worldPos) {
  if (!uPointShadowEnabled) return 1.0;
  
  vec3 lightToFrag = worldPos - uPointShadowLightPos;
  float currentDepth = length(lightToFrag);
  
  if (currentDepth > uPointShadowFar) return 1.0;
  
  vec3 sampleDir = normalize(lightToFrag);
  
  vec4 shadowSample = texture(uPointShadowMap, sampleDir);
  float closestDepth = unpackRGBAToDepth(shadowSample) * uPointShadowFar;
  
  float bias = uPointShadowBias * (1.0 + currentDepth * 0.1);
  
  return currentDepth - bias > closestDepth ? 0.3 : 1.0;
}

float samplePointShadowSoft(vec3 worldPos, vec3 normal) {
  if (!uPointShadowEnabled) return 1.0;
  
  vec3 lightToFrag = worldPos - uPointShadowLightPos;
  float currentDepth = length(lightToFrag);
  
  if (currentDepth > uPointShadowFar) return 1.0;
  
  vec3 sampleDir = normalize(lightToFrag);
  
  float shadow = 0.0;
  float diskRadius = 0.02 * currentDepth / uPointShadowFar;
  
  vec3 tangent = normalize(cross(sampleDir, vec3(0.0, 1.0, 0.0)));
  if (length(tangent) < 0.001) {
    tangent = normalize(cross(sampleDir, vec3(1.0, 0.0, 0.0)));
  }
  vec3 bitangent = cross(sampleDir, tangent);
  
  const int samples = 4;
  float offsets[4] = float[](0.25, 0.5, 0.75, 1.0);
  float angles[4] = float[](0.0, 1.57, 3.14, 4.71);
  
  for (int i = 0; i < samples; i++) {
    float r = diskRadius * offsets[i];
    float a = angles[i] + currentDepth;
    vec3 offset = tangent * cos(a) * r + bitangent * sin(a) * r;
    vec3 dir = normalize(sampleDir + offset);
    
    vec4 shadowSample = texture(uPointShadowMap, dir);
    float closestDepth = unpackRGBAToDepth(shadowSample) * uPointShadowFar;
    
    float bias = uPointShadowBias * (1.0 + currentDepth * 0.1);
    shadow += currentDepth - bias > closestDepth ? 0.0 : 1.0;
  }
  
  shadow /= float(samples);
  return mix(0.3, 1.0, shadow);
}
`;
