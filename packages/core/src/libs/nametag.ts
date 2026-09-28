import { Camera, NearestFilter, Scene, WebGLRenderer } from "three";

import { SpriteText } from "./sprite-text";

/**
 * How a name tag behaves with distance from the camera, in world units.
 */
export type NameTagDistance = {
  /**
   * Up to this distance the tag shows at full opacity.
   */
  fadeStart: number;

  /**
   * By this distance the tag has faded out completely, and past it the tag
   * is not drawn at all, so a crowd of far tags costs no draw calls.
   * `Infinity` keeps the tag at every distance.
   */
  fadeEnd: number;

  /**
   * Within this distance the tag draws over everything, so it stays
   * readable through thin cover and never flickers behind it. Past it the
   * tag is depth tested like the world around it, so terrain between the
   * camera and a far tag hides it instead of letting it show through.
   * `Infinity` never depth tests.
   */
  seeThroughDistance: number;
};

/**
 * Parameters to create a name tag.
 */
export type NameTagOptions = Partial<NameTagDistance> & {
  /**
   * The font face to create the name tag. Defaults to `"monospace"`.
   */
  fontFace?: string;

  /**
   * The font size to create the name tag. Defaults to `0.1`.
   */
  fontSize?: number;

  /**
   * The y-offset of the nametag moved upwards. Defaults to `0`.
   */
  yOffset?: number;

  /**
   * The color of the name tag. Defaults to `0xffffff`.
   */
  color?: string;

  /**
   * The background color of the name tag. Defaults to `0x00000077`.
   */
  backgroundColor?: string;
};

const defaultOptions: NameTagOptions = {
  fontFace: "monospace",
  fontSize: 0.1,
  yOffset: 0,
  color: "#ffffff",
  backgroundColor: "#00000077",
};

/**
 * How opaque a name tag is at `distance` from the camera: 1 up to
 * `fadeStart`, 0 from `fadeEnd` on, and eased in between (smoothstep), so a
 * tag neither pops out nor lingers as a faint smear at the edge.
 */
export function nameTagFade(
  distance: number,
  fadeStart: number,
  fadeEnd: number,
): number {
  if (distance <= fadeStart) return 1;
  if (distance >= fadeEnd) return 0;
  const t = (distance - fadeStart) / (fadeEnd - fadeStart);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * A class that allows you to create a name tag mesh. This name tag mesh also supports colored text
 * using the {@link ColorText} syntax. Name tags can be treated like any other mesh.
 *
 * A name tag is a label, not world geometry: it does not take the scene's
 * fog (`material.fog` is off), and it fades out with camera distance
 * ({@link NameTagDistance}) instead. It is a world-sized sprite, so on
 * screen it shrinks with distance like everything else until the fade
 * retires it.
 *
 * ![Name tag](/img/docs/nametag.png)
 *
 * @noInheritDoc
 */
export class NameTag extends SpriteText {
  /**
   * The distance behaviour a tag uses wherever its own options leave a
   * field unset. Read on every draw, so an app can set it once at startup,
   * before or after its first tags exist. The engine default keeps every
   * tag at every distance, drawn over everything.
   */
  static distanceDefaults: NameTagDistance = {
    fadeStart: Infinity,
    fadeEnd: Infinity,
    seeThroughDistance: Infinity,
  };

  /**
   * Global switch for the distance behaviour. Off, tags behave as they did
   * before distance fading existed: drawn at every distance, over
   * everything, and taking the scene's fog like the world around them. The
   * fade, the cull and the depth test read it on every draw; the fog is
   * set when a tag is made. For side-by-side comparisons.
   */
  static distanceFade = true;

  /** This tag's own fade start; unset uses {@link NameTag.distanceDefaults}. */
  fadeStart?: number;

  /** This tag's own fade end; unset uses {@link NameTag.distanceDefaults}. */
  fadeEnd?: number;

  /** This tag's own see-through range; unset uses {@link NameTag.distanceDefaults}. */
  seeThroughDistance?: number;

  private baseOpacity = 1;

  /** The camera of this tag's latest draw, which the wake check measures from. */
  private viewer: Camera | null = null;

  /** The layers mask put aside while the tag is past its fade end. */
  private parkedLayers = 0;

  private isParked = false;

  constructor(text: string, options: Partial<NameTagOptions> = {}) {
    super(text, options.fontSize ?? defaultOptions.fontSize);

    const { fontFace, yOffset, backgroundColor, color } = {
      ...defaultOptions,
      ...options,
    };

    this.fontFace = fontFace;
    this.position.y += yOffset;
    this.backgroundColor = backgroundColor;
    this.material.depthTest = false;
    this.material.depthWrite = false;
    this.material.fog = !NameTag.distanceFade;
    this.material.userData.skipShadow = true;
    this.renderOrder = 1000000000000;
    this.strokeColor = color;
    this.fadeStart = options.fadeStart;
    this.fadeEnd = options.fadeEnd;
    this.seeThroughDistance = options.seeThroughDistance;

    const image = this.material.map;

    if (image) {
      image.minFilter = NearestFilter;
      image.magFilter = NearestFilter;
    }
  }

  /**
   * How opaque the owner wants the tag (a label fading out with its owner).
   * The distance fade multiplies it on every draw, so set this rather than
   * `material.opacity`, which the fade rewrites.
   */
  get opacity() {
    return this.baseOpacity;
  }

  set opacity(opacity: number) {
    this.baseOpacity = opacity;
    this.material.opacity = opacity;
  }

  /**
   * Fade, depth test and retire the tag for the camera about to draw it.
   * Three calls this only for tags it draws, so the per-frame cost follows
   * the tags on screen, and it allocates nothing.
   */
  onBeforeRender(_renderer: WebGLRenderer, _scene: Scene, camera: Camera) {
    this.viewer = camera;
    const material = this.material;

    if (!NameTag.distanceFade) {
      material.opacity = this.baseOpacity;
      material.depthTest = false;
      return;
    }

    const defaults = NameTag.distanceDefaults;
    const fadeEnd = this.fadeEnd ?? defaults.fadeEnd;
    const distance = Math.sqrt(this.distanceSquaredTo(camera));

    if (distance >= fadeEnd) {
      // Already in this frame's draw list: draw it clear, then take it off
      // the camera's layers so the next frames skip it entirely.
      material.opacity = 0;
      this.park();
      return;
    }

    material.opacity =
      this.baseOpacity *
      nameTagFade(distance, this.fadeStart ?? defaults.fadeStart, fadeEnd);
    material.depthTest =
      distance > (this.seeThroughDistance ?? defaults.seeThroughDistance);
  }

  /**
   * A retired tag is never drawn, so it cannot see the camera come back in
   * range from its draw hook. The scene's matrix pass reaches it every frame
   * regardless, and that is where it rejoins: one distance check, and only
   * for retired tags.
   */
  updateMatrixWorld(force?: boolean) {
    super.updateMatrixWorld(force);
    if (!this.isParked) return;

    if (!NameTag.distanceFade || !this.viewer) {
      this.unpark();
      return;
    }

    const fadeEnd = this.fadeEnd ?? NameTag.distanceDefaults.fadeEnd;
    if (this.distanceSquaredTo(this.viewer) < fadeEnd * fadeEnd) {
      this.unpark();
    }
  }

  private distanceSquaredTo(camera: Camera) {
    const tag = this.matrixWorld.elements;
    const eye = camera.matrixWorld.elements;
    const dx = tag[12] - eye[12];
    const dy = tag[13] - eye[13];
    const dz = tag[14] - eye[14];
    return dx * dx + dy * dy + dz * dz;
  }

  private park() {
    if (this.isParked) return;
    this.parkedLayers = this.layers.mask;
    this.layers.disableAll();
    this.isParked = true;
  }

  private unpark() {
    this.layers.mask = this.parkedLayers;
    this.isParked = false;
  }
}
