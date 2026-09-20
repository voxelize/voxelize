import { Color, Material, Mesh, Object3D, Vector3 } from "three";

import { World } from "../../core";
import {
  composeEntityLight,
  EntityLightSample,
} from "../../core/world/entity-light";
import { blockLightFloodRemainder } from "../../core/world/local-lights";
import {
  getDownwellingTransmittance,
  WATER_OPTICS,
  WATER_SURFACE_SCATTER_COLOR,
} from "../../core/world/water-optics";
import { ChunkUtils, ThreeUtils } from "../../utils";
import { NameTag } from "../nametag";

const position = new Vector3();
const tempColor = new Color();
const waterTransmittance = new Color();
const underwaterFill = new Color();
const lightSample: EntityLightSample = {
  sunExposure: 0,
  floodR: 0,
  floodG: 0,
  floodB: 0,
  floodRemainder: 1,
  clusterR: 0,
  clusterG: 0,
  clusterB: 0,
  shadowFactor: 1,
  sunlightIntensity: 1,
  sunColor: new Color(1, 1, 1),
  ambientColor: new Color(1, 1, 1),
  ambientFloor: 0,
  downTransmit: waterTransmittance,
  underwaterFill,
};
const localLightSample = {
  color: [0, 0, 0] as [number, number, number],
  count: 0,
  claim: 0,
  windowFade: 1,
};
const localLightQueryOptions = { floodMask: 1, timeMs: 0 };
const floodRemainderArgs = { scaledClaim: 0, floodLevel: 0, windowFade: 1 };

type IgnoredType = abstract new (...args: never[]) => object;

export type LightShinedOptions = {
  /**
   * The lerping factor of the brightness of each mesh. Defaults to `0.1`.
   */
  lerpFactor: number;
  /**
   * Cap on the composed light multiplier, applied after tone mapping. The
   * composition already runs through the chunk shader's ACES curve, which
   * tops out near `1.03`, so this only trims that asymptote: the materials
   * under this effect are unlit and untonemapped, and any multiplier past
   * `1` pushes their texture toward white. Defaults to `1`.
   */
  maxBrightness: number;
  /**
   * Frames between fresh light samples for a stationary object. Each sample
   * pays a sun raycast, a water-column walk, and a local-light query, while
   * the sampled color is only ever consumed through the per-frame
   * `lerpFactor` smoothing — a filter whose settling time is already several
   * frames long, so a stationary object cannot display the difference
   * between "sampled every frame" and "sampled every few frames". Objects
   * are phase-staggered so the samples spread across frames instead of
   * bunching. Defaults to `4`.
   */
  sampleIntervalFrames: number;
  /**
   * Movement in blocks past which an object is resampled immediately
   * instead of waiting out its interval: light data is voxel-grained, so a
   * fast mover can cross into differently-lit voxels between scheduled
   * samples. Defaults to `0.5`.
   */
  resampleDistance: number;
};

const defaultOptions: LightShinedOptions = {
  lerpFactor: 0.1,
  maxBrightness: 1,
  sampleIntervalFrames: 4,
  resampleDistance: 0.5,
};

type LightSample = {
  color: Color;
  position: Vector3;
  phase: number;
};

/**
 * Mark a material as its own light source, so the voxel-light effects leave
 * it alone. A lamp lens, a screen, or a glowing sign must not be multiplied
 * by the light around it: that would put the emitter out in exactly the dark
 * it was lit for. Honored by {@link LightShined} and by the Arm's
 * held-object lighting and shadow shaders.
 */
export function markSelfIlluminated(material: Material): void {
  material.userData.isSelfIlluminated = true;
}

export function isSelfIlluminated(material: Material): boolean {
  return material.userData.isSelfIlluminated === true;
}

/**
 * A class that allows mesh to dynamically change brightness based on the voxel light level at their position.
 *
 * By default, `VOXELIZE.NameTag` is ignored by this effect.
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
  public ignored: Set<IgnoredType> = new Set();

  private positionOverrides = new Map<Object3D, Vector3>();

  private samples = new Map<Object3D, LightSample>();

  private frameIndex = 0;

  private nextSamplePhase = 0;

  /**
   * Construct a light shined effect manager.
   *
   * @param world The world that the effect is applied to.
   * @param options Parameters to customize the effect.
   */
  constructor(
    public world: World,
    options: Partial<LightShinedOptions> = {},
  ) {
    this.options = { ...defaultOptions, ...options };

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
    this.samples.delete(obj);
  };

  /**
   * Update the light shined effect. This fetches the light level at the position of
   * each object and recursively updates the brightness of the object.
   *
   * This should be called in the render loop.
   */
  update = () => {
    this.frameIndex++;
    this.list.forEach((obj) => {
      this.recursiveUpdate(obj);
    });
  };

  setPositionOverride = (obj: Object3D, position: Vector3) => {
    this.positionOverrides.set(obj, position);
  };

  clearPositionOverride = (obj: Object3D) => {
    this.positionOverrides.delete(obj);
  };

  ignore = (...types: IgnoredType[]) => {
    types.forEach((type) => {
      this.ignored.add(type);
    });
  };

  private setupLightMaterials = (obj: Object3D) => {
    const setupMaterial = (material: Material) => {
      if (
        ThreeUtils.isShaderMaterial(material) ||
        material.userData.lightEffectSetup ||
        material.userData.heldObjectLighting === true ||
        isSelfIlluminated(material)
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
          `,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          "void main() {",
          `
          uniform vec3 lightEffect;
          void main() {
          `,
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <color_fragment>",
          `
          #include <color_fragment>
          diffuseColor.rgb *= lightEffect;
          `,
        );
      };
      material.needsUpdate = true;
      if (!obj.userData.lightUniforms) {
        obj.userData.lightUniforms = [];
      }
      obj.userData.lightUniforms.push(lightUniform);
      material.userData.lightEffectSetup = true;
    };

    const isMesh = (object: Object3D): object is Mesh => {
      return object instanceof Mesh;
    };

    const setupObjectAndChildren = (object: Object3D) => {
      if (isMesh(object)) {
        if (Array.isArray(object.material)) {
          object.material.forEach(setupMaterial);
        } else {
          setupMaterial(object.material);
        }
      }
      object.children.forEach(setupObjectAndChildren);
    };

    // Setup initial materials
    setupObjectAndChildren(obj);

    // Setup proxies to detect changes
    const setupProxies = (object: Object3D) => {
      if (isMesh(object)) {
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

      object.children.forEach(setupProxies);
    };

    setupProxies(obj);
  };

  private updateObject = (obj: Object3D, color: Color) => {
    for (const type of this.ignored) {
      if (obj instanceof type) return;
    }

    if (obj.userData.lightUniforms) {
      obj.userData.lightUniforms.forEach((uniform: { value: Color }) => {
        if (obj.userData.justChanged) {
          uniform.value.copy(color);
        } else {
          uniform.value.lerp(color, this.options.lerpFactor);
        }
        // Apply the brightness cap
        uniform.value.r = Math.min(uniform.value.r, this.options.maxBrightness);
        uniform.value.g = Math.min(uniform.value.g, this.options.maxBrightness);
        uniform.value.b = Math.min(uniform.value.b, this.options.maxBrightness);
      });
    }
    obj.userData.justChanged = false;
  };

  private recursiveUpdate = (obj: Object3D, color: Color | null = null) => {
    if (!obj.parent) return;

    for (const type of this.ignored) {
      if (obj instanceof type) return;
    }

    if (color === null) {
      const override = this.positionOverrides.get(obj);
      if (override) {
        position.copy(override);
      } else {
        obj.getWorldPosition(position);
      }

      color = this.sampleLight(obj, position);
    }

    obj.traverse((child) => {
      this.updateObject(child, color);
    });
  };

  /** The cached target color for an object, refreshed on its stagger phase,
   * on real movement, or on a material swap — never merely because another
   * frame elapsed. The per-frame smoothing in updateObject is what consumers
   * see; it keeps running against the cached target every frame. */
  private sampleLight = (obj: Object3D, worldPosition: Vector3): Color => {
    let sample = this.samples.get(obj);

    if (!sample) {
      sample = {
        color: new Color(),
        position: new Vector3(),
        phase: this.nextSamplePhase++,
      };
      this.samples.set(obj, sample);
      sample.color.copy(this.computeShaderBasedLight(worldPosition));
      sample.position.copy(worldPosition);
      return sample.color;
    }

    const interval = Math.max(1, this.options.sampleIntervalFrames);
    const isDue = (this.frameIndex + sample.phase) % interval === 0;
    const hasMoved =
      sample.position.distanceToSquared(worldPosition) >
      this.options.resampleDistance * this.options.resampleDistance;

    if (isDue || hasMoved || obj.userData.justChanged === true) {
      sample.color.copy(this.computeShaderBasedLight(worldPosition));
      sample.position.copy(worldPosition);
    }

    return sample.color;
  };

  /**
   * Gather the chunk shader's inputs at a point — flood light, sun
   * exposure and shadow, the water column, the analytic lights in the cell
   * and their flood-ownership claim — and compose them exactly the way the
   * fragment program does (`composeEntityLight`), so the object and the
   * block it stands on agree on brightness under any sky.
   */
  private computeShaderBasedLight(pos: Vector3): Color {
    const { sunlightIntensity, minLightLevel, baseAmbient } =
      this.world.chunkRenderer.uniforms;
    const { sunColor, ambientColor } =
      this.world.chunkRenderer.shaderLightingUniforms;
    const maxLightLevel = this.world.options.maxLightLevel;

    const voxel = ChunkUtils.mapWorldToVoxel(pos.toArray());
    const lightValues = this.world.getLightValuesAt(...voxel);

    lightSample.sunExposure = lightValues
      ? lightValues.sunlight / maxLightLevel
      : 0;
    lightSample.floodR = lightValues ? lightValues.red / maxLightLevel : 0;
    lightSample.floodG = lightValues ? lightValues.green / maxLightLevel : 0;
    lightSample.floodB = lightValues ? lightValues.blue / maxLightLevel : 0;
    lightSample.shadowFactor = this.computeShadowFactor(pos);
    lightSample.sunlightIntensity = sunlightIntensity.value;
    lightSample.sunColor.copy(sunColor.value);
    lightSample.ambientColor.copy(ambientColor.value);
    lightSample.ambientFloor = Math.max(
      minLightLevel.value + baseAmbient.value,
      0,
    );

    // The water column above the point attenuates every sun-path term and
    // adds the surface's scattered fill, as `downTransmit` and
    // `underwaterFill` do for a submerged fragment.
    const column = this.world.measureWaterColumnAt(pos.x, pos.y, pos.z);
    getDownwellingTransmittance(column?.depth ?? 0, waterTransmittance);
    const fillStrength = column
      ? WATER_OPTICS.scatterFillSunStrength * sunlightIntensity.value +
        WATER_OPTICS.scatterFillBase
      : 0;
    underwaterFill
      .copy(WATER_SURFACE_SCATTER_COLOR)
      .multiplyScalar(fillStrength)
      .multiply(waterTransmittance);

    // Clustered local lights (held torches, projectiles, analytic block
    // emitters) shine on entities the same way they shine on the world —
    // including the flood-mask occlusion term, so a character behind a wall
    // stops picking up the tint of the torch the wall blocks.
    const floodLevel = Math.max(
      lightSample.floodR,
      lightSample.floodG,
      lightSample.floodB,
    );
    const knee = this.world.localLights.options.maskKnee;
    const t = Math.min(Math.max(floodLevel / Math.max(knee, 1e-4), 0), 1);
    localLightSample.color[0] = 0;
    localLightSample.color[1] = 0;
    localLightSample.color[2] = 0;
    localLightSample.claim = 0;
    localLightSample.windowFade = 1;
    localLightQueryOptions.floodMask = t * t * (3 - 2 * t);
    localLightQueryOptions.timeMs = performance.now();
    this.world.localLights.queryLocalLights(
      pos,
      localLightSample,
      localLightQueryOptions,
    );
    lightSample.clusterR = localLightSample.color[0];
    lightSample.clusterG = localLightSample.color[1];
    lightSample.clusterB = localLightSample.color[2];

    // Ownership blend, mirroring the chunk shader: where selected analytic
    // lights claim this entity, the baked flood tint yields in proportion
    // so the entity is never lit by both models; beyond their reach (or
    // with local lights off) the legacy flood tint stands untouched. The
    // remainder helper uses the shader's smoothstep denominator on the raw
    // flood level, so the entity and the block it stands on agree on how
    // much flood survives.
    floodRemainderArgs.scaledClaim =
      localLightSample.claim * this.world.localLights.blockLightOwnership;
    floodRemainderArgs.floodLevel = floodLevel;
    floodRemainderArgs.windowFade = localLightSample.windowFade;
    lightSample.floodRemainder = blockLightFloodRemainder(floodRemainderArgs);

    composeEntityLight(lightSample, tempColor);
    return tempColor.setRGB(
      Math.min(tempColor.r, this.options.maxBrightness),
      Math.min(tempColor.g, this.options.maxBrightness),
      Math.min(tempColor.b, this.options.maxBrightness),
    );
  }

  private computeShadowFactor(pos: Vector3): number {
    if (!this.world.csmRenderer) return 1.0;

    const { sunDirection, shadowStrength } =
      this.world.chunkRenderer.shaderLightingUniforms;

    if (shadowStrength.value < 0.01) return 1.0;

    const dir: [number, number, number] = [
      sunDirection.value.x,
      sunDirection.value.y,
      sunDirection.value.z,
    ];
    const maxDist = 64;

    const hit = this.world.raycastVoxels(
      pos.toArray() as [number, number, number],
      dir,
      maxDist,
    );

    if (hit) {
      return 1.0 - shadowStrength.value;
    }

    return 1.0;
  }
}
