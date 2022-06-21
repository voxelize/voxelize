import { AABB } from "@voxelize/voxel-physics-engine";
import {
  Color,
  DoubleSide,
  ShaderLib,
  ShaderMaterial,
  Texture,
  UniformsUtils,
  Vector4,
} from "three";

import { Client } from "..";
import { TextureAtlas } from "../libs";
import { Block, BlockFace, TextureRange } from "../types";

/**
 * Custom shader material for chunks, simply a `ShaderMaterial` from ThreeJS with a map texture.
 */
type CustomShaderMaterial = ShaderMaterial & {
  map: Texture;
};

/**
 * Parameters to initialize the registry.
 */
type RegistryParams = {
  /**
   * The dimension of each registered block texture. Defaults to `8`.
   */
  dimension: number;
};

const defaultParams: RegistryParams = {
  dimension: 8,
};

/**
 * A **built-in** block registry for Voxelize.
 */
class Registry {
  /**
   * Reference linking back to the Voxelize client instance.
   */
  public client: Client;

  /**
   * Parameters to initialize the Voxelize registry.
   */
  public params: RegistryParams;

  /**
   * The generated texture atlas built from all registered block textures.
   */
  public atlas: TextureAtlas;

  /**
   * A map of UV ranges for all registered blocks.
   */
  public ranges: Map<string, TextureRange> = new Map();

  /**
   * The uniform for the texture atlas to work with chunks.
   */
  public atlasUniform: { value: Texture | null };

  /**
   * A `Vector4` representing the [4 levels of ambient occlusion](https://0fps.net/2013/07/03/ambient-occlusion-for-minecraft-like-worlds/).
   */
  public aoUniform: { value: Vector4 };

  /**
   * The minimum sunlight for each block rendered.
   */
  public minLightUniform = { value: 0.05 };

  /**
   * The shared material instances for chunks.
   */
  public materials: {
    opaque?: CustomShaderMaterial;
    transparent?: CustomShaderMaterial;
  } = {};

  private blocksByName: Map<string, Block> = new Map();
  private blocksById: Map<number, Block> = new Map();
  private textures: Set<string> = new Set();
  private nameMap: Map<number, string> = new Map();
  private typeMap: Map<string, number> = new Map();
  private sources: Map<string, string | Color> = new Map();

  /**
   * Construct a block registry for Voxelize.
   *
   * @hidden
   */
  constructor(client: Client, params: Partial<RegistryParams>) {
    this.client = client;

    this.aoUniform = {
      value: new Vector4(100.0, 170.0, 210.0, 255.0),
    };

    this.params = {
      ...defaultParams,
      ...params,
    };
  }

  applyTexturesByNames = (
    textures: { name: string; side: BlockFace; data: string | Color }[]
  ) => {
    textures.forEach(({ name, side, data }) => {
      this.applyTextureByName(name, side, data);
    });
  };

  applyTextureByName = (
    name: string,
    side: BlockFace,
    data: string | Color
  ) => {
    // Offload texture loading to the loader for the loading screen
    if (typeof data === "string") {
      this.client.loader.addTexture(data);
    }

    this.sources.set(this.makeSideName(name, side), data);
  };

  applyTextureById = (id: number, side: BlockFace, path: string) => {
    const name = this.nameMap.get(id);
    this.applyTextureByName(name, side, path);
  };

  load = (blocks: Block[], ranges: { [key: string]: TextureRange }) => {
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

    const textures = new Map();
    Array.from(this.sources.entries()).forEach(([sideName, source]) => {
      textures.set(
        sideName,
        source instanceof Color ? source : this.client.loader.getTexture(source)
      );
    });

    this.atlas = TextureAtlas.create(textures, this.ranges, {
      countPerSide: this.perSide,
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
      this.materials.transparent.map = this.atlas.texture;
    } else {
      const mat = this.makeShaderMaterial();
      mat.side = DoubleSide;
      mat.transparent = true;
      mat.alphaTest = 0.1;
      this.materials.transparent = mat;
    }

    this.client.emit("registry-loaded");
    this.client.loaded = true;
  };

  getBlockByName = (name: string) => {
    return this.blocksByName.get(name.toLowerCase());
  };

  getBlockById = (id: number) => {
    return this.blocksById.get(id);
  };

  getBlockByTextureName = (textureName: string) => {
    for (const [name, block] of this.blocksByName) {
      for (const face of block.faces) {
        if (textureName === this.makeSideName(name, face)) {
          return block;
        }
      }
    }

    return null;
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

  getUV = (id: number): { [key: string]: [any[][], number] } => {
    const getUVInner = (range: TextureRange, uv: number[]): number[] => {
      const { startU, endU, startV, endV } = range;
      return [
        uv[0] * (endU - startU) + startU,
        uv[1] * (endV - startV) + startV,
      ];
    };

    const { isBlock, isPlant } = this.getBlockById(id);
    const textures = this.getUVById(id);

    if (isBlock) {
      // ny
      const bottomUVs = [
        [1, 0],
        [0, 0],
        [1, 1],
        [0, 1],
      ].map((uv) =>
        getUVInner(
          textures["all"]
            ? textures["all"]
            : textures["bottom"]
            ? textures["bottom"]
            : textures["ny"],
          uv
        )
      );

      // py
      const topUVs = [
        [1, 1],
        [0, 1],
        [1, 0],
        [0, 0],
      ].map((uv) =>
        getUVInner(
          textures["all"]
            ? textures["all"]
            : textures["top"]
            ? textures["top"]
            : textures["py"],
          uv
        )
      );

      // nx
      const side1UVs = [
        [0, 1],
        [0, 0],
        [1, 1],
        [1, 0],
      ].map((uv) =>
        getUVInner(
          textures["all"]
            ? textures["all"]
            : textures["side"]
            ? textures["side"]
            : textures["nx"],
          uv
        )
      );

      // px
      const side2UVs = [
        [0, 1],
        [0, 0],
        [1, 1],
        [1, 0],
      ].map((uv) =>
        getUVInner(
          textures["all"]
            ? textures["all"]
            : textures["side"]
            ? textures["side"]
            : textures["px"],
          uv
        )
      );

      // nz
      const side3UVs = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map((uv) =>
        getUVInner(
          textures["all"]
            ? textures["all"]
            : textures["side"]
            ? textures["side"]
            : textures["nz"],
          uv
        )
      );

      // pz
      const side4UVs = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map((uv) =>
        getUVInner(
          textures["all"]
            ? textures["all"]
            : textures["side"]
            ? textures["side"]
            : textures["pz"],
          uv
        )
      );

      return {
        px: [side2UVs, 1],
        py: [topUVs, 3],
        pz: [side4UVs, 0],
        nx: [side1UVs, 1],
        ny: [bottomUVs, 1],
        nz: [side3UVs, 0],
      };
    } else if (isPlant) {
      const oneUVs = [
        [0, 1],
        [0, 0],
        [1, 1],
        [1, 0],
      ].map((uv) => getUVInner(textures["one"], uv));
      return { one: [oneUVs, 1] };
    }
    return {};
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

  getSummary = () => {
    return this.blocksById;
  };

  get perSide() {
    let i = 1;
    const sqrt = Math.ceil(Math.sqrt(this.textures.size));
    while (i < sqrt) {
      i *= 2;
    }
    return i;
  }

  private makeSideName = (name: string, side: BlockFace) => {
    return `${name.toLowerCase().replace(/\s/g, "_")}__${side.toLowerCase()}`;
  };

  private recordBlock = (block: Block) => {
    const { name, id, faces, isPlant, aabbs } = block;

    const lowerName = name.toLowerCase();
    block.aabbs = aabbs.map(
      ({ minX, minY, minZ, maxX, maxY, maxZ }) =>
        new AABB(minX, minY, minZ, maxX, maxY, maxZ)
    );

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
uniform float uFogNear;
uniform float uFogFar;
uniform float uSunlightIntensity;
uniform float uMinLight;
varying float vAO;
varying vec4 vLight; 
varying vec4 vWorldPosition;
`
        )
        .replace(
          "#include <envmap_fragment>",
          `
#include <envmap_fragment>
float s = min(vLight.a * uSunlightIntensity * 0.8 + uMinLight, 1.0);
float scale = 1.0;
outgoingLight.rgb *= vec3(s + pow(vLight.r, scale), s + pow(vLight.g, scale), s + pow(vLight.b, scale));
outgoingLight *= 0.88 * vAO;
`
        )
        .replace(
          "#include <fog_fragment>",
          `
vec3 fogOrigin = cameraPosition;
float depth = sqrt(pow(vWorldPosition.x - fogOrigin.x, 2.0) + pow(vWorldPosition.z - fogOrigin.z, 2.0));

// float depth = gl_FragCoord.z / gl_FragCoord.w;
float fogFactor = smoothstep(uFogNear, uFogFar, depth);
gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, fogFactor);
`
        ),
      vertexShader: ShaderLib.basic.vertexShader
        .replace(
          "#include <common>",
          `
attribute int light;
varying float vAO;
varying vec4 vLight;
varying vec4 vWorldPosition;
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
int ao = light >> 16;
vAO = ((ao == 0) ? uAOTable.x :
    (ao == 1) ? uAOTable.y :
    (ao == 2) ? uAOTable.z : uAOTable.w) / 255.0; 
vLight = unpackLight(light & ((1 << 16) - 1));
`
        )
        .replace(
          "#include <worldpos_vertex>",
          `
vec4 worldPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  worldPosition = instanceMatrix * worldPosition;
#endif
worldPosition = modelMatrix * worldPosition;
vWorldPosition = worldPosition;
`
        ),

      uniforms: {
        ...UniformsUtils.clone(ShaderLib.basic.uniforms),
        map: this.atlasUniform,
        uSunlightIntensity: this.client.world.uSunlightIntensity,
        uAOTable: this.aoUniform,
        uMinLight: this.minLightUniform,
        uFogNear: this.client.rendering.uFogNear,
        uFogFar: this.client.rendering.uFogFar,
        uFogColor: this.client.rendering.uFogColor,
      },
    }) as CustomShaderMaterial;

    material.map = this.atlasUniform.value;

    return material;
  };
}

export type { RegistryParams, CustomShaderMaterial };

export { Registry };
