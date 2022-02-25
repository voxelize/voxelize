import { Block, TextureRange, BlockFace } from "../types";

abstract class SharedRegistry {
  public ranges: Map<string, TextureRange> = new Map();

  protected blocks: Map<string, Block> = new Map();
  protected textures: Set<string> = new Set();
  protected nameMap: Map<number, string> = new Map();
  protected typeMap: Map<string, number> = new Map();

  getBlockByName = (name: string) => {
    return this.blocks.get(name.toLowerCase());
  };

  getBlockById = (id: number) => {
    return this.getBlockByName(this.nameMap.get(id));
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
    const uvMap = {};

    block.faces.forEach((side) => {
      const sideName = this.makeSideName(block.name, side);
      const uv = this.ranges.get(sideName);
      if (!uv)
        throw new Error(`UV range not found: ${sideName} - ${block.name}`);
      uvMap[sideName] = uv;
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
    this.blocks.forEach((value, key) => {
      blockMap[key] = value;
    });
    return blockMap;
  };

  hasType = (id: number) => {
    return this.nameMap.has(id);
  };

  static getTextureType = (texture: { [key: string]: string }) => {
    const len = Object.keys(texture).length;

    if (len === 1) {
      return "mat1";
    } else if (len === 3) {
      return "mat3";
    } else if (len === 6) {
      return "mat6";
    } else {
      return "x";
    }
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
    return Math.ceil(Math.sqrt(this.textures.size));
  };

  protected makeSideName = (name: string, side: BlockFace) => {
    return `${name.toLowerCase()}__${side}`;
  };

  protected recordBlock = (block: Block) => {
    const { name, id, faces } = block;
    const lowerName = name.toLowerCase();

    this.blocks.set(lowerName, block);
    this.nameMap.set(id, lowerName);
    this.typeMap.set(lowerName, id);

    for (const side of faces) {
      const sideName = this.makeSideName(name, side);
      this.textures.add(sideName);
    }
  };
}

export { SharedRegistry };
