import {
  BackSide,
  FrontSide,
  ShaderLib,
  ShaderMaterial,
  Texture,
  UniformsUtils,
  Vector4,
} from "three";

import { Client } from "..";
import { TextureAtlas } from "../libs";
import { Block, BlockFace, TextureRange } from "../types";

type CustomShaderMaterial = ShaderMaterial & {
  map: Texture;
};

type RegistryParams = {
  dimension: number;
};

const defaultParams: RegistryParams = {
  dimension: 16,
};

const TRANSPARENT_SIDES = [FrontSide, BackSide];

class Registry {
  public params: RegistryParams;
  public atlas: TextureAtlas;
  public ranges: Map<string, TextureRange> = new Map();

  public atlasUniform: { value: Texture | null };
  public aoUniform: { value: Vector4 };
  public minLightUniform = { value: 0.05 };

  public materials: {
    opaque?: CustomShaderMaterial;
    transparent?: CustomShaderMaterial[];
  } = {};

  private blocksByName: Map<string, Block> = new Map();
  private blocksById: Map<number, Block> = new Map();
  private textures: Set<string> = new Set();
  private nameMap: Map<number, string> = new Map();
  private typeMap: Map<string, number> = new Map();
  private sources: Map<string, string> = new Map();

  constructor(public client: Client, params: Partial<RegistryParams>) {
    this.aoUniform = { value: new Vector4(100.0, 170.0, 210.0, 255.0) };

    this.params = {
      ...defaultParams,
      ...params,
    };
  }

  applyTextureByName = (name: string, side: BlockFace, path: string) => {
    this.sources.set(this.makeSideName(name, side), path);
  };

  applyTextureById = (id: number, side: BlockFace, path: string) => {
    const name = this.nameMap.get(id);
    this.applyTextureByName(name, side, path);
  };

  load = async (blocks: Block[], ranges: { [key: string]: TextureRange }) => {
    Object.values(blocks).forEach((block) => {
      this.recordBlock(block);
    });

    Object.keys(ranges).forEach((r) => {
      this.ranges.set(r, ranges[r]);
    });

    if (this.atlas && this.atlas.texture) {
      this.atlas.texture.dispose();
    }

    /* -------------------------------------------------------------------------- */
    /*                             Generating Texture                             */
    /* -------------------------------------------------------------------------- */
    const { dimension } = this.params;

    Array.from(this.ranges.keys()).forEach((key) => {
      if (!this.sources.has(key)) {
        this.sources.set(key, null);
      }
    });

    this.atlas = await TextureAtlas.create(this.sources, this.ranges, {
      countPerSide: this.perSide(),
      dimension,
    });

    this.atlasUniform = {
      value: this.atlas.texture,
    };

    if (this.materials.opaque) {
      this.materials.opaque.map = this.atlas.texture;
    } else {
      this.materials.opaque = this.makeShaderMaterial();
    }

    if (this.materials.transparent) {
      this.materials.transparent.forEach((m) => {
        m.map = this.atlas.texture;
      });
    } else {
      this.materials.transparent = TRANSPARENT_SIDES.map((side) => {
        const material = this.makeShaderMaterial();
        material.side = side;
        material.transparent = true;
        material.alphaTest = 0.3;
        return material;
      });
    }

    this.client.emit("texture-loaded");
    this.client.loaded = true;
  };

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

  private perSide = () => {
    let i = 1;
    const sqrt = Math.ceil(Math.sqrt(this.textures.size));
    while (i < sqrt) {
      i *= 2;
    }
    return i;
  };

  private makeSideName = (name: string, side: BlockFace) => {
    return `${name.toLowerCase()}__${side}`;
  };

  private recordBlock = (block: Block) => {
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

  private makeShaderMaterial = () => {
    const material = new ShaderMaterial({
      vertexColors: true,
      fragmentShader: ShaderLib.basic.fragmentShader
        .replace(
          "#include <common>",
          `
#include <common>
uniform vec3 uFogColor;
uniform vec3 uFogNearColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uSunlightIntensity;
uniform float uMinLight;
varying float vAO;
varying vec4 vLight; 
`
        )
        .replace(
          "#include <envmap_fragment>",
          `
#include <envmap_fragment>
float s = min(vLight.a * uSunlightIntensity * 0.8 + uMinLight, 1.0);
float scale = 1.0;
outgoingLight.rgb *= vec3(s + pow(vLight.r, scale), s + pow(vLight.g, scale), s + pow(vLight.b, scale));
// outgoingLight.rgb *= vec3(s + scale / sqrt(vLight.r), s + scale / sqrt(vLight.g), s + scale / sqrt(vLight.b));
outgoingLight *= 0.88 * vAO;
`
        )
        .replace(
          "#include <fog_fragment>",
          `
float depth = gl_FragCoord.z / gl_FragCoord.w;
float fogFactor = smoothstep(uFogNear, uFogFar, depth);
gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(uFogNearColor, uFogColor, fogFactor), fogFactor);
`
        ),
      vertexShader: ShaderLib.basic.vertexShader
        .replace(
          "#include <common>",
          `
attribute int ao;
attribute int light;
varying float vAO;
varying vec4 vLight;
uniform vec4 uAOTable;
vec4 unpackLight(int l) {
  float r = float((l >> 8) & 0xF) / 15.0;
  float g = float((l >> 4) & 0xF) / 15.0;
  float b = float(l & 0xF) / 15.0;
  float s = float((l >> 12) & 0xF) / 15.0;
  return vec4(r, g, b, s);
}
#include <common>
`
        )
        .replace(
          "#include <color_vertex>",
          `
#include <color_vertex>
vAO = ((ao == 0) ? uAOTable.x :
    (ao == 1) ? uAOTable.y :
    (ao == 2) ? uAOTable.z : uAOTable.w) / 255.0; 
vLight = unpackLight(light);
`
        ),

      uniforms: {
        ...UniformsUtils.clone(ShaderLib.basic.uniforms),
        map: this.atlasUniform,
        uSunlightIntensity: { value: 1 },
        uAOTable: this.aoUniform,
        uMinLight: this.minLightUniform,
        ...this.client.rendering.fogUniforms,
      },
    }) as CustomShaderMaterial;

    material.map = this.atlasUniform.value;
    material.needsUpdate = true;

    return material;
  };
}

export type { RegistryParams };

export { Registry };
