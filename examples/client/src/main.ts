import "./style.css";

// For official use, use `@voxelize/client/styles.css` instead.
import "@voxelize/client/src/styles.css";

import * as BABYLON from "@babylonjs/core/Legacy/legacy";
import {
  DOMUtils,
  Debug,
  InputManager,
  Network,
  VoxelPhysicsPlugin,
  World,
} from "@voxelize/client";
import { GUI } from "lil-gui";

import { Map } from "./map";

const BACKEND_SERVER_INSTANCE = new URL(window.location.href);

if (BACKEND_SERVER_INSTANCE.origin.includes("localhost")) {
  BACKEND_SERVER_INSTANCE.port = "4000";
}

const BACKEND_SERVER = BACKEND_SERVER_INSTANCE.toString();

const canvas = document.getElementById("main") as HTMLCanvasElement;

const engine = new BABYLON.Engine(canvas, true);

const scene = new BABYLON.Scene(engine);
scene.useOrderIndependentTransparency = true;

const camera = new BABYLON.ArcRotateCamera(
  "Camera",
  Math.PI / 2,
  Math.PI / 2,
  10,
  BABYLON.Vector3.Zero(),
  scene
);

// camera.attachControl(canvas, true);
camera.checkCollisions = true;
const num = 120;
camera.setPosition(new BABYLON.Vector3(0, num * 1.5, 0));

const light = new BABYLON.HemisphericLight(
  "light1",
  new BABYLON.Vector3(1, 1, 0),
  scene
);
light.intensity = 0.7;

const world = new World(engine, scene);

const inputs = new InputManager();

const network = new Network();

network.register(world);

const debug = new Debug(document.body);

debug.registerDisplay("to request", world.chunks.toRequest, "length");
debug.registerDisplay("requested", world.chunks.requested, "size");
debug.registerDisplay("to process", world.chunks.toProcess, "length");
debug.registerDisplay("loaded", world.chunks.loaded, "size");

const gui = new GUI();
DOMUtils.applyStyles(gui.domElement, {
  zIndex: "100000000",
  top: "10px",
  right: "10px",
});

// gui.add()

const center = new BABYLON.Vector3();

inputs.bind("w", () => {
  center.z -= 16;
});

inputs.bind("s", () => {
  center.z += 16;
});

inputs.bind("a", () => {
  center.x -= 16;
});

inputs.bind("d", () => {
  center.x += 16;
});

const map = new Map(world);

inputs.bind("m", map.toggle);

inputs.bind("escape", () => {
  map.setVisible(false);
});

inputs.bind("r", () => {
  center.set(
    (Math.random() - 0.5) * 1000000,
    (Math.random() - 0.5) * 1000000,
    (Math.random() - 0.5) * 1000000
  );
});

const start = async () => {
  await network.connect(BACKEND_SERVER, { secret: "test" });
  await network.join("world1");
  await world.init();

  scene.enablePhysics(null, new VoxelPhysicsPlugin(world));

  engine.runRenderLoop(() => {
    world.update(center);
    map.update(center);
    debug.update();
    network.flush();
    scene.render();
  });
};

window.addEventListener("resize", () => {
  engine.resize();
});
engine.resize();

start();
