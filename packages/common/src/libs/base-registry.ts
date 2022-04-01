import { Block, TextureRange, BlockFace } from "../types";

abstract class BaseRegistry {
  public ranges: Map<string, TextureRange> = new Map();

  protected blocksByName: Map<string, Block> = new Map();
  protected blocksById: Map<number, Block> = new Map();
  protected textures: Set<string> = new Set();
  protected nameMap: Map<number, string> = new Map();
  protected typeMap: Map<string, number> = new Map();

  getBlockByName = (name: string) => {
    return this.blocksByName.get(name.toLowerCase());
  };

  getBlockById = (id: number) => {
    return this.blocksById.get(id);
  };

  getTransparencyByName = (name: string) => {
    return this.getBlockByName(name)?.isTransparent;
  };

  getTransparencyById = (id: number) => {
    return this.getBlockById(id)?.isTransparent;
  };

  getFluidityByName = (name: string) => {
    return this.getBlockByName(name)?.isFluid;
  };

  getFluidityById = (id: number) => {
    return this.getBlockById(id)?.isFluid;
  };

  getSolidityByName = (name: string) => {
    return this.getBlockByName(name)?.isSolid;
  };

  getSolidityById = (id: number) => {
    return this.getBlockById(id)?.isSolid;
  };

  getEmptinessByName = (name: string) => {
    return this.getBlockByName(name)?.isEmpty;
  };

  getEmptinessById = (id: number) => {
    return this.getBlockById(id)?.isEmpty;
  };

  getFacesByName = (name: string) => {
    return this.getBlockByName(name)?.faces;
  };

  getFacesById = (id: number) => {
    return this.getBlockById(id)?.faces;
  };

  getUVByName = (name: string) => {
    return this.getUVMap(this.getBlockByName(name));
  };

  getUVById = (id: number) => {
    return this.getUVMap(this.getBlockById(id));
  };

  getUVMap = (block: Block) => {
    const uvMap: { [key: string]: TextureRange } = {};

    block.faces.forEach((side) => {
      const sideName = this.makeSideName(block.name, side);
      const uv = this.ranges.get(sideName);
      if (!uv)
        throw new Error(`UV range not found: ${sideName} - ${block.name}`);
      uvMap[side] = uv;
    });

    return uvMap;
  };

  getTypeMap = (blocks: string[]) => {
    const typeMap = {};

    blocks.forEach((block) => {
      const id = this.typeMap.get(block);
      typeMap[block] = id;
    });

    return blocks;
  };

  getBlockMap = () => {
    const blockMap = {};
    this.blocksByName.forEach((value, key) => {
      blockMap[key] = value;
    });
    return blockMap;
  };

  hasType = (id: number) => {
    return this.nameMap.has(id);
  };

  static getFacesMap = (faces: BlockFace[]) => {
    const faceMap: { [key: string]: string } = {};
    const sides = ["px", "pz", "nx", "nz"];

    sides.forEach((side) => {
      if (faces.includes(side as BlockFace)) {
        faceMap[side] = side;
      } else if (faces.includes("side")) {
        faceMap[side] = "side";
      } else {
        faceMap[side] = "all";
      }
    });

    if (faces.includes("py")) faceMap.py = "py";
    else if (faces.includes("top")) faceMap.py = "top";
    else faceMap.py = "all";

    if (faces.includes("ny")) faceMap.py = "ny";
    else if (faces.includes("bottom")) faceMap.py = "bottom";
    else faceMap.ny = "all";

    return faceMap;
  };

  static fixTextureBleeding = (
    startU: number,
    startV: number,
    endU: number,
    endV: number
  ) => {
    const offset = 0.1 / 128;
    return [startU + offset, startV - offset, endU - offset, endV + offset];
  };

  protected perSide = () => {
    let i = 1;
    const sqrt = Math.ceil(Math.sqrt(this.textures.size));
    while (i < sqrt) {
      i *= 2;
    }
    return i;
  };

  protected makeSideName = (name: string, side: BlockFace) => {
    return `${name.toLowerCase()}__${side}`;
  };

  protected recordBlock = (block: Block) => {
    const { name, id, faces, isPlant } = block;
    const lowerName = name.toLowerCase();

    this.blocksByName.set(lowerName, block);
    this.blocksById.set(id, block);
    this.nameMap.set(id, lowerName);
    this.typeMap.set(lowerName, id);

    for (const side of faces) {
      if (side === "diagonal" && !isPlant) {
        throw new Error(
          "Blocks that are not plants cannot have diagnoal textures."
        );
      }

      const sideName = this.makeSideName(name, side);
      this.textures.add(sideName);
    }
  };
}

export { BaseRegistry };
