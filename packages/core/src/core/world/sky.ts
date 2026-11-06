import {
  BackSide,
  Color,
  DodecahedronGeometry,
  Mesh,
  type MeshBasicNodeMaterial,
  NodeMaterial,
  type UniformNode,
  Vector2,
  Vector3,
} from "three/webgpu";
import {
  cameraPosition,
  diffuseColor,
  dot,
  exp,
  float,
  Fn,
  fwidth,
  If,
  max,
  mix,
  normalize,
  output,
  positionWorld,
  pow,
  refract,
  smoothstep,
  sqrt,
  step,
  vec3,
  vec4,
} from "three/tsl";

import { CanvasBox, CanvasBoxOptions } from "../../libs/canvas-box";

import { exemptFromLightCones } from "./light-cones";
import { markNeverCaster } from "./shadow-casters";
import { skyGlow, type SkyGlowInputs } from "./shading/sky-fog";
import type { FloatNode, Vec3Node, Vec4Node } from "./shading/types";
import { ownUniform } from "./shading/uniforms";
import { WATER_OPTICS } from "./water-optics";

export type SkyShadingCycleData = {
  start: number;
  name: string;
  color: {
    top: Color | string;
    middle: Color | string;
    bottom: Color | string;
  };
  skyOffset: number;
  voidOffset: number;
};

export type SkyOptions = {
  /**
   * The dimension of the dodecahedron sky. The inner canvas box is 0.8 times this dimension.
   */
  dimension: number;

  /**
   * The lerp factor for the sky gradient. The sky gradient is updated every frame by lerping the current color to the target color.
   * set by the `setTopColor`, `setMiddleColor`, and `setBottomColor` methods.
   */
  lerpFactor: number;

  transitionSpan: number;

  /**
   * The luminance at which painted sky textures begin to feed bloom. Defaults to `0.72`.
   */
  textureBloomThreshold: number;

  /**
   * The emissive boost applied to painted sky texels above `textureBloomThreshold`. Defaults to `2.0`.
   */
  textureBloomIntensity: number;
};

/**
 * The sky's own light, drawn by the dome and by every fogged surface from
 * one set of uniform nodes (`skyGlow`), so the haze in front of a sunset
 * wears exactly the light of the sky behind it. Colours are linear and
 * already scaled by their strength; all black, the default, adds nothing.
 * The world keeps `sunDirection` on the drawn disc each frame
 * (`getSunDiscDirection`); a host paints the colours.
 */
export type SkyGlowUniforms = {
  /** Toward the sun's disc, never clamped or tilted; the moon is opposite. */
  sunDirection: UniformNode<"vec3", Vector3>;
  /** The broad aura round the sun and the band along the horizon under it. */
  color: UniformNode<"vec3", Color>;
  /** The halo the haze scatters round the sun's disc. */
  sunHaloColor: UniformNode<"vec3", Color>;
  /** The halo round the moon's disc. */
  moonHaloColor: UniformNode<"vec3", Color>;
  /**
   * The discs as the host draws them in the sky (colour times how much of
   * it shows), for the fog to carry: terrain hides the drawn disc by depth
   * even where its haze has made it the sky's own colour.
   */
  sunDiscColor: UniformNode<"vec3", Color>;
  moonDiscColor: UniformNode<"vec3", Color>;
  /** The discs' angular radii in radians: x the sun, y the moon. */
  discRadii: UniformNode<"vec2", Vector2>;
};

export const createSkyGlowUniforms = (): SkyGlowUniforms => ({
  sunDirection: ownUniform(new Vector3(0, 1, 0)),
  color: ownUniform(new Color(0, 0, 0)),
  sunHaloColor: ownUniform(new Color(0, 0, 0)),
  moonHaloColor: ownUniform(new Color(0, 0, 0)),
  sunDiscColor: ownUniform(new Color(0, 0, 0)),
  moonDiscColor: ownUniform(new Color(0, 0, 0)),
  discRadii: ownUniform(new Vector2(0.07, 0.07)),
});

/** The glow as `skyGlow` reads it, veiled by `directSunlight`. */
export const skyGlowInputsOf = (
  glow: SkyGlowUniforms,
  directSunlight: FloatNode,
): SkyGlowInputs =>
  ({
    skyGlowSunDirection: glow.sunDirection,
    skyGlowColor: glow.color,
    skySunHaloColor: glow.sunHaloColor,
    skyMoonHaloColor: glow.moonHaloColor,
    skySunDiscColor: glow.sunDiscColor,
    skyMoonDiscColor: glow.moonDiscColor,
    skyDiscRadii: glow.discRadii,
    directSunlight,
  }) as unknown as SkyGlowInputs;

/** The dome gradient's ramp exponents: toward the top, toward the void. */
const SKY_EXPONENT = 0.6;
const SKY_EXPONENT_2 = 1.2;

/**
 * The disc seen through the surface, in radians of the sky above: smaller
 * than the disc in the air, as the window squeezes the whole sky into it.
 */
const SNELL_SUN_RADIUS = 0.03;

const defaultOptions: SkyOptions = {
  dimension: 2000,
  lerpFactor: 0.1,
  transitionSpan: 0.05,
  textureBloomThreshold: 0.72,
  textureBloomIntensity: 2,
};

/**
 * Direction from the viewer to the centre of the painted sun disc for a
 * time of day (0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset). The disc
 * is the centre of the sky box's bottom face, and {@link Sky.update} spins
 * the box about Z by one turn per day, so the sun points straight down at
 * midnight, rises along +X, stands at the zenith at noon and sets along -X.
 * The moon is the top face, diametrically opposite.
 *
 * This is where the disc is *drawn*. The shading light
 * (`ShaderLightingUniforms.sunDirection`) is deliberately not this: it is
 * held above a minimum elevation, tilted off the sun's plane, and blended
 * toward the moon through twilight so terrain shading and shadows stay
 * readable. Anything that has to line up with the disc the player sees — a
 * reflection on water — reads this instead.
 */
export function getSunDiscDirection(
  timeOfDay: number,
  target: Vector3,
): Vector3 {
  const angle = timeOfDay * Math.PI * 2 - Math.PI / 2;
  return target.set(Math.cos(angle), Math.sin(angle), 0);
}

/**
 * The celestial disc above the horizon: the sun while it is up, the moon
 * (its antipode) once it has set. The choice flips at the instant both sit
 * on the horizon, and nothing shows it: a disc at zero elevation only
 * mirrors into a ray that is itself horizontal.
 */
export function getVisibleDiscDirection(
  timeOfDay: number,
  target: Vector3,
): Vector3 {
  getSunDiscDirection(timeOfDay, target);
  if (target.y < 0) {
    target.negate();
  }
  return target;
}

/**
 * Sky consists of both a large dodecahedron used to render the 3-leveled sky gradient and a {@link CanvasBox} that renders custom sky textures (
 * for a sky box) within the dodecahedron sky.
 *
 * # Example
 * ```ts
 * // Create the sky texture.
 * const sky = new VOXELIZE.Sky();
 *
 * // Load a texture and paint it to the top of the sky.
 * world.loader.addTexture(ExampleImage, (texture) => {
 *   sky.paint("top", texture);
 * })
 *
 * // Add the sky to the scene.
 * world.add(sky);
 *
 * // Update the sky per frame.
 * sky.update(camera.position);
 * ```
 *
 * ![Sky](/img/docs/sky.png)
 *
 */
export class Sky extends CanvasBox {
  public declare options: CanvasBoxOptions & SkyOptions;

  /**
   * The top color of the sky gradient. Change this by calling {@link Sky.setTopColor}.
   */
  public uTopColor = ownUniform(new Color("#222"));

  /**
   * The middle color of the sky gradient. Change this by calling {@link Sky.setMiddleColor}.
   */
  public uMiddleColor = ownUniform(new Color("#222"));

  /**
   * The bottom color of the sky gradient. Change this by calling {@link Sky.setBottomColor}.
   */
  public uBottomColor = ownUniform(new Color("#222"));

  public uSkyOffset = ownUniform(0);

  public uVoidOffset = ownUniform(1200);

  public uTextureBloomThreshold = ownUniform(
    defaultOptions.textureBloomThreshold,
  );

  public uTextureBloomIntensity = ownUniform(
    defaultOptions.textureBloomIntensity,
  );

  /**
   * The ambient water color the sky gradient fades toward while the camera
   * is submerged.
   */
  public uUnderwaterAmbient = ownUniform(new Color(0, 0, 0));

  /**
   * How much of the sky gradient is replaced by the underwater ambient,
   * driven by camera depth.
   */
  public uUnderwaterFade = ownUniform(0);

  /**
   * 1 while the camera is under water: the dome then shows the sky only
   * through the Snell window, refracted, and the water's in-scatter
   * everywhere else.
   */
  public uUnderwaterSubmerged = ownUniform(0);

  /** The celestial disc's direction, colour and light, for the refracted
   * disc the dome draws inside the Snell window. */
  public uCelestialDirection = ownUniform(new Vector3(0, 1, 0));
  public uSunColor = ownUniform(new Color(1, 1, 1));
  public uSunlightIntensity = ownUniform(1);
  /** The share of the disc's light that reaches the world as a beam (the
   * chunk renderer's `directSunlight`): a veiled disc is not drawn. */
  public uDirectSunlight = ownUniform(1);

  /**
   * The sky's own light (see {@link SkyGlowUniforms}). The world shares these
   * objects with the fog of every surface it draws.
   */
  public readonly glow: SkyGlowUniforms;

  public shadingData: SkyShadingCycleData[] = [];

  private textureBloomMaterials = new WeakSet<MeshBasicNodeMaterial>();

  /** The gradient dome (`createSkyShading`). */
  private shading: Mesh<DodecahedronGeometry, NodeMaterial> | null = null;

  /**
   * Create a new sky instance.
   *
   * @param dimension The dimension of the dodecahedron sky. The inner canvas box is 0.8 times this dimension.
   * @param lerpFactor The lerp factor for the sky gradient. The sky gradient is updated every frame by lerping the current color to the target color.
   * @param glow The glow's uniform objects, to share them with the fog.
   */
  constructor(
    options: Partial<SkyOptions> = {},
    glow: SkyGlowUniforms = createSkyGlowUniforms(),
  ) {
    super({
      width:
        (options.dimension ? options.dimension : defaultOptions.dimension) *
        0.8,
      side: BackSide,
      transparent: true,
      widthSegments: 512,
      heightSegments: 512,
      depthSegments: 512,
    });

    this.options = {
      ...this.options,
      ...defaultOptions,
      ...options,
    };

    this.glow = glow;

    this.uTextureBloomThreshold.value = this.options.textureBloomThreshold;
    this.uTextureBloomIntensity.value = this.options.textureBloomIntensity;

    this.boxMaterials.forEach((m) => (m.depthWrite = false));
    this.frustumCulled = false;
    this.renderOrder = -1;
    markNeverCaster(this);
    exemptFromLightCones(this, "the sky: no beam reaches it");

    this.boxLayers.forEach((layer) => {
      layer.renderOrder = -1;
      layer.frustumCulled = false;
    });

    const paintSkyTexture = this.paint.bind(this);
    this.paint = (side, art, layer = 0) => {
      this.applyTextureBloomToMaterials();
      paintSkyTexture(side, art, layer);
    };

    this.applyTextureBloomToMaterials();
    this.createSkyShading();
  }

  setShadingPhases = (data: SkyShadingCycleData[]) => {
    if (data.length === 0) {
      return;
    }

    if (data.length === 1) {
      const { top, middle, bottom } = data[0].color;
      const topColor = new Color(top);
      const middleColor = new Color(middle);
      const bottomColor = new Color(bottom);

      this.uTopColor.value.copy(topColor);
      this.uMiddleColor.value.copy(middleColor);
      this.uBottomColor.value.copy(bottomColor);
      this.uSkyOffset.value = data[0].skyOffset;
      this.uVoidOffset.value = data[0].voidOffset;
    }

    this.shadingData = data;

    // Sort the shading data by start

    this.shadingData.sort((a, b) => a.start - b.start);
  };

  /**
   * Get the current top color of the sky gradient. This can be used as shader uniforms's value.
   *
   * @returns The current top color of the sky gradient.
   */
  getTopColor = () => {
    return this.uTopColor.value;
  };

  /**
   * Get the current middle color of the sky gradient. This can be used as shader uniforms's value. For instance,
   * this can be used to set the color of the fog in the world.
   *
   * @returns The current middle color of the sky gradient.
   */
  getMiddleColor = () => {
    return this.uMiddleColor.value;
  };

  /**
   * Get the current bottom color of the sky gradient. This can be used as shader uniforms's value.
   *
   * @returns The current bottom color of the sky gradient.
   */
  getBottomColor = () => {
    return this.uBottomColor.value;
  };

  /**
   * Update the position of the sky box to the camera's x/z position, and lerp the sky gradient colors.
   *
   * @param position The new position to center the sky at.
   */
  update = (position: Vector3, time: number, timePerDay: number) => {
    this.applyTextureBloomToMaterials();

    this.rotation.z = Math.PI * 2 * (time / timePerDay);

    this.position.copy(position);

    if (this.shadingData.length <= 1) {
      return;
    }

    const shadingStack: [number, SkyShadingCycleData][] = [];
    const transitionTime = this.options.transitionSpan * timePerDay;

    for (let i = 0; i < this.shadingData.length; i++) {
      const data = this.shadingData[i];
      const nextData = this.shadingData[(i + 1) % this.shadingData.length];

      const { start } = data;
      const startTime = start * timePerDay;
      const nextStartTime = nextData.start * timePerDay;

      if (
        startTime < nextStartTime
          ? time >= startTime && time < nextStartTime
          : time < nextStartTime || time >= startTime
      ) {
        const weight = Math.max(
          Math.min(
            time >= startTime
              ? (time - startTime) / transitionTime
              : (time + timePerDay - startTime) / transitionTime,
            1.0,
          ),
          0.0,
        );

        shadingStack.push([weight, data]);

        if (
          time >= startTime
            ? time < startTime + transitionTime
            : time + timePerDay < startTime + transitionTime
        ) {
          const previousData =
            this.shadingData[
              (i - 1 < 0 ? i - 1 + this.shadingData.length : i - 1) %
                this.shadingData.length
            ];

          shadingStack.push([1 - weight, previousData]);
        }

        break;
      }
    }

    const weightedTopRGB = [0, 0, 0];
    const weightedMiddleRGB = [0, 0, 0];
    const weightedBottomRGB = [0, 0, 0];
    let weightedSkyOffset = 0;
    let weightedVoidOffset = 0;

    const emptyRGB = {
      r: 0,
      g: 0,
      b: 0,
    };

    shadingStack.forEach(([weight, data]) => {
      const {
        skyOffset,
        voidOffset,
        color: { top, middle, bottom },
      } = data;

      const topColor = new Color(top);
      const middleColor = new Color(middle);
      const bottomColor = new Color(bottom);

      topColor.getRGB(emptyRGB);
      weightedTopRGB[0] += emptyRGB.r * weight;
      weightedTopRGB[1] += emptyRGB.g * weight;
      weightedTopRGB[2] += emptyRGB.b * weight;

      middleColor.getRGB(emptyRGB);
      weightedMiddleRGB[0] += emptyRGB.r * weight;
      weightedMiddleRGB[1] += emptyRGB.g * weight;
      weightedMiddleRGB[2] += emptyRGB.b * weight;

      bottomColor.getRGB(emptyRGB);
      weightedBottomRGB[0] += emptyRGB.r * weight;
      weightedBottomRGB[1] += emptyRGB.g * weight;
      weightedBottomRGB[2] += emptyRGB.b * weight;

      weightedSkyOffset += weight * skyOffset;
      weightedVoidOffset += weight * voidOffset;
    });

    this.uTopColor.value.setRGB(
      weightedTopRGB[0],
      weightedTopRGB[1],
      weightedTopRGB[2],
    );

    this.uMiddleColor.value.setRGB(
      weightedMiddleRGB[0],
      weightedMiddleRGB[1],
      weightedMiddleRGB[2],
    );

    this.uBottomColor.value.setRGB(
      weightedBottomRGB[0],
      weightedBottomRGB[1],
      weightedBottomRGB[2],
    );

    this.uSkyOffset.value = weightedSkyOffset;
    this.uVoidOffset.value = weightedVoidOffset;
  };

  /**
   * Create the dodecahedron sky gradient: the two-ramp gradient, the sky's
   * own glow, and under water the Snell window.
   */
  private createSkyShading = () => {
    const shadingGeometry = new DodecahedronGeometry(this.options.dimension, 2);
    const shadingMaterial = new NodeMaterial();
    shadingMaterial.name = "sky-dome";
    shadingMaterial.fragmentNode = this.skyDomeColor();
    shadingMaterial.depthWrite = false;
    shadingMaterial.side = BackSide;
    shadingMaterial.fog = false;
    shadingMaterial.lights = false;
    const shadingMesh = new Mesh(shadingGeometry, shadingMaterial);
    shadingMesh.renderOrder = -1;
    shadingMesh.frustumCulled = false;

    // We use attach here so that the sky shading is not affected by the box's rotation.
    this.attach(shadingMesh);
    this.shading = shadingMesh;
  };

  private skyDomeColor(): Vec4Node {
    const glow = skyGlow(skyGlowInputsOf(this.glow, this.uDirectSunlight));
    return Fn(() => {
      // Sky colours are view-relative. Sampling absolute world coordinates
      // makes the gradient collapse around the origin when a camera-centred
      // dome crosses it, producing a radial seam far from (0, 0, 0).
      const skyPosition = positionWorld.sub(cameraPosition);
      const viewDir = normalize(skyPosition).toVar("skyViewDir");
      const h = normalize(skyPosition.add(this.uSkyOffset)).y;
      const h2 = normalize(skyPosition.add(this.uVoidOffset)).y;
      const upper = mix(
        this.uMiddleColor,
        this.uTopColor,
        max(pow(max(h, 0), SKY_EXPONENT), 0),
      );
      const color = mix(
        upper,
        this.uBottomColor,
        max(pow(max(h2.negate(), 0), SKY_EXPONENT_2), 0),
      )
        // The sky's own light toward its discs, the same light every fogged
        // surface tints toward (sky-fog.ts), so the haze and the sky agree.
        .add(glow.glow(viewDir))
        .toVar("skyColor");

      // From under water the sky only reaches the eye through the Snell
      // window: a ray within the critical angle of straight up leaves the
      // water bent away from the vertical, so the whole sky, horizon to
      // zenith, shows squeezed into that cone, with the sun at its
      // refracted place. Every other ray is reflected back down and sees
      // only the water's in-scatter, which is also what any ray that meets
      // no geometry near the horizon must read as (past the loaded surface,
      // over a drop-off), never a pale horizon band. Depth dims the window
      // toward the in-scatter. The disc's edge width is taken up front,
      // outside the branches, where every pixel still runs it.
      const airDir = refract(viewDir, vec3(0, -1, 0), 1.333).toVar("skyAirDir");
      const sunCos = dot(airDir, this.uCelestialDirection);
      const sunAngle = sqrt(max(sunCos.mul(-2).add(2), 0)).toVar("skySunAngle");
      const sunEdge = fwidth(sunAngle).mul(1.5).toVar("skySunEdge");
      If(this.uUnderwaterSubmerged.greaterThan(0.5), () => {
        const inScatter = this.uUnderwaterAmbient.mul(
          viewDir.y.mul(WATER_OPTICS.underwaterInScatterTilt).add(1),
        );
        const underColor = inScatter.toVar("skyUnderColor");
        If(viewDir.y.greaterThan(0).and(dot(airDir, airDir).greaterThan(0.5)), () => {
          // The same glowing disc as in the air: a soft-edged core and a
          // halo around it, not a hard sticker.
          const sunDisc = smoothstep(
            float(SNELL_SUN_RADIUS).sub(sunEdge),
            float(SNELL_SUN_RADIUS).add(sunEdge),
            sunAngle,
          )
            .oneMinus()
            .mul(step(0, sunCos));
          const sunGlow = exp(sunAngle.div(SNELL_SUN_RADIUS).mul(-0.9))
            .mul(0.6)
            .add(pow(max(sunCos, 0), 48));
          const windowSky = mix(
            this.uMiddleColor,
            this.uTopColor,
            pow(max(airDir.y, 0), SKY_EXPONENT),
          ).add(
            this.uSunColor
              .mul(this.uSunlightIntensity)
              .mul(this.uDirectSunlight)
              .mul(sunDisc.mul(2.2).add(sunGlow.mul(0.35))),
          );
          const transmit = pow(airDir.y.oneMinus(), 5).mul(0.98).add(0.02).oneMinus();
          underColor.assign(mix(inScatter, windowSky, transmit));
        });
        color.assign(mix(underColor, inScatter, this.uUnderwaterFade));
      });
      return vec4(color, 1);
    })() as unknown as Vec4Node;
  }

  /**
   * Frees the box's layers (geometry, face canvases and materials, atlas)
   * and the gradient dome's geometry and shader. Call once the sky has left
   * the scene for good.
   */
  dispose() {
    super.dispose();
    if (this.shading) {
      this.shading.geometry.dispose();
      this.shading.material.dispose();
      this.shading = null;
    }
  }

  /**
   * Painted sky texels past the bloom threshold glow, so a painted sun or
   * aurora feeds the bloom like the light it depicts.
   */
  private applyTextureBloomToMaterials = () => {
    this.boxLayers.forEach((layer) => {
      layer.renderOrder = -1;
      layer.frustumCulled = false;

      layer.materials.forEach((material) => {
        material.depthWrite = false;
        // The sky is what the world's fog fades into, never fogged itself.
        material.fog = false;

        if (this.textureBloomMaterials.has(material)) {
          return;
        }

        const base = (material.outputNode ?? output) as unknown as Vec4Node;
        const luminance = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        const mask = smoothstep(
          this.uTextureBloomThreshold,
          1,
          luminance,
        ).mul(diffuseColor.a);
        material.outputNode = vec4(
          (base.rgb as Vec3Node).mul(mask.mul(this.uTextureBloomIntensity).add(1)),
          base.a,
        );
        material.needsUpdate = true;
        this.textureBloomMaterials.add(material);
      });
    });
  };
}
