import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataArrayTexture,
  DataTexture,
  DepthTexture,
  FloatType,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  MeshBasicNodeMaterial,
  NodeMaterial,
  type Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  QuadMesh,
  RedFormat,
  RenderTarget,
  RGBAFormat,
  Scene,
  UnsignedByteType,
  Vector4,
  WebGPURenderer,
} from "three/webgpu";
import { uv, vec4 } from "three/tsl";

import {
  BloomEffect,
  BrightnessContrastEffect,
  EffectComposer,
  EffectPass,
  FxaaEffect,
  SceneOverlayEffect,
  ScenePass,
  VignetteEffect,
} from "../../../postprocessing/src";
import { CanvasBox } from "../../src/libs/canvas-box";
import { BlockOverlayEffect } from "../../src/libs/effects/block-overlay";
import { LocalLightAirlightEffect } from "../../src/libs/effects/local-light-airlight";
import {
  InstancedSkinnedDepthMaterial,
  InstancedSkinnedMaterial,
} from "../../src/libs/instancing/instanced-skinned-material";
import { packVertexBuffers } from "../../src/libs/instancing/vertex-buffers";
import { Clouds } from "../../src/core/world/clouds";
import { createCrustedFluidSurface } from "../../src/core/world/crusted-fluid-shader";
import { LightCones } from "../../src/core/world/light-cones";
import { LocalLightAirlight } from "../../src/core/world/local-lights/airlight";
import { LightClusterGrid } from "../../src/core/world/local-lights/clustering";
import {
  defaultOrderIndependentTransparencyOptions,
  OrderIndependentTransparency,
} from "../../src/core/world/order-independent-transparency";
import {
  ChunkMaterial,
  type ChunkMaterialKind,
  type ChunkShadingInputs,
} from "../../src/core/world/shading/chunk-material";
import {
  arrayUniform,
  createChunkUniforms,
  createShaderLightingUniforms,
} from "../../src/core/world/shading/chunk-uniforms";
import { applyEntityLight } from "../../src/core/world/shading/entity-light";
import {
  createFarLandMaterial,
  createFarSeabedMaterial,
  createFarTerrainUniforms,
  createFarWaterMaterial,
  type FarTerrainSharedUniforms,
} from "../../src/core/world/shading/far-terrain";
import {
  ownUniform,
  textureSlot,
  worldUniform,
} from "../../src/core/world/shading/uniforms";
import {
  createVolumetricCloudMaterial,
  createVolumetricCloudUniforms,
} from "../../src/core/world/shading/volumetric-clouds";
import { Sky } from "../../src/core/world/sky";
import { worldFogNode } from "../../src/core/world/shading/sky-fog";

type Report = {
  ok: boolean;
  done: boolean;
  errors: string[];
  shaders: Record<string, { vertex: string; fragment: string }>;
};

const report: Report = { ok: false, done: false, errors: [], shaders: {} };
(window as unknown as { __probe: Report }).__probe = report;
const origError = console.error;
console.error = (...args: unknown[]) => {
  report.errors.push(args.map(String).join(" "));
  origError(...args);
};

function quadGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute(
    "normal",
    new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
  );
  geometry.setAttribute(
    "uv",
    new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2),
  );
  geometry.setAttribute(
    "light",
    new BufferAttribute(new Int32Array([0xf000, 0xf000, 0xf000, 0xf000]), 1),
  );
  geometry.setIndex([0, 1, 3, 3, 2, 0]);
  return geometry;
}

type ShaderDebug = {
  debug: {
    getShaderAsync(
      s: Scene,
      c: PerspectiveCamera,
      m: Object3D,
    ): Promise<{ vertexShader: string; fragmentShader: string }>;
  };
};

async function main() {
  const renderer = new WebGPURenderer({ antialias: false });
  renderer.setSize(256, 256);
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  const device = (renderer.backend as unknown as { device?: GPUDevice }).device;
  device?.addEventListener("uncapturederror", (event) => {
    report.errors.push(
      `uncaptured: ${(event as GPUUncapturedErrorEvent).error.message}`,
    );
  });

  const grid = new LightClusterGrid(
    { capacity: 16 } as never,
    {
      gridCellSize: 8,
      gridDims: [8, 4, 8],
      maxClusteredLights: 16,
      windowFadeBlocks: 4,
      highResolutionPixels: 1e9,
      highResolutionLightsPerCell: 8,
      highResolutionHysteresis: 0.1,
      maskKnee: 5 / 15,
      fluidSpecularStrength: 1,
    } as never,
  );
  const chunk = createChunkUniforms();
  const lighting = createShaderLightingUniforms();
  const cones = new LightCones().uniforms;
  const airlight = new LocalLightAirlight({} as never);
  const inputs: ChunkShadingInputs = {
    id: 1,
    chunk: chunk as never,
    lighting,
    cones,
    local: {
      grid: (grid as unknown as LightClusterGrid).uniforms,
      shadow: {
        atlas: textureSlot("depth"),
        params: worldUniform(new Vector4(1024, 128, 0.05, 1)),
        params2: worldUniform(new Vector4(1, 1, 0, 0)),
      } as never,
      air: airlight.uniforms,
    },
    swayTable: arrayUniform(
      Array.from({ length: 64 }, () => new Vector4()),
      "vec4",
    ),
  };
  const atmosphere = {
    ...chunk,
    directSunlight: lighting.directSunlight,
  };

  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0.5, 0.5, 2);
  camera.updateMatrixWorld();

  const probe = async (name: string, object: Object3D, scene = new Scene()) => {
    scene.add(object);
    try {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      // The first mesh with one material (three's shader dump takes one);
      // a material array still drew above, and its errors were reported.
      let inspected: Object3D | null = null;
      object.traverse((child) => {
        const mesh = child as Mesh;
        if (!inspected && mesh.isMesh && !Array.isArray(mesh.material)) {
          inspected = child;
        }
      });
      if (!inspected) return;
      const shader = await (renderer as unknown as ShaderDebug).debug.getShaderAsync(
        scene,
        camera,
        inspected as Object3D,
      );
      report.shaders[name] = {
        vertex: shader.vertexShader,
        fragment: shader.fragmentShader,
      };
    } catch (error) {
      report.errors.push(`${name}: ${(error as Error).stack ?? error}`);
    }
  };

  // ── chunk materials ────────────────────────────────────────────────────
  const kinds: ChunkMaterialKind[] = ["opaque", "cutout", "seeThrough", "fluid"];
  for (const kind of kinds) {
    const material = new ChunkMaterial(inputs, { kind });
    if (kind === "cutout") material.alphaTest = 0.5;
    if (kind === "seeThrough" || kind === "fluid") {
      material.transparent = true;
      material.alphaTest = kind === "seeThrough" ? 0.1 : 0;
    }
    await probe(kind, new Mesh(quadGeometry(), material));
  }
  {
    const lava = createCrustedFluidSurface();
    const material = new ChunkMaterial(inputs, {
      kind: "seeThrough",
      hooks: lava.hooks,
    });
    await probe("crust", new Mesh(quadGeometry(), material));
    const translucent = new ChunkMaterial(inputs, { kind: "seeThrough" });
    translucent.transparent = true;
    translucent.alphaTest = 0.1;
    translucent.cutsSolidTexels = true;
    translucent.solidTexelCut = 0.99;
    await probe("translucent-texels", new Mesh(quadGeometry(), translucent));
  }

  // ── sky, clouds, volumetric clouds ─────────────────────────────────────
  {
    const sky = new Sky({ dimension: 50 });
    await probe("sky", sky);
  }
  const clouds = new Clouds({ atmosphere: atmosphere as never });
  await probe("clouds", new Mesh(new PlaneGeometry(1, 1), clouds.material));
  {
    const material = createVolumetricCloudMaterial(
      createVolumetricCloudUniforms(),
      clouds.shared,
    );
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    );
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    await probe("volumetric-clouds", mesh);
  }

  // ── far terrain ─────────────────────────────────────────────────────────
  {
    const shared = {
      ...atmosphere,
      sunDirection: lighting.sunDirection,
      sunColor: lighting.sunColor,
      ambientColor: lighting.ambientColor,
      skyTopColor: lighting.skyTopColor,
      skyMiddleColor: lighting.skyMiddleColor,
      waterFresnelStrength: lighting.waterFresnelStrength,
      waterTint: lighting.waterTint,
    } as unknown as FarTerrainSharedUniforms;
    const layers = new DataArrayTexture(new Uint8Array(16 * 16 * 4 * 2), 16, 16, 2);
    layers.needsUpdate = true;
    const materials = new DataTexture(new Float32Array(3 * 4 * 2), 3, 2, RGBAFormat, FloatType);
    materials.needsUpdate = true;
    const shadow = new DataTexture(new Float32Array(16), 4, 4, RedFormat, FloatType);
    shadow.needsUpdate = true;
    const depth = new DataTexture(new Uint8Array(16), 4, 4, RedFormat, UnsignedByteType);
    depth.needsUpdate = true;
    const u = createFarTerrainUniforms({ layers, materials, shadow, depth });
    u.ringOuter.value = 1000;
    const land = quadGeometry();
    land.setAttribute("aFarColumn", new BufferAttribute(new Int16Array(8), 2));
    land.setAttribute("aFarMaterial", new BufferAttribute(new Uint8Array(16), 4));
    land.setAttribute("aFarTint", new BufferAttribute(new Uint8Array(16), 4));
    await probe("far-land", new Mesh(land, createFarLandMaterial(shared, u)));
    await probe(
      "far-water",
      new Mesh(new PlaneGeometry(1, 1), createFarWaterMaterial(shared, u, 32)),
    );
    await probe(
      "far-seabed",
      new Mesh(new PlaneGeometry(1, 1), createFarSeabedMaterial(shared, u)),
    );
  }

  // ── instanced skinned entities ──────────────────────────────────────────
  {
    const bones = new DataTexture(new Float32Array(16 * 4 * 4), 16, 4, RGBAFormat, FloatType);
    bones.needsUpdate = true;
    const geometry = quadGeometry();
    geometry.deleteAttribute("light");
    geometry.setAttribute("skinIndex", new BufferAttribute(new Float32Array(16), 4));
    geometry.setAttribute(
      "skinWeight",
      new BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]), 4),
    );
    geometry.setAttribute("pivotOffset", new BufferAttribute(new Float32Array(12), 3));
    geometry.setAttribute("partIndex", new BufferAttribute(new Float32Array(4), 1));
    geometry.setAttribute("vertexColor", new BufferAttribute(new Float32Array(12).fill(1), 3));
    geometry.setAttribute("instanceBoneOffset", new InstancedBufferAttribute(new Float32Array(2), 1));
    geometry.setAttribute("instanceHitEffect", new InstancedBufferAttribute(new Float32Array(2), 1));
    geometry.setAttribute("instanceLightColor", new InstancedBufferAttribute(new Float32Array(6).fill(1), 3));
    geometry.setAttribute("instanceEmissive", new InstancedBufferAttribute(new Float32Array(2), 1));
    packVertexBuffers(geometry);
    const material = new InstancedSkinnedMaterial(bones, 16, 4, 4, {
      useFaceUV: true,
      useVertexColor: true,
      receiveShadows: true,
      isEnvironmentBound: false,
      emissiveFace: { partIndex: 0, faceIndex: 2, color: new Color(1, 1, 0) },
    });
    const mesh = new InstancedMesh(geometry, material, 2);
    mesh.frustumCulled = false;
    await probe("instanced-skinned", mesh);
    const depthMesh = new InstancedMesh(
      geometry,
      new InstancedSkinnedDepthMaterial(bones, 16, 4),
      2,
    );
    depthMesh.frustumCulled = false;
    await probe("instanced-skinned-depth", depthMesh);
  }

  // ── entity surfaces ─────────────────────────────────────────────────────
  {
    const box = new CanvasBox({ receiveShadows: true });
    await probe("canvas-box", box);
    const lit = new MeshBasicNodeMaterial({ color: 0x88aaff });
    applyEntityLight(lit, ownUniform(new Color(1, 1, 1)), cones);
    await probe("entity-light", new Mesh(new PlaneGeometry(1, 1), lit));
  }

  // ── the world's fog node over generic materials ────────────────────────
  {
    const scene = new Scene();
    (scene as unknown as { fogNode: unknown }).fogNode = worldFogNode(atmosphere as never);
    const additive = new MeshBasicNodeMaterial({
      color: 0xffaa66,
      transparent: true,
      blending: 2,
      depthWrite: false,
    });
    scene.add(
      new Mesh(new PlaneGeometry(1, 1), new MeshBasicNodeMaterial({ color: 0x66aa88 })),
      new Mesh(new PlaneGeometry(0.5, 0.5), additive),
    );
    try {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    } catch (error) {
      report.errors.push(`world-fog: ${(error as Error).stack ?? error}`);
    }
  }

  // ── screen effects ──────────────────────────────────────────────────────
  {
    const depthTexture = new DepthTexture(4, 4);
    depthTexture.type = FloatType;
    const target = new RenderTarget(256, 256, { type: FloatType, depthTexture });
    renderer.setRenderTarget(target);
    renderer.render(new Scene(), camera);
    renderer.setRenderTarget(null);
    const effect = new LocalLightAirlightEffect(camera, airlight);
    effect.update();
    const overlay = new BlockOverlayEffect(null as never, camera);
    const material = new NodeMaterial();
    material.fragmentNode = overlay.apply(
      effect.apply(vec4(0.2, 0.3, 0.4, 1), textureSlot("depth", depthTexture), uv()),
    );
    try {
      new QuadMesh(material).render(renderer);
    } catch (error) {
      report.errors.push(`screen-effects: ${(error as Error).stack ?? error}`);
    }
  }

  // ── order-independent transparency ──────────────────────────────────────
  {
    const scene = new Scene();
    const opaque = new Mesh(new PlaneGeometry(4, 4), new MeshBasicNodeMaterial({ color: 0x336633 }));
    opaque.position.z = -1;
    const glass = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicNodeMaterial({ color: 0x88ccff, transparent: true, opacity: 0.4, depthWrite: false }),
    );
    const water = new Mesh(
      quadGeometry(),
      Object.assign(new ChunkMaterial(inputs, { kind: "fluid" }), {
        transparent: true,
        depthWrite: false,
      }),
    );
    scene.add(opaque, glass, water);
    const oit = new OrderIndependentTransparency(
      scene,
      defaultOrderIndependentTransparencyOptions,
    );
    const depthTexture = new DepthTexture(256, 256);
    depthTexture.type = FloatType;
    const target = new RenderTarget(256, 256, { type: FloatType, depthTexture });
    try {
      oit.render(renderer, scene, camera, target);
      oit.render(renderer, scene, camera, target);
      if (oit.stats.opened !== 2) {
        report.errors.push(`oit: opened ${oit.stats.opened} of 2 frames`);
      }
    } catch (error) {
      report.errors.push(`oit: ${(error as Error).stack ?? error}`);
    }
  }

  // ── postprocessing chain ────────────────────────────────────────────────
  {
    const scene = new Scene();
    const glow = new Mesh(new PlaneGeometry(1, 1), new MeshBasicNodeMaterial({ color: 0xffffff }));
    scene.add(glow);
    const armScene = new Scene();
    armScene.add(new Mesh(new PlaneGeometry(0.3, 0.3), new MeshBasicNodeMaterial({ color: 0xff8844 })));
    const composer = new EffectComposer(renderer);
    composer.addPass(new ScenePass((r) => r.render(scene, camera)));
    composer.addPass(new EffectPass(new FxaaEffect()));
    const bloom = new BloomEffect({ luminanceThreshold: 0.85, luminanceSmoothing: 0.1, intensity: 0.5, radius: 0.6 });
    composer.addPass(
      new EffectPass(
        bloom,
        new VignetteEffect({ offset: 0.5, darkness: 0.3 }),
        new BrightnessContrastEffect({ contrast: 0.04 }),
        new SceneOverlayEffect(armScene, camera),
      ),
    );
    composer.setSize(256, 256);
    try {
      composer.render(0.016);
      composer.render(0.016);
    } catch (error) {
      report.errors.push(`postprocessing: ${(error as Error).stack ?? error}`);
    }
  }

  await device?.queue.onSubmittedWorkDone();
  report.ok = report.errors.length === 0;
  report.done = true;
}

main().catch((error) => {
  report.errors.push(`fatal: ${(error as Error).stack ?? error}`);
  report.done = true;
});
