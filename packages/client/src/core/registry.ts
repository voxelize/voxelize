import {
  Block,
  SharedRegistry,
  BlockFace,
  TextureRange,
} from "@voxelize/common";
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

class Registry extends SharedRegistry {
  public params: RegistryParams;
  public atlas: TextureAtlas;

  public atlasUniform: { value: Texture | null };
  public aoUniform: { value: Vector4 };

  public materials: {
    opaque?: CustomShaderMaterial;
    transparent?: CustomShaderMaterial[];
  } = {};

  private sources: Map<string, string> = new Map();

  constructor(public client: Client, params: Partial<RegistryParams>) {
    super();

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
    this.client.emit("texture-loading");

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
        throw new Error(`Missing texture source for: ${key}`);
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
varying float vAO;
varying vec4 vLight; 
`
        )
        .replace(
          "#include <envmap_fragment>",
          `
#include <envmap_fragment>
float s = max(vLight.a * uSunlightIntensity * 0.8, 0.02);
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
        ...this.client.rendering.fogUniforms,
      },
    }) as CustomShaderMaterial;

    material.map = this.atlasUniform.value;

    return material;
  };
}

export type { RegistryParams };

export { Registry };
