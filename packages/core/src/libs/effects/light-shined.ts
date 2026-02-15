import { Color, Material, Mesh, Object3D, Vector3 } from "three";

import { World } from "../../core";
import { ThreeUtils } from "../../utils";
import { NameTag } from "../nametag";
import { Shadow } from "../shadows";
import type { DynamicLight } from "../../core/world/light-registry";

const position = new Vector3();
const tempColor = new Color();

export type LightShinedOptions = {
  /**
   * The lerping factor of the brightness of each mesh. Defaults to `0.1`.
   */
  lerpFactor: number;
  /**
   * The maximum brightness cap for the light effect. Defaults to `2.5`.
   */
  maxBrightness: number;
};

const defaultOptions: LightShinedOptions = {
  lerpFactor: 0.1,
  maxBrightness: 2.5,
};

/**
 * A class that allows mesh to dynamically change brightness based on the voxel light level at their position.
 *
 * By default, `VOXELIZE.Shadow` and `VOXELIZE.NameTag` is ignored by this effect.
 *
 * # Example
 * ```ts
 * // Create a light shined effect manager.
 * const lightShined = new VOXELIZE.LightShined();
 *
 * // Add the effect to a mesh.
 * lightShined.add(character);
 *
 * // In the render loop, update the effect.
 * lightShined.update();
 * ```
 *
 * ![Example](/img/docs/light-shined.png)
 *
 * @category Effects
 */
export class LightShined {
  private static readonly zeroColor = new Color(0, 0, 0);

  /**
   * Parameters to customize the effect.
   */
  public options: LightShinedOptions;

  /**
   * A list of meshes that are effected by this effect.
   */
  public list: Set<Object3D> = new Set();

  /**
   * A list of types that are ignored by this effect.
   */
  public ignored: Set<Function> = new Set();
  private ignoredTypes: Function[] = [];

  private positionOverrides = new Map<Object3D, Vector3>();
  private torchLightColor = new Color();
  private traversalStack: Object3D[] = [];
  private raycastOrigin: [number, number, number] = [0, 0, 0];
  private raycastDirection: [number, number, number] = [0, 0, 0];
  private nearbyLightsBuffer: DynamicLight[] = [];

  /**
   * Construct a light shined effect manager.
   *
   * @param world The world that the effect is applied to.
   * @param options Parameters to customize the effect.
   */
  constructor(public world: World, options: Partial<LightShinedOptions> = {}) {
    this.options = { ...defaultOptions, ...options };

    this.ignore(Shadow);
    this.ignore(NameTag);
  }

  /**
   * Add an object to be affected by this effect.
   *
   * @param obj A THREE.JS object to be shined on.
   */
  add = (obj: Object3D) => {
    this.list.add(obj);
    this.setupLightMaterials(obj);
  };

  /**
   * Remove an object from being affected by this effect
   *
   * @param obj The object to be removed from the effect.
   */
  remove = (obj: Object3D) => {
    this.list.delete(obj);
  };

  /**
   * Update the light shined effect. This fetches the light level at the position of
   * each object and recursively updates the brightness of the object.
   *
   * This should be called in the render loop.
   */
  update = () => {
    let objects = this.list.values();
    let object = objects.next();
    while (!object.done) {
      this.recursiveUpdate(object.value);
      object = objects.next();
    }
  };

  setPositionOverride = (obj: Object3D, position: Vector3) => {
    this.positionOverrides.set(obj, position);
  };

  clearPositionOverride = (obj: Object3D) => {
    this.positionOverrides.delete(obj);
  };

  ignore = (...types: Function[]) => {
    for (let index = 0; index < types.length; index++) {
      const type = types[index];
      if (this.ignored.has(type)) {
        continue;
      }
      this.ignored.add(type);
      this.ignoredTypes.push(type);
    }
  };

  private setupLightMaterials = (obj: Object3D) => {
    const setupMaterial = (material: Material) => {
      if (
        ThreeUtils.isShaderMaterial(material) ||
        material.userData.lightEffectSetup
      )
        return;

      const lightUniform = { value: new Color(1, 1, 1) };
      const oldOnBeforeCompile = material.onBeforeCompile;
      material.onBeforeCompile = (shader, renderer) => {
        if (oldOnBeforeCompile) {
          oldOnBeforeCompile(shader, renderer);
        }

        shader.uniforms.lightEffect = lightUniform;
        shader.vertexShader = shader.vertexShader.replace(
          "void main() {",
          `
          uniform vec3 lightEffect;
          void main() {
          `
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          "void main() {",
          `
          uniform vec3 lightEffect;
          void main() {
          `
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <color_fragment>",
          `
          #include <color_fragment>
          diffuseColor.rgb *= lightEffect;
          `
        );
      };
      material.needsUpdate = true;
      if (!obj.userData.lightUniforms) {
        obj.userData.lightUniforms = [];
      }
      obj.userData.lightUniforms.push(lightUniform);
      material.userData.lightEffectSetup = true;
    };

    const setupObjectAndChildren = (object: Object3D) => {
      if (object instanceof Mesh) {
        if (Array.isArray(object.material)) {
          const materials = object.material;
          for (let materialIndex = 0; materialIndex < materials.length; materialIndex++) {
            setupMaterial(materials[materialIndex]);
          }
        } else {
          setupMaterial(object.material);
        }
      }
      for (let childIndex = 0; childIndex < object.children.length; childIndex++) {
        setupObjectAndChildren(object.children[childIndex]);
      }
    };

    // Setup initial materials
    setupObjectAndChildren(obj);

    // Setup proxies to detect changes
    const setupProxies = (object: Object3D) => {
      if (object instanceof Mesh) {
        object.material = new Proxy(object.material, {
          set: (target, prop, value) => {
            target[prop] = value;
            if (prop === "needsUpdate" && value === true) {
              setupObjectAndChildren(object);
            }
            return true;
          },
        });
        obj.userData.justChanged = true;
      }

      object.children = new Proxy(object.children, {
        set: (target, prop, value) => {
          target[prop] = value;
          if (typeof prop === "string" && !isNaN(Number(prop))) {
            setupObjectAndChildren(value);
            setupProxies(value);
          }
          return true;
        },
      });

      for (let childIndex = 0; childIndex < object.children.length; childIndex++) {
        setupProxies(object.children[childIndex]);
      }
    };

    setupProxies(obj);
  };

  private updateObject = (obj: Object3D, color: Color) => {
    const ignoredTypes = this.ignoredTypes;
    for (let typeIndex = 0; typeIndex < ignoredTypes.length; typeIndex++) {
      if (obj instanceof ignoredTypes[typeIndex]) return;
    }

    if (obj.userData.lightUniforms) {
      const lightUniforms = obj.userData.lightUniforms as Array<{
        value: Color;
      }>;
      for (let uniformIndex = 0; uniformIndex < lightUniforms.length; uniformIndex++) {
        const uniform = lightUniforms[uniformIndex];
        if (obj.userData.justChanged) {
          uniform.value.copy(color);
        } else {
          uniform.value.lerp(color, this.options.lerpFactor);
        }
        // Apply the brightness cap
        uniform.value.r = Math.min(uniform.value.r, this.options.maxBrightness);
        uniform.value.g = Math.min(uniform.value.g, this.options.maxBrightness);
        uniform.value.b = Math.min(uniform.value.b, this.options.maxBrightness);
      }
    }
    obj.userData.justChanged = false;
  };

  private recursiveUpdate = (obj: Object3D, color: Color | null = null) => {
    if (!obj.parent) return;

    const ignoredTypes = this.ignoredTypes;
    for (let typeIndex = 0; typeIndex < ignoredTypes.length; typeIndex++) {
      if (obj instanceof ignoredTypes[typeIndex]) return;
    }

    if (color === null) {
      const override = this.positionOverrides.get(obj);
      if (override) {
        position.copy(override);
      } else {
        obj.getWorldPosition(position);
      }

      if (this.world.usesShaderLighting) {
        color = this.computeShaderBasedLight(position);
      } else {
        color = this.computeCPUBasedLight(position);
      }

      if (!color) return;
    }

    this.updateObjectSubtree(obj, color);
  };

  private updateObjectSubtree(root: Object3D, color: Color) {
    const stack = this.traversalStack;
    stack.length = 0;
    stack.push(root);

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) {
        continue;
      }

      this.updateObject(current, color);

      const children = current.children;
      for (let childIndex = 0; childIndex < children.length; childIndex++) {
        stack.push(children[childIndex]);
      }
    }
  }

  private computeCPUBasedLight(pos: Vector3): Color | null {
    const vx = Math.floor(pos.x);
    const vy = Math.floor(pos.y);
    const vz = Math.floor(pos.z);
    const lightValues = this.world.getLightValuesAt(vx, vy, vz);
    if (!lightValues) return null;

    const { sunlight, red, green, blue } = lightValues;
    const { sunlightIntensity, minLightLevel, baseAmbient } =
      this.world.chunkRenderer.uniforms;
    const maxLightLevel = this.world.options.maxLightLevel;

    const sunlightNorm = sunlight / maxLightLevel;
    const sunlightFactor = sunlightNorm ** 2 * sunlightIntensity.value;
    const s = Math.min(
      sunlightFactor + minLightLevel.value * sunlightNorm + baseAmbient.value,
      1
    );

    const torchR = (red / maxLightLevel) ** 2;
    const torchG = (green / maxLightLevel) ** 2;
    const torchB = (blue / maxLightLevel) ** 2;
    const torchAttenuation = 1.0 - s * 0.8;

    return tempColor.setRGB(
      s + torchR * torchAttenuation,
      s + torchG * torchAttenuation,
      s + torchB * torchAttenuation
    );
  }

  private computeShaderBasedLight(pos: Vector3): Color {
    const { sunlightIntensity } = this.world.chunkRenderer.uniforms;
    const { sunColor, ambientColor } =
      this.world.chunkRenderer.shaderLightingUniforms;
    const maxLightLevel = this.world.options.maxLightLevel;

    const shadowFactor = this.computeShadowFactor(pos);

    const avgNdotL = 0.5;
    const sunContrib = sunlightIntensity.value * avgNdotL * shadowFactor;

    const torchLight = this.getTorchLightAtPosition(pos);

    const vx = Math.floor(pos.x);
    const vy = Math.floor(pos.y);
    const vz = Math.floor(pos.z);
    const lightValues = this.world.getLightValuesAt(vx, vy, vz);

    let cpuTorchR = 0,
      cpuTorchG = 0,
      cpuTorchB = 0;
    if (lightValues) {
      cpuTorchR = (lightValues.red / maxLightLevel) ** 2;
      cpuTorchG = (lightValues.green / maxLightLevel) ** 2;
      cpuTorchB = (lightValues.blue / maxLightLevel) ** 2;
    }

    const sunBasedLight = ambientColor.value.r + sunColor.value.r * sunContrib;
    const torchAttenuation = 1.0 - Math.min(sunBasedLight, 1.0) * 0.8;

    const totalR =
      ambientColor.value.r +
      sunColor.value.r * sunContrib +
      (torchLight.r + cpuTorchR) * torchAttenuation;
    const totalG =
      ambientColor.value.g +
      sunColor.value.g * sunContrib +
      (torchLight.g + cpuTorchG) * torchAttenuation;
    const totalB =
      ambientColor.value.b +
      sunColor.value.b * sunContrib +
      (torchLight.b + cpuTorchB) * torchAttenuation;

    return tempColor.setRGB(
      Math.min(totalR, this.options.maxBrightness),
      Math.min(totalG, this.options.maxBrightness),
      Math.min(totalB, this.options.maxBrightness)
    );
  }

  private getTorchLightAtPosition(pos: Vector3): Color {
    const registry = this.world.lightRegistry;
    if (!registry) return LightShined.zeroColor;

    const lights = this.nearbyLightsBuffer;
    const lightCount = registry.getLightsNearPointInto(pos, 16, lights);
    let r = 0,
      g = 0,
      b = 0;

    for (let lightIndex = 0; lightIndex < lightCount; lightIndex++) {
      const light = lights[lightIndex];
      const radius = light.radius;
      if (radius <= 0) {
        continue;
      }

      const dx = light.position.x - pos.x;
      const dy = light.position.y - pos.y;
      const dz = light.position.z - pos.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      const radiusSq = radius * radius;
      if (distSq > radiusSq) continue;

      const dist = Math.sqrt(distSq);
      const attenuation = Math.pow(1 - dist / radius, light.falloffExponent);
      const intensity = light.intensity * attenuation;

      r += light.color.r * intensity;
      g += light.color.g * intensity;
      b += light.color.b * intensity;
    }

    return this.torchLightColor.setRGB(r, g, b);
  }

  private computeShadowFactor(pos: Vector3): number {
    if (!this.world.usesShaderLighting || !this.world.csmRenderer) return 1.0;

    const { sunDirection, shadowStrength } =
      this.world.chunkRenderer.shaderLightingUniforms;

    if (shadowStrength.value < 0.01) return 1.0;

    const dir = this.raycastDirection;
    dir[0] = sunDirection.value.x;
    dir[1] = sunDirection.value.y;
    dir[2] = sunDirection.value.z;
    const origin = this.raycastOrigin;
    origin[0] = pos.x;
    origin[1] = pos.y;
    origin[2] = pos.z;
    const maxDist = 64;

    const hit = this.world.raycastVoxels(origin, dir, maxDist);

    if (hit) {
      return 1.0 - shadowStrength.value;
    }

    return 1.0;
  }
}
