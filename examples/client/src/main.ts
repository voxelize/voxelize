import "./style.css";

// For official use, use `@voxelize/client/styles.css` instead.
import "@voxelize/client/src/styles.css";

import * as VOXELIZE from "@voxelize/client";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass";
// import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { setupWorld } from "./core";
import { Map } from "./map";

const BACKEND_SERVER_INSTANCE = new URL(window.location.href);

if (BACKEND_SERVER_INSTANCE.origin.includes("localhost")) {
  BACKEND_SERVER_INSTANCE.port = "4000";
}

const BACKEND_SERVER = BACKEND_SERVER_INSTANCE.toString();

const canvas = document.getElementById("main") as HTMLCanvasElement;

const world = new VOXELIZE.World({
  textureDimension: 16,
});

const renderer = new THREE.WebGLRenderer({
  canvas,
});
renderer.outputEncoding = THREE.sRGBEncoding;

const camera = new THREE.PerspectiveCamera(
  90,
  window.innerWidth / window.innerHeight,
  0.1,
  5000
);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(world, camera));

// const pass = new SMAAPass(
//   window.innerWidth * renderer.getPixelRatio(),
//   window.innerHeight * renderer.getPixelRatio()
// );
// // @ts-ignore
// pass.uniformsGroups = [];
// composer.addPass(pass);

const inputs = new VOXELIZE.Inputs<"menu" | "in-game" | "chat">();

const controls = new VOXELIZE.RigidControls(camera, canvas, world);

renderer.setTransparentSort(VOXELIZE.TRANSPARENT_SORT(controls.object));
controls.connect(inputs, "in-game");

inputs.on("namespace", (newNamespace) => {
  console.log("namespace", newNamespace);
});

controls.on("lock", () => {
  inputs.setNamespace("in-game");
});

controls.on("unlock", () => {
  inputs.setNamespace("menu");
});

// const orbit = new OrbitControls(camera, canvas);

const map = new Map(world);
inputs.bind("m", map.toggle);
inputs.bind("escape", () => {
  map.setVisible(false);
});

const sky = new VOXELIZE.Sky();
const clouds = new VOXELIZE.Clouds();

world.add(sky, clouds);

const debug = new VOXELIZE.Debug();
debug.registerDisplay("to request", world.chunks.toRequest, "length");
debug.registerDisplay("requested", world.chunks.requested, "size");
debug.registerDisplay("to process", world.chunks.toProcess, "length");
debug.registerDisplay("loaded", world.chunks.loaded, "size");

const network = new VOXELIZE.Network();
network.register(world);

const start = async () => {
  await network.connect(BACKEND_SERVER, { secret: "test" });
  await network.join("world1");

  await world.init();
  await setupWorld(world);

  inputs.bind("g", controls.toggleGhostMode);

  const render = () => {
    requestAnimationFrame(render);

    const center = controls.position;

    world.update(center);
    map.update(center);

    debug.update();
    controls.update();

    sky.update(center);
    clouds.update(center);

    network.flush();

    composer.render();
  };

  render();
};

start();

const resize = () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
};

window.addEventListener("resize", resize);
resize();
