import { useEffect, useRef, useState } from "react";

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { DEFAULT_WEIGHTS } from "./math";
import { Choice } from "./ui";

/**
 * A small scene drawn two ways. "Sorted" is three's own transparent sort
 * with the water refracting a copy of the frame drawn before it, the way a
 * sorted pipeline does. "Order-independent" is the engine's pass in
 * miniature: depth writers and solid texels, the depth of the water, the
 * blended layers behind it accumulated and composited, then the water and
 * everything in front of it accumulated and composited. The GLSL below is
 * the same arithmetic as the engine's encoder and composite.
 */

type Mode = "sorted" | "oit";
type View = "final" | "accumulation" | "coverage" | "water";

const LAYER_WORLD = 0;
const LAYER_SOLID_TEXELS = 1;
const LAYER_BLENDED = 2;
const LAYER_TRANSLUCENT_TEXELS = 3;
const LAYER_SORTED_GLASS = 4;

const OIT_GLSL = /* glsl */ `
uniform float uMode;
uniform float uPhase;
uniform sampler2D uWaterDepth;
uniform vec2 uViewport;
uniform vec2 uClip;
uniform vec4 uWeight;
uniform vec2 uWeightRange;
layout(location = 1) out highp vec4 pc_fragOitWeight;

float oitDistanceAt(float depth) {
  return uClip.x * uClip.y / (uClip.y - depth * (uClip.y - uClip.x));
}

bool oitKeep() {
  if (uMode < 0.5 || uPhase < 0.5) return true;
  float separator = texture2D(uWaterDepth, gl_FragCoord.xy / uViewport).r;
  bool isBehind = oitDistanceAt(gl_FragCoord.z) > oitDistanceAt(separator) + 0.02;
  return isBehind == (uPhase < 1.5);
}

void oitWrite(vec4 color) {
  pc_fragOitWeight = vec4(0.0);
  if (uMode < 0.5) {
    gl_FragColor = color;
    return;
  }
  float alpha = clamp(color.a, 0.0, 1.0);
  if (alpha <= 0.0) discard;
  float distance = oitDistanceAt(gl_FragCoord.z);
  float weight = alpha * clamp(
    uWeight.x / (1e-5 + pow(distance / uWeight.y, 3.0) + pow(distance / uWeight.z, 6.0)),
    uWeightRange.x,
    uWeightRange.y
  );
  gl_FragColor = vec4(color.rgb * alpha * weight, alpha);
  pc_fragOitWeight = vec4(alpha * weight, 0.0, 0.0, 0.0);
}
`;

const VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const GLASS_FRAGMENT = /* glsl */ `
${OIT_GLSL}
uniform sampler2D uMap;
uniform float uSkipSolid;
varying vec2 vUv;
void main() {
  if (!oitKeep()) discard;
  vec4 texel = texture2D(uMap, vUv);
  if (texel.a < 0.1) discard;
  if (uSkipSolid > 0.5 && texel.a >= 0.99) discard;
  oitWrite(texel);
}
`;

const WATER_FRAGMENT = /* glsl */ `
${OIT_GLSL}
uniform sampler2D uScene;
uniform float uTime;
varying vec3 vWorld;
void main() {
  if (!oitKeep()) discard;
  vec2 uv = gl_FragCoord.xy / uViewport;
  vec2 ripple = vec2(
    sin(vWorld.x * 2.3 + uTime * 1.1) + sin(vWorld.z * 3.1 - uTime * 0.8),
    cos(vWorld.z * 2.1 + uTime * 0.9) + cos(vWorld.x * 2.9 + uTime * 0.6)
  ) * 0.0012;
  vec3 behind = texture2D(uScene, clamp(uv + ripple, vec2(0.001), vec2(0.999))).rgb;
  vec3 color = mix(behind * vec3(0.55, 0.8, 0.92), vec3(0.05, 0.22, 0.42), 0.3);
  oitWrite(vec4(color, 0.9));
}
`;

const PUFF_FRAGMENT = /* glsl */ `
${OIT_GLSL}
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  if (!oitKeep()) discard;
  float r = length(vUv - 0.5) * 2.0;
  float alpha = uAlpha * smoothstep(1.0, 0.15, r);
  if (alpha < 0.01) discard;
  oitWrite(vec4(uColor, alpha));
}
`;

const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const COMPOSITE_FRAGMENT = /* glsl */ `
uniform sampler2D tAccumulation;
uniform sampler2D tWeight;
void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  vec4 accumulation = texelFetch(tAccumulation, pixel, 0);
  float coverage = 1.0 - accumulation.a;
  if (coverage <= 0.0) discard;
  float weight = texelFetch(tWeight, pixel, 0).r;
  gl_FragColor = vec4(accumulation.rgb / max(weight, 1e-5) * coverage, coverage);
}
`;

const BLIT_FRAGMENT = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tAccumulation;
uniform sampler2D tWeight;
uniform sampler2D tWaterDepth;
uniform vec2 uClip;
uniform float uView;
varying vec2 vUv;
void main() {
  if (uView < 0.5) {
    gl_FragColor = texture2D(tScene, vUv);
  } else if (uView < 1.5) {
    vec4 accumulation = texture2D(tAccumulation, vUv);
    float weight = texture2D(tWeight, vUv).r;
    gl_FragColor = vec4(weight > 0.0 ? accumulation.rgb / weight : vec3(0.0), 1.0);
  } else if (uView < 2.5) {
    gl_FragColor = vec4(vec3(1.0 - texture2D(tAccumulation, vUv).a), 1.0);
  } else {
    float depth = texture2D(tWaterDepth, vUv).r;
    float distance = uClip.x * uClip.y / (uClip.y - depth * (uClip.y - uClip.x));
    gl_FragColor = vec4(vec3(depth >= 1.0 ? 0.0 : 1.0 - distance / 30.0), 1.0);
  }
  #include <colorspace_fragment>
}
`;

function canvasTexture(
  size: number,
  paint: (x: number, y: number) => number[],
) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d") as CanvasRenderingContext2D;
  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++)
      image.data.set(paint(x, y), (y * size + x) * 4);
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

const stainedGlass = () =>
  canvasTexture(32, (x, y) => {
    const lead =
      x < 2 ||
      y < 2 ||
      x > 29 ||
      y > 29 ||
      x === 15 ||
      x === 16 ||
      y === 15 ||
      y === 16 ||
      Math.abs(x - y) < 1;
    if (lead) return [34, 30, 28, 255];
    const pane = (x < 16 ? 0 : 1) + (y < 16 ? 0 : 2);
    return [
      [52, 180, 98, 150],
      [60, 120, 220, 150],
      [230, 170, 40, 150],
      [210, 60, 80, 150],
    ][pane];
  });

const rubyGlass = () =>
  canvasTexture(16, (x, y) =>
    x === 0 || y === 0 || x === 15 || y === 15
      ? [90, 20, 30, 255]
      : [220, 50, 70, 115],
  );

const tiles = (a: number[], b: number[]) =>
  canvasTexture(16, (x, y) => (((x >> 2) + (y >> 2)) % 2 ? a : b));

type Puff = {
  mesh: THREE.Mesh;
  age: number;
  life: number;
  spot: THREE.Vector3;
  drift: THREE.Vector3;
};

export default function LiveDemo() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>("oit");
  const [view, setView] = useState<View>("final");
  const [shuffles, setShuffles] = useState(0);
  const [camera, setCamera] = useState<"above" | "below">("above");
  const state = useRef({ mode, view, shuffles, camera });
  state.current = { mode, view, shuffles, camera };
  const apiRef = useRef<{
    placeCamera: (preset: "above" | "below") => void;
  } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.autoClear = false;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const view = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
    const controls = new OrbitControls(view, renderer.domElement);
    controls.enableDamping = true;
    controls.maxDistance = 30;
    const placeCamera = (preset: "above" | "below") => {
      if (preset === "above") {
        view.position.set(6.5, 4.2, 9.5);
        controls.target.set(0, -0.3, 0);
      } else {
        view.position.set(-3.2, -1.1, 3.4);
        controls.target.set(1.2, 0.4, -1.2);
      }
      controls.update();
    };
    placeCamera(state.current.camera);
    apiRef.current = { placeCamera };

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a5a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(4, 10, 6);
    scene.add(sun);

    const world = (mesh: THREE.Mesh, layer: number) => {
      mesh.layers.set(layer);
      scene.add(mesh);
      return mesh;
    };
    const grass = new THREE.MeshLambertMaterial({
      map: tiles([96, 156, 70, 255], [86, 142, 62, 255]),
    });
    const stone = new THREE.MeshLambertMaterial({
      map: tiles([150, 146, 138, 255], [134, 130, 122, 255]),
    });
    const sand = new THREE.MeshLambertMaterial({
      map: tiles([212, 190, 140, 255], [196, 174, 126, 255]),
    });
    // The ground around the pool, as four strips leaving the pool open.
    for (const [x, z, w, d] of [
      [0, -12.25, 40, 15.5],
      [0, 12.25, 40, 15.5],
      [-12.75, 0, 14.5, 9],
      [12.75, 0, 14.5, 9],
    ]) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, d), grass);
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(x, 0.4, z);
      world(strip, LAYER_WORLD);
    }
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 8), sand);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2;
    world(floor, LAYER_WORLD);
    for (const [x, z, w, d] of [
      [0, -4.25, 10.5, 0.5],
      [0, 4.25, 10.5, 0.5],
      [-5.25, 0, 0.5, 9],
      [5.25, 0, 0.5, 9],
    ]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 2.4, d), stone);
      wall.position.set(x, -0.8, z);
      world(wall, LAYER_WORLD);
    }

    const weightUniforms = {
      uWeight: {
        value: new THREE.Vector4(
          DEFAULT_WEIGHTS.scale,
          DEFAULT_WEIGHTS.nearDistance,
          DEFAULT_WEIGHTS.farDistance,
          0,
        ),
      },
      uWeightRange: {
        value: new THREE.Vector2(DEFAULT_WEIGHTS.min, DEFAULT_WEIGHTS.max),
      },
    };
    const shared = {
      uMode: { value: 1 },
      uPhase: { value: 0 },
      uWaterDepth: { value: null as THREE.Texture | null },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uClip: { value: new THREE.Vector2(view.near, view.far) },
      ...weightUniforms,
    };
    const blended: THREE.ShaderMaterial[] = [];
    const blendedMaterial = (
      fragmentShader: string,
      uniforms: Record<string, THREE.IUniform>,
    ) => {
      const material = new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader,
        uniforms: { ...shared, ...uniforms },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        forceSinglePass: true,
      });
      blended.push(material);
      return material;
    };

    const glassMap = stainedGlass();
    const rubyMap = rubyGlass();
    const pane = new THREE.PlaneGeometry(3, 3.4);
    const column = new THREE.BoxGeometry(0.9, 4, 0.9);
    const addGlass = (
      geometry: THREE.BufferGeometry,
      map: THREE.Texture,
      at: THREE.Vector3,
    ) => {
      const solid = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          map,
          alphaTest: 0.99,
          side: THREE.DoubleSide,
        }),
      );
      solid.position.copy(at);
      world(solid, LAYER_SOLID_TEXELS);
      const translucent = new THREE.Mesh(
        geometry,
        blendedMaterial(GLASS_FRAGMENT, {
          uMap: { value: map },
          uSkipSolid: { value: 1 },
        }),
      );
      translucent.position.copy(at);
      world(translucent, LAYER_TRANSLUCENT_TEXELS);
      const whole = new THREE.Mesh(
        geometry,
        blendedMaterial(GLASS_FRAGMENT, {
          uMap: { value: map },
          uSkipSolid: { value: 0 },
        }),
      );
      whole.position.copy(at);
      world(whole, LAYER_SORTED_GLASS);
      return [translucent, whole];
    };
    const glassMeshes = [
      ...addGlass(pane, glassMap, new THREE.Vector3(0, -0.3, 0.6)),
      ...addGlass(column, rubyMap, new THREE.Vector3(2.7, 0, -1.7)),
    ];

    const capture = new THREE.FramebufferTexture(1, 1);
    capture.colorSpace = THREE.SRGBColorSpace;
    const waterMaterial = blendedMaterial(WATER_FRAGMENT, {
      uScene: { value: capture },
      uTime: { value: 0 },
    });
    const waterGeometry = new THREE.PlaneGeometry(10, 8);
    waterGeometry.rotateX(-Math.PI / 2);
    const water = world(
      new THREE.Mesh(waterGeometry, waterMaterial),
      LAYER_BLENDED,
    );
    water.onBeforeRender = (r) => {
      if (state.current.mode === "sorted") r.copyFramebufferToTexture(capture);
    };

    const waterDepthScene = new THREE.Scene();
    const waterDepthMesh = new THREE.Mesh(
      waterGeometry,
      new THREE.MeshBasicMaterial({
        colorWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    waterDepthScene.add(waterDepthMesh);

    const puffGeometry = new THREE.PlaneGeometry(1, 1);
    const puffs: Puff[] = [];
    const addPuffs = (
      count: number,
      color: number,
      alpha: number,
      spot: THREE.Vector3,
      drift: THREE.Vector3,
      life: number,
    ) => {
      for (let i = 0; i < count; i++) {
        const mesh = world(
          new THREE.Mesh(
            puffGeometry,
            blendedMaterial(PUFF_FRAGMENT, {
              uColor: { value: new THREE.Color(color) },
              uAlpha: { value: alpha },
            }),
          ),
          LAYER_BLENDED,
        );
        puffs.push({ mesh, age: (i / count) * life, life, spot, drift });
      }
    };
    addPuffs(
      18,
      0xd8d4cc,
      0.5,
      new THREE.Vector3(-0.7, 0.45, 2.5),
      new THREE.Vector3(0.1, 0.62, -0.3),
      6,
    );
    addPuffs(
      10,
      0xe6f4ff,
      0.7,
      new THREE.Vector3(-2.4, -1.9, 1.4),
      new THREE.Vector3(0.03, 0.42, 0.05),
      4.5,
    );

    const transparentMeshes = [
      water,
      ...glassMeshes,
      ...puffs.map((p) => p.mesh),
    ];

    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const triangle = new THREE.BufferGeometry();
    triangle.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]),
        3,
      ),
    );
    const composite = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: COMPOSITE_FRAGMENT,
      uniforms: { tAccumulation: { value: null }, tWeight: { value: null } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    const compositeScene = new THREE.Scene();
    const compositeMesh = new THREE.Mesh(triangle, composite);
    compositeMesh.frustumCulled = false;
    compositeScene.add(compositeMesh);
    const blit = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERTEX,
      fragmentShader: BLIT_FRAGMENT,
      uniforms: {
        tScene: { value: null },
        tAccumulation: { value: null },
        tWeight: { value: null },
        tWaterDepth: { value: null },
        uClip: shared.uClip,
        uView: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const blitScene = new THREE.Scene();
    const blitMesh = new THREE.Mesh(triangle, blit);
    blitMesh.frustumCulled = false;
    blitScene.add(blitMesh);

    let sceneTarget: THREE.WebGLRenderTarget | null = null;
    let accumulation: THREE.WebGLRenderTarget | null = null;
    let waterDepth: THREE.WebGLRenderTarget | null = null;
    const release = () => {
      if (accumulation) {
        accumulation.depthTexture = null;
        accumulation.dispose();
      }
      sceneTarget?.dispose();
      waterDepth?.dispose();
    };
    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      view.aspect = width / height;
      view.updateProjectionMatrix();
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      release();
      sceneTarget = new THREE.WebGLRenderTarget(size.x, size.y, {
        depthTexture: new THREE.DepthTexture(size.x, size.y),
      });
      sceneTarget.texture.colorSpace = THREE.SRGBColorSpace;
      accumulation = new THREE.WebGLRenderTarget(size.x, size.y, {
        count: 2,
        type: THREE.HalfFloatType,
        depthTexture: sceneTarget.depthTexture,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
      });
      accumulation.textures[1].format = THREE.RedFormat;
      const depth = new THREE.DepthTexture(size.x, size.y, THREE.FloatType);
      waterDepth = new THREE.WebGLRenderTarget(size.x, size.y, {
        depthTexture: depth,
      });
      capture.image.width = size.x;
      capture.image.height = size.y;
      capture.dispose();
      shared.uViewport.value.set(size.x, size.y);
      shared.uWaterDepth.value = depth;
      composite.uniforms.tAccumulation.value = accumulation.textures[0];
      composite.uniforms.tWeight.value = accumulation.textures[1];
      blit.uniforms.tScene.value = sceneTarget.texture;
      blit.uniforms.tAccumulation.value = accumulation.textures[0];
      blit.uniforms.tWeight.value = accumulation.textures[1];
      blit.uniforms.tWaterDepth.value = depth;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    let appliedMode: Mode | null = null;
    let appliedShuffles = -1;
    const applyMode = (next: Mode) => {
      shared.uMode.value = next === "oit" ? 1 : 0;
      for (const material of blended) {
        if (next === "oit") {
          material.blending = THREE.CustomBlending;
          material.blendSrc = THREE.OneFactor;
          material.blendDst = THREE.OneFactor;
          material.blendSrcAlpha = THREE.ZeroFactor;
          material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
        } else {
          material.blending = THREE.NormalBlending;
        }
      }
      waterMaterial.uniforms.uScene.value = capture;
      appliedMode = next;
    };

    const clearAccumulation = () => {
      renderer.setRenderTarget(accumulation);
      const gl = renderer.getContext() as WebGL2RenderingContext;
      renderer.state.buffers.color.setMask(true);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 1]);
      gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    };
    const drawLayers = (...layers: number[]) => {
      view.layers.disableAll();
      for (const layer of layers) view.layers.enable(layer);
      renderer.render(scene, view);
    };

    const clock = new THREE.Clock();
    let frame = 0;
    let isVisible = true;
    const visibility = new IntersectionObserver(([entry]) => {
      isVisible = entry.isIntersecting;
    });
    visibility.observe(host);

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(clock.getDelta(), 0.05);
      if (!isVisible || !sceneTarget || !accumulation || !waterDepth) return;
      const {
        mode: currentMode,
        view: currentView,
        shuffles: currentShuffles,
      } = state.current;
      if (currentMode !== appliedMode) applyMode(currentMode);
      if (currentShuffles !== appliedShuffles) {
        appliedShuffles = currentShuffles;
        for (const mesh of transparentMeshes) {
          mesh.renderOrder =
            currentShuffles === 0 ? 0 : Math.floor(Math.random() * 1000);
        }
      }
      controls.update();
      waterMaterial.uniforms.uTime.value += dt;
      for (const puff of puffs) {
        puff.age = (puff.age + dt) % puff.life;
        const t = puff.age / puff.life;
        puff.mesh.position
          .copy(puff.spot)
          .addScaledVector(puff.drift, puff.age)
          .add(
            new THREE.Vector3(
              Math.sin(puff.age * 1.3 + puff.life) * 0.15,
              0,
              0,
            ),
          );
        puff.mesh.scale.setScalar(0.35 + t * 1.25);
        puff.mesh.quaternion.copy(view.quaternion);
        const material = puff.mesh.material as THREE.ShaderMaterial;
        material.uniforms.uAlpha.value =
          (puff.drift.y > 0.6 ? 0.5 : 0.7) * Math.min(1, t * 6) * (1 - t);
      }

      renderer.setRenderTarget(sceneTarget);
      renderer.setClearColor(0x9fc4ea, 1);
      renderer.clear(true, true, false);
      if (currentMode === "sorted") {
        shared.uPhase.value = 0;
        drawLayers(LAYER_WORLD, LAYER_BLENDED, LAYER_SORTED_GLASS);
      } else {
        drawLayers(LAYER_WORLD, LAYER_SOLID_TEXELS);
        renderer.setRenderTarget(waterDepth);
        renderer.clear(false, true, false);
        renderer.render(waterDepthScene, view);
        waterMaterial.uniforms.uScene.value = sceneTarget.texture;

        clearAccumulation();
        shared.uPhase.value = 1;
        drawLayers(LAYER_BLENDED, LAYER_TRANSLUCENT_TEXELS);
        renderer.setRenderTarget(sceneTarget);
        renderer.render(compositeScene, ortho);

        clearAccumulation();
        shared.uPhase.value = 2;
        drawLayers(LAYER_BLENDED, LAYER_TRANSLUCENT_TEXELS);
        renderer.setRenderTarget(sceneTarget);
        renderer.render(compositeScene, ortho);
      }

      blit.uniforms.uView.value =
        currentMode === "sorted"
          ? 0
          : { final: 0, accumulation: 1, coverage: 2, water: 3 }[currentView];
      renderer.setRenderTarget(null);
      renderer.clear(true, true, false);
      renderer.render(blitScene, ortho);
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      visibility.disconnect();
      controls.dispose();
      release();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      apiRef.current = null;
    };
  }, []);

  return (
    <div>
      <div className="oit-demo" ref={hostRef}>
        <span className="oit-demo__badge">
          {mode === "oit" ? "order-independent" : "sorted"}
          {shuffles > 0 ? " · shuffled draw order" : ""}
        </span>
      </div>
      <div className="oit-controls">
        <div className="oit-controls__group">
          <span className="oit-controls__label">Blending</span>
          <Choice<Mode>
            value={mode}
            options={[
              { value: "sorted", label: "Sorted" },
              { value: "oit", label: "Order-independent" },
            ]}
            onChange={setMode}
          />
        </div>
        <div className="oit-controls__group">
          <button
            type="button"
            className="oit-button"
            onClick={() => setShuffles(shuffles + 1)}
          >
            Shuffle the draw order
          </button>
          {shuffles > 0 && (
            <button
              type="button"
              className="oit-button"
              onClick={() => setShuffles(0)}
            >
              Reset
            </button>
          )}
        </div>
        <div className="oit-controls__group">
          <span className="oit-controls__label">Camera</span>
          <Choice
            value={camera}
            options={[
              { value: "above", label: "Above the pool" },
              { value: "below", label: "Under the water" },
            ]}
            onChange={(preset) => {
              setCamera(preset);
              apiRef.current?.placeCamera(preset);
            }}
          />
        </div>
        {mode === "oit" && (
          <div className="oit-controls__group">
            <span className="oit-controls__label">Show</span>
            <Choice<View>
              value={view}
              options={[
                { value: "final", label: "Frame" },
                { value: "accumulation", label: "Σ C·α·w ÷ Σ α·w" },
                { value: "coverage", label: "1 − Π(1 − α)" },
                { value: "water", label: "Water depth" },
              ]}
              onChange={setView}
            />
          </div>
        )}
      </div>
    </div>
  );
}
