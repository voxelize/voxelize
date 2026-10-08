import { AABB } from "@voxelize/aabb";
import * as VOXELIZE from "@voxelize/core";
import * as THREE from "three";

import TestImage from "./assets/cat.jpeg";
import LolImage from "./assets/lol.jpeg";
import ChoGeImage from "./assets/lol.png";
import AndesiteImage from "./assets/own/andesite.png";
import BirchSideImage from "./assets/own/birch_log_side.png";
import BirchTopImage from "./assets/own/birch_log_top.png";
import BlackConcreteImage from "./assets/own/black_concrete.png";
import BlueConcrete from "./assets/own/blue_concrete.png";
import Color2Image from "./assets/own/color2.png";
import DirtImage from "./assets/own/dirt.png";
import GlassImage from "./assets/own/glass.png";
import GraniteImage from "./assets/own/granite.png";
import GraphiteImage from "./assets/own/graphite.png";
import GrassImage from "./assets/own/grass.png";
import GrassBlockSideImage from "./assets/own/grass_side.png";
import GrassBlockImage from "./assets/own/grass_top.png";
import IvoryBlockImage from "./assets/own/ivory_block.png";
import OakLeavesImage from "./assets/own/leaves_oak.png";
import MarbleImage from "./assets/own/marble.png";
import OakSideImage from "./assets/own/oak_log_side.png";
import OakTopImage from "./assets/own/oak_log_top.png";
import OakPlanksImage from "./assets/own/oak_planks.png";
import ObsidianImage from "./assets/own/obsidian.png";
import OrangeConcreteImage from "./assets/own/orange_concrete.png";
import RedConcreteImage from "./assets/own/red_concrete.png";
import SandImage from "./assets/own/sand.png";
import SlateImage from "./assets/own/slate.png";
import SnowImage from "./assets/own/snow.png";
import StoneImage from "./assets/own/stone.png";
import WaterImage from "./assets/own/water.png";
import WhiteConcreteImage from "./assets/own/white_concrete.png";
import YellowConcreteImage from "./assets/own/yellow_concrete.png";

const BIOME_SHADE_WEIGHT = 0.2;

// Flat colours for the landscape demo block pack's blocks that have no
// texture here (the showcase world registers only that pack).
const DEMO_PACK_COLORS: [string, string][] = [
  ["Limestone", "#cfc8b4"],
  ["Sandstone", "#d8bc84"],
  ["Clay", "#a8786a"],
  ["Mudstone", "#8a7a6c"],
  ["Basalt", "#4a4a50"],
  ["Scoria", "#6e4a40"],
  ["Tuff", "#a39a86"],
  ["Gravel", "#8f8a85"],
  ["Ice", "#bcd8f0"],
  ["Moss", "#5c7a3a"],
  ["Vines", "#3f6a2c"],
  ["Glow Stone", "#f4d58a"],
  ["Dripstone", "#9a8470"],
  ["Cobblestone", "#7d7d7d"],
  ["Lava", "#e0561c"],
];

export async function setupWorld(world: VOXELIZE.World) {
  const all = ["px", "nx", "py", "ny", "pz", "nz"];
  const side = ["px", "nx", "pz", "nz"];

  // Each world registers its own blocks; skip paint for blocks it lacks.
  const hasBlock = (idOrName: number | string) =>
    typeof idOrName === "number"
      ? world.registry.blocksById.has(idOrName)
      : world.registry.blocksByName.has(idOrName.toLowerCase());
  const applyKnown = (
    data: {
      idOrName: number | string;
      faceNames: string | string[];
      source: string | THREE.Color;
    }[],
  ) => world.applyBlockTextures(data.filter((d) => hasBlock(d.idOrName)));

  if (hasBlock(50000)) {
    world.applyBlockTexture(50000, all, new THREE.Color("#f99999"));
  }

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
        0.5 + portion[0] * BIOME_SHADE_WEIGHT,
        0.5 + portion[1] * BIOME_SHADE_WEIGHT,
        0.5 + portion[2] * BIOME_SHADE_WEIGHT,
      ),
    };

    return biome;
  });

  await applyKnown(biomeTextures);

  // const biomesDOM = document.getElementById("biomes") as HTMLUListElement;

  // biomeTextures.forEach((biome, i) => {
  //   const portion = biomes[i];

  //   const colorStr = `#${biome.source.getHexString()}`;
  //   const biomeEntry = document.createElement("li");

  //   const biomeTitle = document.createElement("p");
  //   biomeTitle.innerText = `(${portion[0]},${portion[1]},${portion[2]})`;

  //   const biomeColor = document.createElement("div");
  //   biomeColor.style.backgroundColor = colorStr;

  //   biomeEntry.appendChild(biomeTitle);
  //   biomeEntry.appendChild(biomeColor);

  //   biomesDOM.appendChild(biomeEntry);
  // });

  const diagonalFaces = ["one", "two"];

  await applyKnown(
    DEMO_PACK_COLORS.map(([name, color]) => ({
      idOrName: name,
      faceNames: all,
      source: new THREE.Color(color),
    })),
  );

  await applyKnown([
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
    { idOrName: "Grass", faceNames: diagonalFaces, source: GrassImage },
    { idOrName: "Stone", faceNames: all, source: StoneImage },
    { idOrName: "Oak Leaves", faceNames: all, source: OakLeavesImage },
    {
      idOrName: "Oak Leaves",
      faceNames: diagonalFaces,
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
    // Torch: plain wooden stick, hot emitting tip. Only "py" glows.
    { idOrName: "Torch", faceNames: side, source: new THREE.Color("#7A5230") },
    {
      idOrName: "Torch",
      faceNames: ["ny"],
      source: new THREE.Color("#5C3D22"),
    },
    {
      idOrName: "Torch",
      faceNames: ["py"],
      source: new THREE.Color("#FFC773"),
    },
    {
      idOrName: "Ember Lamp",
      faceNames: all,
      source: new THREE.Color("#FF6A35"),
    },
    {
      idOrName: "Azure Lamp",
      faceNames: all,
      source: new THREE.Color("#4D8FFF"),
    },
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
      faceNames: all.map((name) => `bottom-${name}`),
      source: new THREE.Color("#A27B5C"),
    },
    {
      idOrName: "Mushroom",
      faceNames: all
        .filter((name) => name !== "py")
        .map((name) => `top-${name}`),
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

  if (hasBlock("Grass")) {
    diagonalFaces.forEach((face) => {
      const mat = world.getBlockFaceMaterial("Grass", face);
      mat.depthWrite = false;
    });
  }

  // await world.applyBlockFrames(
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

  if (hasBlock("Grass")) {
    world.customizeMaterialShaders(
      "Grass",
      null,
      VOXELIZE.customShaders.sway({
        rooted: true,
      }),
    );
  }

  if (hasBlock("Oak Leaves")) {
    world.customizeMaterialShaders(
      "Oak Leaves",
      null,
      VOXELIZE.customShaders.sway({
        yScale: 0,
      }),
    );
  }

  // world.setResolutionOf("Sand", "nx", 128);
  // await world.applyBlockGif("Sand", "nx", FunnyGif);
  // await world.applyBlockTexture("Biggie", "pz", new THREE.Color("#2C3639"));
  try {
    // const image = await world.loader.loadImage(
    //   "https://i.imgur.com/2ZQZV2w.png"
    // );
    // await world.applyBlockTexture("Biggie", "pz", image);
    // await world.setResolutionOf("Biggie", "pz", 10);
  } catch (e) {
    console.warn("oh well,", e);
  }
  // world.setResolutionOfByName("Biggie", "pz", 128);

  // await world.applyBlockFrames(
  //   "Biggie",
  //   "pz",
  //   [
  //     [5000, TechnoImage],
  //     [5000, LolImage],
  //   ],
  //   50
  // );

  if (!hasBlock("Water")) return;

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
