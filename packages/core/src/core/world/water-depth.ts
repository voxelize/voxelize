import {
  type Camera,
  DepthTexture,
  DoubleSide,
  FloatType,
  Frustum,
  type Material,
  Matrix4,
  Mesh,
  NearestFilter,
  type Object3D,
  type PerspectiveCamera,
  RedFormat,
  Scene,
  ShaderMaterial,
  type Texture,
  UnsignedByteType,
  Vector2,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";

import { TRANSPARENT_OVER_FLUID_RENDER_ORDER } from "../../common";

import {
  type CustomChunkShaderMaterial,
  forkChunkMaterial,
} from "./chunk-materials";
import { forwardDraws } from "./forward-draws";
import { shareBuffers } from "./see-through-texels";
import {
  WATER_DEPTH_DRAWN,
  WATER_DEPTH_DRY,
  WATER_DEPTH_SIDE_BEHIND,
  WATER_DEPTH_SIDE_FRONT,
  WATER_DEPTH_UNKNOWN,
} from "./shaders";

/** The uniforms every chunk material shares with the pass. */
export type WaterDepthUniforms = {
  waterDepth: { value: Texture | null };
  waterDepthState: { value: number };
  /** The size of the target the panes draw into, to turn pixels into UVs. */
  waterDepthViewport: { value: Vector2 };
  /** The camera's near and far planes, to compare depths as distances. */
  waterDepthClip: { value: Vector2 };
};

/** Where a chunk mesh's section sits, in sections. */
export type SectionCoords = [cx: number, level: number, cz: number];

const DEPTH_ONLY_FRAGMENT = "void main() {}";

function sectionKey(cx: number, level: number, cz: number) {
  return `${cx},${level},${cz}`;
}

/** Whether an object is drawn at all: it and every ancestor up to a scene. */
function isShown(object: Object3D) {
  for (let node: Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return false;
    if (!node.parent) return (node as Scene).isScene === true;
  }
  return false;
}

/**
 * The sections whose water can stand between the camera and a pane: the
 * pane's own and every one around it. Water that is not touching a pane's
 * section can only be in front of it through air the pane looks out of,
 * which leaves the pane in front of that water on screen.
 */
export function sectionsAround([cx, level, cz]: SectionCoords): string[] {
  const keys: string[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        keys.push(sectionKey(cx + dx, level + dy, cz + dz));
      }
    }
  }
  return keys;
}

/**
 * The draw ranges a pane mesh and its lifted child take for a render: the
 * mesh (before the water) keeps what is behind it and the child (after the
 * water) the rest. With nothing drawn, every fragment counts as behind and
 * the child draws nothing; with no water near, the mesh does.
 */
export function paneDrawCounts(state: number): {
  pane: number;
  lifted: number;
} {
  if (state === WATER_DEPTH_DRY) return { pane: 0, lifted: Infinity };
  if (state === WATER_DEPTH_DRAWN) return { pane: Infinity, lifted: Infinity };
  return { pane: Infinity, lifted: 0 };
}

type Pane = { lifted: Mesh; section: SectionCoords };

/**
 * Which side of the water each blended see-through fragment draws on,
 * decided per pixel.
 *
 * Water writes no depth and composites a copy of everything drawn before it
 * as its refraction, so a pane fragment behind the nearest water face has to
 * draw before the water, inside that copy, and one in front of it after the
 * water, or the water paints over it. Which one a face is depends on where
 * the camera stands: the floor of a glass tunnel under a pool is behind the
 * surface seen from above and in front of the water seen from inside the
 * tunnel, so no answer per face holds.
 *
 * Before the frame, `render` draws the depth of the water near the panes in
 * view into a texture, with the water's own vertex shader so the waves
 * match. Every pane mesh then draws twice from the same buffers: itself,
 * before the water, keeping the fragments behind that depth, and its lifted
 * child, after the water, keeping the rest. A material fork per side carries
 * the test, so neither draw changes a uniform mid-frame.
 */
export class WaterDepthPass {
  private readonly scene = new Scene();
  /** Each water mesh's stand-in in the depth scene, by section. */
  private readonly water = new Map<string, Map<Mesh, Mesh>>();
  private readonly panes = new Map<Mesh, Pane>();
  private readonly depthMaterials = new WeakMap<Material, ShaderMaterial>();
  private readonly forks = new WeakMap<
    Material,
    { behind: CustomChunkShaderMaterial; front: CustomChunkShaderMaterial }
  >();
  private target: WebGLRenderTarget | null = null;
  private drawnCamera: Camera | null = null;
  private readonly drawnView = new Matrix4();
  private readonly drawnProjection = new Matrix4();
  private checkedFrame = -1;
  private shown: Mesh[] = [];
  private readonly frustum = new Frustum();
  private readonly viewProjection = new Matrix4();
  private readonly size = new Vector2();
  private readonly near = new Set<string>();

  constructor(
    private readonly uniforms: WaterDepthUniforms,
    private readonly sectionOf: (mesh: Mesh) => SectionCoords,
  ) {
    this.scene.matrixWorldAutoUpdate = false;
  }

  /** A water mesh: its depth is drawn while a pane near it is in view. */
  addWater(mesh: Mesh) {
    const [cx, level, cz] = this.sectionOf(mesh);
    const key = sectionKey(cx, level, cz);
    const standIn = new Mesh(
      mesh.geometry,
      this.depthMaterialFor(mesh.material as ShaderMaterial),
    );
    standIn.matrixAutoUpdate = false;
    standIn.matrixWorldAutoUpdate = false;
    standIn.visible = false;
    this.scene.add(standIn);

    let section = this.water.get(key);
    if (!section) {
      section = new Map();
      this.water.set(key, section);
    }
    section.set(mesh, standIn);

    mesh.geometry.addEventListener("dispose", () => {
      this.scene.remove(standIn);
      const current = this.water.get(key);
      current?.delete(mesh);
      if (current?.size === 0) this.water.delete(key);
    });
  }

  /**
   * A blended see-through mesh: it takes the fork that keeps what is behind
   * the water, and a child that draws the rest after the water. Returns the
   * child.
   */
  addPane(mesh: Mesh): Mesh {
    const { behind, front } = this.forksOf(
      mesh.material as CustomChunkShaderMaterial,
    );
    mesh.material = behind;

    const source = mesh.geometry;
    const geometry = shareBuffers(source);
    const lifted = new Mesh(geometry, front);
    lifted.renderOrder = TRANSPARENT_OVER_FLUID_RENDER_ORDER;
    lifted.matrixAutoUpdate = false;
    lifted.userData = { isLiftedPane: true };
    mesh.add(lifted);

    this.panes.set(mesh, { lifted, section: this.sectionOf(mesh) });
    source.addEventListener("dispose", () => {
      geometry.dispose();
      this.panes.delete(mesh);
    });
    return lifted;
  }

  /** The child that draws `mesh`'s part in front of the water, if a pane. */
  liftedOf(mesh: Mesh): Mesh | null {
    return this.panes.get(mesh)?.lifted ?? null;
  }

  /**
   * Before a pane mesh draws: which of its two draws run. Checks once a
   * render that the depth was drawn for this very camera; for another
   * camera, or one that has moved since, every pane falls back to drawing
   * before the water.
   */
  prepareDraw(
    renderer: WebGLRenderer,
    camera: Camera,
    mesh: Mesh,
    lifted: Mesh,
  ) {
    const frame = renderer.info.render.frame;
    if (frame !== this.checkedFrame) {
      this.checkedFrame = frame;
      this.checkRender(renderer, camera);
    }
    const counts = paneDrawCounts(this.uniforms.waterDepthState.value);
    mesh.geometry.setDrawRange(0, counts.pane);
    lifted.geometry.setDrawRange(0, counts.lifted);
  }

  /** The depth drawn by the last {@link render}, while it holds water. */
  get depthTexture(): Texture | null {
    return this.uniforms.waterDepthState.value === WATER_DEPTH_DRAWN
      ? this.target?.depthTexture ?? null
      : null;
  }

  /**
   * Draws the depth of the water near the panes in view (`"panes"`), or of
   * all the water in view (`"all"`), for `camera`. Call it once a frame,
   * before the scene renders with that camera.
   */
  render(
    renderer: WebGLRenderer,
    camera: Camera,
    scope: "panes" | "all" = "panes",
  ) {
    const state = this.uniforms.waterDepthState;
    for (const standIn of this.shown) standIn.visible = false;
    this.shown = [];
    this.checkedFrame = -1;

    if (!(camera as PerspectiveCamera).isPerspectiveCamera) {
      this.drawnCamera = null;
      state.value = WATER_DEPTH_UNKNOWN;
      return;
    }
    const perspective = camera as PerspectiveCamera;
    perspective.updateWorldMatrix(true, false);
    this.drawnCamera = camera;
    this.drawnView.copy(camera.matrixWorldInverse);
    this.drawnProjection.copy(camera.projectionMatrix);

    this.viewProjection.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    this.frustum.setFromProjectionMatrix(this.viewProjection);

    this.near.clear();
    if (scope === "all") {
      for (const key of this.water.keys()) this.near.add(key);
    } else {
      for (const [mesh, pane] of this.panes) {
        if (!isShown(mesh) || !this.frustum.intersectsObject(mesh)) continue;
        for (const key of sectionsAround(pane.section)) this.near.add(key);
      }
    }
    for (const key of this.near) {
      const section = this.water.get(key);
      if (!section) continue;
      for (const [mesh, standIn] of section) {
        if (!isShown(mesh) || !this.frustum.intersectsObject(mesh)) continue;
        standIn.matrixWorld.copy(mesh.matrixWorld);
        standIn.visible = true;
        this.shown.push(standIn);
      }
    }
    if (this.shown.length === 0) {
      state.value = WATER_DEPTH_DRY;
      return;
    }

    const size = renderer.getDrawingBufferSize(this.size);
    const target = this.targetOfSize(Math.floor(size.x), Math.floor(size.y));
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    renderer.setRenderTarget(target);
    renderer.autoClear = false;
    // A clear honours the depth mask, which the last draw may have left off.
    renderer.state.buffers.depth.setMask(true);
    renderer.clear(false, true, false);
    renderer.render(this.scene, camera);
    renderer.autoClear = previousAutoClear;
    renderer.setRenderTarget(previousTarget);

    this.uniforms.waterDepth.value = target.depthTexture;
    this.uniforms.waterDepthClip.value.set(perspective.near, perspective.far);
    state.value = WATER_DEPTH_DRAWN;
  }

  dispose() {
    this.target?.dispose();
    this.target = null;
  }

  private checkRender(renderer: WebGLRenderer, camera: Camera) {
    const state = this.uniforms.waterDepthState;
    if (state.value === WATER_DEPTH_UNKNOWN) return;
    if (
      camera !== this.drawnCamera ||
      !camera.matrixWorldInverse.equals(this.drawnView) ||
      !camera.projectionMatrix.equals(this.drawnProjection)
    ) {
      state.value = WATER_DEPTH_UNKNOWN;
      return;
    }
    const target = renderer.getRenderTarget();
    if (target) {
      this.uniforms.waterDepthViewport.value.set(target.width, target.height);
    } else {
      renderer.getDrawingBufferSize(this.uniforms.waterDepthViewport.value);
    }
  }

  private targetOfSize(width: number, height: number) {
    if (this.target?.width === width && this.target.height === height) {
      return this.target;
    }
    this.target?.dispose();
    const depthTexture = new DepthTexture(width, height, FloatType);
    depthTexture.minFilter = NearestFilter;
    depthTexture.magFilter = NearestFilter;
    this.target = new WebGLRenderTarget(width, height, {
      format: RedFormat,
      type: UnsignedByteType,
      depthBuffer: true,
      depthTexture,
      generateMipmaps: false,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
    });
    return this.target;
  }

  /**
   * The water's own vertex shader (its waves move the surface) over a
   * fragment stage that writes nothing but depth. Both sides: the nearest
   * water face is the surface's top from above and its underside from
   * below, where the water itself draws back faces.
   */
  private depthMaterialFor(water: ShaderMaterial) {
    const cached = this.depthMaterials.get(water);
    if (cached) return cached;
    const depth = new ShaderMaterial({
      vertexShader: water.vertexShader,
      fragmentShader: DEPTH_ONLY_FRAGMENT,
      uniforms: water.uniforms,
      defines: { ...water.defines },
      vertexColors: water.vertexColors,
      side: DoubleSide,
      colorWrite: false,
    });
    // The same map as the water compiles the shared vertex stage alike.
    (depth as unknown as CustomChunkShaderMaterial).map = (
      water as CustomChunkShaderMaterial
    ).map;
    Object.assign(depth.defaultAttributeValues, water.defaultAttributeValues);
    this.depthMaterials.set(water, depth);
    return depth;
  }

  private forksOf(material: CustomChunkShaderMaterial) {
    let forks = this.forks.get(material);
    if (!forks) {
      const behind = forkChunkMaterial(material);
      behind.uniforms.uWaterDepthSide = { value: WATER_DEPTH_SIDE_BEHIND };
      forwardDraws(behind, material);
      const front = forkChunkMaterial(material);
      front.uniforms.uWaterDepthSide = { value: WATER_DEPTH_SIDE_FRONT };
      forwardDraws(front, material);
      forks = { behind, front };
      this.forks.set(material, forks);
    }
    return forks;
  }
}
