import "./style.css";

// For official use, you should do `@voxelize/core/styles.css` instead.
import "@voxelize/core/styles.css";

import * as VOXELIZE from "@voxelize/core";
import { GUI } from "lil-gui";
import {
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
} from "postprocessing";
import * as THREE from "three";

import LolImage from "./assets/lol.png";
// import { Map } from "./map";
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

    shadows.add(this);
    lightShined.add(this);
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
  textureUnitDimension: 8,
});

const chat = new VOXELIZE.Chat();
const inputs = new VOXELIZE.Inputs<"menu" | "in-game" | "chat">();

const options = { pathVisible: false };

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

const camera = new THREE.PerspectiveCamera(
  90,
  window.innerWidth / window.innerHeight,
  0.1,
  5000
);

const renderer = new THREE.WebGLRenderer({
  canvas,
});
renderer.setSize(
  renderer.domElement.offsetWidth,
  renderer.domElement.offsetHeight
);
renderer.setPixelRatio(1);

renderer.outputColorSpace = THREE.SRGBColorSpace;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(world, camera));

const overlayEffect = new VOXELIZE.BlockOverlayEffect(world, camera);
overlayEffect.addOverlay("water", new THREE.Color("#5F9DF7"), 0.001);
composer.addPass(new EffectPass(camera, new SMAAEffect({}), overlayEffect));

const lightShined = new VOXELIZE.LightShined(world);
const shadows = new VOXELIZE.Shadows(world);

const character = createCharacter();

const controls = new VOXELIZE.RigidControls(
  camera,
  renderer.domElement,
  world,
  {
    initialPosition: [0, 82, 0],
    flyForce: 400,
    // stepHeight: 1,
  }
);

controls.attachCharacter(character);
controls.connect(inputs, "in-game");

world.add(character);

world.addChunkInitListener([0, 0], () => {
  controls.teleportToTop(0, 0);
});

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
  // potentialVisuals: true,
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
    (world.time / world.options.timePerDay) * 100
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

type BotData = {
  position: VOXELIZE.Coords3;
  rotation: [number, number, number, number];
  target: [VOXELIZE.TargetType, VOXELIZE.Coords3];
  path: {
    maxNodes: number;
    path: VOXELIZE.Coords3[];
  };
};

const botPaths = new THREE.Group();
const botCharacters = new Map<string, VOXELIZE.Character>();

world.add(botPaths);

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
    this.character.username = "$#B4D4FF$Ian's Bot";

    // shadows.add(this.character);
    // lightShined.add(this.character);

    this.character.head.paint("all", new THREE.Color("#F99417"));
    this.character.head.paint("front", new THREE.Color("#F4CE14"));

    this.character.scale.set(0.5, 0.5, 0.5);
    this.character.position.y += this.character.totalHeight / 4;
    this.add(this.character);

    lightShined.add(this.character);

    botPaths.add(this.path);

    botCharacters.set(id, this.character);
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
    botCharacters.delete(this.entityId);
  };

  onUpdate = (data: BotData) => {
    const { position, target } = data;

    const adjustedPosition = this.adjustPosition(position);

    const origin = this.character.position;

    const [tx, ty, tz] = target[1] || [0, 0, 0];
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
}

entities.setClass("bot", Bot);
entities.setClass("box", Box);

world.add(entities);

const method = new VOXELIZE.Method();

inputs.bind("v", () => {
  method.call("time", {
    time: world.options.timePerDay / 2,
  });
});

inputs.bind("z", () => {
  method.call("spawn-bot", {
    position: controls.object.position.toArray(),
  });
});

const events = new VOXELIZE.Events();

events.on("test", (payload) => {
  console.log("test event:", payload);
});

inputs.bind("n", () => {
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

// const map = new Map(world, document.getElementById("biomes") || document.body);

// inputs.bind("m", map.toggle);

// inputs.bind("escape", () => {
//   map.setVisible(false);
// });

network
  .register(chat)
  .register(entities)
  .register(world)
  .register(method)
  .register(events)
  .register(peers)
  .register(controls);

const HOTBAR_CONTENT = [400, 1, 5, 20, 50000, 13131, 45, 300, 1000, 500];

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

world.addBlockEntityUpdateListener((data) => {
  if (data.operation === "UPDATE" || data.operation === "CREATE") {
    // console.log("data", data);
    const color = data.newValue.color ?? [0, 0, 0];
    console.log("color", color, data.voxel);
    world.applyBlockTextureAt(
      "mushroom",
      "top-py-",
      new THREE.Color(...color),
      data.voxel
    );
  }
  // console.log(
  //   JSON.stringify(data.oldValue, null, 2),
  //   JSON.stringify(data.newValue, null, 2)
  // );
});

let frame: any;

const start = async () => {
  let isFocused = true;
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

  const update = () => {
    if (!world.isInitialized) return;

    peers.update();
    controls.update();

    const inWater =
      world.getBlockAt(
        ...camera.getWorldPosition(new THREE.Vector3()).toArray()
      )?.name === "Water";

    const fogNear = inWater
      ? 0.1 * world.options.chunkSize * world.renderRadius
      : 0.7 * world.options.chunkSize * world.renderRadius;
    const fogFar = inWater
      ? 0.8 * world.options.chunkSize * world.renderRadius
      : world.options.chunkSize * world.renderRadius;
    const fogColor = inWater
      ? new THREE.Color("#5F9DF7")
      : world.chunks.uniforms.fogColor.value;

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

    world.update(
      controls.object.position,
      camera.getWorldDirection(new THREE.Vector3())
    );

    perspective.update();
    shadows.update();
    debug.update();
    lightShined.update();
    voxelInteract.update();
    botCharacters.forEach((bot) => bot.update());
  };

  const animate = () => {
    frame = requestAnimationFrame(animate);
    if (isFocused) update();
    composer.render();
  };

  animate();

  await network.connect(BACKEND_SERVER, { secret: "test" });
  await network.join(currentWorldName);
  await world.initialize();
  await setupWorld(world);

  world.renderRadius = 8;

  gui
    .add({ world: currentWorldName }, "world", ["terrain", "flat"])
    .onChange((worldName: string) => {
      localStorage.setItem(VOXELIZE_LOCALSTORAGE_KEY, worldName);
      window.location.reload();
    });

  gui.add(world, "renderRadius", 3, 20, 1);
  // gui.add(map, "dimension", 1, 10, 0.1);
  gui.add(voxelInteract.options, "ignoreFluids");
  gui
    .add({ time: world.time }, "time", 0, world.options.timePerDay, 0.01)
    .onFinishChange((time: number) => {
      world.time = time;
    });
  gui.add(options, "pathVisible").onChange((value: boolean) => {
    options.pathVisible = value;
  });

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

  const hud = new VOXELIZE.Hud();

  hud.connect(inputs, "in-game");
  // controls.attachHud(hud);
  bar.onFocusChange((_, current) => {
    const mesh = world.makeBlockMesh(current.content, { material: "basic" });
    hud.setMesh(mesh, false);
  });

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

  // debug.registerDisplay("Build radius", () => {
  //   return radius;
  // });

  // debug.registerDisplay("# of triangles", () => {
  //   return renderer.info.render.triangles;
  // });

  // debug.registerDisplay("# of points", () => {
  //   return renderer.info.render.points;
  // });

  debug.registerDisplay("Concurrent WebWorkers", () => {
    return VOXELIZE.SharedWorkerPool.WORKING_COUNT;
  });

  debug.registerDisplay("Packet queue length", network, "packetQueueLength");

  HOTBAR_CONTENT.forEach((id, index) => {
    const slot = bar.getSlot(0, index);
    const mesh = world.makeBlockMesh(id, { material: "standard" });
    if (mesh) slot.setObject(mesh);

    if (id === 500) {
      slot.setPerspective("pz");
    }

    slot.setContent(id);
  });

  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].forEach((key) => {
    inputs.bind(
      key,
      () => {
        const index = key !== "0" ? parseInt(key) : 10;
        bar.setFocused(0, index - 1);
      },
      "in-game"
    );
  });

  let radius = 1;
  const maxRadius = 10;
  const minRadius = 1;
  const circular = true;

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

  inputs.scroll(
    () => (radius = Math.min(maxRadius, radius + 1)),
    () => (radius = Math.max(minRadius, radius - 1)),
    "in-game"
  );

  inputs.click("left", bulkDestroy, "in-game");

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
            aabb.clone().translate([vx, vy, vz]).intersects(controls.body.aabb)
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
    "in-game"
  );

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
    "in-game"
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
