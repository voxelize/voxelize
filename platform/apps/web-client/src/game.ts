// The in-world client: renders the world, sends intents, shows results.
// Every change to the world or the inventory is decided by the server; the
// client only predicts its own movement and shows progress.

import * as VOXELIZE from "@voxelize/core";
import "@voxelize/core/styles.css";
import * as THREE from "three";

import { Content, miningMillis, RecipeDef } from "./content";
import { Hud, InventorySnapshot } from "./hud";
import { textureCanvas } from "./textures";

type ResultEvent = { intent: string; ok: boolean; code?: string; voxel?: [number, number, number] };

const WORLD = "main";
const FACE_ROLES: Record<string, "top" | "bottom" | "side"> = {
  py: "top",
  ny: "bottom",
  px: "side",
  nx: "side",
  pz: "side",
  nz: "side",
};

const MESSAGES: Record<string, string> = {
  out_of_reach: "Too far away",
  unbreakable: "This cannot be broken",
  inventory_full: "Inventory full",
  not_placeable: "Select a placeable block",
  slot_empty: "Nothing selected",
  occupied: "Something is already there",
  collides_with_player: "Someone is standing there",
  needs_workbench: "Stand near a workbench for this recipe",
  missing_ingredients: "Missing ingredients",
  not_loaded: "That area is still loading",
};

class Players extends VOXELIZE.Peers<VOXELIZE.Character> {
  createPeer = () => new VOXELIZE.Character();

  onPeerUpdate = (object: VOXELIZE.Character, data: { position: number[]; direction: number[] }) => {
    object.set(data.position as VOXELIZE.Coords3, data.direction as VOXELIZE.Coords3);
  };
}

export async function startGame(content: Content, getTicket: () => Promise<string>, hud: Hud) {
  const canvas = document.getElementById("main") as HTMLCanvasElement;

  const world = new VOXELIZE.World({ textureUnitDimension: 16 });
  const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 3000);
  camera.layers.enable(VOXELIZE.SCENE_OVERLAY_LAYER);
  const renderer = new THREE.WebGLRenderer({ canvas, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // Our own sky palette.
  world.sky.setShadingPhases([
    { name: "dawn", color: { top: "#5d7cc0", middle: "#d9875f", bottom: "#1d1f24" }, skyOffset: 0.05, voidOffset: 0.6, start: 0.2 },
    { name: "day", color: { top: "#4f8fe8", middle: "#a9cdf5", bottom: "#1d1f24" }, skyOffset: 0, voidOffset: 0.6, start: 0.26 },
    { name: "dusk", color: { top: "#5a4f8a", middle: "#e8784a", bottom: "#1d1f24" }, skyOffset: 0.05, voidOffset: 0.6, start: 0.7 },
    { name: "night", color: { top: "#04060c", middle: "#0b1020", bottom: "#000000" }, skyOffset: 0.1, voidOffset: 0.6, start: 0.76 },
  ]);
  world.sky.paint("bottom", VOXELIZE.artFunctions.drawSun());
  world.sky.paint("top", VOXELIZE.artFunctions.drawStars());
  world.sky.paint("top", VOXELIZE.artFunctions.drawMoon());

  const inputs = new VOXELIZE.Inputs<"in-game" | "menu">();
  const controls = new VOXELIZE.RigidControls(camera, renderer.domElement, world, {
    initialPosition: [0, 120, 0],
    flyForce: 120,
  });
  controls.connect(inputs, "in-game");

  const interact = new VOXELIZE.VoxelInteract(controls.object, world, {
    highlightType: "outline",
    highlightColor: new THREE.Color("#101010"),
    highlightOpacity: 0.6,
    inverseDirection: true,
    reachDistance: 6,
  });
  world.add(interact);

  const players = new Players(controls.object);
  world.add(players);

  const network = new VOXELIZE.Network();
  const method = new VOXELIZE.Method();
  const events = new VOXELIZE.Events();
  network.register(world).register(players).register(method).register(events).register(controls);

  // ---- server answers -------------------------------------------------------

  let mining: { voxel: VOXELIZE.Coords3; started: number; total: number; finishing: boolean } | null = null;
  let leftDown = false;
  let realm = "survival";

  events.on<InventorySnapshot>("platform.inventory", (snapshot) => {
    if (!snapshot) return;
    realm = snapshot.realm;
    hud.setInventory(snapshot);
  });

  events.on<ResultEvent>("platform.result", (result) => {
    if (!result) return;
    if (result.intent === "mine.finish") {
      if (result.ok || result.code !== "too_fast") mining = null;
      else if (mining) {
        mining.finishing = false;
        mining.total += 150;
      }
    }
    if (!result.ok && result.code && result.code !== "too_fast" && result.code !== "nothing_there") {
      hud.toast(MESSAGES[result.code] ?? result.code.replace(/_/g, " "));
    }
    if (result.ok && result.intent === "craft") hud.toast("Crafted");
  });

  hud.onCraft = (recipe: RecipeDef) => method.call("platform.craft", { grid: content.recipeGrid(recipe) });

  // ---- input ----------------------------------------------------------------

  const same = (a: VOXELIZE.Coords3, b: VOXELIZE.Coords3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

  const startMining = () => {
    const target = interact.target;
    if (!target) return;
    const block = content.blocksById.get(world.getVoxelAt(...target));
    if (!block) return;
    const total = realm === "creative" ? 0 : miningMillis(block, hud.heldItem());
    if (total === null) {
      hud.toast(MESSAGES.unbreakable);
      return;
    }
    mining = { voxel: [...target] as VOXELIZE.Coords3, started: performance.now(), total, finishing: false };
    method.call("platform.mine.start", { voxel: target });
  };

  canvas.addEventListener("mousedown", (event) => {
    if (!controls.isLocked) return;
    if (event.button === 0) {
      leftDown = true;
      startMining();
    } else if (event.button === 2 && interact.potential) {
      method.call("platform.build.place", { voxel: interact.potential.voxel });
    }
  });
  addEventListener("mouseup", (event) => {
    if (event.button === 0) {
      leftDown = false;
      mining = null;
    }
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("click", () => {
    if (!controls.isLocked && !hud.craftingOpen) controls.lock();
  });

  for (let i = 1; i <= 9; i++) {
    inputs.bind(
      `Digit${i}`,
      () => {
        method.call("platform.inventory.select", { slot: i - 1 });
      },
      "in-game",
    );
  }
  addEventListener("wheel", (event) => {
    if (!controls.isLocked) return;
    const next = (hud.inventory.selected + (event.deltaY > 0 ? 1 : 8)) % 9;
    method.call("platform.inventory.select", { slot: next });
  });
  inputs.bind("KeyF", () => {
    if (realm === "creative") controls.toggleFly();
    else hud.toast("Flight is for creative worlds");
  }, "in-game");
  addEventListener("keydown", (event) => {
    if (event.code !== "KeyC" || (event.target as HTMLElement)?.tagName === "INPUT") return;
    const open = !hud.craftingOpen;
    hud.toggleCrafting(open);
    if (open) controls.unlock();
  });
  document.getElementById("crafting-close")?.addEventListener("click", () => hud.toggleCrafting(false));

  // ---- connect --------------------------------------------------------------

  hud.setStatus("Connecting…");
  await network.connect(location.origin, { getTicket, reconnectTimeout: 3000 });
  await network.join(WORLD);
  await world.initialize();

  // Original procedural textures for every block face.
  for (const block of content.pack.blocks) {
    const engineBlock = world.getBlockByIdSafe(block.id);
    if (!engineBlock) continue;
    for (const face of engineBlock.faces) {
      const role = FACE_ROLES[face.name];
      const name = (role && block.texture[role]) || block.texture.all;
      const texture = new THREE.CanvasTexture(textureCanvas(name));
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.colorSpace = THREE.SRGBColorSpace;
      world.applyBlockTexture(block.id, face.name, texture);
    }
  }

  world.renderRadius = 6;
  controls.teleportToTop(0, 0, 2);
  method.call("platform.inventory.get", {});
  hud.show();

  // ---- frame loop -----------------------------------------------------------

  const direction = new THREE.Vector3();
  let lastStatus = 0;

  const frame = () => {
    requestAnimationFrame(frame);
    if (!world.isInitialized) return;

    controls.update();
    interact.update();
    camera.getWorldDirection(direction);
    world.update(controls.object.position, direction);
    players.update();

    if (mining) {
      const target = interact.target;
      if (!leftDown || !target || !same(target, mining.voxel)) {
        mining = null;
        if (leftDown && target) startMining();
      } else {
        const elapsed = performance.now() - mining.started;
        hud.setMining(mining.total === 0 ? 1 : elapsed / mining.total);
        if (elapsed >= mining.total && !mining.finishing) {
          mining.finishing = true;
          method.call("platform.mine.finish", { voxel: mining.voxel });
        }
      }
    }
    if (!mining) hud.setMining(null);

    const now = performance.now();
    if (now - lastStatus > 250) {
      lastStatus = now;
      const [x, y, z] = controls.voxel;
      const time = world.time / world.options.timePerDay;
      const clock = `${String(Math.floor(time * 24)).padStart(2, "0")}:${String(Math.floor((time * 1440) % 60)).padStart(2, "0")}`;
      hud.setStatus(`${x}, ${y}, ${z} · ${clock} · ${realm}`);
    }

    renderer.render(world, camera);
  };
  frame();
}
