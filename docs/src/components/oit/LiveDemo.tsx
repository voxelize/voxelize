import { useEffect, useRef, useState } from "react";

import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  cameraFar,
  cameraNear,
  clamp,
  cos,
  Discard,
  float,
  Fn,
  If,
  ivec2,
  length,
  max,
  mix,
  mrt,
  output,
  positionView,
  positionWorld,
  pow,
  screenCoordinate,
  screenUV,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";

import { DEFAULT_WEIGHTS } from "./math";
import { Choice } from "./ui";

/**
 * A small scene drawn two ways. "Sorted" is three's own transparent sort
 * with the water refracting a copy of the frame drawn before it, the way a
 * sorted pipeline does. "Order-independent" is the engine's pass in
 * miniature: depth writers and solid texels, the depth of the water, the
 * blended layers behind it accumulated and composited, then the water and
 * everything in front of it accumulated and composited. The encoder and the
 * composite below are the engine's (order-independent-transparency.ts), in
 * TSL on three's WebGPU renderer.
 */

type Mode = "sorted" | "oit";
type View = "final" | "accumulation" | "coverage" | "water";

const LAYER_WORLD = 0;
const LAYER_SOLID_TEXELS = 1;
const LAYER_BLENDED = 2;
const LAYER_TRANSLUCENT_TEXELS = 3;
const LAYER_SORTED_GLASS = 4;

type FloatNode = THREE.Node<"float">;
type Vec4Node = THREE.Node<"vec4">;

/**
 * Perspective depth (0..1, as stored) back to the distance along the view
 * axis, for a camera with these clip planes (the engine's
 * `perspectiveDepthToViewZ`).
 */
const depthToDistance = (
  depth: FloatNode,
  near: FloatNode = cameraNear,
  far: FloatNode = cameraFar,
) => near.mul(far).div(far.sub(depth.mul(far.sub(near))));

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
  /** The puff's opacity, read by its material. */
  alpha: { value: number };
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
    const renderer = new THREE.WebGPURenderer({ antialias: false });
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
    const lambert = (map: THREE.Texture) =>
      new THREE.MeshLambertNodeMaterial({ map });
    const grass = lambert(tiles([96, 156, 70, 255], [86, 142, 62, 255]));
    const stone = lambert(tiles([150, 146, 138, 255], [134, 130, 122, 255]));
    const sand = lambert(tiles([212, 190, 140, 255], [196, 174, 126, 255]));
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

    // The pass's own inputs, read by the encoder laid over every blended
    // draw while it accumulates.
    const uPhase = uniform(0);
    const uWeight = uniform(
      new THREE.Vector4(
        DEFAULT_WEIGHTS.scale,
        DEFAULT_WEIGHTS.nearDistance,
        DEFAULT_WEIGHTS.farDistance,
        0,
      ),
    );
    const uWeightRange = uniform(
      new THREE.Vector2(DEFAULT_WEIGHTS.min, DEFAULT_WEIGHTS.max),
    );
    const placeholderDepth = new THREE.DepthTexture(1, 1);
    const waterDepthNode = texture(placeholderDepth);

    // The engine's encoder: the material's own colour (three's `output`)
    // becomes the weighted sums, a blend mode per attachment.
    const distance = positionView.z.negate();
    const weightOf = Fn(() =>
      clamp(output.a, 0, 1).mul(
        clamp(
          uWeight.x.div(
            distance
              .div(uWeight.y)
              .add(pow(distance.div(uWeight.z), 6))
              .add(1),
          ),
          uWeightRange.x,
          uWeightRange.y,
        ),
      ),
    );
    const encodedColor = Fn(() => {
      If(uPhase.greaterThan(0.5), () => {
        // Phase 1 keeps what lies behind the nearest water, phase 2 the rest.
        const separator = waterDepthNode.sample(screenUV).x;
        const isBehind = distance.greaterThan(
          depthToDistance(separator).add(0.02),
        );
        Discard(isBehind.xor(uPhase.lessThan(1.5)));
      });
      const alpha = clamp(output.a, 0, 1).toVar();
      Discard(alpha.lessThanEqual(0));
      return vec4(output.rgb.mul(alpha).mul(weightOf()), alpha);
    })();
    const encodedWeight = Fn(() => {
      const w = clamp(output.a, 0, 1).mul(weightOf());
      return vec4(w, w.mul(distance), 0, 0);
    })();
    const encoder = mrt({ output: encodedColor, weight: encodedWeight });
    const sums = new THREE.BlendMode(THREE.CustomBlending);
    sums.blendEquation = THREE.AddEquation;
    sums.blendSrc = THREE.OneFactor;
    sums.blendDst = THREE.OneFactor;
    sums.blendEquationAlpha = THREE.AddEquation;
    sums.blendSrcAlpha = THREE.OneFactor;
    sums.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    encoder.setBlendMode("output", sums);
    const added = new THREE.BlendMode(THREE.CustomBlending);
    added.blendEquation = THREE.AddEquation;
    added.blendSrc = THREE.OneFactor;
    added.blendDst = THREE.OneFactor;
    added.blendEquationAlpha = THREE.AddEquation;
    added.blendSrcAlpha = THREE.OneFactor;
    added.blendDstAlpha = THREE.OneFactor;
    encoder.setBlendMode("weight", added);

    const blendedMaterial = (color: Vec4Node) => {
      const material = new THREE.NodeMaterial();
      material.colorNode = color;
      material.transparent = true;
      material.depthWrite = false;
      material.side = THREE.DoubleSide;
      material.forceSinglePass = true;
      return material;
    };
    const glassColor = (map: THREE.Texture, skipSolid: boolean) =>
      Fn(() => {
        const texel = texture(map, uv()).toVar();
        Discard(texel.a.lessThan(0.1));
        if (skipSolid) Discard(texel.a.greaterThanEqual(0.99));
        return texel;
      })() as unknown as Vec4Node;

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
        new THREE.MeshBasicNodeMaterial({
          map,
          alphaTest: 0.99,
          side: THREE.DoubleSide,
        }),
      );
      solid.position.copy(at);
      world(solid, LAYER_SOLID_TEXELS);
      const translucent = new THREE.Mesh(
        geometry,
        blendedMaterial(glassColor(map, true)),
      );
      translucent.position.copy(at);
      world(translucent, LAYER_TRANSLUCENT_TEXELS);
      const whole = new THREE.Mesh(
        geometry,
        blendedMaterial(glassColor(map, false)),
      );
      whole.position.copy(at);
      world(whole, LAYER_SORTED_GLASS);
      return [translucent, whole];
    };
    const glassMeshes = [
      ...addGlass(pane, glassMap, new THREE.Vector3(0, -0.3, 0.6)),
      ...addGlass(column, rubyMap, new THREE.Vector3(2.7, 0, -1.7)),
    ];

    // Sorted, the water refracts a copy of the frame drawn before it; order
    // independent, it reads the scene target itself.
    const capture = new THREE.FramebufferTexture(1, 1);
    capture.colorSpace = THREE.SRGBColorSpace;
    const sceneColorNode = texture(capture);
    const uTime = uniform(0);
    const waterColor = Fn(() => {
      const ripple = vec2(
        sin(positionWorld.x.mul(2.3).add(uTime.mul(1.1))).add(
          sin(positionWorld.z.mul(3.1).sub(uTime.mul(0.8))),
        ),
        cos(positionWorld.z.mul(2.1).add(uTime.mul(0.9))).add(
          cos(positionWorld.x.mul(2.9).add(uTime.mul(0.6))),
        ),
      ).mul(0.0012);
      const behind = sceneColorNode
        .sample(clamp(screenUV.add(ripple), vec2(0.001), vec2(0.999)))
        .rgb;
      return vec4(
        mix(behind.mul(vec3(0.55, 0.8, 0.92)), vec3(0.05, 0.22, 0.42), 0.3),
        0.9,
      );
    })();
    const waterGeometry = new THREE.PlaneGeometry(10, 8);
    waterGeometry.rotateX(-Math.PI / 2);
    const water = world(
      new THREE.Mesh(waterGeometry, blendedMaterial(waterColor)),
      LAYER_BLENDED,
    );
    water.onBeforeRender = (r) => {
      if (state.current.mode === "sorted") {
        (r as unknown as THREE.WebGPURenderer).copyFramebufferToTexture(capture);
      }
    };

    const waterDepthScene = new THREE.Scene();
    const waterDepthMaterial = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
    });
    waterDepthMaterial.colorWrite = false;
    waterDepthScene.add(new THREE.Mesh(waterGeometry, waterDepthMaterial));

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
        const uAlpha = uniform(alpha);
        const puffColor = Fn(() => {
          const r = length(uv().sub(0.5)).mul(2);
          const a = uAlpha.mul(smoothstep(1, 0.15, r)).toVar();
          Discard(a.lessThan(0.01));
          return vec4(uniform(new THREE.Color(color)), a);
        })();
        const mesh = world(
          new THREE.Mesh(puffGeometry, blendedMaterial(puffColor)),
          LAYER_BLENDED,
        );
        puffs.push({
          mesh,
          alpha: uAlpha,
          age: (i / count) * life,
          life,
          spot,
          drift,
        });
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

    // The engine's composite, over the scene.
    const accumulationNode = texture(placeholderDepth);
    const weightNode = texture(placeholderDepth);
    const composite = new THREE.NodeMaterial();
    composite.fragmentNode = Fn(() => {
      const pixel = ivec2(screenCoordinate.xy);
      const accumulated = accumulationNode.load(pixel);
      const coverage = clamp(accumulated.a, 0, 1).toVar();
      Discard(coverage.lessThanEqual(0));
      const total = weightNode.load(pixel).x;
      return vec4(
        accumulated.rgb.div(max(total, 1e-5)).mul(coverage),
        coverage,
      );
    })();
    composite.transparent = true;
    composite.depthTest = false;
    composite.depthWrite = false;
    composite.blending = THREE.CustomBlending;
    composite.blendSrc = THREE.OneFactor;
    composite.blendDst = THREE.OneMinusSrcAlphaFactor;
    composite.blendSrcAlpha = THREE.OneFactor;
    composite.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    const compositeQuad = new THREE.QuadMesh(composite);

    // What the canvas shows: the frame, or one of the pass's inputs. The
    // quad draws with a camera of its own, so the scene camera's clip planes
    // come in as a uniform.
    const uView = uniform(0);
    const uClip = uniform(new THREE.Vector2(view.near, view.far));
    const blitSceneNode = texture(capture);
    const blitAccumulationNode = texture(placeholderDepth);
    const blitWeightNode = texture(placeholderDepth);
    const blitWaterNode = texture(placeholderDepth);
    const blit = new THREE.NodeMaterial();
    blit.fragmentNode = Fn(() => {
      const shown = vec4(blitSceneNode.sample(screenUV)).toVar();
      If(uView.greaterThan(0.5).and(uView.lessThan(1.5)), () => {
        const sums = blitAccumulationNode.sample(screenUV);
        const total = blitWeightNode.sample(screenUV).x;
        shown.assign(
          vec4(total.greaterThan(0).select(sums.rgb.div(total), vec3(0)), 1),
        );
      })
        .ElseIf(uView.greaterThan(1.5).and(uView.lessThan(2.5)), () => {
          shown.assign(vec4(vec3(blitAccumulationNode.sample(screenUV).a), 1));
        })
        .ElseIf(uView.greaterThan(2.5), () => {
          const depth = blitWaterNode.sample(screenUV).x;
          const shade = depth
            .greaterThanEqual(1)
            .select(
              float(0),
              float(1).sub(depthToDistance(depth, uClip.x, uClip.y).div(30)),
            );
          shown.assign(vec4(vec3(shade), 1));
        });
      return shown;
    })();
    blit.depthTest = false;
    blit.depthWrite = false;
    const blitQuad = new THREE.QuadMesh(blit);

    let sceneTarget: THREE.RenderTarget | null = null;
    let accumulation: THREE.RenderTarget | null = null;
    let waterDepth: THREE.RenderTarget | null = null;
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
      sceneTarget = new THREE.RenderTarget(size.x, size.y, {
        depthTexture: new THREE.DepthTexture(size.x, size.y),
      });
      sceneTarget.texture.colorSpace = THREE.SRGBColorSpace;
      // Two attachments sharing the scene's depth: the blended layers are
      // tested against the terrain and the cutouts without a copy.
      accumulation = new THREE.RenderTarget(size.x, size.y, {
        count: 2,
        type: THREE.HalfFloatType,
        depthTexture: sceneTarget.depthTexture,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
      });
      accumulation.textures[0].name = "output";
      accumulation.textures[1].name = "weight";
      const depth = new THREE.DepthTexture(size.x, size.y, THREE.FloatType);
      waterDepth = new THREE.RenderTarget(size.x, size.y, {
        depthTexture: depth,
      });
      capture.image.width = size.x;
      capture.image.height = size.y;
      capture.needsUpdate = true;
      waterDepthNode.value = depth;
      accumulationNode.value = accumulation.textures[0];
      weightNode.value = accumulation.textures[1];
      blitSceneNode.value = sceneTarget.texture;
      blitAccumulationNode.value = accumulation.textures[0];
      blitWeightNode.value = accumulation.textures[1];
      blitWaterNode.value = depth;
    };

    const drawLayers = (...layers: number[]) => {
      view.layers.disableAll();
      for (const layer of layers) view.layers.enable(layer);
      renderer.render(scene, view);
    };
    // One phase of the blended band into the cleared accumulation, under the
    // encoder, then composited into the scene.
    const accumulate = (phase: number) => {
      if (!sceneTarget || !accumulation) return;
      uPhase.value = phase;
      renderer.setRenderTarget(accumulation);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
      renderer.setMRT(encoder);
      drawLayers(LAYER_BLENDED, LAYER_TRANSLUCENT_TEXELS);
      renderer.setMRT(null);
      uPhase.value = 0;
      renderer.setRenderTarget(sceneTarget);
      compositeQuad.render(renderer);
    };

    const timer = new THREE.Timer();
    let frame = 0;
    let isVisible = true;
    let isDisposed = false;
    const visibility = new IntersectionObserver(([entry]) => {
      isVisible = entry.isIntersecting;
    });
    visibility.observe(host);
    let observer: ResizeObserver | null = null;
    let appliedShuffles = -1;

    const tick = () => {
      frame = requestAnimationFrame(tick);
      timer.update();
      const dt = Math.min(timer.getDelta(), 0.05);
      if (!isVisible || !sceneTarget || !accumulation || !waterDepth) return;
      const {
        mode: currentMode,
        view: currentView,
        shuffles: currentShuffles,
      } = state.current;
      if (currentShuffles !== appliedShuffles) {
        appliedShuffles = currentShuffles;
        for (const mesh of transparentMeshes) {
          mesh.renderOrder =
            currentShuffles === 0 ? 0 : Math.floor(Math.random() * 1000);
        }
      }
      controls.update();
      uTime.value += dt;
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
        puff.alpha.value =
          (puff.drift.y > 0.6 ? 0.5 : 0.7) * Math.min(1, t * 6) * (1 - t);
      }

      renderer.setRenderTarget(sceneTarget);
      renderer.setClearColor(0x9fc4ea, 1);
      renderer.clear(true, true, false);
      if (currentMode === "sorted") {
        sceneColorNode.value = capture;
        drawLayers(LAYER_WORLD, LAYER_BLENDED, LAYER_SORTED_GLASS);
      } else {
        drawLayers(LAYER_WORLD, LAYER_SOLID_TEXELS);
        renderer.setRenderTarget(waterDepth);
        renderer.clear(false, true, false);
        renderer.render(waterDepthScene, view);
        // The water refracts the scene target itself: first what lies
        // behind it composited, then it draws with what stands in front.
        sceneColorNode.value = sceneTarget.texture;
        accumulate(1);
        accumulate(2);
      }

      uView.value =
        currentMode === "sorted"
          ? 0
          : { final: 0, accumulation: 1, coverage: 2, water: 3 }[currentView];
      renderer.setRenderTarget(null);
      renderer.clear(true, true, false);
      blitQuad.render(renderer);
    };

    // Nothing draws until the GPU device is up.
    void renderer.init().then(() => {
      if (isDisposed) return;
      resize();
      observer = new ResizeObserver(resize);
      observer.observe(host);
      tick();
    });

    return () => {
      isDisposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      visibility.disconnect();
      controls.dispose();
      release();
      renderer.dispose();
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
