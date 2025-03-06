import * as VOXELIZE from "@voxelize/core";
import { defaultWorldSettings } from "../config/settings";
import { VOXELIZE_LOCALSTORAGE_KEY } from "../config/constants";

export const currentWorldName = 
  localStorage.getItem(VOXELIZE_LOCALSTORAGE_KEY) ?? "terrain";

export const createWorld = () => {
  const world = new VOXELIZE.World(defaultWorldSettings);

  // Sky configuration
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

  // Sky art
  world.sky.paint("bottom", VOXELIZE.artFunctions.drawSun());
  world.sky.paint("top", VOXELIZE.artFunctions.drawStars());
  world.sky.paint("top", VOXELIZE.artFunctions.drawMoon());
  world.sky.paint("sides", VOXELIZE.artFunctions.drawStars());

  return world;
};

// const sky = new VOXELIZE.Sky(2000);
// sky.paint("top", VOXELIZE.artFunctions.drawSun);
// world.add(sky);

// const clouds = new VOXELIZE.Clouds({
//   uFogColor: sky.uMiddleColor,
// });

// world.add(clouds);
// world.setFogColor(sky.getMiddleColor());
