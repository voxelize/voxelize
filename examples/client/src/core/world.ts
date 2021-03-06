import WaterImage from "../assets/own/water.png";
import ObsidianImage from "../assets/own/obsidian.png";
import OakLeavesImage from "../assets/own/oak_leaves.png";
import GrassImage from "../assets/own/grass_top.png";
import GrassSideImage from "../assets/own/grass_side.png";
import DirtImage from "../assets/own/dirt.png";
import OakTopImage from "../assets/own/oak_log_top.png";
import OakSideImage from "../assets/own/oak_log_side.png";
import OrangeConcreteImage from "../assets/own/orange_concrete.png";
import BlueConcrete from "../assets/own/blue_concrete.png";
import RedConcreteImage from "../assets/own/red_concrete.png";
import WhiteConcreteImage from "../assets/own/white_concrete.png";
import YellowConcreteImage from "../assets/own/yellow_concrete.png";
import BlackConcreteImage from "../assets/own/black_concrete.png";
import IvoryBlockImage from "../assets/own/ivory_block.png";
import SandImage from "../assets/own/sand.png";
import StoneImage from "../assets/own/stone.png";
import SnowImage from "../assets/own/snow.png";
import Color2Image from "../assets/own/color2.png";
import BirchTopImage from "../assets/own/birch_log_top.png";
import BirchSideImage from "../assets/own/birch_log_side.png";
import GraniteImage from "../assets/own/granite.png";
import GraphiteImage from "../assets/own/graphite.png";
import MarbleImage from "../assets/own/marble.png";
import SlateImage from "../assets/own/slate.png";
import AndesiteImage from "../assets/own/andesite.png";
import OakPlanksImage from "../assets/own/oak_planks.png";
import LolImage from "../assets/lol.jpeg";
import ChoGeImage from "../assets/lol.png";
import GlassImage from "../assets/own/glass.png";
import TechnoImage from "../assets/techno.png";
import TestImage from "../assets/cat.jpeg";

import { World } from "@voxelize/client";
import { Color } from "three";

export function setupWorld(world: World) {
  const all = ["px", "nx", "py", "ny", "pz", "nz"];
  const side = ["px", "nx", "pz", "nz"];

  world.applyTexturesByNames([
    { name: "Dirt", sides: all, data: DirtImage },
    { name: "Lol", sides: all, data: new Color("#8479E1") },
    { name: "Lol", sides: ["py"], data: LolImage },
    { name: "Marble", sides: all, data: MarbleImage },
    { name: "Orange Concrete", sides: all, data: OrangeConcreteImage },
    { name: "Blue Concrete", sides: all, data: BlueConcrete },
    { name: "Red Concrete", sides: all, data: RedConcreteImage },
    { name: "White Concrete", sides: all, data: WhiteConcreteImage },
    { name: "Yellow Concrete", sides: all, data: YellowConcreteImage },
    { name: "Black Concrete", sides: all, data: BlackConcreteImage },
    { name: "Ivory Block", sides: all, data: IvoryBlockImage },
    { name: "Grass", sides: ["py"], data: GrassImage },
    { name: "Color", sides: all, data: new Color("#ffffff") },
    { name: "Color", sides: all, data: Color2Image },
    { name: "Grass", sides: side, data: GrassSideImage },
    { name: "Grass", sides: ["ny"], data: DirtImage },
    { name: "Stone", sides: all, data: StoneImage },
    { name: "Oak Leaves", sides: all, data: OakLeavesImage },
    { name: "Oak Log", sides: ["py"], data: OakTopImage },
    { name: "Oak Log", sides: side, data: OakSideImage },
    { name: "Oak Log", sides: ["ny"], data: OakTopImage },
    { name: "Oak Pole", sides: side, data: TestImage },
    { name: "Birch Log", sides: ["py"], data: BirchTopImage },
    { name: "Birch Log", sides: side, data: BirchSideImage },
    { name: "Birch Log", sides: ["ny"], data: BirchTopImage },
    { name: "Sand", sides: all, data: SandImage },
    { name: "Snow", sides: all, data: SnowImage },
    { name: "Water", sides: all, data: WaterImage },
    { name: "Obsidian", sides: all, data: ObsidianImage },
    { name: "Granite", sides: all, data: GraniteImage },
    { name: "Graphite", sides: all, data: GraphiteImage },
    { name: "Slate", sides: all, data: SlateImage },
    { name: "Andesite", sides: all, data: AndesiteImage },
    { name: "Oak Planks", sides: all, data: OakPlanksImage },
    { name: "Oak Slab Top", sides: all, data: OakPlanksImage },
    { name: "Oak Slab Bottom", sides: all, data: OakPlanksImage },
    { name: "ChoGe", sides: ["px", "nx"], data: ChoGeImage },
    { name: "Glass", sides: all, data: GlassImage },
    {
      name: "Mushroom",
      sides: all.map((name) => "bottom-" + name + "-"),
      data: new Color("#A27B5C"),
    },
    {
      name: "Mushroom",
      sides: all.map((name) => "top-" + name + "-"),
      data: new Color("#E4DCCF"),
    },
    { name: "Biggie", sides: all, data: new Color("#2C3639") },
    { name: "Biggie", sides: ["pz"], data: TechnoImage },
  ]);
}
