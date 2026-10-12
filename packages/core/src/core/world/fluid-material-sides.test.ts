import { BackSide, DoubleSide, FrontSide, MeshBasicMaterial } from "three";
import { describe, expect, it } from "vitest";

import { setFluidMaterialSides } from "./chunk-materials";

const WATER = 1;
const LAVA = 2;

function fluidMaterial(blockId?: number) {
  const material = new MeshBasicMaterial({ side: FrontSide });
  material.userData.isFluid = true;
  if (blockId !== undefined) material.userData.fluidBlockId = blockId;
  return material;
}

describe("setFluidMaterialSides", () => {
  const isWater = (blockId: number) => blockId === WATER;

  it("turns only water to its back side while the camera is under it", () => {
    const water = fluidMaterial(WATER);
    const lava = fluidMaterial(LAVA);
    const glass = new MeshBasicMaterial({ side: DoubleSide });

    setFluidMaterialSides([water, lava, glass], true, isWater);

    expect(water.side).toBe(BackSide);
    expect(lava.side).toBe(FrontSide);
    expect(glass.side).toBe(DoubleSide);
  });

  it("turns water back to its front side out of it", () => {
    const water = fluidMaterial(WATER);
    setFluidMaterialSides([water], true, isWater);
    setFluidMaterialSides([water], false, isWater);
    expect(water.side).toBe(FrontSide);
  });

  it("treats a fluid material that names no block as water", () => {
    const untagged = fluidMaterial();
    setFluidMaterialSides([untagged], true, isWater);
    expect(untagged.side).toBe(BackSide);
  });

  it("recompiles only a material whose side changed", () => {
    const lava = fluidMaterial(LAVA);
    const version = lava.version;
    setFluidMaterialSides([lava], true, isWater);
    expect(lava.version).toBe(version);
  });
});
