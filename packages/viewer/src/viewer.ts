/**
 * The world viewer: one or two sources (an A/B pair shown side by side or
 * under a swipe) streamed around a shared camera, each rendered with the
 * engine's chunk materials and far layer into its own target, then
 * composited with the overlays, the split and the output encoding in one
 * pass. Everything a host or a script can change goes through `setPose`,
 * `setPreset`, `setOptions` and `setSources`, and `state()` reports it.
 */
import { CSMRenderer, type AtlasFilteringMode } from "@voxelize/core";
import {
  BackSide,
  Color,
  DepthTexture,
  HalfFloatType,
  Matrix4,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
  type Camera,
} from "three";

import {
  type CameraFeel,
  CameraRig,
  type FlightOptions,
  type FlightResult,
} from "./camera";
import { ChunkLayer, type ChunkLayerOptions } from "./chunk-layer";
import { FarLayer, FarTileClient, type FarPalette } from "./far-layer";
import { nearRadiusFor } from "./lod";
import { applyLook, defaultLook, type LookProvider } from "./look";
import { ViewerMaterials, type MaterialOptions } from "./materials";
import { DEFAULT_OPTIONS, type ViewerOptions } from "./options";
import {
  BUILTIN_OVERLAYS,
  OverlayCompositor,
  type Annotation,
  type SourceMeta,
  type ViewerOverlay,
} from "./overlays";
import { type PinAction, PinLayer } from "./pin-layer";
import type { PinLighting } from "./pin-model";
import type { Pin, PinFact } from "./pins";
import {
  type Bookmark,
  formatVec,
  type Pose,
  type Preset,
  type ShareLinkFormatter,
  standInPose,
  type Vec3,
} from "./pose";
import { DEFAULT_THEME, type ViewerTheme } from "./theme";

export type SourceRef = {
  /** The server's id for the source (one backend process). */
  id: string;
  /** What captions and the HUD call it. */
  label: string;
};

export type ViewerHost = {
  /** Origin of the viewer server; "" for the page's own. */
  server?: string;
  workerUrl?: string;
  /**
   * Paints a source's registry: run the game's own texture setup against
   * `world`, a stand-in exposing the texture calls a `World` has.
   */
  setupTextures?: (world: unknown, meta: SourceMeta) => Promise<void>;
  look?: LookProvider;
  farPalette?: (meta: SourceMeta) => FarPalette;
  /** The y of the far water plane; below everything when absent. */
  waterSurface?: (meta: SourceMeta) => number | null;
  materialOptions?: Partial<MaterialOptions>;
  /** Overlays besides the built-in ones, keyed by id. */
  overlays?: ViewerOverlay[];
  shareLink?: ShareLinkFormatter;
  /** CSS font for labels drawn over the view. */
  labelFont?: string;
  fov?: number;
  chunkLayer?: Partial<ChunkLayerOptions>;
  /** Tunes how the camera follows the ground and flies (`DEFAULT_CAMERA_FEEL`). */
  camera?: Partial<CameraFeel>;
  /** Colours, font and icons of the pins, the wheel and the labels. */
  theme?: Partial<ViewerTheme>;
  pins?: {
    /** Blocks from a top face to the eyes of a player standing on it (spawn links, Look from here). */
    standingEyeHeight?: number;
    /** How tall a pin stays on screen, CSS pixels. */
    screenHeight?: number;
    /** Keep the pins in the page URL (`pins=`); on by default. */
    persistInUrl?: boolean;
    /** Lines for the pin card from the column the backend reports (its `source` field). */
    describe?: (column: unknown) => PinFact[];
    /** Actions added to the wheel after the built-in ones. */
    actions?: PinAction[];
  };
};

let viewerCount = 0;

type View = {
  ref: SourceRef;
  meta: SourceMeta;
  materials: ViewerMaterials;
  scene: Scene;
  chunks: ChunkLayer;
  far: FarLayer;
  overlays: OverlayCompositor;
  sky: Mesh;
  target: WebGLRenderTarget;
  csm: CSMRenderer;
  textures: ReturnType<ViewerMaterials["textureCensus"]> | null;
};

export type ViewerState = {
  sources: { a: SourceRef | null; b: SourceRef | null };
  preset: Preset;
  pose: Pose;
  options: ViewerOptions;
  hover: Vec3 | null;
  shareLink: string | null;
  fps: number;
  /** A flight under way, or the camera still easing after a move. */
  camera: { flying: boolean; settling: boolean };
  pins: Pin[];
  bookmarks: Bookmark[];
  views: {
    id: string;
    label: string;
    chunks: ChunkLayer["stats"];
    far: FarLayer["stats"];
    idle: boolean;
    textures: ReturnType<ViewerMaterials["textureCensus"]> | null;
  }[];
};

export type IdleReport = {
  idle: boolean;
  waitedMs: number;
  frames: number;
  views: ViewerState["views"];
};

const SKY_VERTEX = `
varying vec3 vDirection;
void main() {
  vDirection = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}`;

const SKY_FRAGMENT = `
uniform vec3 uSkyFogTopColor;
uniform vec3 uSkyFogMiddleColor;
uniform vec3 uSkyFogBottomColor;
uniform float uSkyFogOffset;
uniform float uSkyFogVoidOffset;
uniform float uSkyFogExponent;
uniform float uSkyFogExponent2;
uniform float uSkyFogDimension;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uSunlightIntensity;
varying vec3 vDirection;
void main() {
  vec3 ray = normalize(vDirection);
  vec3 dome = ray * uSkyFogDimension;
  float h = normalize(dome + uSkyFogOffset).y;
  float h2 = normalize(dome + uSkyFogVoidOffset).y;
  vec3 color = mix(uSkyFogMiddleColor, uSkyFogTopColor, max(pow(max(h, 0.0), uSkyFogExponent), 0.0));
  color = mix(color, uSkyFogBottomColor, max(pow(max(-h2, 0.0), uSkyFogExponent2), 0.0));
  color += uSunColor * pow(max(0.0, dot(ray, uSunDirection)), 6.0) * uSunlightIntensity * 0.35;
  gl_FragColor = vec4(color, 1.0);
}`;

const COMPOSITE_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const COMPOSITE_FRAGMENT = `
uniform sampler2D tColorA;
uniform sampler2D tDepthA;
uniform sampler2D tColorB;
uniform sampler2D tDepthB;
uniform mat4 uInverseA;
uniform mat4 uInverseB;
uniform sampler2D tOverlayA;
uniform sampler2D tOverlayB;
uniform vec4 uOverlayRectA;
uniform vec4 uOverlayRectB;
uniform float uHasOverlayA;
uniform float uHasOverlayB;
uniform sampler2D tHeightA;
uniform sampler2D tHeightB;
uniform float uHasHeightA;
uniform float uHasHeightB;
uniform float uOverlayOpacity;
uniform float uGrid;
uniform float uGridSize;
uniform float uContours;
uniform float uContourStep;
uniform float uSplit;
uniform float uSwipe;
uniform vec2 uResolution;
varying vec2 vUv;

vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 toSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 shade(sampler2D color, sampler2D depthMap, mat4 inverse, sampler2D overlay, vec4 rect, float hasOverlay, sampler2D heights, float hasHeights, vec2 uv) {
  vec3 c = texture2D(color, uv).rgb;
  float depth = texture2D(depthMap, uv).r;
  if (depth >= 1.0) return c;
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 world = inverse * ndc;
  world /= world.w;
  if (hasOverlay > 0.5) {
    vec2 o = (world.xz - rect.xy) * rect.zw;
    if (o.x >= 0.0 && o.y >= 0.0 && o.x < 1.0 && o.y < 1.0) {
      vec4 ov = texture2D(overlay, o);
      c = mix(c, toLinear(ov.rgb), ov.a * uOverlayOpacity);
    }
  }
  // Lines are drawn only where the surface is continuous across the pixel:
  // at a silhouette the derivatives jump and would outline every block.
  if (uGrid > 0.5) {
    vec2 cell = world.xz / uGridSize;
    vec2 fw = fwidth(cell);
    if (max(fw.x, fw.y) < 0.06) {
      vec2 d = abs(fract(cell + 0.5) - 0.5) / max(fw, vec2(1e-4));
      float line = 1.0 - clamp(min(d.x, d.y) - 0.5, 0.0, 1.0);
      c = mix(c, vec3(1.0, 0.85, 0.2), line * 0.6);
    }
  }
  // Contours of the filtered height map, so they run as smooth lines over
  // blocky ground and read the same from above as from the side.
  if (uContours > 0.5 && hasHeights > 0.5) {
    vec2 o = (world.xz - rect.xy) * rect.zw;
    if (o.x >= 0.0 && o.y >= 0.0 && o.x < 1.0 && o.y < 1.0) {
      float h = texture2D(heights, o).r / uContourStep;
      float fw = fwidth(h);
      if (h > 0.0 && fw < 0.5) {
        float d = abs(fract(h + 0.5) - 0.5) / max(fw, 1e-4);
        float line = 1.0 - clamp(d - 0.5, 0.0, 1.0);
        float major = step(0.5, 1.0 - abs(mod(floor(h + 0.5), 5.0)));
        c = mix(c, mix(vec3(0.16, 0.1, 0.05), vec3(0.04, 0.02, 0.0), major), line * (0.55 + 0.35 * major));
      }
    }
  }
  return c;
}

void main() {
  vec3 color;
  if (uSplit < 0.5) {
    color = shade(tColorA, tDepthA, uInverseA, tOverlayA, uOverlayRectA, uHasOverlayA, tHeightA, uHasHeightA, vUv);
  } else if (uSplit < 1.5) {
    bool left = vUv.x < 0.5;
    vec2 uv = vec2(left ? vUv.x * 2.0 : (vUv.x - 0.5) * 2.0, vUv.y);
    color = left
      ? shade(tColorA, tDepthA, uInverseA, tOverlayA, uOverlayRectA, uHasOverlayA, tHeightA, uHasHeightA, uv)
      : shade(tColorB, tDepthB, uInverseB, tOverlayB, uOverlayRectB, uHasOverlayB, tHeightB, uHasHeightB, uv);
    if (abs(vUv.x - 0.5) * uResolution.x < 1.5) color = vec3(1.0);
  } else {
    color = vUv.x < uSwipe
      ? shade(tColorA, tDepthA, uInverseA, tOverlayA, uOverlayRectA, uHasOverlayA, tHeightA, uHasHeightA, vUv)
      : shade(tColorB, tDepthB, uInverseB, tOverlayB, uOverlayRectB, uHasOverlayB, tHeightB, uHasHeightB, vUv);
    if (abs(vUv.x - uSwipe) * uResolution.x < 1.5) color = vec3(1.0);
  }
  gl_FragColor = vec4(toSrgb(color), 1.0);
}`;

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`${url}: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

export class WorldViewer {
  readonly renderer: WebGLRenderer;

  readonly rig: CameraRig;

  readonly canvas: HTMLCanvasElement;

  readonly hud: HTMLCanvasElement;

  options: ViewerOptions = { ...DEFAULT_OPTIONS, overlays: [] };

  hover: Vec3 | null = null;

  private views: { a: View | null; b: View | null } = { a: null, b: null };

  private overlays: ViewerOverlay[];

  private composite: ShaderMaterial;

  private quad: Mesh;

  private quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private quadScene = new Scene();

  private frame = 0;

  private lastFrame = performance.now();

  private fps = 0;

  private listeners = new Set<(state: ViewerState) => void>();

  private running = true;

  private pointer: { x: number; y: number } | null = null;

  /** Where the last double-click sent the camera, ringed on the HUD while it flies. */
  private flightMark: { point: Vec3; at: number } | null = null;

  /** Pins on the terrain and the action wheel around them. */
  readonly pins: PinLayer;

  /** The places the page offers (the server's, plus those added here). */
  bookmarks: Bookmark[] = [];

  private lastNotify = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly host: ViewerHost = {},
  ) {
    this.overlays = [...BUILTIN_OVERLAYS, ...(host.overlays ?? [])];
    this.canvas = document.createElement("canvas");
    this.canvas.tabIndex = 0;
    this.canvas.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;outline:none;touch-action:none";
    this.hud = document.createElement("canvas");
    this.hud.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
    if (getComputedStyle(container).position === "static")
      container.style.position = "relative";
    container.append(this.canvas, this.hud);

    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.debug.checkShaderErrors = true;

    this.rig = new CameraRig(this.canvas, host.fov ?? 60);
    this.rig.groundAt = (x, z) => this.groundAt(x, z);
    this.rig.onChange = () => this.notify();
    Object.assign(this.rig.feel, host.camera ?? {});
    this.applyCameraOptions();
    const theme: ViewerTheme = { ...DEFAULT_THEME, ...host.theme };
    viewerCount += 1;
    this.pins = new PinLayer(
      container,
      {
        pickGround: (x, y) => this.pickGround(x, y),
        flyTo: (point) => this.flyTo(point),
        flyToPose: (pose, preset) => this.flyToPose(pose, preset),
        query: (x, z) => this.query(x, z),
        linkFor: (pose) => this.linkFor(pose),
        cameraYaw: () =>
          this.rig.preset === "free" ? this.rig.fly.yaw : this.rig.orbit.yaw,
        cameraPitch: () =>
          this.rig.preset === "free"
            ? -this.rig.fly.pitch
            : this.rig.orbit.pitch,
        releaseCamera: () => this.rig.cancelDrag(),
        pose: () => this.rig.pose(),
        preset: () => this.rig.preset,
        addBookmark: (bookmark) => this.addBookmark(bookmark),
      },
      {
        theme,
        prefix: `vxv${viewerCount}`,
        standingEyeHeight: host.pins?.standingEyeHeight ?? 1.6,
        screenHeight: host.pins?.screenHeight ?? 64,
        holdMs: 280,
        clickSlop: 5,
        doubleClickMs: 600,
        describe: host.pins?.describe,
        actions: host.pins?.actions,
        persistInUrl: host.pins?.persistInUrl ?? true,
      },
      () => this.notify(true),
    );
    const local = (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    this.rig.claimPointer = (e) => {
      const p = local(e);
      const claimed = this.pins.claimPress(p.x, p.y, e.button);
      // A held pin opens the wheel under the pointer; capture keeps the
      // flick reporting to the canvas while the pointer crosses the wheel.
      if (claimed) this.canvas.setPointerCapture(e.pointerId);
      return claimed;
    };
    this.rig.claimKey = (e) => this.pins.key(e);
    this.canvas.addEventListener("pointerup", (e) => {
      const p = local(e);
      this.pins.release(p.x, p.y, e.button);
    });
    this.canvas.addEventListener("click", (e) => {
      const p = local(e);
      this.pins.click(p.x, p.y, e.detail);
    });

    this.composite = new ShaderMaterial({
      vertexShader: COMPOSITE_VERTEX,
      fragmentShader: COMPOSITE_FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColorA: { value: null },
        tDepthA: { value: null },
        tColorB: { value: null },
        tDepthB: { value: null },
        uInverseA: { value: new Matrix4() },
        uInverseB: { value: new Matrix4() },
        tOverlayA: { value: null },
        tOverlayB: { value: null },
        uOverlayRectA: { value: new Vector4() },
        uOverlayRectB: { value: new Vector4() },
        uHasOverlayA: { value: 0 },
        uHasOverlayB: { value: 0 },
        tHeightA: { value: null },
        tHeightB: { value: null },
        uHasHeightA: { value: 0 },
        uHasHeightB: { value: 0 },
        uOverlayOpacity: { value: 0.6 },
        uGrid: { value: 0 },
        uGridSize: { value: 16 },
        uContours: { value: 0 },
        uContourStep: { value: 8 },
        uSplit: { value: 0 },
        uSwipe: { value: 0.5 },
        uResolution: { value: new Vector2(1, 1) },
      },
    });
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.composite);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    this.canvas.addEventListener("pointermove", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      this.pins.move(this.pointer.x, this.pointer.y);
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.pointer = null;
      this.hover = null;
    });
    // The second press of a double-click would select page text near the canvas.
    this.canvas.addEventListener("mousedown", (e) => {
      if (e.detail > 1) e.preventDefault();
    });
    // Double-click flies to the ground under the cursor; Alt keeps the zoom
    // (Shift is already the zoom-out key and the pan modifier).
    this.canvas.addEventListener("dblclick", (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      // The first click of the pair dropped a pin; the pin layer takes it back.
      const point = this.pins.doubleClick(
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
      if (!point) return;
      this.flightMark = { point, at: performance.now() };
      void this.flyTo(point, { keepZoom: e.altKey });
    });

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const loop = () => {
      if (!this.running) return;
      this.tick();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private get server() {
    return this.host.server ?? "";
  }

  /** Overlays the current sources can draw. */
  availableOverlays(): ViewerOverlay[] {
    const meta = this.views.a?.meta;
    return this.overlays.filter(
      (o) => o.kind !== "raster" || !meta || (o.available?.(meta) ?? true),
    );
  }

  sources() {
    return { a: this.views.a?.ref ?? null, b: this.views.b?.ref ?? null };
  }

  meta(which: "a" | "b" = "a"): SourceMeta | null {
    return this.views[which]?.meta ?? null;
  }

  async setSources(a: SourceRef, b: SourceRef | null = null) {
    const make = async (ref: SourceRef | null, current: View | null) => {
      if (!ref) {
        if (current) this.disposeView(current);
        return null;
      }
      if (current && current.ref.id === ref.id) return current;
      if (current) this.disposeView(current);
      return this.makeView(ref);
    };
    const [va, vb] = await Promise.all([
      make(a, this.views.a),
      make(b, this.views.b),
    ]);
    this.views = { a: va, b: vb };
    this.pins.attach(
      [va, vb]
        .filter((v): v is View => v !== null)
        .map((v) => ({ scene: v.scene, lighting: pinLighting(v.materials) })),
    );
    if (!vb && this.options.split !== "none")
      this.options = { ...this.options, split: "none" };
    if (vb && this.options.split === "none")
      this.options = { ...this.options, split: "swipe" };
    this.resize();
    this.notify(true);
  }

  private async makeView(ref: SourceRef): Promise<View> {
    const base = `${this.server}/api/source/${encodeURIComponent(ref.id)}`;
    const meta = await getJson<SourceMeta>(`${base}/meta`);
    const blocks = await getJson<Record<string, Record<string, unknown>>>(
      `${base}/blocks`,
    );
    const materials = new ViewerMaterials(
      blocks,
      {
        chunkSize: meta.chunkSize,
        maxHeight: meta.maxHeight,
        subChunks: meta.subChunks,
        maxLightLevel: meta.maxLightLevel,
      },
      this.host.materialOptions,
    );
    await materials.build();
    if (this.host.setupTextures)
      await this.host.setupTextures(materials.worldFacade(), meta);
    const textures = materials.textureCensus();
    if (textures.unpainted > 0) {
      console.warn(
        `[viewer] ${ref.label}: ${textures.unpainted} atlas slots left unpainted (${textures.unpaintedBlocks.slice(0, 8).join(", ")})`,
      );
    }
    const scene = new Scene();
    scene.matrixAutoUpdate = false;
    const chunks = new ChunkLayer(`${base}/chunks`, materials, meta.chunkSize, {
      workerUrl: this.host.workerUrl ?? `${this.server}/viewer-worker.js`,
      ...this.host.chunkLayer,
    });
    scene.add(chunks.group);
    let colors: Map<number, [number, number, number]> | null = null;
    const far = new FarLayer(
      `${base}/far`,
      materials,
      meta.far?.kind === "classes" ? "classes" : "blocks",
      this.host.farPalette?.(meta) ?? {
        water: "#4a86ad",
        skyTop: "#78a85a",
        skySide: "#6e665c",
      },
      () => (colors ??= materials.topColors()),
      this.host.waterSurface?.(meta) ?? -4096,
    );
    scene.add(far.terrain);
    const sky = new Mesh(
      new SphereGeometry(9000, 32, 16),
      new ShaderMaterial({
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        side: BackSide,
        depthWrite: false,
        uniforms: {
          uSkyFogTopColor: materials.chunkRenderer.uniforms.skyFogTopColor,
          uSkyFogMiddleColor:
            materials.chunkRenderer.uniforms.skyFogMiddleColor,
          uSkyFogBottomColor:
            materials.chunkRenderer.uniforms.skyFogBottomColor,
          uSkyFogOffset: materials.chunkRenderer.uniforms.skyFogOffset,
          uSkyFogVoidOffset: materials.chunkRenderer.uniforms.skyFogVoidOffset,
          uSkyFogExponent: materials.chunkRenderer.uniforms.skyFogExponent,
          uSkyFogExponent2: materials.chunkRenderer.uniforms.skyFogExponent2,
          uSkyFogDimension: materials.chunkRenderer.uniforms.skyFogDimension,
          uSunDirection:
            materials.chunkRenderer.shaderLightingUniforms.sunDirection,
          uSunColor: materials.chunkRenderer.shaderLightingUniforms.sunColor,
          uSunlightIntensity:
            materials.chunkRenderer.shaderLightingUniforms.sunlightIntensity,
        },
      }),
    );
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    scene.add(sky);
    const overlays = new OverlayCompositor(
      meta,
      new FarTileClient(`${base}/far`),
      `${base}/annotations`,
    );
    const target = this.makeTarget(1, 1);
    const csm = new CSMRenderer({
      maxShadowDistance: 256,
      shadowMapSize: 2048,
      farShadowMapSize: 1024,
    });
    csm.addNeverCaster(far.terrain);
    csm.addNeverCaster(sky);
    chunks.setShadowCasters(csm);
    return {
      ref,
      meta,
      materials,
      scene,
      chunks,
      far,
      overlays,
      sky,
      target,
      csm,
      textures,
    };
  }

  private makeTarget(width: number, height: number) {
    const target = new WebGLRenderTarget(width, height, {
      type: HalfFloatType,
      depthTexture: new DepthTexture(width, height),
      samples: 4,
    });
    return target;
  }

  private disposeView(view: View) {
    view.chunks.dispose();
    view.far.dispose();
    view.overlays.dispose();
    view.target.dispose();
    view.csm.dispose();
  }

  setPose(pose: Pose, preset?: Preset) {
    this.rig.setPose(pose, preset);
    this.notify(true);
  }

  setPreset(preset: Preset, span?: number) {
    this.rig.setPreset(preset, span);
    this.notify(true);
  }

  setOptions(next: Partial<ViewerOptions>) {
    const split = this.options.split;
    this.options = { ...this.options, ...next };
    if (this.options.split !== split) this.resize();
    this.applyCameraOptions();
    this.notify(true);
  }

  /**
   * Flies the camera to frame (x, y, z), keeping the preset; a null y takes
   * the ground there. Resolves when it lands, or as not completed when input
   * or another move cuts it short.
   */
  flyTo(
    point: [number, number | null, number],
    options: FlightOptions = {},
  ): Promise<FlightResult> {
    const [x, given, z] = point;
    const y = given ?? this.surfaceAt(x, z);
    if (y === null) {
      return Promise.reject(
        new Error(`nothing loaded at ${x},${z} to fly to; pass its height`),
      );
    }
    return this.rig
      .flyToPoint([x, y, z], options)
      .finally(() => this.notify(true));
  }

  /** Flies to `pose` in `preset` (default: the current one). */
  flyToPose(
    pose: Pose,
    preset?: Preset,
    options: FlightOptions = {},
  ): Promise<FlightResult> {
    return this.rig
      .flyToPose(pose, preset ?? this.rig.preset, options)
      .finally(() => this.notify(true));
  }

  /** Stops a flight where it is. */
  cancelFlight() {
    this.rig.cancelFlight();
  }

  /** The game's link for `pose` in source A's world, or null when the host has none. */
  linkFor(pose: Pose): string | null {
    if (!this.host.shareLink || !this.views.a) return null;
    return this.host.shareLink(pose, { world: this.views.a.meta.name });
  }

  setBookmarks(bookmarks: Bookmark[]) {
    this.bookmarks = [...bookmarks];
    this.notify(true);
  }

  /** Saves a bookmark with the viewer server, which keeps it with the others. */
  async addBookmark(bookmark: Bookmark): Promise<Bookmark> {
    const response = await fetch(`${this.server}/api/bookmarks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bookmark }),
    });
    if (!response.ok) {
      throw new Error(`could not save the bookmark: ${await response.text()}`);
    }
    const saved = (await response.json()) as { bookmark: Bookmark };
    this.bookmarks = [
      ...this.bookmarks.filter((b) => b.id !== saved.bookmark.id),
      saved.bookmark,
    ];
    this.notify(true);
    return saved.bookmark;
  }

  /**
   * The ground point under canvas pixel (px, py), in either half of a side
   * by side split, or null where the ray meets nothing loaded.
   */
  pickGround(px: number, py: number): Vec3 | null {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const split = this.options.split === "side" && this.views.b;
    const viewWidth = split ? width / 2 : width;
    const x = split && px > viewWidth ? px - viewWidth : px;
    const camera = this.rig.camera;
    const ndc = new Vector3(
      (x / viewWidth) * 2 - 1,
      -(py / height) * 2 + 1,
      -1,
    );
    const origin = ndc.clone().unproject(camera);
    const direction = new Vector3(ndc.x, ndc.y, 1)
      .unproject(camera)
      .sub(origin)
      .normalize();
    const at = (t: number) => origin.clone().addScaledVector(direction, t);
    const below = (p: Vector3) => {
      const ground = this.surfaceAt(p.x, p.z);
      return ground !== null && p.y <= ground;
    };
    let last = 0;
    let t = 0;
    for (let i = 0; i < 6000 && t < 12000; i++) {
      if (below(at(t))) {
        // March back between the last step above the ground and this one.
        let lo = last;
        let hi = t;
        for (let k = 0; k < 16; k++) {
          const mid = (lo + hi) / 2;
          if (below(at(mid))) hi = mid;
          else lo = mid;
        }
        const p = at(hi);
        return [p.x, this.surfaceAt(p.x, p.z) ?? p.y, p.z];
      }
      last = t;
      t += Math.max(0.5, t * 0.004);
    }
    return null;
  }

  private applyCameraOptions() {
    this.rig.smoothing = this.options.smoothing;
    this.rig.levelFlight = this.options.levelFlight;
  }

  /** Top of the column at (x, z) from the near chunks, else the far layer; null where nothing is loaded. */
  surfaceAt(x: number, z: number): number | null {
    const view = this.views.a;
    if (!view) return null;
    return view.chunks.heightAt(x, z) ?? view.far.heightAt(x, z);
  }

  pose(): Pose {
    return this.rig.pose();
  }

  shareLink(): string | null {
    if (!this.host.shareLink || !this.views.a) return null;
    const pose =
      this.rig.projection === "orthographic"
        ? standInPose(this.rig.pose())
        : this.rig.pose();
    return this.host.shareLink(pose, { world: this.views.a.meta.name });
  }

  on(listener: (state: ViewerState) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(force = false) {
    const now = performance.now();
    if (!force && now - this.lastNotify < 100) return;
    this.lastNotify = now;
    const state = this.state();
    for (const listener of this.listeners) listener(state);
  }

  state(): ViewerState {
    const views = (["a", "b"] as const)
      .map((k) => this.views[k])
      .filter((v): v is View => v !== null)
      .map((v) => ({
        id: v.ref.id,
        label: v.ref.label,
        chunks: { ...v.chunks.stats },
        far: v.far.stats,
        idle: v.chunks.isIdle() && v.far.isIdle() && v.overlays.isIdle(),
        textures: v.textures,
      }));
    return {
      sources: this.sources(),
      preset: this.rig.preset,
      pose: this.rig.pose(),
      options: { ...this.options, overlays: [...this.options.overlays] },
      hover: this.hover,
      shareLink: this.shareLink(),
      fps: this.fps,
      camera: { flying: this.rig.flying, settling: this.rig.isSettling() },
      pins: this.pins.list(),
      bookmarks: [...this.bookmarks],
      views,
    };
  }

  /** Resolves once every view has everything it wants, steady for `settleFrames`. */
  async waitIdle({
    timeoutMs = 120_000,
    settleFrames = 8,
  } = {}): Promise<IdleReport> {
    const started = performance.now();
    const firstFrame = this.frame;
    let steady = 0;
    while (performance.now() - started < timeoutMs) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const views = this.state().views;
      const idle =
        views.length > 0 &&
        views.every((v) => v.idle) &&
        !this.rig.isSettling();
      steady = idle ? steady + 1 : 0;
      if (steady >= settleFrames) {
        return {
          idle: true,
          waitedMs: performance.now() - started,
          frames: this.frame - firstFrame,
          views,
        };
      }
    }
    return {
      idle: false,
      waitedMs: performance.now() - started,
      frames: this.frame - firstFrame,
      views: this.state().views,
    };
  }

  /** The current frame as a PNG data URL (the WebGL canvas only). */
  captureCanvas(): string {
    return this.canvas.toDataURL("image/png");
  }

  async query(x: number, z: number, which: "a" | "b" = "a") {
    const view = this.views[which];
    if (!view) return null;
    const response = await fetch(
      `${this.server}/api/source/${encodeURIComponent(view.ref.id)}/query`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ points: [[Math.floor(x), Math.floor(z)]] }),
      },
    );
    return response.ok
      ? ((await response.json()) as { points: unknown[] }).points[0]
      : null;
  }

  dispose() {
    this.running = false;
    this.pins.dispose();
    for (const view of [this.views.a, this.views.b])
      if (view) this.disposeView(view);
    this.rig.dispose();
    this.renderer.dispose();
    this.canvas.remove();
    this.hud.remove();
  }

  private groundAt(x: number, z: number): number | null {
    const view = this.views.a;
    if (!view) return null;
    return view.chunks.heightAt(x, z, true) ?? view.far.heightAt(x, z);
  }

  private resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    const ratio = this.renderer.getPixelRatio();
    const split = this.options.split === "side" && this.views.b;
    const viewWidth = split ? Math.floor(width / 2) : width;
    for (const view of [this.views.a, this.views.b]) {
      view?.target.setSize(
        Math.floor(viewWidth * ratio),
        Math.floor(height * ratio),
      );
      if (view?.target.depthTexture) {
        view.target.depthTexture.image.width = Math.floor(viewWidth * ratio);
        view.target.depthTexture.image.height = Math.floor(height * ratio);
      }
    }
    this.rig.resize(viewWidth, height);
    this.hud.width = Math.floor(width * ratio);
    this.hud.height = Math.floor(height * ratio);
    (this.composite.uniforms.uResolution.value as Vector2).set(
      width * ratio,
      height * ratio,
    );
  }

  private fog(): { near: number; far: number } {
    const o = this.options;
    if (o.fog === "off" || this.rig.projection === "orthographic")
      return { near: 1e7, far: 1e7 + 1 };
    if (o.fog === "game") {
      const sample = (this.host.look ?? defaultLook)(o.time);
      return { near: sample.fogNear, far: sample.fogFar };
    }
    const reach = Math.max(256, o.far ? o.farDistance : o.nearRadius * 16);
    return { near: reach * 0.55, far: reach };
  }

  private tick() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.fps = this.fps * 0.92 + (dt > 0 ? 1 / dt : 0) * 0.08;
    this.frame += 1;
    this.rig.update(dt);

    const focus = this.rig.focus();
    const span = this.rig.span();
    const camera = this.rig.camera;
    const look = (this.host.look ?? defaultLook)(this.options.time);
    const fog = this.fog();
    const overlays = this.options.overlays
      .map((id) => this.overlays.find((o) => o.id === id))
      .filter((o): o is ViewerOverlay => !!o);
    const grid = overlays.find((o) => o.kind === "grid");
    const contours = overlays.find((o) => o.kind === "contours");
    const useShadows =
      this.options.shadows && this.rig.projection === "perspective";

    const views = [this.views.a, this.views.b];
    views.forEach((view, index) => {
      if (!view || (index === 1 && this.options.split === "none")) return;
      applyLook(view.materials, look, fog);
      const u = view.materials.chunkRenderer.uniforms;
      u.fogHeightDensity.value = fog.near > 1e6 ? 0 : 0.005;
      const radius = nearRadiusFor({
        span,
        chunkSize: view.meta.chunkSize,
        max: this.options.nearRadius,
      });
      view.chunks.update(focus[0], focus[2], radius);
      view.chunks.setVisibility({
        water: this.options.water,
        plants: this.options.plants,
      });
      view.far.update(
        new Vector3(focus[0], focus[1], focus[2]),
        this.options.far && view.meta.far ? this.options.farDistance : 0,
        view.chunks,
        radius,
      );
      view.overlays.update(focus[0], focus[2], span, overlays);
      view.sky.position.copy(camera.position);
      view.sky.updateMatrixWorld();

      const viewCamera = camera;
      const lighting = view.materials.chunkRenderer.shaderLightingUniforms;
      if (useShadows) {
        view.csm.update(
          viewCamera,
          lighting.sunDirection.value,
          new Vector3(...focus),
          look.shadowStrength,
        );
        const csmUniforms = view.csm.getUniforms();
        lighting.shadowMap0.value = csmUniforms.uShadowMaps[0] ?? null;
        lighting.shadowMap1.value = csmUniforms.uShadowMaps[1] ?? null;
        lighting.shadowMap2.value = csmUniforms.uShadowMaps[2] ?? null;
        lighting.cascadeSplit0.value = csmUniforms.uCascadeSplits[0];
        lighting.cascadeSplit1.value = csmUniforms.uCascadeSplits[1];
        lighting.cascadeSplit2.value = csmUniforms.uCascadeSplits[2];
        lighting.shadowBias.value = csmUniforms.uShadowBias;
        lighting.shadowNormalBias.value = csmUniforms.uShadowNormalBias;
        view.csm.render(this.renderer, view.scene, [], 0, [], []);
        const m = [0, 1, 2].map((i) => view.csm.getCascadeMatrix(i));
        if (m[0]) lighting.shadowMatrix0.value.copy(m[0]);
        if (m[1]) lighting.shadowMatrix1.value.copy(m[1]);
        if (m[2]) lighting.shadowMatrix2.value.copy(m[2]);
      } else {
        lighting.shadowStrength.value = 0;
      }

      this.renderer.setRenderTarget(view.target);
      this.renderer.setClearColor(new Color(0, 0, 0), 1);
      this.renderer.clear();
      this.renderer.render(view.scene, viewCamera);

      const key = index === 0 ? "A" : "B";
      const uniforms = this.composite.uniforms;
      uniforms[`tColor${key}`].value = view.target.texture;
      uniforms[`tDepth${key}`].value = view.target.depthTexture;
      (uniforms[`uInverse${key}`].value as Matrix4).multiplyMatrices(
        viewCamera.matrixWorld,
        viewCamera.projectionMatrixInverse,
      );
      uniforms[`tOverlay${key}`].value = view.overlays.texture;
      const r = view.overlays.rect;
      (uniforms[`uOverlayRect${key}`].value as Vector4).set(
        r.x0,
        r.z0,
        1 / (1024 * r.res),
        1 / (1024 * r.res),
      );
      uniforms[`uHasOverlay${key}`].value = view.overlays.hasRaster ? 1 : 0;
      uniforms[`tHeight${key}`].value = view.overlays.heightTexture;
      uniforms[`uHasHeight${key}`].value = view.overlays.hasHeights ? 1 : 0;
    });

    const uniforms = this.composite.uniforms;
    uniforms.uOverlayOpacity.value = this.options.overlayOpacity;
    uniforms.uGrid.value = grid ? 1 : 0;
    uniforms.uGridSize.value =
      grid && grid.kind === "grid" ? grid.interval : 16;
    uniforms.uContours.value = contours ? 1 : 0;
    uniforms.uContourStep.value =
      contours && contours.kind === "contours" ? contours.interval : 8;
    uniforms.uSplit.value =
      !this.views.b || this.options.split === "none"
        ? 0
        : this.options.split === "side"
          ? 1
          : 2;
    uniforms.uSwipe.value = this.options.swipe;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCamera);

    this.updateHover();
    const cssWidth = this.canvas.clientWidth;
    this.pins.update(
      camera,
      this.options.split === "side" && this.views.b ? cssWidth / 2 : cssWidth,
      this.canvas.clientHeight,
    );
    this.drawHud(camera, overlays);
    this.notify();
  }

  private updateHover() {
    if (!this.pointer || this.frame % 4 !== 0) return;
    this.hover = this.pickGround(this.pointer.x, this.pointer.y);
  }

  /**
   * Four pixel brackets round the double-clicked spot, closing in a step at
   * a time while the camera flies there, then gone: no fade.
   */
  private drawFlightMark(
    context: CanvasRenderingContext2D,
    camera: Camera,
    width: number,
    height: number,
  ) {
    const mark = this.flightMark;
    if (!mark) return;
    const age = (performance.now() - mark.at) / 1000;
    const life = this.rig.feel.flightMax;
    if (age > life) {
      this.flightMark = null;
      return;
    }
    const p = new Vector3(...mark.point).project(camera);
    if (p.z < -1 || p.z > 1) return;
    const x = Math.round(((p.x + 1) / 2) * width);
    const y = Math.round(((1 - p.y) / 2) * height);
    const step = Math.min(
      FLIGHT_MARK_STEPS.length - 1,
      Math.floor((age / life) * FLIGHT_MARK_STEPS.length),
    );
    const r = FLIGHT_MARK_STEPS[step];
    const theme = { ...DEFAULT_THEME, ...this.host.theme };
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const cx = x + sx * r;
      const cy = y + sy * r;
      context.fillStyle = theme.outline;
      context.fillRect(cx - (sx > 0 ? 7 : 1), cy - 1, 8, 4);
      context.fillRect(cx - 1, cy - (sy > 0 ? 7 : 1), 4, 8);
      context.fillStyle = theme.accent;
      context.fillRect(cx - (sx > 0 ? 6 : 0), cy, 6, 2);
      context.fillRect(cx, cy - (sy > 0 ? 6 : 0), 2, 6);
    }
  }

  private drawHud(camera: Camera, overlays: ViewerOverlay[]) {
    const context = this.hud.getContext("2d");
    if (!context) return;
    const ratio = this.renderer.getPixelRatio();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, this.hud.width, this.hud.height);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.pins.drawHud(context);
    if (!this.options.hud) return;
    const font = this.host.labelFont ?? "sans-serif";
    const width = this.hud.width / ratio;
    const height = this.hud.height / ratio;
    const label = (
      text: string,
      x: number,
      y: number,
      size = 13,
      color = "#f2f2f2",
    ) => {
      context.font = `${size}px ${font}`;
      const w = context.measureText(text).width;
      context.fillStyle = "rgba(10, 12, 16, 0.72)";
      context.fillRect(x - 5, y - size, w + 10, size + 7);
      context.fillStyle = color;
      context.fillText(text, x, y);
    };
    this.drawFlightMark(context, camera, width, height);
    const annotationsOn = overlays.some((o) => o.kind === "annotations");
    if (annotationsOn && this.views.a && this.options.split !== "side") {
      const seen: { x: number; y: number }[] = [];
      for (const a of this.views.a.overlays.annotations as Annotation[]) {
        const p = new Vector3(...a.anchor).project(camera);
        if (p.z < -1 || p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1)
          continue;
        const x = ((p.x + 1) / 2) * width;
        const y = ((1 - p.y) / 2) * height;
        if (seen.some((s) => Math.abs(s.x - x) < 90 && Math.abs(s.y - y) < 18))
          continue;
        seen.push({ x, y });
        label(a.label.replace(/_/g, " "), x + 6, y, 12, "#ffd24a");
      }
    }
    const pose = this.rig.pose();
    const lines = [
      `${this.rig.preset} · eye ${formatVec(pose.eye, 0)} · look ${formatVec(pose.look, 0)}`,
      this.hover ? `cursor ${formatVec(this.hover, 0)}` : "",
    ].filter(Boolean);
    lines.forEach((line, i) =>
      label(line, 12, height - 14 - (lines.length - 1 - i) * 22),
    );
    if (this.views.b && this.options.split !== "none") {
      const split = this.options.split === "side" ? 0.5 : this.options.swipe;
      label(`A · ${this.views.a?.ref.label ?? ""}`, 12, 22, 14, "#9fd4ff");
      const bText = `B · ${this.views.b.ref.label}`;
      context.font = `14px ${font}`;
      label(
        bText,
        Math.max(
          split * width + 12,
          width - context.measureText(bText).width - 18,
        ),
        22,
        14,
        "#ffd24a",
      );
    }
  }
}

export type { AtlasFilteringMode };

/** Half-widths of the flight mark's brackets, CSS pixels, one per step. */
const FLIGHT_MARK_STEPS = [22, 16, 11, 7];

/** The chunk lighting a pin shares, so it is lit like the terrain of its view. */
function pinLighting(materials: ViewerMaterials): PinLighting {
  const u = materials.chunkRenderer.uniforms;
  const l = materials.chunkRenderer.shaderLightingUniforms;
  return {
    sunDirection: l.sunDirection,
    sunColor: l.sunColor,
    sunlightIntensity: u.sunlightIntensity,
    ambientColor: l.ambientColor,
    minLightLevel: u.minLightLevel,
    baseAmbient: u.baseAmbient,
    faceShades: u.faceShades,
  };
}
