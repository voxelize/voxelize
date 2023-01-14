import { AABB } from "@voxelize/aabb";
import * as VOXELIZE from "@voxelize/client";
import * as THREE from "three";

import TestImage from "./assets/cat.jpeg";
import FunnyGif from "./assets/funny.gif";
import LolImage from "./assets/lol.jpeg";
import ChoGeImage from "./assets/lol.png";
import AndesiteImage from "./assets/own/andesite.png";
import BirchSideImage from "./assets/own/birch_log_side.png";
import BirchTopImage from "./assets/own/birch_log_top.png";
import BlackConcreteImage from "./assets/own/black_concrete.png";
import BlueConcrete from "./assets/own/blue_concrete.png";
import Color2Image from "./assets/own/color2.png";
import GraniteImage from "./assets/own/granite.png";
import GraphiteImage from "./assets/own/graphite.png";
import IvoryBlockImage from "./assets/own/ivory_block.png";
import MarbleImage from "./assets/own/marble.png";
import ObsidianImage from "./assets/own/obsidian.png";
import OrangeConcreteImage from "./assets/own/orange_concrete.png";
import RedConcreteImage from "./assets/own/red_concrete.png";
import SlateImage from "./assets/own/slate.png";
import SnowImage from "./assets/own/snow.png";
import WhiteConcreteImage from "./assets/own/white_concrete.png";
import YellowConcreteImage from "./assets/own/yellow_concrete.png";
import DirtImage from "./assets/pixel-perfection/dirt.png";
import GlassImage from "./assets/pixel-perfection/glass.png";
import GrassImage from "./assets/pixel-perfection/grass.png";
import GrassBlockSideImage from "./assets/pixel-perfection/grass_side.png";
import GrassBlockImage from "./assets/pixel-perfection/grass_top.png";
import OakLeavesImage from "./assets/pixel-perfection/leaves_oak.png";
import OakSideImage from "./assets/pixel-perfection/log_oak_side.png";
import OakTopImage from "./assets/pixel-perfection/log_oak_top.png";
import OakPlanksImage from "./assets/pixel-perfection/planks_oak.png";
import SandImage from "./assets/pixel-perfection/sand.png";
import StoneImage from "./assets/pixel-perfection/stone.png";
import WaterImage from "./assets/pixel-perfection/water.png";
import Water1Image from "./assets/pixel-perfection/water1.png";
import Water2Image from "./assets/pixel-perfection/water2.png";
import Water3Image from "./assets/pixel-perfection/water3.png";
import Water4Image from "./assets/pixel-perfection/water4.png";
import TechnoImage from "./assets/techno.png";

export async function setupWorld(world: VOXELIZE.World) {
  const all = ["px", "nx", "py", "ny", "pz", "nz"];
  const side = ["px", "nx", "pz", "nz"];

  // world.applyBlockGifByName("Sand", "nx", FunnyGif);
  // world.setResolutionOfByName("Sand", "nx", 120);

  // world.applyBlockFrames(
  //   "Dirt",
  //   "py",
  //   [
  //     [500, DirtImage],
  //     [500, SandImage],
  //   ],
  //   50
  // );

  const biomes = [
    [0, 0, 0],
    [0, 0, 1],
    [0, 1, 0],
    [0, 1, 1],
    [1, 0, 0],
    [1, 0, 1],
    [1, 1, 0],
    [1, 1, 1],
    [0, 0, -1],
    [0, -1, 0],
    [0, -1, -1],
    [-1, 0, 0],
    [-1, 0, -1],
    [-1, -1, 0],
    [-1, -1, -1],
    [1, 1, -1],
    [1, -1, 1],
    [1, -1, -1],
    [-1, 1, 1],
    [-1, 1, -1],
    [-1, -1, 1],
  ];

  const biomeTextures = biomes.map((portion, i) => {
    const biome = {
      idOrName: `Biome Test ${i}`,
      faceNames: all,
      source: new THREE.Color(
        // Split portion into three parts, shading by 1/3rd low to high
        (portion[0] + 1) * 0.5,
        (portion[1] + 1) * 0.5,
        (portion[2] + 1) * 0.5
      ),
    };

    return biome;
  });

  await world.applyBlockTextures(biomeTextures);

  const biomesDOM = document.getElementById("biomes") as HTMLUListElement;

  biomeTextures.forEach((biome, i) => {
    const portion = biomes[i];

    const colorStr = `#${biome.source.getHexString()}`;
    const biomeEntry = document.createElement("li");

    const biomeTitle = document.createElement("p");
    biomeTitle.innerText = `(${portion[0]},${portion[1]},${portion[2]})`;

    const biomeColor = document.createElement("div");
    biomeColor.style.backgroundColor = colorStr;

    biomeEntry.appendChild(biomeTitle);
    biomeEntry.appendChild(biomeColor);

    biomesDOM.appendChild(biomeEntry);
  });

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

  await world.applyBlockFrames(
    "Water",
    "py",
    [
      [500, Water1Image],
      [500, Water2Image],
      [500, Water3Image],
      [500, Water4Image],
    ],
    300
  );

  world.customizeMaterialShaders(
    "Grass",
    null,
    VOXELIZE.customShaders.sway({
      rooted: true,
    })
  );

  world.customizeMaterialShaders(
    "Oak Leaves",
    null,
    VOXELIZE.customShaders.sway({
      yScale: 0,
    })
  );

  // await world.applyBlockTexture(
  //   "Biggie",
  //   "pz",
  //   await world.loader.loadTexture(TechnoImage)
  // );
  // world.setResolutionOfByName("Biggie", "pz", 128);

  // world.setResolutionOf("Sand", "nx", 128);
  // await world.applyBlockGif("Sand", "nx", FunnyGif);

  world.setResolutionOf("Biggie", "pz", 128);

  await world.applyBlockFrames(
    "Biggie",
    "pz",
    [
      [5000, TechnoImage],
      [5000, LolImage],
    ],
    50
  );

  world.customizeBlockDynamic("Water", (pos) => {
    const [vx, vy, vz] = pos;

    let topIsWater = false;

    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        if (world.getBlockAt(vx + ox, vy + 1, vz + oz)?.name === "Water")
          topIsWater = true;
      }
    }

    const originalAABB = world.getBlockByName("Water");

    return {
      ...originalAABB,
      aabbs: topIsWater ? [new AABB(0, 0, 0, 1, 1, 1)] : originalAABB.aabbs,
    };
  });
}
