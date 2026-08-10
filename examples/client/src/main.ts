import "./style.css";

import * as VOXELIZE from "@voxelize/core";
import { GUI } from "lil-gui";
import {
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
} from "postprocessing";
import * as THREE from "three";

import "@voxelize/core/styles.css"; //? For official use, you should do `@voxelize/core/styles.css` instead.

import LolImage from "./assets/lol.png";
import {
  BOT_HEAD_COLOR,
  BOT_HEAD_FRONT_COLOR,
  BOT_SCALE,
} from "./config/constants";
import { Map } from "./map";
import { setupWorld } from "./world";

VOXELIZE.configurePerfLogging(
  new URLSearchParams(window.location.search).has("perf"),
);

const canvas = document.getElementById("main") as HTMLCanvasElement;

/* -------------------------------------------------------------------------- */
/*                               VOXELIZE WORLD                               */
/* -------------------------------------------------------------------------- */
const world = new VOXELIZE.World({
  textureUnitDimension: 8,
  // Sized for the local-lights benchmark scenes (10k registered emitters).
  localLights: { maxRegisteredLights: 12288 },
});
// actual world setup code handled later after network and world are initialized

/* -------------------------------------------------------------------------- */
/*                         THREE-JS UTILITIES/CLASSES                         */
/* -------------------------------------------------------------------------- */
const camera = new THREE.PerspectiveCamera(
  90,
  window.innerWidth / window.innerHeight,
  0.1,
  5000,
);
camera.layers.enable(VOXELIZE.SCENE_OVERLAY_LAYER);

const renderer = new THREE.WebGLRenderer({
  canvas,
});
renderer.setSize(
  renderer.domElement.offsetWidth,
  renderer.domElement.offsetHeight,
);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

// Local light GPU state is rebuilt from CPU pools on a restored context.
canvas.addEventListener("webglcontextlost", (event) => event.preventDefault());
canvas.addEventListener("webglcontextrestored", () => {
  world.localLights.onContextRestored();
});

// resize window event listener found inside start() function

/* -------------------------------------------------------------------------- */
/*                             VISUAL IMPROVEMENTS                            */
/* -------------------------------------------------------------------------- */
const lightShined = new VOXELIZE.LightShined(world);

world.sky.setShadingPhases([
  // start of sunrise
  {
    name: "sunrise",
    color: {
      top: "#7694CF",
      middle: "#B0483A",
      bottom: "#222",
    },
    skyOffset: 0.05,
    voidOffset: 0.6,
    start: 0.2,
  },
  // end of sunrise
  {
    name: "daylight",
    color: {
      top: "#73A3FB",
      middle: "#B1CCFD",
      bottom: "#222",
    },
    skyOffset: 0,
    voidOffset: 0.6,
    start: 0.25,
  },
  // start of sunset
  {
    name: "sunset",
    color: {
      top: "#A57A59",
      middle: "#FC5935",
      bottom: "#222",
    },
    skyOffset: 0.05,
    voidOffset: 0.6,
    start: 0.7,
  },
  // end of sunset
  {
    name: "night",
    color: {
      top: "#000",
      middle: "#000",
      bottom: "#000",
    },
    skyOffset: 0.1,
    voidOffset: 0.6,
    start: 0.75,
  },
]);

world.sky.paint("bottom", VOXELIZE.artFunctions.drawSun());
world.sky.paint("top", VOXELIZE.artFunctions.drawStars());
world.sky.paint("top", VOXELIZE.artFunctions.drawMoon());
world.sky.paint("sides", VOXELIZE.artFunctions.drawStars());

// const sky = new VOXELIZE.Sky(2000);
// sky.paint("top", VOXELIZE.artFunctions.drawSun);
// world.add(sky);

// const clouds = new VOXELIZE.Clouds({
//   uFogColor: sky.uMiddleColor,
// });

// world.add(clouds);
// world.setFogColor(sky.getMiddleColor());

/* -------------------------------------------------------------------------- */
/*                               PLAYER CONTROLS                              */
/* -------------------------------------------------------------------------- */
const inputs = new VOXELIZE.Inputs<"menu" | "in-game" | "chat">();

// To run around the world
const controls = new VOXELIZE.RigidControls(
  camera,
  renderer.domElement,
  world,
  {
    initialPosition: [0, 82, 0],
    flyForce: 400,
    // stepHeight: 1,
  },
);

controls.connect(inputs, "in-game");

inputs.bind(
  "KeyG",
  () => {
    controls.toggleGhostMode();
  },
  "in-game",
);
inputs.bind("KeyF", controls.toggleFly, "in-game");

// To add/remove blocks
const voxelInteract = new VOXELIZE.VoxelInteract(controls.object, world, {
  highlightType: "outline",
  highlightColor: new THREE.Color("#000"),
  highlightOpacity: 0.5,
  inverseDirection: true,
  // potentialVisuals: true,
});
world.add(voxelInteract);

let radius = 1;
const maxRadius = 10;
const minRadius = 1;
const circular = true;

inputs.scroll(
  () => (radius = Math.min(maxRadius, radius + 1)),
  () => (radius = Math.max(minRadius, radius - 1)),
  "in-game",
);

const bulkDestroy = () => {
  if (!voxelInteract.target) return;

  const [vx, vy, vz] = voxelInteract.target;

  const updates: VOXELIZE.BlockUpdate[] = [];

  for (let x = -radius; x <= radius; x++) {
    for (let y = -radius; y <= radius; y++) {
      for (let z = -radius; z <= radius; z++) {
        if (circular && x ** 2 + y ** 2 + z ** 2 > radius ** 2 - 1) continue;

        updates.push({
          vx: vx + x,
          vy: vy + y,
          vz: vz + z,
          type: 0,
        });
      }
    }
  }

  if (updates.length) controls.world.updateVoxels(updates);
};
inputs.click("left", bulkDestroy, "in-game");

// unsure where holdingBlockType equivilent is located

const HOTBAR_CONTENT = [0, 1, 5, 20, 50000, 13131, 45, 300, 1000, 500];
const bar = new VOXELIZE.ItemSlots({
  verticalCount: 1,
  horizontalCount: HOTBAR_CONTENT.length,
  wrapperStyles: {
    left: "50%",
    transform: "translateX(-50%)",
  },
  scrollable: false,
});

document.body.appendChild(bar.element);

inputs.click(
  "middle",
  () => {
    if (!voxelInteract.target) return;
    const [vx, vy, vz] = voxelInteract.target;
    const block = controls.world.getBlockAt(vx, vy, vz);
    const slot = bar.getFocused();
    slot.setObject(world.makeBlockMesh(block.id, { material: "standard" }));
    slot.setContent(block.id);
  },
  "in-game",
);

const bulkPlace = () => {
  if (!voxelInteract.potential) return;

  const {
    voxel: [vx, vy, vz],
    rotation,
    yRotation,
    yRotation4,
    yRotation8,
  } = voxelInteract.potential;

  const updates: VOXELIZE.BlockUpdate[] = [];
  const block = world.getBlockById(bar.getFocused().content);

  for (let x = -radius; x <= radius; x++) {
    for (let y = -radius; y <= radius; y++) {
      for (let z = -radius; z <= radius; z++) {
        if (circular && x ** 2 + y ** 2 + z ** 2 > radius ** 2 - 1) continue;

        updates.push({
          vx: vx + x,
          vy: vy + y,
          vz: vz + z,
          type: block.id,
          rotation: block.rotatable ? rotation : 0,
          yRotation:
            block.yRotatableSegments === "All"
              ? yRotation
              : block.yRotatableSegments === "Eight"
                ? yRotation8
                : yRotation4,
        });
      }
    }
  }

  if (updates.length) controls.world.updateVoxels(updates);
};

inputs.click(
  "right",
  () => {
    if (!voxelInteract.potential) return;
    const {
      voxel: [vx, vy, vz],
    } = voxelInteract.potential;
    if (!voxelInteract.target) return;
    const currentBlock = world.getBlockAt(...voxelInteract.target);
    const slot = bar.getFocused();
    const id = slot.content;
    if (!id) return;

    const block = world.getBlockById(id);
    if (!block.isPassable) {
      const aabbs = world.getBlockAABBsByIdAt(id, vx, vy, vz);
      if (
        aabbs.find((aabb) =>
          aabb.clone().translate([vx, vy, vz]).intersects(controls.body.aabb),
        )
      )
        return;
    }

    if (currentBlock.isEntity) {
      const [tx, ty, tz] = voxelInteract.target;
      world.setBlockEntityDataAt(tx, ty, tz, {
        color: [Math.random(), Math.random(), Math.random()],
      });
      return;
    }

    bulkPlace();
  },
  "in-game",
);

// Add a character to the control
world.loader.loadTexture(LolImage, (texture) => {
  character.head.paint("front", texture);
});
const createCharacter = () => {
  const character = new VOXELIZE.Character();
  // Light neutral panels: the LightShined tint (and with it every colored
  // local light) reads on the body from any angle, instead of drowning in
  // the default dark navy/brown palette.
  character.head.paint("all", new THREE.Color("#E7E1D5"));
  character.body.paint("all", new THREE.Color("#DDD5C6"));
  character.leftArm.paint("all", new THREE.Color("#D3CCBD"));
  character.rightArm.paint("all", new THREE.Color("#D3CCBD"));
  character.leftLeg.paint("all", new THREE.Color("#C9C2B3"));
  character.rightLeg.paint("all", new THREE.Color("#C9C2B3"));
  world.add(character);
  lightShined.add(character);

  world.loader.load().then(() => {
    character.head.paint("front", world.loader.getTexture(LolImage));
  });

  return character;
};

const character = createCharacter();
controls.attachCharacter(character);

// To change the perspective of the player
const perspective = new VOXELIZE.Perspective(controls, world);
perspective.connect(inputs, "in-game");

inputs.bind(
  "KeyT",
  () => {
    controls.unlock(() => {
      inputs.setNamespace("chat");
    });
  },
  "in-game",
);

inputs.bind(
  "Escape",
  () => {
    controls.lock();
  },
  "chat",
  {
    // Need this so that ESC doesn't unlock the pointerlock.
    occasion: "keyup",
  },
);

inputs.bind(
  "Enter",
  () => {
    controls.lock();
  },
  "chat",
);

inputs.bind("KeyP", () => {
  voxelInteract.toggle();
});

inputs.bind("KeyV", () => {
  method.call("time", {
    time: world.options.timePerDay / 2,
  });
});

/* -------------------------------------------------------------------------- */
/*                          LOCAL LIGHTS DEMO / BENCH                         */
/* -------------------------------------------------------------------------- */

// Analytic profiles for the demo's authored light blocks. The torch declares
// no offset: its anchor derives from the emissive tip face, so shadow
// projection and light bounds originate at the flame, not the block center —
// and lean with the stick when the block is rotated.
// analyticShare leans these hero lights toward the per-pixel (shadowable)
// layer: the flood base still carries the broad glow, but occlusion reads
// as real darkness instead of a slight dip.
world.localLights.setBlockProfile("Torch", {
  colorTemperatureK: 1900,
  intensity: 1.1,
  range: 13,
  analyticShare: 0.85,
  shadowPolicy: "shadowMap",
  flicker: { speed: 6, amplitude: 0.08 },
});
world.localLights.setBlockProfile("Ember Lamp", {
  color: [1, 0.35, 0.15],
  intensity: 1.5,
  range: 14,
  analyticShare: 0.85,
  shadowPolicy: "shadowMap",
});
world.localLights.setBlockProfile("Azure Lamp", {
  color: [0.3, 0.55, 1],
  intensity: 1.5,
  range: 14,
  analyticShare: 0.85,
  shadowPolicy: "shadowMap",
});

// KeyH cycles the shader debug views (off, cell occupancy, isolated
// contribution, leak mask, shadow slots, shadow visibility, flood-ownership
// remainder); KeyY cycles quality tiers; KeyX toggles the selected-light
// bounds overlay; KeyC orbits a dynamic light around you.
inputs.bind("KeyH", () => {
  const next = ((world.localLights.getDebugMode() + 1) % 7) as
    | 0
    | 1
    | 2
    | 3
    | 4
    | 5
    | 6;
  world.localLights.setDebugMode(next);
  console.log(`[demo] local light debug mode: ${next}`);
});

const LIGHT_TIERS: VOXELIZE.LightQualityTier[] = [
  "ultra",
  "high",
  "medium",
  "low",
  "potato",
  "off",
];
inputs.bind("KeyY", () => {
  const current = LIGHT_TIERS.indexOf(world.localLights.getQualityTier());
  const next = LIGHT_TIERS[(current + 1) % LIGHT_TIERS.length];
  world.localLights.setQualityTier(next);
  console.log(`[demo] local light quality tier: ${next}`);
});

let isLightOverlayShown = false;
inputs.bind("KeyX", () => {
  isLightOverlayShown = !isLightOverlayShown;
  if (isLightOverlayShown) {
    world.localLights.showDebugOverlay(world);
  } else {
    world.localLights.hideDebugOverlay();
  }
});

let orbitLightHandle = VOXELIZE.INVALID_LIGHT_HANDLE;
const orbitLightPosition = new THREE.Vector3();
const updateOrbitLight = () => {
  if (orbitLightHandle === VOXELIZE.INVALID_LIGHT_HANDLE) return;
  const t = performance.now() * 0.0012;
  orbitLightPosition.set(
    controls.object.position.x + Math.cos(t) * 6,
    controls.object.position.y + 1,
    controls.object.position.z + Math.sin(t) * 6,
  );
  world.localLights.setPosition(orbitLightHandle, orbitLightPosition);
};
const toggleOrbitLight = () => {
  if (orbitLightHandle === VOXELIZE.INVALID_LIGHT_HANDLE) {
    orbitLightHandle = world.localLights.add(
      {
        shape: "point",
        colorTemperatureK: 1900,
        intensity: 1.2,
        range: 14,
        isStatic: false,
        shadowPolicy: "none",
        priorityBias: 2,
        flicker: { speed: 9, amplitude: 0.1 },
      },
      controls.object.position,
    );
  } else {
    world.localLights.remove(orbitLightHandle);
    orbitLightHandle = VOXELIZE.INVALID_LIGHT_HANDLE;
  }
};
inputs.bind("KeyC", toggleOrbitLight);

// A held hero light: follows the player and requests a shadow slot, so
// walking past a pillar swings a real moving shadow around it (KeyR).
let heldLightHandle = VOXELIZE.INVALID_LIGHT_HANDLE;
const heldLightPosition = new THREE.Vector3();
const updateHeldLight = () => {
  if (heldLightHandle === VOXELIZE.INVALID_LIGHT_HANDLE) return;
  heldLightPosition.copy(controls.object.position);
  heldLightPosition.y += 0.4;
  world.localLights.setPosition(heldLightHandle, heldLightPosition);
};
const toggleHeldLight = () => {
  if (heldLightHandle === VOXELIZE.INVALID_LIGHT_HANDLE) {
    heldLightHandle = world.localLights.add(
      {
        shape: "point",
        colorTemperatureK: 1900,
        intensity: 1.2,
        range: 14,
        isStatic: false,
        shadowPolicy: "shadowMap",
        priorityBias: 2,
        flicker: { speed: 9, amplitude: 0.08 },
      },
      controls.object.position,
    );
  } else {
    world.localLights.remove(heldLightHandle);
    heldLightHandle = VOXELIZE.INVALID_LIGHT_HANDLE;
  }
};
inputs.bind("KeyR", toggleHeldLight);

/* -------------------------------------------------------------------------- */
/*                       LOCAL SHADOW DEMO SCENE / CASTERS                    */
/* -------------------------------------------------------------------------- */

// Local light shadows and CSM want the demo's dynamic casters each frame:
// the player's own character plus every entity that exposes a caster object
// (pigs and bots below). Scratch array, rebuilt in place.
const shadowCasters: THREE.Object3D[] = [];
const collectShadowCasters = () => {
  shadowCasters.length = 0;
  if (character.visible) shadowCasters.push(character);
  entities.map.forEach((entity) => {
    const caster = (entity as { shadowCaster?: THREE.Object3D }).shadowCaster;
    if (caster) shadowCasters.push(caster);
  });
  return shadowCasters;
};

// `?shadows=off` keeps the exact Engine-PR-A frame (no CSM, no atlas) for
// apples-to-apples benchmark comparisons.
const SHADOWS_ENABLED =
  new URLSearchParams(window.location.search).get("shadows") !== "off";

// Generic proof stage built from demo primitives: marble floor + back wall,
// warm and cool lamp poles, an upright torch, a rotated wall torch, and a
// pillar standing between the warm lamp and the wall.
const buildShadowStage = (ox: number, oy: number, oz: number) => {
  const idOf = (name: string) => world.getBlockByName(name)?.id ?? 0;
  const marble = idOf("Marble");
  const ember = idOf("Ember Lamp");
  const azure = idOf("Azure Lamp");
  const torch = idOf("Torch");
  const pole = idOf("Oak Pole");
  const updates: VOXELIZE.BlockUpdate[] = [];

  for (let x = -13; x <= 13; x++) {
    for (let z = -13; z <= 13; z++) {
      updates.push({ vx: ox + x, vy: oy - 1, vz: oz + z, type: marble });
    }
  }
  for (let x = -9; x <= 9; x++) {
    for (let y = 0; y < 5; y++) {
      updates.push({ vx: ox + x, vy: oy + y, vz: oz + 7, type: marble });
    }
  }
  // Street-lamp shape: the support column stands *beside* the lamp head so
  // the pool under the lamp stays open (the column still casts its own
  // honest sliver of shadow to the side).
  updates.push({ vx: ox - 1, vy: oy, vz: oz, type: pole });
  updates.push({ vx: ox - 1, vy: oy + 1, vz: oz, type: pole });
  updates.push({ vx: ox - 1, vy: oy + 2, vz: oz, type: pole });
  updates.push({ vx: ox, vy: oy + 2, vz: oz, type: ember });
  // Cool lamp on its own side column to the south-west.
  updates.push({ vx: ox - 9, vy: oy, vz: oz - 4, type: pole });
  updates.push({ vx: ox - 9, vy: oy + 1, vz: oz - 4, type: pole });
  updates.push({ vx: ox - 9, vy: oy + 2, vz: oz - 4, type: pole });
  updates.push({ vx: ox - 8, vy: oy + 2, vz: oz - 4, type: azure });
  // Upright torch on the floor; wall torch rotated out of the back wall.
  updates.push({ vx: ox + 4, vy: oy, vz: oz + 4, type: torch });
  updates.push({
    vx: ox - 4,
    vy: oy + 2,
    vz: oz + 6,
    type: torch,
    rotation: VOXELIZE.NZ_ROTATION,
  });
  // Static pillar between the warm lamp and the back wall.
  for (let y = 0; y < 3; y++) {
    updates.push({ vx: ox + 2, vy: oy + y, vz: oz + 3, type: marble });
  }
  world.updateVoxels(updates);
};

const clearShadowStage = (ox: number, oy: number, oz: number) => {
  // The stage floor replaced the plain's own surface layer; restore stone
  // there instead of leaving a crater that changes nearby chunk geometry.
  const stone = world.getBlockByName("Stone")?.id ?? 0;
  const updates: VOXELIZE.BlockUpdate[] = [];
  for (let x = -14; x <= 14; x++) {
    for (let z = -14; z <= 14; z++) {
      updates.push({ vx: ox + x, vy: oy - 1, vz: oz + z, type: stone });
      for (let y = 0; y <= 7; y++) {
        updates.push({ vx: ox + x, vy: oy + y, vz: oz + z, type: 0 });
      }
    }
  }
  world.updateVoxels(updates);
};

// World-space debug quad showing the live shadow atlas depth (brightened,
// with slot grid lines) — the "what is the atlas actually holding" view.
let atlasViewerMesh: THREE.Mesh | null = null;
const toggleAtlasViewer = (x: number, y: number, z: number, size: number) => {
  if (atlasViewerMesh) {
    world.remove(atlasViewerMesh);
    atlasViewerMesh.geometry.dispose();
    (atlasViewerMesh.material as THREE.Material).dispose();
    atlasViewerMesh = null;
    return;
  }
  const bindings = world.localLights.uniformBindings;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uAtlas: bindings.uLocalShadowAtlas,
      uParams: bindings.uLocalShadowParams,
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uAtlas;
      uniform vec4 uParams;
      varying vec2 vUv;
      void main() {
        float d = texture2D(uAtlas, vUv).r;
        // Perspective depth clusters near 1; stretch the useful range.
        float shade = pow(clamp(1.0 - d, 0.0, 1.0), 0.30);
        vec2 cell = fract(vUv * uParams.x / uParams.y);
        float line = step(cell.x, 0.02) + step(cell.y, 0.02);
        vec3 color = mix(vec3(shade), vec3(1.0, 0.55, 0.1), clamp(line, 0.0, 1.0) * 0.6);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });
  material.userData.skipShadow = true;
  atlasViewerMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    material,
  );
  atlasViewerMesh.position.set(x, y, z);
  world.add(atlasViewerMesh);
};

// Headless benchmark hooks: deterministic scenes, stats sampling, tier and
// debug switching, scripted context loss. Driven by scripts/bench-local-lights.mjs.
const frameSamples = new Float64Array(600);
let frameSampleCount = 0;
let frameSampleCursor = 0;
let lastFrameAt = 0;
const recordFrame = (now: number) => {
  if (lastFrameAt > 0) {
    frameSamples[frameSampleCursor] = now - lastFrameAt;
    frameSampleCursor = (frameSampleCursor + 1) % frameSamples.length;
    if (frameSampleCount < frameSamples.length) frameSampleCount++;
  }
  lastFrameAt = now;
};
const frameStats = () => {
  const sorted = [...frameSamples.slice(0, frameSampleCount)].sort(
    (a, b) => a - b,
  );
  const at = (q: number) =>
    sorted.length === 0 ? 0 : sorted[Math.floor(q * (sorted.length - 1))];
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), samples: sorted.length };
};

(window as Window & { __bench__?: object }).__bench__ = {
  runScene: (scene: string, block: string, origin: number[], count: number) =>
    method.call("bench-lights", { scene, block, origin, count }),
  stats: () => ({
    frame: frameStats(),
    localLights: { ...world.localLights.stats },
    render: { ...renderer.info.render },
    programs: renderer.info.programs?.length ?? 0,
    memory:
      (performance as Performance & { memory?: { usedJSHeapSize: number } })
        .memory?.usedJSHeapSize ?? 0,
  }),
  resetFrameStats: () => {
    frameSampleCount = 0;
    frameSampleCursor = 0;
    lastFrameAt = 0;
    world.localLights.resetPeakStats();
  },
  setTier: (tier: VOXELIZE.LightQualityTier) =>
    world.localLights.setQualityTier(tier),
  setDebugMode: (mode: 0 | 1 | 2 | 3 | 4 | 5 | 6) =>
    world.localLights.setDebugMode(mode),
  // DEBUG-ONLY ownership override for QA A/B captures: pokes the raw
  // uniform to render the pre-ownership additive composition (0) against
  // the shipped exclusive-ownership behavior (1). Deliberately not part of
  // the engine's configuration surface — hybrid visible stacking is not a
  // supported state, and any tier change resets this to the invariant.
  setOwnership: (value: number) => {
    world.localLights.grid.uniforms.ownership.value = Math.min(
      Math.max(value, 0),
      1,
    );
  },
  // Deterministic renderer diff harness (scripts/render-off-parity.mjs):
  // renders the loaded scene twice in ONE synchronous turn — once with the
  // shipped chunk programs, once with true "local lights never existed"
  // programs compiled via stripLocalLightsFromFragment — through the same
  // renderer, camera, and shared uniform objects, then compares every byte
  // of the full RGBA readbacks (alpha included). Every pixel input is
  // frozen by construction: nothing (world update, animation, particles,
  // clocks) runs between the two renders, the uniforms are the same live
  // objects for both programs, and uTime is pinned for reproducibility of
  // the captures. At the off tier the outputs must be byte-identical.
  renderOffParityDiff: () => {
    const size = 512;
    world.chunkRenderer.uniforms.time.value = 123456;
    const chunkMaterials = [
      ...new Set(world.chunkRenderer.materials.values()),
    ] as THREE.ShaderMaterial[];
    // globalThis: the demo shadows Map with its minimap component import.
    const legacyOf = new globalThis.Map<THREE.Material, THREE.ShaderMaterial>();
    for (const material of chunkMaterials) {
      const legacy = new THREE.ShaderMaterial({
        vertexShader: material.vertexShader,
        fragmentShader: VOXELIZE.stripLocalLightsFromFragment(
          material.fragmentShader,
        ),
        uniforms: material.uniforms, // shared: identical inputs, both passes
        vertexColors: material.vertexColors,
        transparent: material.transparent,
        side: material.side,
        depthWrite: material.depthWrite,
        depthTest: material.depthTest,
        blending: material.blending,
        alphaTest: material.alphaTest,
        polygonOffset: material.polygonOffset,
        polygonOffsetFactor: material.polygonOffsetFactor,
        polygonOffsetUnits: material.polygonOffsetUnits,
        defines: { ...material.defines },
      });
      // The chunk pipeline assigns `.map` after construction; the program
      // builder keys USE_MAP off the property, so the legacy program must
      // carry it too or it compiles untextured.
      (legacy as THREE.ShaderMaterial & { map?: THREE.Texture }).map = (
        material as THREE.ShaderMaterial & { map?: THREE.Texture }
      ).map;
      legacyOf.set(material, legacy);
    }

    const target = new THREE.WebGLRenderTarget(size, size, {
      depthBuffer: true,
      stencilBuffer: false,
    });
    const readback = () => {
      renderer.setRenderTarget(target);
      renderer.render(world, camera);
      const pixels = new Uint8Array(size * size * 4);
      renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);
      return pixels;
    };
    const swap = (toLegacy: boolean) => {
      world.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const material = mesh.material as THREE.Material;
        if (toLegacy && legacyOf.has(material)) {
          mesh.userData.__parityOriginal = material;
          mesh.material = legacyOf.get(material)!;
        } else if (!toLegacy && mesh.userData.__parityOriginal) {
          mesh.material = mesh.userData.__parityOriginal;
          delete mesh.userData.__parityOriginal;
        }
      });
    };

    // The world's own per-render hook flushes animated-atlas frames on a
    // real-time clock — a texture patch landing between two passes would
    // fail the control for reasons outside the programs under test. Freeze
    // it for the harness; queued patches flush on the next live frame.
    const worldOnBeforeRender = world.onBeforeRender;
    world.onBeforeRender = () => undefined;

    // The contract under test is the CHUNK programs. Sky, clouds, entities,
    // and overlays render identical programs in both passes but animate on
    // their own real-time clocks, so they only add nondeterminism; hide
    // everything that is not chunk geometry for the duration.
    const hidden: THREE.Object3D[] = [];
    world.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.visible) return;
      if (!legacyOf.has(mesh.material as THREE.Material)) {
        mesh.visible = false;
        hidden.push(mesh);
      }
    });

    // Warm-up render: lazily-initialized render-path state (target
    // allocation, first-render uploads, program compiles) settles before
    // the measured passes, exactly like a real frame stream.
    readback();
    // Control: two consecutive readbacks with the SAME programs must be
    // byte-identical, or the surface itself has order-dependent state and
    // the legacy comparison would be meaningless.
    const shippedControl = readback();
    const shipped = readback();
    swap(true);
    // Compile + settle the legacy programs, then measure their pass.
    readback();
    const legacy = readback();
    swap(false);
    renderer.setRenderTarget(null);
    for (const object of hidden) object.visible = true;
    world.onBeforeRender = worldOnBeforeRender;

    // Full-RGBA comparison: every byte of the readback counts, alpha
    // included — the contract is byte-identical output, not RGB-close.
    const compare = (a: Uint8Array, b: Uint8Array) => {
      let diffBytes = 0;
      let diffPixels = 0;
      let maxDelta = 0;
      for (let p = 0; p < size * size; p++) {
        const i = p * 4;
        let d = 0;
        for (let c = 0; c < 4; c++) {
          const delta = Math.abs(a[i + c] - b[i + c]);
          if (delta > 0) diffBytes++;
          d += delta;
        }
        if (d > 0) {
          diffPixels++;
          if (d > maxDelta) maxDelta = d;
        }
      }
      return { diffBytes, diffPixels, maxDelta };
    };
    const control = compare(shippedControl, shipped);
    const { diffBytes, diffPixels, maxDelta } = compare(shipped, legacy);

    const toPng = (pixels: Uint8Array) => {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      const image = ctx.createImageData(size, size);
      // GL readback is bottom-up; PNGs are top-down.
      for (let row = 0; row < size; row++) {
        image.data.set(
          pixels.subarray((size - 1 - row) * size * 4, (size - row) * size * 4),
          row * size * 4,
        );
      }
      ctx.putImageData(image, 0, 0);
      return canvas.toDataURL("image/png");
    };
    const result = {
      diffPixels,
      /** Differing BYTES across the full RGBA readback (alpha included). */
      diffBytes,
      maxDelta,
      controlDiffPixels: control.diffPixels,
      controlDiffBytes: control.diffBytes,
      controlMaxDelta: control.maxDelta,
      totalPixels: size * size,
      totalBytes: size * size * 4,
      shippedPng: toPng(shipped),
      legacyPng: toPng(legacy),
    };

    target.dispose();
    for (const legacyMaterial of legacyOf.values()) legacyMaterial.dispose();
    return result;
  },
  // Positions of every registered light, for QA sweeps of leftover emitters.
  lightReport: () => {
    const { registry } = world.localLights;
    const out: number[][] = [];
    for (let n = 0; n < registry.aliveCount; n++) {
      const i = registry.aliveIndices[n];
      out.push([
        Math.round(registry.positions[i * 3] * 10) / 10,
        Math.round(registry.positions[i * 3 + 1] * 10) / 10,
        Math.round(registry.positions[i * 3 + 2] * 10) / 10,
      ]);
    }
    return out;
  },
  setAggregation: (block: string, mode: "none" | "cluster") =>
    world.localLights.setBlockProfile(block, { aggregation: mode }),
  setProfile: (block: string | number, profile: VOXELIZE.BlockLightProfile) =>
    world.localLights.setBlockProfile(block, profile),
  clearProfile: (block: string) => world.localLights.clearBlockProfile(block),
  toggleOrbit: () => toggleOrbitLight(),
  toggleHeldLight: () => toggleHeldLight(),
  // Worst-case shadow benchmark: a shadow-requesting light that never stops
  // moving, so its whole face set re-renders every frame the ledger allows.
  toggleOrbitShadowed: () => {
    if (orbitLightHandle === VOXELIZE.INVALID_LIGHT_HANDLE) {
      orbitLightHandle = world.localLights.add(
        {
          shape: "point",
          colorTemperatureK: 1900,
          intensity: 1.2,
          range: 14,
          isStatic: false,
          shadowPolicy: "shadowMap",
          priorityBias: 4,
        },
        controls.object.position,
      );
    } else {
      world.localLights.remove(orbitLightHandle);
      orbitLightHandle = VOXELIZE.INVALID_LIGHT_HANDLE;
    }
  },
  teleport: (x: number, y: number, z: number) => {
    controls.teleport(x, y, z);
    // Move the server-side avatar too: entity interest management follows
    // it, and the anti-cheat clamp would otherwise crawl it there slowly.
    method.call("teleport-client", { position: [x, y, z] });
  },
  lookAt: (x: number, y: number, z: number) => controls.lookAt(x, y, z),
  setDirection: (dx: number, dy: number, dz: number) =>
    controls.setDirection(dx, dy, dz),
  setTime: (time: number) => method.call("time", { time }),
  setTimeFrac: (frac: number) =>
    method.call("time", { time: world.options.timePerDay * frac }),
  loseContext: () => {
    const ext = renderer.getContext().getExtension("WEBGL_lose_context");
    ext?.loseContext();
    setTimeout(() => ext?.restoreContext(), 1500);
  },
  worldReady: () => world.isInitialized,
  pendingWork: () => ({
    scans: world.localLights.stats.sectionsPendingScan,
    chunksProcessing: world.chunkPipeline.processingCount,
    chunksRequested: world.chunkPipeline.requestedCount,
  }),
  getVoxel: (x: number, y: number, z: number) => world.getVoxelAt(x, y, z),
  getPosition: () => controls.object.position.toArray(),
  getCameraFacing: () =>
    camera.getWorldDirection(new THREE.Vector3()).toArray(),
  charLight: () => {
    const sample = {
      color: [0, 0, 0] as [number, number, number],
      count: 0,
      claim: 0,
      windowFade: 1,
    };
    world.localLights.queryLocalLights(character.position, sample);
    const uniform = (
      character.userData.lightUniforms as { value: THREE.Color }[] | undefined
    )?.[0]?.value;
    return {
      position: character.position.toArray(),
      sample,
      uniform: uniform ? [uniform.r, uniform.g, uniform.b] : null,
    };
  },
  getBlockNameAt: (x: number, y: number, z: number) =>
    world.getBlockAt(x, y, z)?.name ?? "<none>",
  listEntities: () => {
    const out: { type: string; position: number[] }[] = [];
    entities.map.forEach((entity) => {
      const caster = (entity as { shadowCaster?: THREE.Object3D }).shadowCaster;
      out.push({
        type: entity.entType ?? "?",
        position: (caster ?? entity).position.toArray(),
      });
    });
    return out;
  },
  // ── shadow proof / bench hooks (Engine PR B) ─────────────────────────────
  buildShadowStage: (x: number, y: number, z: number) =>
    buildShadowStage(x, y, z),
  clearShadowStage: (x: number, y: number, z: number) =>
    clearShadowStage(x, y, z),
  placeBlock: (
    x: number,
    y: number,
    z: number,
    name: string,
    rotation?: number,
  ) =>
    world.updateVoxels([
      {
        vx: x,
        vy: y,
        vz: z,
        type: name === "air" ? 0 : world.getBlockByName(name)?.id ?? 0,
        rotation,
      },
    ]),
  spawnPigs: (
    x: number,
    y: number,
    z: number,
    count = 1,
    radius = 3.5,
    speed = 0.35,
    kind = "pig",
  ) =>
    method.call("spawn-pig", {
      position: [x, y, z],
      count,
      radius,
      speed,
      kind,
    }),
  clearPigs: () => method.call("clear-pigs", {}),
  spawnFauna: (x: number, y: number, z: number, count = 1) =>
    method.call("spawn-fauna", { position: [x, y, z], count }),
  toggleAtlasViewer: (x: number, y: number, z: number, size = 6) =>
    toggleAtlasViewer(x, y, z, size),
  setPerspective: (state: "first" | "second" | "third") => {
    perspective.state = state;
  },
  walk: (forwardMs: number) => {
    controls.movements.front = true;
    setTimeout(() => {
      controls.movements.front = false;
    }, forwardMs);
  },
  toggleDebugPanel: () => debug.toggle(),
  ledgerStats: () => ({ ...world.localLights.shadowLedger.frameStats }),
  invalidationLog: () => world.localLights.shadows.invalidationLog.slice(),
  invalidateShadowRegion: (
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
  ) =>
    world.localLights.invalidateShadowRegion({
      min: new THREE.Vector3(minX, minY, minZ),
      max: new THREE.Vector3(maxX, maxY, maxZ),
    }),
};

inputs.bind(
  "KeyZ",
  () => {
    console.log("hello");
    method.call("spawn-bot", {
      position: controls.object.position.toArray(),
    });
  },
  "in-game",
);

inputs.bind(
  "KeyO",
  () => {
    method.call("spawn-fauna", {
      position: controls.object.position.toArray(),
      count: 150,
    });
  },
  "in-game",
);

inputs.bind(
  "KeyU",
  () => {
    method.call("clear-fauna", {});
  },
  "in-game",
);

inputs.bind(
  "KeyB",
  () => {
    if (!voxelInteract.target) return;
    method.call("break-with-drop", { voxel: voxelInteract.target });
  },
  "in-game",
);

inputs.bind(
  "KeyL",
  () => {
    let nearestId: string | null = null;
    let nearestDistanceSq = Infinity;
    entities.map.forEach((entity) => {
      if (entity.entType !== "drop") return;
      const distanceSq = entity.position.distanceToSquared(
        controls.object.position,
      );
      if (distanceSq < nearestDistanceSq) {
        nearestDistanceSq = distanceSq;
        nearestId = entity.entId;
      }
    });
    if (nearestId) {
      method.call("pickup-drop", { id: nearestId });
    }
  },
  "in-game",
);

inputs.bind("KeyN", () => {
  events.emit("test", {
    test: "Hello World",
    nested: {
      test: "Hello World",
      array: [1, 2, 3],
      arrayOfObjects: [
        {
          test: "Hello World",

          nested: {
            test: "Hello World",
            array: [1, 2, 3],

            arrayOfObjects: [
              {
                test: "Hello World",
              },
            ],
          },
        },
      ],
    },
  });
});

const RANDOM_TELEPORT_WIDTH = 1000000;
inputs.bind("]", () => {
  controls.teleportToTop(
    Math.random() * RANDOM_TELEPORT_WIDTH,
    Math.random() * RANDOM_TELEPORT_WIDTH,
  );
});

// map toggle bind located after map initialization

// inputs.bind("escape", () => {
//   map.setVisible(false);
// });

// inputs.bind("l", () => {
//   network.action("create_world", "new_world");
// });

// inputs.bind(
//   "b",
//   () => {
//     inputs.remap("t", "c", { occasion: "keyup" });
//   },
//   "in-game",
//   { identifier: "BRUH" }
// );

// inputs.bind(
//   "o",
//   () => {
//     console.log(controls.object.position);
//   },
//   "in-game"
// );

/* -------------------------------------------------------------------------- */
/*                           MULTIPLAYER CHARACTERS                           */
/* -------------------------------------------------------------------------- */
type PeersMeta = {
  direction: number[];
  position: number[];
  holding_object_id: number;
};

class Peers extends VOXELIZE.Peers<VOXELIZE.Character, PeersMeta> {
  constructor(public object?: THREE.Object3D) {
    super(object);
  }

  createPeer = createCharacter;

  onPeerUpdate = (
    object: VOXELIZE.Character,
    data: PeersMeta,
    info: { id: string; username: string },
  ) => {
    object.set(data.position, data.direction);
    object.username = info.username;
    if (
      object instanceof VOXELIZE.Character &&
      data.holding_object_id !== undefined &&
      data.holding_object_id !== object.userData.holdingObjectId &&
      world.isInitialized
    ) {
      const newHoldingObjectId = data.holding_object_id;
      const characterBlock = world.makeBlockMesh(newHoldingObjectId, {
        material: "basic",
      });
      if (characterBlock) {
        const size = 0.3;
        characterBlock.quaternion.setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          -Math.PI / 4,
        );
        characterBlock.scale.set(size, size, size);
        characterBlock.position.set(0, -size * 0.5, -size * 0.5);
      }
      object.setArmHoldingObject(characterBlock);
      object.userData.holdingObjectId = data.holding_object_id;
    }
  };

  packInfo = () => {
    const emptyQ = new THREE.Quaternion();
    const emptyP = new THREE.Vector3();

    if (!this.object) return;

    const {
      x: dx,
      y: dy,
      z: dz,
    } = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(this.object.getWorldQuaternion(emptyQ))
      .normalize();
    const { x: px, y: py, z: pz } = this.object.getWorldPosition(emptyP);

    let holdingObjectId = 0;

    if (this.ownPeer) {
      holdingObjectId = this.ownPeer.userData.holdingObjectId ?? 0;
    }

    return {
      id: this.ownID,
      username: this.ownUsername,
      metadata: {
        position: [px, py, pz],
        direction: [dx, dy, dz],
        holding_object_id: holdingObjectId,
      } as any as PeersMeta,
    };
  };
}
const peers = new Peers(controls.object);

// createPeer code found in Peers class

// onPeerUpdate code located in Peers class

peers.setOwnPeer(character);

world.add(peers);

/* -------------------------------------------------------------------------- */
/*                                  DEBUGGING                                 */
/* -------------------------------------------------------------------------- */
const debug = new VOXELIZE.Debug(document.body, {
  dataStyles: {
    top: "unset",
    bottom: "10px",
    left: "10px",
  },
});

debug.registerDisplay(
  "Chunks Requested",
  () => world.chunkPipeline.requestedCount,
);
debug.registerDisplay(
  "Chunks Processing",
  () => world.chunkPipeline.processingCount,
);
debug.registerDisplay("Chunks Loaded", () => world.chunkPipeline.loadedCount);

debug.registerDisplay("Local Lights", () => {
  const { registered, clustered, candidates } = world.localLights.stats;
  return `${clustered}/${candidates} of ${registered}`;
});

debug.registerDisplay("Light CPU", () => {
  const { selectMs, packMs, scanMs } = world.localLights.stats;
  return `${(selectMs + packMs).toFixed(2)}ms +scan ${scanMs.toFixed(2)}ms`;
});

debug.registerDisplay("Shadows", () => {
  const s = world.localLights.stats;
  return (
    `${s.shadowed} slot(s) | faces ${s.shadowFacesStatic}s+${s.shadowFacesDynamic}d` +
    ` | cache ${(s.shadowCacheHitRate * 100).toFixed(0)}%`
  );
});

debug.registerDisplay("Shadow ledger", () => {
  const l = world.localLights.shadowLedger.frameStats;
  return (
    `${l.used}/${l.budget}u (csm ${l.csmNearUnits + l.csmFarUnits}` +
    `, local ${l.localDynamicUnits + l.localStaticUnits})` +
    `${l.csmFarDenied > 0 ? " far-deferred" : ""}`
  );
});

debug.registerDisplay("Position", controls, "voxel");

debug.registerDisplay("Voxel Stage", () => {
  return world.getVoxelStageAt(...controls.voxel);
});

debug.registerDisplay("Time", () => {
  return `${Math.floor(
    (world.time / world.options.timePerDay) * 100,
  )}% (${world.time.toFixed(2)})`;
});

debug.registerDisplay("Sunlight", () => {
  return world.getSunlightAt(...controls.voxel);
});

["Red", "Green", "Blue"].forEach((color) => {
  debug.registerDisplay(`${color} Light`, () => {
    return world.getTorchLightAt(...controls.voxel, color.toUpperCase() as any);
  });
});

debug.registerDisplay("Holding", () => {
  const slot = bar.getFocused();
  if (!slot) return;

  const id = slot.getContent();
  const block = world.getBlockById(id);
  return block ? block.name : "<Empty>";
});

debug.registerDisplay("Looking at", () => {
  const { target } = voxelInteract;
  if (!target) return "<Empty>";

  const [x, y, z] = target;
  const block = world.getBlockAt(x, y, z);
  return block ? block.name : "<Empty>";
});

debug.registerDisplay("Build radius", () => {
  return radius;
});

debug.registerDisplay("# of triangles", () => {
  return renderer.info.render.triangles;
});

debug.registerDisplay("# of points", () => {
  return renderer.info.render.points;
});

debug.registerDisplay("Concurrent WebWorkers", () => {
  return VOXELIZE.WorkerPool.WORKING_COUNT;
});

// packet queue length defined after network is initialized

const gui = new GUI();
gui.domElement.style.top = "10px";

inputs.bind("KeyJ", debug.toggle, "*");

// debug.registerDisplay("Active Voxels", async () => {
//   const data = await fetch(`${BACKEND_SERVER}info`);
//   const json = await data.json();
//   return json.worlds.terrain.chunks.active_voxels;
// });

/* -------------------------------------------------------------------------- */
/*                               NETWORK MANAGER                              */
/* -------------------------------------------------------------------------- */
const network = new VOXELIZE.Network();
debug.registerDisplay("Packet queue length", network, "packetQueueLength"); //! usually under debug section

// Diagnostic: count entity payloads reaching the client (bench hook below).
let entityMessageCount = 0;

const chat = new VOXELIZE.Chat();
const entities = new VOXELIZE.Entities();
const method = new VOXELIZE.Method();
const events = new VOXELIZE.Events();
network
  .register(world)
  .register(peers)
  .register(chat)
  .register(entities)
  .register(method)
  .register(events)
  .register(controls);

/* -------------------------------------------------------------------------- */
/*                                UNSORTED CODE                               */
/* -------------------------------------------------------------------------- */
const BACKEND_SERVER_INSTANCE = new URL(window.location.href);
const VOXELIZE_LOCALSTORAGE_KEY = "voxelize-world";

const currentWorldName =
  new URLSearchParams(window.location.search).get("world") ??
  localStorage.getItem(VOXELIZE_LOCALSTORAGE_KEY) ??
  "terrain";

if (BACKEND_SERVER_INSTANCE.origin.includes("localhost")) {
  BACKEND_SERVER_INSTANCE.port = "4000";
}

const BACKEND_SERVER = BACKEND_SERVER_INSTANCE.toString();

class Box extends VOXELIZE.Entity<{
  position: VOXELIZE.Coords3;
}> {
  constructor(id: string) {
    super(id);

    this.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.5, 0.5),
        new THREE.MeshBasicMaterial(),
      ),
    );

    lightShined.add(this);
  }

  onCreate = (data: { position: VOXELIZE.Coords3 }) => {
    this.position.set(...data.position);
  };

  onUpdate = (data: { position: VOXELIZE.Coords3 }) => {
    this.position.set(...data.position);
  };
}

class Fauna extends VOXELIZE.Entity<{
  position: VOXELIZE.Coords3;
  direction?: number[];
}> {
  private targetPosition = new THREE.Vector3();

  constructor(id: string) {
    super(id);

    // A stable per-entity hue so individual movers are distinguishable in
    // the 150+ entity stress scene.
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash * 31 + id.charCodeAt(i)) | 0;
    }
    const color = new THREE.Color().setHSL(
      (Math.abs(hash) % 360) / 360,
      0.8,
      0.6,
    );

    this.add(
      new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.6, 0.6),
        new THREE.MeshBasicMaterial({ color }),
      ),
    );
  }

  onCreate = (data: { position: VOXELIZE.Coords3 }) => {
    this.position.set(...data.position);
    this.targetPosition.set(...data.position);
  };

  onUpdate = (data: { position: VOXELIZE.Coords3 }) => {
    this.targetPosition.set(...data.position);
  };

  update = () => {
    this.position.lerp(this.targetPosition, 0.25);
  };

  snapToTarget = () => {
    this.position.copy(this.targetPosition);
  };
}

/**
 * A generic demo animal: a pink quadruped built from the engine's Creature
 * primitive. It tints under local lights (LightShined) and is handed to the
 * shadow pipeline as a dynamic caster, so it blocks lamp light and drags a
 * moving shadow as it wanders.
 */
class DemoAnimal extends VOXELIZE.Entity<{
  position: VOXELIZE.Coords3;
  direction?: number[];
}> {
  creature: VOXELIZE.Creature;
  shadowCaster: THREE.Object3D;

  constructor(id: string, options: Partial<VOXELIZE.CreatureOptions>) {
    super(id);

    this.creature = new VOXELIZE.Creature({
      walkingSpeed: 1.6,
      ...options,
    });
    // The stock creature is knee-high; demo animals are block-scale casters.
    this.creature.scale.set(4.5, 4.5, 4.5);
    this.add(this.creature);
    // The entity group stays at the origin (creature.set drives world
    // position), so the creature's own position is world-space — exactly
    // what the shadow scheduler's range tests need.
    this.shadowCaster = this.creature;

    lightShined.add(this.creature);
  }

  onCreate = (data: { position: VOXELIZE.Coords3; direction?: number[] }) => {
    this.creature.set(data.position, data.direction ?? [0, 0, -1]);
    this.creature.snapToTarget();
  };

  onUpdate = (data: { position: VOXELIZE.Coords3; direction?: number[] }) => {
    this.creature.set(data.position, data.direction ?? [0, 0, -1]);
  };

  update = () => {
    this.creature.update();
  };
}

class Pig extends DemoAnimal {
  constructor(id: string) {
    super(id, {
      head: { color: "#F2A0B4", faceColor: "#E87D9B" },
      body: { color: "#EE8FA6" },
      legs: { color: "#D97A93" },
    });
  }
}

class Sheep extends DemoAnimal {
  constructor(id: string) {
    super(id, {
      head: { color: "#E8E4DA", faceColor: "#8A8378" },
      body: { color: "#F2EFE7" },
      legs: { color: "#B5AC9C" },
    });
  }
}

class Drop extends VOXELIZE.Entity<{
  position: VOXELIZE.Coords3;
}> {
  constructor(id: string) {
    super(id);

    this.add(
      new THREE.Mesh(
        new THREE.OctahedronGeometry(0.4),
        new THREE.MeshBasicMaterial({ color: 0xffcc33 }),
      ),
    );
  }

  onCreate = (data: { position: VOXELIZE.Coords3 }) => {
    this.position.set(...data.position);
  };

  onUpdate = (data: { position: VOXELIZE.Coords3 }) => {
    this.position.set(...data.position);
  };

  update = () => {
    this.rotation.y += 0.05;
  };
}

{
  const originalOnMessage = entities.onMessage.bind(entities);
  entities.onMessage = (message, ...rest) => {
    if (message?.entities?.length) {
      entityMessageCount += message.entities.length;
    }
    return originalOnMessage(message, ...rest);
  };
  (
    window as Window & { __bench__?: Record<string, unknown> }
  ).__bench__.entityMessages = () => entityMessageCount;
}

inputs.on("namespace", (namespace) => {
  console.log("namespace changed", namespace);
});
inputs.setNamespace("menu");

world.addChunkInitListener([0, 0], () => {
  controls.teleportToTop(0, 0);
});

renderer.setTransparentSort(VOXELIZE.TRANSPARENT_SORT(controls.object));

controls.on("lock", () => {
  inputs.setNamespace("in-game");
});

controls.on("unlock", () => {
  inputs.setNamespace("menu");
});

// let hand = "glass";

VOXELIZE.ColorText.SPLITTER = "$";

type BotData = {
  position: VOXELIZE.Coords3;
  direction: number[];
  target: {
    targetType: VOXELIZE.TargetType;
    position: VOXELIZE.Coords3;
  };
  path: {
    maxNodes: number;
    path: VOXELIZE.Coords3[];
  };
};

const botPaths = new THREE.Group();
world.add(botPaths);

const options = { pathVisible: false };
class Bot extends VOXELIZE.Entity<BotData> {
  entityId: string;
  character: VOXELIZE.Character;
  path = new THREE.Group();

  constructor(id: string) {
    super(id);

    this.entityId = id;

    this.character = new VOXELIZE.Character({
      nameTagOptions: {
        fontFace: "ConnectionSerif-d20X",
      },
    });
    this.character.username = "$#B4D4FF$Eric's Bot";

    // lightShined.add(this.character);

    this.character.head.paint("all", new THREE.Color(BOT_HEAD_COLOR));
    this.character.head.paint("front", new THREE.Color(BOT_HEAD_FRONT_COLOR));
    this.character.scale.set(BOT_SCALE, BOT_SCALE, BOT_SCALE);

    this.character.position.y += this.character.totalHeight / 4;
    this.add(this.character);

    lightShined.add(this.character);

    botPaths.add(this.path);
  }

  adjustPosition = (position: VOXELIZE.Coords3) => {
    position[1] += this.character.totalHeight / 4;
    return position;
  };

  onCreate = (data: BotData) => {
    const adjustedPosition = this.adjustPosition(data.position);
    console.log(adjustedPosition);
    this.character.set(adjustedPosition, [0, 0, 0]);
  };

  onDelete = () => {
    this.path.children.forEach((node) => {
      this.path.remove(node);
    });

    botPaths.remove(this.path);
  };

  onUpdate = (data: BotData) => {
    const { position, target } = data;

    const adjustedPosition = this.adjustPosition(position);

    const origin = this.character.position;

    const [tx, ty, tz] = target.position || [0, 0, 0];
    const delta = new THREE.Vector3(tx, ty, tz).sub(origin);
    const direction = delta.clone().normalize();

    this.character.set(adjustedPosition, direction.toArray());

    this.path.children.forEach((node) => {
      this.path.remove(node);
    });

    const { path } = data;

    if (path.path && options.pathVisible) {
      const { path: nodes } = path;

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const color = new THREE.Color("#fff");
        const geometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
        const material = new THREE.MeshBasicMaterial({
          color,
          opacity: 0.3,
          transparent: true,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(...node);
        mesh.position.addScalar(0.5);
        this.path.add(mesh);
      }
    }
  };

  update = () => {
    this.character.update();
  };
}

entities.setClass("bot", Bot);
entities.setClass("box", Box);
entities.setClass("fauna", Fauna);
entities.setClass("drop", Drop);
entities.setClass("pig", Pig);
entities.setClass("sheep", Sheep);

world.add(entities);

events.on("test", (payload) => {
  console.log("test event:", payload);
});

// Create a test for atlas
// setTimeout(() => {
//   let i = -Math.floor(world.chunkmaterials.size / 2);
//   const width = 2;

//   for (const mat of world.chunkmaterials.values()) {
//     const plane = new THREE.Mesh(
//       new THREE.PlaneGeometry(width, width),
//       new THREE.MeshBasicMaterial({
//         map: mat.map,
//       })
//     );

//     plane.position.x = i++ * width;
//     plane.position.y = -width;

//     world.add(plane);
//   }
// }, 1000);

// const portraits = new VOXELIZE.BlockPortraits(world);

// for (let i = 0; i < 5; i++) {
//   const canvas = portraits.add("fuck" + i, 2);
//   VOXELIZE.DOMUtils.applyStyles(canvas, {
//     position: "fixed",
//     top: `${Math.floor(i / 10) * 100}px`,
//     right: `${(i % 10) * 100}px`,
//     zIndex: "10000000000000000",
//     background: "black",
//   });
//   document.body.appendChild(canvas);
// }

const map = new Map(world, document.getElementById("biomes") || document.body);
inputs.bind("m", map.toggle); //! does not seem to work

// let isLoading = true;
// const loadingFade = 500;
const loading = document.getElementById("loading") as HTMLDivElement;
loading.style.display = "none";
// const loadingBar = document.getElementById(
//   "loading-bar-inner"
// ) as HTMLDivElement;
// loading.style.transition = `${loadingFade}ms opacity ease`;

world.addBlockEntityUpdateListener((data) => {
  if (data.operation === "UPDATE" || data.operation === "CREATE") {
    // console.log("data", data);
    const color = data.newValue.color ?? [0, 0, 0];
    console.log("color", color, data.voxel);
    world.applyBlockTextureAt(
      "mushroom",
      "top-py",
      new THREE.Color(...color),
      data.voxel,
    );
  }
  // console.log(
  //   JSON.stringify(data.oldValue, null, 2),
  //   JSON.stringify(data.newValue, null, 2)
  // );
});

const arm = new VOXELIZE.Arm();
const armScene = new THREE.Scene();
const armCamera = camera.clone();
lightShined.add(arm);
armScene.add(arm);
arm.connect(inputs, "in-game");
controls.attachArm(arm);

window.addEventListener("resize", () => {
  const width = window.innerWidth as number;
  const height = window.innerHeight as number;

  renderer.setSize(width, height);
  renderer.pixelRatio = window.devicePixelRatio;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  armCamera.aspect = width / height;
  armCamera.updateProjectionMatrix();
});

bar.onFocusChange((_, current) => {
  const armBlock = world.makeBlockMesh(current.content, {
    material: "basic",
  });
  arm.setArmObject(armBlock, false);

  const characterBlock = world.makeBlockMesh(current.content, {
    material: "basic",
  });
  if (characterBlock) {
    const size = 0.3;
    characterBlock.quaternion.setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      -Math.PI / 4,
    );
    characterBlock.scale.set(size, size, size);
    characterBlock.position.set(0, -size * 0.5, -size * 0.5);
  }
  character.userData.holdingObjectId = current.content;
  character.setArmHoldingObject(characterBlock);
});

/* -------------------------------------------------------------------------- */
/*                               MAIN GAME LOOPS                              */
/* -------------------------------------------------------------------------- */
const update = () => {
  if (!world.isInitialized) return;

  perspective.update();
  voxelInteract.update();
  controls.update();
  lightShined.update();

  const inWater =
    world.getBlockAt(...camera.getWorldPosition(new THREE.Vector3()).toArray())
      ?.name === "Water";

  const fogNear = inWater
    ? 0.1 * world.options.chunkSize * world.renderRadius
    : 0.7 * world.options.chunkSize * world.renderRadius;
  const fogFar = inWater
    ? 0.8 * world.options.chunkSize * world.renderRadius
    : world.options.chunkSize * world.renderRadius;
  const fogColor = inWater
    ? new THREE.Color("#5F9DF7")
    : world.chunkRenderer.uniforms.fogColor.value;

  world.chunkRenderer.uniforms.fogNear.value = THREE.MathUtils.lerp(
    world.chunkRenderer.uniforms.fogNear.value,
    fogNear,
    0.08,
  );

  world.chunkRenderer.uniforms.fogFar.value = THREE.MathUtils.lerp(
    world.chunkRenderer.uniforms.fogFar.value,
    fogFar,
    0.08,
  );

  world.chunkRenderer.uniforms.fogColor.value.lerp(fogColor, 0.08);

  updateOrbitLight();
  updateHeldLight();

  world.update(
    controls.object.position,
    camera.getWorldDirection(new THREE.Vector3()),
  );

  entities.update();

  peers.update();
  debug.update();
};

let isFocused = true;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(world, camera));

const overlayEffect = new VOXELIZE.BlockOverlayEffect(world, camera);
overlayEffect.addOverlay("water", new THREE.Color("#5F9DF7"), 0.001);
composer.addPass(new EffectPass(camera, new SMAAEffect({}), overlayEffect));

const animate = () => {
  requestAnimationFrame(animate);
  recordFrame(performance.now());
  if (isFocused) update();
  // Drive the sun/moon + CSM uniforms and render the shadow maps (cascades
  // plus the local-light atlas) exactly the way a production host does.
  if (world.isInitialized && SHADOWS_ENABLED) {
    world.updateShaderLighting(camera, controls.object.position);
    world.renderShadowMaps(renderer, collectShadowCasters());
  }
  composer.render();
  renderer.clearDepth();
  renderer.render(armScene, armCamera);
};

const start = async () => {
  let clearUpdate: any;

  const handleVisibilityChange = () => {
    if (document.hidden) {
      console.log("Page is hidden");
      isFocused = false;
      if (!clearUpdate) {
        clearUpdate = VOXELIZE.setWorkerInterval(update, 1000 / 60);
      }
    } else {
      console.log("Page is visible");
      if (clearUpdate) {
        clearUpdate();
        clearUpdate = null;
      }
      isFocused = true;
    }
  };

  document.addEventListener("visibilitychange", handleVisibilityChange);

  animate();

  await network.connect(BACKEND_SERVER, { secret: "test" });
  await network.join(currentWorldName);

  await world.initialize();
  await setupWorld(world);

  gui
    .add({ time: world.time }, "time", 0, world.options.timePerDay, 0.01)
    .onFinishChange((time: number) => {
      world.time = time;
    });

  gui
    .add({ world: currentWorldName }, "world", ["terrain", "flat", "test"])
    .onChange((worldName: string) => {
      localStorage.setItem(VOXELIZE_LOCALSTORAGE_KEY, worldName);
      window.location.reload();
    });

  gui.add(options, "pathVisible").onChange((value: boolean) => {
    options.pathVisible = value;
  });

  world.renderRadius = 8;
  gui.add(world, "renderRadius", 3, 20, 1);

  gui.add(voxelInteract.options, "ignoreFluids");

  gui.add(map, "dimension", 1, 10, 0.1);

  HOTBAR_CONTENT.forEach((id, index) => {
    const slot = bar.getSlot(0, index);
    const mesh = world.makeBlockMesh(id, { material: "standard" });
    if (mesh) slot.setObject(mesh);
    if (id === 500) {
      slot.setPerspective("pz");
    }
    slot.setContent(id);
  });
  [
    "Digit1",
    "Digit2",
    "Digit3",
    "Digit4",
    "Digit5",
    "Digit6",
    "Digit7",
    "Digit8",
    "Digit9",
    "Digit0",
  ].forEach((key) => {
    inputs.bind(
      key,
      () => {
        const index = parseInt(key.replace("Digit", ""));
        bar.setFocused(0, index - 1);
      },
      "in-game",
    );
  });
  bar.connect(inputs);

  inputs.bind(
    ";",
    () => {
      const updates: VOXELIZE.BlockUpdate[] = [];
      const [vx, vy, vz] = controls.voxel;
      const width = 80;
      const height = 80;
      for (let x = -width / 2; x <= width / 2; x++) {
        for (let y = 0; y <= height; y++) {
          updates.push({
            type: 1,
            vx: vx,
            vy: vy + y,
            vz: vz + x,
          });
        }
      }

      world.updateVoxels(updates);
    },
    "in-game",
  );

  // world.addBlockUpdateListener(({ voxel, oldValue, newValue }) => {
  //   console.log("block update", voxel, oldValue, newValue);
  // });

  // const inventoryTest = new VOXELIZE.ItemSlots({
  //   verticalCount: 10,
  //   horizontalCount: 10,
  // });

  // document.body.appendChild(inventoryTest.element);

  // const zeroZero = inventoryTest.getSlot(0, 0);
  // zeroZero.setContent(1);
  // zeroZero.setObject(world.makeBlockMesh(1, { material: "standard" }));
};

start();
