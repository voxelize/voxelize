import * as VOXELIZE from "@voxelize/client";
import {
  EffectComposer,
  EffectPass,
  PixelationEffect,
  RenderPass,
  SMAAEffect,
} from "postprocessing";
import * as THREE from "three";

import TestImage from "../assets/cat.jpeg";
import LolImage from "../assets/lol.jpeg";
import ChoGeImage from "../assets/lol.png";
import AndesiteImage from "../assets/own/andesite.png";
import BirchSideImage from "../assets/own/birch_log_side.png";
import BirchTopImage from "../assets/own/birch_log_top.png";
import BlackConcreteImage from "../assets/own/black_concrete.png";
import BlueConcrete from "../assets/own/blue_concrete.png";
import Color2Image from "../assets/own/color2.png";
import GraniteImage from "../assets/own/granite.png";
import GraphiteImage from "../assets/own/graphite.png";
import IvoryBlockImage from "../assets/own/ivory_block.png";
import MarbleImage from "../assets/own/marble.png";
import ObsidianImage from "../assets/own/obsidian.png";
import OrangeConcreteImage from "../assets/own/orange_concrete.png";
import RedConcreteImage from "../assets/own/red_concrete.png";
import SlateImage from "../assets/own/slate.png";
import SnowImage from "../assets/own/snow.png";
import WhiteConcreteImage from "../assets/own/white_concrete.png";
import YellowConcreteImage from "../assets/own/yellow_concrete.png";
import DirtImage from "../assets/pixel-perfection/dirt.png";
import GlassImage from "../assets/pixel-perfection/glass.png";
import GrassImage from "../assets/pixel-perfection/grass.png";
import GrassBlockSideImage from "../assets/pixel-perfection/grass_side.png";
import GrassBlockImage from "../assets/pixel-perfection/grass_top.png";
import OakLeavesImage from "../assets/pixel-perfection/leaves_oak.png";
import OakSideImage from "../assets/pixel-perfection/log_oak_side.png";
import OakTopImage from "../assets/pixel-perfection/log_oak_top.png";
import OakPlanksImage from "../assets/pixel-perfection/planks_oak.png";
import SandImage from "../assets/pixel-perfection/sand.png";
import StoneImage from "../assets/pixel-perfection/stone.png";
import WaterImage from "../assets/pixel-perfection/water.png";
import Water1Image from "../assets/pixel-perfection/water1.png";
import Water2Image from "../assets/pixel-perfection/water2.png";
import Water3Image from "../assets/pixel-perfection/water3.png";
import Water4Image from "../assets/pixel-perfection/water4.png";
import TechnoImage from "../assets/techno.png";
import { Map } from "../map";

export function getBackendUrl() {
  const BACKEND_SERVER_INSTANCE = new URL(window.location.href);

  if (BACKEND_SERVER_INSTANCE.origin.includes("localhost")) {
    BACKEND_SERVER_INSTANCE.port = "4000";
  }

  return BACKEND_SERVER_INSTANCE.toString();
}

export function createSharedInstances() {
  const canvas = document.getElementById("main") as HTMLCanvasElement;

  const world = new VOXELIZE.World({
    textureDimension: 16,
  });

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
  });
  renderer.outputEncoding = THREE.sRGBEncoding;

  const camera = new THREE.PerspectiveCamera(
    90,
    window.innerWidth / window.innerHeight,
    0.1,
    5000
  );

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

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(world, camera));
  composer.addPass(
    new EffectPass(
      camera,
      new SMAAEffect({})
      // new PixelationEffect()
    )
  );

  const debug = new VOXELIZE.Debug();
  debug.registerDisplay("to request", world.chunks.toRequest, "length");
  debug.registerDisplay("requested", world.chunks.requested, "size");
  debug.registerDisplay("to process", world.chunks.toProcess, "length");
  debug.registerDisplay("loaded", world.chunks.loaded, "size");

  const resize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  };

  window.addEventListener("resize", resize);
  resize();

  return {
    world,
    renderer,
    camera,
    controls,
    inputs,
    composer,
    debug,
    sky,
    clouds,
    map,
  };
}

async function setupRegistry(world: VOXELIZE.World) {
  const all = ["px", "nx", "py", "ny", "pz", "nz"];
  const side = ["px", "nx", "pz", "nz"];

  // const video = document.getElementById("video") as HTMLVideoElement;

  // if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
  //   const constraints = {
  //     video: { width: 1280, height: 720, facingMode: "user" },
  //   };

  //   navigator.mediaDevices
  //     .getUserMedia(constraints)
  //     .then(function (stream) {
  //       // apply the stream to the video element used in the texture

  //       video.srcObject = stream;
  //       video.play();
  //     })
  //     .catch(function (error) {
  //       console.error("Unable to access the camera/webcam.", error);
  //     });
  // } else {
  //   console.error("MediaDevices interface not available.");
  // }

  // const videoTexture = new VideoTexture(video);

  // world.applyBlockGifByName("Grass Block", "py", FunnyGif);

  // world.applyBlockGifByName("Sand", "nx", FunnyGif);
  // world.applyResolutionByName("Sand", "nx", 120);

  // world.applyBlockAnimationByName(
  //   "Water",
  //   "py",
  //   [
  //     [500, Water1Image],
  //     [500, Water2Image],
  //     [500, Water3Image],
  //     [500, Water4Image],
  //   ],
  //   300
  // );

  // world.applyBlockAnimationByName(
  //   "Dirt",
  //   "py",
  //   [
  //     [500, DirtImage],
  //     [500, SandImage],
  //   ],
  //   50
  // );

  await world.applyBlockTexture("water", "py", WaterImage);

  await world.applyBlockTextures([
    { idOrName: "Dirt", faceNames: all, source: DirtImage },
    { idOrName: "Lol", faceNames: all, source: new THREE.Color("#8479E1") },
    { idOrName: "Lol", faceNames: ["py"], source: LolImage },
    { idOrName: "Marble", faceNames: all, source: MarbleImage },
    {
      idOrName: "Orange Concrete",
      faceNames: all,
      source: OrangeConcreteImage,
    },
    { idOrName: "Blue Concrete", faceNames: all, source: BlueConcrete },
    { idOrName: "Red Concrete", faceNames: all, source: RedConcreteImage },
    { idOrName: "White Concrete", faceNames: all, source: WhiteConcreteImage },
    {
      idOrName: "Yellow Concrete",
      faceNames: all,
      source: YellowConcreteImage,
    },
    { idOrName: "Black Concrete", faceNames: all, source: BlackConcreteImage },
    { idOrName: "Ivory Block", faceNames: all, source: IvoryBlockImage },
    { idOrName: "Grass Block", faceNames: ["py"], source: GrassBlockImage },
    { idOrName: "Color", faceNames: all, source: new THREE.Color("#ffffff") },
    { idOrName: "Color", faceNames: all, source: Color2Image },
    { idOrName: "Grass Block", faceNames: side, source: GrassBlockSideImage },
    { idOrName: "Grass Block", faceNames: ["ny"], source: DirtImage },
    { idOrName: "Grass", faceNames: ["one", "two"], source: GrassImage },
    { idOrName: "Stone", faceNames: all, source: StoneImage },
    { idOrName: "Oak Leaves", faceNames: all, source: OakLeavesImage },
    {
      idOrName: "Oak Leaves",
      faceNames: ["one", "two"],
      source: OakLeavesImage,
    },
    { idOrName: "Oak Log", faceNames: ["py"], source: OakTopImage },
    { idOrName: "Oak Log", faceNames: side, source: OakSideImage },
    { idOrName: "Oak Log", faceNames: ["ny"], source: OakTopImage },
    { idOrName: "Oak Pole", faceNames: side, source: TestImage },
    { idOrName: "Birch Log", faceNames: ["py"], source: BirchTopImage },
    { idOrName: "Birch Log", faceNames: side, source: BirchSideImage },
    { idOrName: "Birch Log", faceNames: ["ny"], source: BirchTopImage },
    { idOrName: "Sand", faceNames: all, source: SandImage },
    { idOrName: "Snow", faceNames: all, source: SnowImage },
    { idOrName: "Water", faceNames: all, source: WaterImage },
    { idOrName: "Obsidian", faceNames: all, source: ObsidianImage },
    { idOrName: "Granite", faceNames: all, source: GraniteImage },
    { idOrName: "Graphite", faceNames: all, source: GraphiteImage },
    { idOrName: "Slate", faceNames: all, source: SlateImage },
    { idOrName: "Andesite", faceNames: all, source: AndesiteImage },
    { idOrName: "Oak Planks", faceNames: all, source: OakPlanksImage },
    { idOrName: "Oak Slab Top", faceNames: all, source: OakPlanksImage },
    { idOrName: "Oak Slab Bottom", faceNames: all, source: OakPlanksImage },
    { idOrName: "ChoGe", faceNames: ["px", "nx"], source: ChoGeImage },
    { idOrName: "Glass", faceNames: all, source: GlassImage },
    {
      idOrName: "Mushroom",
      faceNames: all.map((name) => `bottom-${name}-`),
      source: new THREE.Color("#A27B5C"),
    },
    {
      idOrName: "Mushroom",
      faceNames: all.map((name) => `top-${name}-`),
      source: new THREE.Color("#E4DCCF"),
    },
    { idOrName: "Biggie", faceNames: all, source: new THREE.Color("#2C3639") },
    {
      idOrName: "Test",
      faceNames: "py",
      source: new THREE.Color("#E4DCCF"),
    },
    {
      idOrName: "Test",
      faceNames: "px",
      source: new THREE.Color("red"),
    },
    {
      idOrName: "Test",
      faceNames: "pz",
      source: new THREE.Color("purple"),
    },
  ]);

  // world.applyBlockTexture("Biggie", "pz", videoTexture);

  // // world.applyTextureByName("Biggie", "pz", TechnoImage);
  // world.applyResolutionByName("Biggie", "pz", 128);

  // world.applyBlockAnimationByName(
  //   "Biggie",
  //   "pz",
  //   [
  //     [5000, TechnoImage],
  //     [5000, LolImage],
  //   ],
  //   50
  // );
}

export function runWorld(name: string) {
  const { world, inputs, controls, map, debug, sky, clouds, composer } =
    createSharedInstances();

  const network = new VOXELIZE.Network();
  network.register(world);

  const start = async () => {
    await network.connect(getBackendUrl(), { secret: "test" });
    await network.join(name);

    await world.init();
    await setupRegistry(world);

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
}
