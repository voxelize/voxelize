// The in-world client: renders the world, sends intents, shows results.
// Every change to the world or the inventory is decided by the server; the
// client only predicts its own movement and shows progress.

import * as VOXELIZE from "@voxelize/core";
import "@voxelize/core/styles.css";
import * as THREE from "three";

import { Content, isUsableBlock, miningMillis } from "./content";
import { LandPanel, type LandHere } from "./land";
import { MarketPanel } from "./market";
import { StallPanel, type StallView } from "./stall";
import { BlueprintPanel } from "./blueprints";
import { nearest, TradePanel, type TradeView } from "./trade";
import { DropsView } from "./drops";
import { Sfx } from "./audio";
import { MobInfo, MobsView } from "./mobs-view";
import { loadSettings, Settings, settingsPanel } from "./settings";
import { isTouchDevice, mountTouchControls } from "./touch";
import { Hud, InventorySnapshot, Vitals, VitalsHud } from "./hud";
import { textureCanvas } from "./textures";
import { WindowState, WindowUi } from "./window-ui";

type ResultEvent = { intent: string; ok: boolean; code?: string; voxel?: [number, number, number] };

/** Session key naming the engine world this tab is in (the server tells
 * the client where to go; the overworld is "main"). */
const WORLD_KEY = "platform.world";
const storedWorld = (() => {
  try {
    return sessionStorage.getItem(WORLD_KEY);
  } catch {
    return null;
  }
})();
const WORLD = storedWorld && /^[a-z0-9_]{1,64}$/.test(storedWorld) ? storedWorld : "main";
const UNDERWORLD = WORLD.endsWith("_underworld");
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
  not_hungry: "You are not hungry",
  dead: "You are dead",
  needs_support: "That cannot stand there",
  cannot_use: "Nothing happens",
  too_fast: "",
  not_loaded: "That area is still loading",
  land_protected: "This land is protected",
  market_unavailable: "The market is closed on this server",
  survival_only: "Only survival goods can be sold",
  bad_listing: "Check the price, buyout and duration",
  not_owner: "That belongs to someone else",
  busy: "A sale is still being paid",
  bad_blueprint: "That is not a blueprint that can be captured or built",
  creative_only: "Only in creative worlds",
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

  // Our own sky palette; the underworld is a sealed cavern with a smoky
  // red void instead of a sky.
  if (UNDERWORLD) {
    const ember = { top: "#1a0806", middle: "#3a120a", bottom: "#120403" };
    world.sky.setShadingPhases([
      { name: "ember", color: ember, skyOffset: 0, voidOffset: 0.6, start: 0 },
      { name: "ember-late", color: ember, skyOffset: 0, voidOffset: 0.6, start: 0.5 },
    ]);
  } else world.sky.setShadingPhases([
    { name: "dawn", color: { top: "#5d7cc0", middle: "#d9875f", bottom: "#1d1f24" }, skyOffset: 0.05, voidOffset: 0.6, start: 0.2 },
    { name: "day", color: { top: "#4f8fe8", middle: "#a9cdf5", bottom: "#1d1f24" }, skyOffset: 0, voidOffset: 0.6, start: 0.26 },
    { name: "dusk", color: { top: "#5a4f8a", middle: "#e8784a", bottom: "#1d1f24" }, skyOffset: 0.05, voidOffset: 0.6, start: 0.7 },
    { name: "night", color: { top: "#04060c", middle: "#0b1020", bottom: "#000000" }, skyOffset: 0.1, voidOffset: 0.6, start: 0.76 },
  ]);
  if (!UNDERWORLD) {
    world.sky.paint("bottom", VOXELIZE.artFunctions.drawSun());
    world.sky.paint("top", VOXELIZE.artFunctions.drawStars());
    world.sky.paint("top", VOXELIZE.artFunctions.drawMoon());
  }

  const inputs = new VOXELIZE.Inputs<"in-game" | "menu">();
  const touch = isTouchDevice();
  const controlOptions = { initialPosition: [0, 120, 0] as VOXELIZE.Coords3, flyForce: 120 };
  const controls = touch
    ? new VOXELIZE.MobileRigidControls(camera, renderer.domElement, world, controlOptions)
    : new VOXELIZE.RigidControls(camera, renderer.domElement, world, controlOptions);
  controls.connect(inputs, "in-game");

  // ---- settings and sound ----------------------------------------------------

  const sfx = new Sfx();
  const applySettings = (s: Settings) => {
    controls.options.sensitivity = s.sensitivity;
    controls.options.invertY = s.invertY;
    camera.fov = s.fov;
    camera.updateProjectionMatrix();
    world.renderRadius = s.renderDistance;
    document.documentElement.style.setProperty("--ui-scale", String(s.uiScale));
    sfx.setVolume(s.volume);
  };
  const settings = loadSettings();
  const settingsEl = settingsPanel(settings, applySettings);
  const gear = document.createElement("button");
  gear.id = "settings-button";
  gear.type = "button";
  gear.textContent = "⚙";
  gear.setAttribute("aria-label", "Settings");
  gear.addEventListener("click", () => {
    settingsEl.hidden = !settingsEl.hidden;
    if (!settingsEl.hidden) controls.unlock();
  });
  document.body.append(gear);

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

  let lastMinedMaterial = "soil";
  let mining: { voxel: VOXELIZE.Coords3; started: number; total: number; finishing: boolean } | null = null;
  let leftDown = false;
  let realm = "survival";

  events.on<InventorySnapshot>("platform.inventory", (snapshot) => {
    if (!snapshot) return;
    realm = snapshot.realm;
    hud.setInventory(snapshot);
  });

  const materialAt = (voxel?: [number, number, number]) =>
    voxel ? content.blocksById.get(world.getVoxelAt(...voxel))?.material ?? "soil" : "soil";
  events.on<ResultEvent>("platform.result", (result) => {
    if (!result) return;
    if (result.ok) {
      if (result.intent === "mine.finish") sfx.play("break", lastMinedMaterial);
      if (result.intent === "build.place") sfx.play("place", materialAt(result.voxel));
      if (result.intent === "attack") sfx.play("hit");
      if (result.intent === "eat") sfx.play("eat");
      if (result.intent === "use") sfx.play("dig", "soil");
    }
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
  });

  const vitalsHud = new VitalsHud();
  let lastHealth = 20;
  events.on<Vitals>("platform.vitals", (vitals) => {
    if (!vitals) return;
    if (vitals.health < lastHealth) sfx.play("hurt");
    lastHealth = vitals.health;
    vitalsHud.set(vitals);
    if (vitals.dead) {
      mining = null;
      controls.unlock();
    }
  });
  vitalsHud.onRespawn = () => method.call("platform.respawn", {});
  // The server places the player: where they left, or at a portal on
  // arrival. Feet cell coordinates; waits for the chunk to exist.
  let pendingFeet: [number, number, number] | null = null;
  const placeFeet = ([x, y, z]: [number, number, number]) => {
    const [cx, cz] = VOXELIZE.ChunkUtils.mapVoxelToChunk([x, 0, z], world.options.chunkSize);
    const go = () => controls.teleport(x, y - 1, z);
    if (world.getChunkByCoords(cx, cz)?.isReady) go();
    else world.addChunkInitListener([cx, cz], go);
  };
  events.on<{ feet: [number, number, number] }>("platform.teleport", ({ feet }) => {
    if (world.isInitialized) placeFeet(feet);
    else pendingFeet = feet;
  });
  // Land: a notice when entering someone's land, and the panel (L).
  const landPanel = new LandPanel({
    world: "main",
    dimension: UNDERWORLD ? "underworld" : "overworld",
    position: () => controls.object.position,
    notify: (text) => hud.toast(text),
  });
  events.on<{ land: LandHere }>("platform.land", ({ land }) => {
    landPanel.setHere(land);
    hud.toast(land ? `${land.name || "Land"} — ${land.owner.name || "owned"}` : "Wilderness");
  });
  addEventListener("keydown", (event) => {
    if (event.code !== "KeyL" || (event.target as HTMLElement)?.tagName === "INPUT") return;
    landPanel.toggle();
    if (landPanel.isOpen) controls.unlock();
  });

  // Market (M): selling goes through the game server, the rest to the API.
  const marketPanel = new MarketPanel({
    world: "main",
    content,
    inventory: () => hud.inventory,
    sell: (payload) => method.call("platform.market.list", payload),
    deliver: (contract, slot, count) => method.call("platform.contract.deliver", { contract, slot, count }),
    notify: (text) => hud.toast(text),
  });
  const stallPanel = new StallPanel({
    itemName: (key) => (key ? content.itemsByKey.get(key)?.name ?? key : "?"),
    buy: (at, slot) => method.call("platform.stall.buy", { at, slot }),
    price: (at, slot, price) => method.call("platform.stall.price", { at, slot, price }),
    notify: (text) => hud.toast(text),
  });
  events.on<StallView>("platform.stall", (view) => {
    stallPanel.show(view);
    controls.unlock();
  });
  const blueprintPanel = new BlueprintPanel({
    world: "main",
    content,
    target: () => (interact.target ? ([...interact.target] as [number, number, number]) : null),
    placeAt: () => (interact.potential ? ([...interact.potential.voxel] as [number, number, number]) : null),
    capture: (min, max, name) => method.call("platform.blueprint.capture", { min, max, name }),
    build: (id, at) => method.call("platform.blueprint.build", { id, at }),
    notify: (text) => hud.toast(text),
  });
  addEventListener("keydown", (event) => {
    if (event.code !== "KeyB" || (event.target as HTMLElement)?.tagName === "INPUT") return;
    blueprintPanel.toggle();
    if (blueprintPanel.isOpen) controls.unlock();
  });
  const tradePanel = new TradePanel({
    itemName: (key) => (key ? content.itemsByKey.get(key)?.name ?? key : "?"),
    heldSlot: () => {
      const slot = hud.inventory.selected;
      const s = hud.inventory.slots[slot];
      return s ? { slot, count: s.count } : null;
    },
    call: (intent, payload) => method.call(intent, payload),
    notify: (text) => hud.toast(text),
  });
  events.on<{ invite?: { from: string; name: string }; trade?: TradeView | null; ended?: string; refused?: string; received?: unknown }>(
    "platform.trade",
    (e) => {
      if (e.invite) {
        tradePanel.invite = e.invite;
        hud.toast(`${e.invite.name} wants to trade: press Y to accept`);
      }
      if (e.trade !== undefined) {
        tradePanel.show(e.trade);
        if (e.trade) controls.unlock();
      }
      if (e.ended) hud.toast(e.ended === "done" ? "Trade complete" : "Trade cancelled");
      if (e.refused) hud.toast(`Trade not paid: ${e.refused.replace(/_/g, " ")}`);
    },
  );
  addEventListener("keydown", (event) => {
    if ((event.target as HTMLElement)?.tagName === "INPUT") return;
    if (event.code === "KeyT") {
      const me = controls.object.position;
      const others = [...players.map.entries()].map(([id, c]) => [id, c.position] as [string, { x: number; y: number; z: number }]);
      const partner = nearest(me, others);
      if (!partner) return hud.toast("Stand next to the player you want to trade with");
      method.call("platform.trade.request", { player: partner });
    } else if (event.code === "KeyY" && tradePanel.invite) {
      method.call("platform.trade.accept", { player: tradePanel.invite.from });
      tradePanel.invite = null;
    }
  });
  type MarketNotice = {
    blueprint?: { stored?: string; built?: string; refused?: string; blocks?: number };
    bought?: { item: string; count: number; price: number };
    sold?: { item: string; count: number; price: number };
    refused?: { code: string; item: string; count: number };
    listed?: { item: string; count: number };
    rejected?: { code: string; item: string; count: number };
    received?: { item: string; count: number; reason: string };
    waiting?: { item: string; count: number };
  };
  const itemName = (key: string) => content.itemsByKey.get(key)?.name ?? key;
  events.on<MarketNotice>("platform.market", (n) => {
    if (n.listed) hud.toast(`Listed ${n.listed.count} × ${itemName(n.listed.item)}`);
    if (n.rejected) hud.toast(`Not listed (${n.rejected.code}); ${itemName(n.rejected.item)} returned`);
    if ((n as { fulfilled?: { count: number; item: string } }).fulfilled) hud.toast("Contract fulfilled: the reward is yours");
    if (n.received) hud.toast(`Received ${n.received.count} × ${itemName(n.received.item)}`);
    if (n.waiting) hud.toast(`A delivery of ${itemName(n.waiting.item)} waits for room in your inventory`);
    if (n.blueprint?.stored) hud.toast(`Blueprint saved (${n.blueprint.blocks} blocks)`);
    if (n.blueprint?.built) hud.toast(`Built ${n.blueprint.blocks} blocks from the blueprint`);
    if (n.blueprint?.refused) hud.toast(MESSAGES[n.blueprint.refused] || `Blueprint: ${n.blueprint.refused.replace(/_/g, " ")}`);
    if (n.blueprint) blueprintPanel.refresh();
    if (n.bought) hud.toast(`Bought ${n.bought.count} × ${itemName(n.bought.item)} for ${n.bought.price} CRN`);
    if (n.sold) hud.toast(`Your stall sold ${n.sold.count} × ${itemName(n.sold.item)} for ${n.sold.price} CRN`);
    if (n.refused) hud.toast(`Not bought: ${n.refused.code.replace("_", " ")}`);
    marketPanel.refresh();
  });
  addEventListener("keydown", (event) => {
    if (event.code !== "KeyM" || (event.target as HTMLElement)?.tagName === "INPUT") return;
    marketPanel.toggle();
    if (marketPanel.isOpen) controls.unlock();
  });

  // Travel to another dimension: this tab joins that world from now on.
  events.on<{ world: string }>("platform.travel", ({ world: target }) => {
    if (!/^[a-z0-9_]{1,64}$/.test(target) || target === WORLD) return;
    hud.setStatus("Travelling…");
    try {
      sessionStorage.setItem(WORLD_KEY, target);
    } catch {
      return;
    }
    location.reload();
  });
  events.on<{ x: number; z: number }>("platform.respawn", (spawn) => {
    if (!spawn) return;
    controls.teleportToTop(spawn.x, spawn.z, 2);
    controls.lock();
  });

  // ---- windows: inventory screen, workbench, furnace, chest ---------------

  const windowUi = new WindowUi(content, hud, {
    click: (slot, click) => method.call("platform.window.click", { slot, click }),
    drag: (slots, oneEach) => method.call("platform.window.drag", { slots, oneEach }),
    fill: (recipe, max) => method.call("platform.window.fill", { recipe, max }),
    close: () => closeWindow(),
    creative: (item) => method.call("platform.inventory.creative", { slot: hud.inventory.selected, item }),
  });
  const closeWindow = () => {
    windowUi.wantPlayer = false;
    windowUi.hide();
    method.call("platform.window.close", {});
  };
  const openWindow = (voxel?: VOXELIZE.Coords3) => {
    windowUi.wantPlayer = !voxel;
    method.call("platform.window.open", voxel ? { voxel } : {});
    controls.unlock();
  };
  events.on<WindowState>("platform.window", (state) => {
    if (!state) return;
    windowUi.set(state);
  });

  const mobs = new MobsView(content);
  world.add(mobs.group);
  events.on<{ mobs: MobInfo[] }>("platform.mobs", (payload) => payload && mobs.set(payload.mobs));

  const drops = new DropsView(content, hud);
  world.add(drops.group);
  events.on<{ items: { id: number; item: number; count: number; p: [number, number, number] }[] }>(
    "platform.drops",
    (payload) => payload && drops.set(payload.items),
  );
  events.on<{ items: [number, number][] }>("platform.pickup", (payload) => {
    if (!payload) return;
    sfx.play("pickup");
    for (const [item, count] of payload.items) {
      hud.toast(`+${count} ${content.itemsById.get(item)?.name ?? "item"}`);
    }
  });

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
    lastMinedMaterial = block.material ?? "soil";
    mining = { voxel: [...target] as VOXELIZE.Coords3, started: performance.now(), total, finishing: false };
    method.call("platform.mine.start", { voxel: target });
  };

  // A creature in front of the block under the crosshair takes the action.
  const mobInFront = () => {
    const mob = mobs.pick(camera, 4.5);
    const blockDistance = interact.target
      ? camera.position.distanceTo(new THREE.Vector3(...interact.target).addScalar(0.5))
      : Infinity;
    return mob && mob.distance < blockDistance ? mob : null;
  };
  const primary = (down: boolean) => {
    if (!down) {
      leftDown = false;
      mining = null;
      return;
    }
    if (vitalsHud.dead) return;
    const mob = mobInFront();
    if (mob) {
      method.call("platform.attack", { mob: mob.id });
      return;
    }
    leftDown = true;
    startMining();
  };
  const secondary = (sneaking: boolean) => {
    if (vitalsHud.dead) return;
    const mob = mobInFront();
    if (mob) {
      method.call("platform.interact", { mob: mob.id });
      return;
    }
    secondaryOnBlock(sneaking);
  };
  canvas.addEventListener("mousedown", (event) => {
    if (!controls.isLocked || touch) return;
    if (event.button === 0) primary(true);
    else if (event.button === 2) secondary(event.shiftKey);
  });
  // Using a workbench, furnace or chest opens it (sneak to place against
  // it); a hoe tills soil; food in hand is eaten; anything else is placed.
  const secondaryOnBlock = (sneaking: boolean) => {
    const target = interact.target;
    const targetDef = target ? content.blocksById.get(world.getVoxelAt(...target)) : undefined;
    const targetKey = targetDef?.key;
    const held = hud.heldItem();
    if (target && !sneaking && targetKey && ["crafting_table", "furnace", "chest", "trade_stall"].includes(targetKey)) {
      openWindow([...target] as VOXELIZE.Coords3);
    } else if (target && !sneaking && isUsableBlock(targetDef)) {
      method.call("platform.use", { voxel: target });
    } else if (held?.tool?.kind === "hoe" && target && ["dirt", "turf"].includes(targetKey ?? "")) {
      method.call("platform.use", { voxel: target });
    } else if (held?.type === "food") {
      method.call("platform.eat", {});
    } else if (interact.potential) {
      const { voxel, rotation, yRotation4 } = interact.potential;
      method.call("platform.build.place", { voxel, rotation, yRotation: yRotation4 });
    }
  };
  addEventListener("mouseup", (event) => {
    if (event.button === 0) primary(false);
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("click", () => {
    if (!controls.isLocked && !windowUi.isOpen && !vitalsHud.dead) controls.lock();
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
  if (touch) {
    const mobile = controls as VOXELIZE.MobileRigidControls;
    mountTouchControls({
      move: (x, y) => mobile.setMovementVector(x, y),
      look: (dx, dy) => mobile.setLookDirection(dx, dy),
      jump: (down) => (mobile.movements.up = down),
      crouch: (down) => (mobile.movements.down = down),
      sprint: (on) => (mobile.options.alwaysSprint = on),
      primary,
      secondary: () => secondary(false),
      inventory: () => (windowUi.isOpen ? closeWindow() : openWindow()),
      drop: () => method.call("platform.inventory.drop", { all: false }),
    });
    document.body.classList.add("touch");
  }
  inputs.bind("KeyF", () => {
    if (realm === "creative") controls.toggleFly();
    else hud.toast("Flight is for creative worlds");
  }, "in-game");
  addEventListener("keydown", (event) => {
    if ((event.target as HTMLElement)?.tagName === "INPUT" || vitalsHud.dead) return;
    if (event.code === "KeyE") {
      if (windowUi.isOpen) closeWindow();
      else openWindow();
    } else if (event.code === "Escape" && windowUi.isOpen) {
      closeWindow();
    } else if (event.code === "KeyQ" && controls.isLocked && !windowUi.isOpen) {
      method.call("platform.inventory.drop", { all: event.ctrlKey });
    }
  });

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

  applySettings(settings);
  if (pendingFeet) placeFeet(pendingFeet);
  else if (!UNDERWORLD) controls.teleportToTop(0, 0, 2);
  method.call("platform.inventory.get", {});
  hud.show();

  // ---- frame loop -----------------------------------------------------------

  const direction = new THREE.Vector3();
  const lastStep = controls.object.position.clone();
  let lastDigTick = 0;
  let lastStatus = 0;

  const frame = () => {
    requestAnimationFrame(frame);
    if (!world.isInitialized) return;

    controls.update();
    interact.update();
    camera.getWorldDirection(direction);
    world.update(controls.object.position, direction);
    players.update();
    drops.update(performance.now());
    mobs.update(performance.now());

    // Footsteps while walking on the ground.
    const pos = controls.object.position;
    const moved = Math.hypot(pos.x - lastStep.x, pos.z - lastStep.z);
    if (moved > 1.6 && Math.abs(pos.y - lastStep.y) < 0.6) {
      const below = content.blocksById.get(world.getVoxelAt(Math.floor(pos.x), Math.floor(pos.y - 1.5), Math.floor(pos.z)));
      if (below) sfx.play("step", below.material);
      lastStep.copy(pos);
    } else if (moved > 1.6) lastStep.copy(pos);

    if (mining) {
      if (Math.floor(performance.now() / 250) !== lastDigTick) {
        lastDigTick = Math.floor(performance.now() / 250);
        sfx.play("dig", lastMinedMaterial);
      }
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
