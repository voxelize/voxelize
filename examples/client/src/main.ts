import "./style.css";

// For official use, you should do `@voxelize/core/styles.css` instead.
import "@voxelize/core/src/styles.css";

import * as VOXELIZE from "@voxelize/core";
import { GUI } from "lil-gui";
import {
  EffectComposer,
  EffectPass,
  // PixelationEffect,
  RenderPass,
  SMAAEffect,
} from "postprocessing";
import * as THREE from "three";

import LolImage from "./assets/lol.png";
import { Map } from "./map";
import { setupWorld } from "./world";

const createCharacter = () => {
  const character = new VOXELIZE.Character();
  world.loader.load().then(() => {
    character.head.paint("front", world.loader.getTexture(LolImage));
  });
  lightShined.add(character);
  shadows.add(character);
  return character;
};

const BACKEND_SERVER_INSTANCE = new URL(window.location.href);
const VOXELIZE_LOCALSTORAGE_KEY = "voxelize-world";

const currentWorldName =
  localStorage.getItem(VOXELIZE_LOCALSTORAGE_KEY) ?? "terrain";

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
        new THREE.MeshBasicMaterial()
      )
    );

    // shadows.add(this);
    // lightShined.add(this);
  }

  onCreate = (data: { position: VOXELIZE.Coords3 }) => {
    this.position.set(...data.position);
  };

  onUpdate = (data: { position: VOXELIZE.Coords3 }) => {
    this.position.set(...data.position);
  };
}

const canvas = document.getElementById("main") as HTMLCanvasElement;

const world = new VOXELIZE.World({
  textureUnitDimension: 16,
});

const chat = new VOXELIZE.Chat();
const inputs = new VOXELIZE.Inputs<"menu" | "in-game" | "chat">();

world.loader.loadTexture(LolImage, (texture) => {
  character.head.paint("front", texture);
});

inputs.on("namespace", (namespace) => {
  console.log("namespace changed", namespace);
});
inputs.setNamespace("menu");

world.sky.setShadingPhases([
  // start of sunrise
  {
    name: "sunrise",
    color: {
      top: new THREE.Color("#7694CF"),
      middle: new THREE.Color("#B0483A"),
      bottom: new THREE.Color("#222"),
    },
    skyOffset: 0.05,
    voidOffset: 0.6,
    start: 0.2,
  },
  // end of sunrise
  {
    name: "daylight",
    color: {
      top: new THREE.Color("#73A3FB"),
      middle: new THREE.Color("#B1CCFD"),
      bottom: new THREE.Color("#222"),
    },
    skyOffset: 0,
    voidOffset: 0.6,
    start: 0.25,
  },
  // start of sunset
  {
    name: "sunset",
    color: {
      top: new THREE.Color("#A57A59"),
      middle: new THREE.Color("#FC5935"),
      bottom: new THREE.Color("#222"),
    },
    skyOffset: 0.05,
    voidOffset: 0.6,
    start: 0.7,
  },
  // end of sunset
  {
    name: "night",
    color: {
      top: new THREE.Color("#000"),
      middle: new THREE.Color("#000"),
      bottom: new THREE.Color("#000"),
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

const camera = new THREE.PerspectiveCamera(
  90,
  window.innerWidth / window.innerHeight,
  0.1,
  5000
);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
});
renderer.setSize(
  renderer.domElement.offsetWidth,
  renderer.domElement.offsetHeight
);
renderer.setPixelRatio(1);

renderer.outputEncoding = THREE.sRGBEncoding;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(world, camera));

const overlayEffect = new VOXELIZE.BlockOverlayEffect(world, camera);
overlayEffect.addOverlay("water", new THREE.Color("#5F9DF7"), 0.05);

composer.addPass(
  new EffectPass(
    camera,
    new SMAAEffect({}),
    overlayEffect
    // new PixelationEffect(6)
  )
);

const lightShined = new VOXELIZE.LightShined(world);
const shadows = new VOXELIZE.Shadows(world);

const character = createCharacter();
character.position.set(0, 10, -5);

const controls = new VOXELIZE.RigidControls(
  camera,
  renderer.domElement,
  world,
  {
    initialPosition: [0, 12, 0],
    flyForce: 400,
  }
);

controls.attachCharacter(character);
controls.connect(inputs, "in-game");

world.addChunkInitListener([0, 0], () => controls.teleportToTop(0, 0));

renderer.setTransparentSort(VOXELIZE.TRANSPARENT_SORT(controls.object));

const perspective = new VOXELIZE.Perspective(controls, world);
perspective.connect(inputs, "in-game");

const network = new VOXELIZE.Network();

window.addEventListener("resize", () => {
  const width = window.innerWidth as number;
  const height = window.innerHeight as number;

  renderer.setSize(width, height);
  renderer.pixelRatio = window.devicePixelRatio;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
});

controls.on("lock", () => {
  inputs.setNamespace("in-game");
});

controls.on("unlock", () => {
  inputs.setNamespace("menu");
});

const voxelInteract = new VOXELIZE.VoxelInteract(controls.object, world, {
  highlightType: "outline",
  highlightColor: new THREE.Color("#000"),
  highlightOpacity: 0.5,
  inverseDirection: true,
});
world.add(voxelInteract);

const debug = new VOXELIZE.Debug(document.body, {
  dataStyles: {
    top: "unset",
    bottom: "10px",
    left: "10px",
  },
});

const gui = new GUI();
gui.domElement.style.top = "10px";

inputs.bind(
  "t",
  () => {
    controls.unlock(() => {
      inputs.setNamespace("chat");
    });
  },
  "in-game"
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
  }
);

// let hand = "glass";
// let radius = 1;
// let circular = true;

// const bulkDestroy = () => {
//   if (!voxelInteract.target) return;

//   const [vx, vy, vz] = voxelInteract.target;

//   const updates: VOXELIZE.BlockUpdate[] = [];

//   for (let x = -radius; x <= radius; x++) {
//     for (let y = -radius; y <= radius; y++) {
//       for (let z = -radius; z <= radius; z++) {
//         if (circular && x ** 2 + y ** 2 + z ** 2 > radius ** 2 - 1)
//           continue;

//         updates.push({
//           vx: vx + x,
//           vy: vy + y,
//           vz: vz + z,
//           type: 0,
//         });
//       }
//     }
//   }

//   if (updates.length) controls.world.updateVoxels(updates);
// };

// const bulkPlace = () => {
//   if (!voxelInteract.potential) return;

//   const {
//     voxel: [vx, vy, vz],
//     rotation,
//     yRotation,
//   } = voxelInteract.potential;

//   const updates: VOXELIZE.BlockUpdate[] = [];
//   const block = controls.world.getBlockByName(hand);

//   for (let x = -radius; x <= radius; x++) {
//     for (let y = -radius; y <= radius; y++) {
//       for (let z = -radius; z <= radius; z++) {
//         if (circular && x ** 2 + y ** 2 + z ** 2 > radius ** 2 - 1)
//           continue;

//         updates.push({
//           vx: vx + x,
//           vy: vy + y,
//           vz: vz + z,
//           type: block.id,
//           rotation,
//           yRotation,
//         });
//       }
//     }
//   }

//   if (updates.length) controls.world.updateVoxels(updates);
// };

// inputs.scroll(
//   () => (radius = Math.min(100, radius + 1)),
//   () => (radius = Math.max(1, radius - 1)),
//   "in-game"
// );

// inputs.bind(
//   "b",
//   () => {
//     inputs.remap("t", "c", { occasion: "keyup" });
//   },
//   "in-game",
//   { identifier: "BRUH" }
// );

const peers = new VOXELIZE.Peers<VOXELIZE.Character>(controls.object);

peers.createPeer = createCharacter;

peers.setOwnPeer(character);

peers.onPeerUpdate = (object, data, info) => {
  object.set(data.position, data.direction);
  object.username = info.username;
};

world.add(peers);

VOXELIZE.ColorText.SPLITTER = "$";

// inputs.bind(
//   "o",
//   () => {
//     console.log(controls.object.position);
//   },
//   "in-game"
// );

inputs.bind(
  "g",
  () => {
    controls.toggleGhostMode();
  },
  "in-game"
);

inputs.bind(
  "enter",
  () => {
    controls.lock();
  },
  "chat"
);

inputs.bind("f", controls.toggleFly, "in-game");

inputs.bind("j", debug.toggle, "*");

// inputs.bind("l", () => {
//   network.action("create_world", "new_world");
// });

debug.registerDisplay("Position", controls, "voxel");

debug.registerDisplay("Time", () => {
  return `${Math.floor(
    (world.time / world.params.timePerDay) * 100
  )}% (${world.time.toFixed(2)})`;
});

debug.registerDisplay("Sunlight", () => {
  return world.getSunlightAt(...controls.voxel);
});

debug.registerDisplay("Voxel Stage", () => {
  return world.getVoxelStageAt(...controls.voxel);
});

debug.registerDisplay("Chunks to Request", world.chunks.toRequest, "length");
debug.registerDisplay("Chunks Requested", world.chunks.requested, "size");
debug.registerDisplay("Chunks to Process", world.chunks.toProcess, "length");
debug.registerDisplay("Chunks Loaded", world.chunks.loaded, "size");

["Red", "Green", "Blue"].forEach((color) => {
  debug.registerDisplay(`${color} Light`, () => {
    return world.getTorchLightAt(...controls.voxel, color.toUpperCase() as any);
  });
});

inputs.bind("p", () => {
  voxelInteract.toggle();
});

const entities = new VOXELIZE.Entities();

entities.setClass("box", Box);

world.add(entities);

const method = new VOXELIZE.Method();

// inputs.bind("m", () => {
//   method.call("test", {
//     test: "Hello World",
//   });
// });

inputs.bind("z", () => {
  method.call("spawn", {
    position: controls.object.position.toArray(),
  });
});

const events = new VOXELIZE.Events();

events.on("test2", (payload) => {
  console.log("test2 event:", payload);
});

events.on("test1", (payload) => {
  console.log("test1 event:", payload);
});

inputs.bind("n", () => {
  events.emit("test2", {
    test: "Hello World",
  });
});

inputs.bind("b", () => {
  events.emitMany([
    {
      name: "test1",
      payload: {
        test: "Hello World",
      },
    },
    {
      name: "test2",
      payload: {
        test: "Hello World",
      },
    },
  ]);
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

inputs.bind("m", map.toggle);

inputs.bind("escape", () => {
  map.setVisible(false);
});

network
  .register(chat)
  .register(entities)
  .register(world)
  .register(method)
  .register(events)
  .register(peers);

const HOTBAR_CONTENT = [1, 5, 20, 40, 43, 45, 300, 400, 500, 150];

// let isLoading = true;
// const loadingFade = 500;
const loading = document.getElementById("loading") as HTMLDivElement;
loading.style.display = "none";
// const loadingBar = document.getElementById(
//   "loading-bar-inner"
// ) as HTMLDivElement;
// loading.style.transition = `${loadingFade}ms opacity ease`;

const RANDOM_TELEPORT_WIDTH = 1000000;
inputs.bind("]", () => {
  controls.teleportToTop(
    Math.random() * RANDOM_TELEPORT_WIDTH,
    Math.random() * RANDOM_TELEPORT_WIDTH
  );
});

const start = async () => {
  const animate = () => {
    requestAnimationFrame(animate);

    // if (isLoading) {
    //   const supposedCount = world.renderRadius * world.renderRadius * 3;
    //   const loadProgress = (world.chunks.loaded.size / supposedCount) * 100;
    //   loadingBar.style.width = `${loadProgress}%`;

    //   if (loadProgress >= 100) {
    //     loading.style.opacity = "0";
    //     isLoading = false;
    //     setTimeout(() => (loading.style.display = "none"), loadingFade);
    //   }
    // }

    network.sync();

    if (world.isInitialized) {
      peers.update();
      controls.update();

      const inWater =
        world.getBlockAt(
          ...camera.getWorldPosition(new THREE.Vector3()).toArray()
        )?.name === "Water";
      const fogNear = inWater
        ? 0.1 * world.params.chunkSize * world.renderRadius
        : 0.7 * world.params.chunkSize * world.renderRadius;
      const fogFar = inWater
        ? 0.8 * world.params.chunkSize * world.renderRadius
        : world.params.chunkSize * world.renderRadius;
      const fogColor = inWater
        ? new THREE.Color("#5F9DF7")
        : new THREE.Color("#B1CCFD");

      world.chunks.uniforms.fogNear.value = THREE.MathUtils.lerp(
        world.chunks.uniforms.fogNear.value,
        fogNear,
        0.08
      );

      world.chunks.uniforms.fogFar.value = THREE.MathUtils.lerp(
        world.chunks.uniforms.fogFar.value,
        fogFar,
        0.08
      );

      world.chunks.uniforms.fogColor.value.lerp(fogColor, 0.08);

      // clouds.update(controls.object.position);
      // sky.update(controls.object.position);
      world.update(
        controls.object.position,
        camera.getWorldDirection(new THREE.Vector3())
      );
      map.update(
        controls.object.position,
        camera.getWorldDirection(new THREE.Vector3())
      );

      network.flush();

      perspective.update();
      shadows.update();
      debug.update();
      lightShined.update();
      voxelInteract.update();
    }

    composer.render();
  };

  animate();

  await network.connect(BACKEND_SERVER, { secret: "test" });
  await network.join(currentWorldName);
  await world.initialize();
  await setupWorld(world);

  world.renderRadius = 8;

  gui
    .add({ world: currentWorldName }, "world", ["terrain", "main", "flat"])
    .onChange((worldName: string) => {
      localStorage.setItem(VOXELIZE_LOCALSTORAGE_KEY, worldName);
      window.location.reload();
    });

  gui.add(world, "renderRadius", 3, 20, 1);
  gui.add(map, "dimension", 1, 10, 0.1);
  gui.add(world, "time", 0, world.params.timePerDay, 0.01);
  gui.add(voxelInteract.params, "ignoreFluids");

  const bar = new VOXELIZE.ItemSlots({
    verticalCount: 1,
    horizontalCount: HOTBAR_CONTENT.length,
    wrapperStyles: {
      top: "0",
      left: "0",
    },
  });
  document.body.appendChild(bar.element);

  // debug.registerDisplay("Active Voxels", async () => {
  //   const data = await fetch(`${BACKEND_SERVER}info`);
  //   const json = await data.json();
  //   return json.worlds.terrain.chunks.active_voxels;
  // });

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

  debug.registerDisplay("Concurrent WebWorkers", () => {
    return VOXELIZE.WorkerPool.WORKING_COUNT;
  });

  HOTBAR_CONTENT.forEach((id, index) => {
    const mesh = world.makeBlockMesh(id, { material: "standard" });
    const slot = bar.getSlot(0, index);
    slot.setObject(mesh);

    if (id === 500) {
      slot.setPerspective("pz");
    }

    slot.setContent(id);
  });

  ["1", "2", "3", "4", "5", "6", "7", "8", "9"].forEach((key) => {
    inputs.bind(
      key,
      () => {
        const index = parseInt(key);
        bar.setFocused(0, index - 1);
      },
      "in-game"
    );
  });

  inputs.click(
    "left",
    () => {
      const { target } = voxelInteract;
      if (!target) return;
      world.updateVoxel(...target, 0);
    },
    "in-game"
  );

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
    "in-game"
  );

  inputs.click(
    "right",
    () => {
      if (!voxelInteract.potential) return;
      const {
        rotation,
        yRotation,
        voxel: [vx, vy, vz],
      } = voxelInteract.potential;
      const slot = bar.getFocused();
      const id = slot.content;
      if (!id) return;

      const { aabbs } = world.getBlockById(id);
      if (
        aabbs.find((aabb) =>
          aabb.clone().translate([vx, vy, vz]).intersects(controls.body.aabb)
        )
      )
        return;

      world.updateVoxel(vx, vy, vz, id, rotation, yRotation);
    },
    "in-game"
  );

  bar.connect(inputs);
};

start();
