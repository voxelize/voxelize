/**
 * The pin as a voxel object: a survey banner on a wooden pole with a brass
 * finial, built from boxes whose every face shows its texture at the same
 * 16 texels per block (a 9 x 8 texel banner face is a 9 x 8 patch of
 * pixels, never a squashed image), nearest-filtered, and lit by the same
 * sun, sky and face shading the chunk shader gives the terrain around it.
 */
import { CHUNK_DAYLIGHT } from "@voxelize/core";
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Group,
  Mesh,
  NearestFilter,
  ShaderMaterial,
  SRGBColorSpace,
  type Texture,
} from "three";

import {
  paintCap,
  paintCloth,
  paintClothEdge,
  paintFlat,
  paintPole,
} from "./pin-art";

/** Texels per block on every face of the model. */
export const PIN_TEXELS_PER_BLOCK = 16;

type Face = "px" | "nx" | "py" | "ny" | "pz" | "nz";

type Part = {
  name: "pole" | "cap" | "cloth";
  /** Size in texels along x, y, z. */
  size: [number, number, number];
  /** Minimum corner in texels. */
  at: [number, number, number];
};

/**
 * The banner, in texels: a 2x2 pole 26 tall, a 4x2x4 finial and a 9x8
 * cloth on its +x side. The cloth runs half a texel into the pole so the
 * two never share a face.
 */
export const PIN_PARTS: readonly Part[] = [
  { name: "pole", size: [2, 26, 2], at: [-1, 0, -1] },
  { name: "cap", size: [4, 2, 4], at: [-2, 26, -2] },
  { name: "cloth", size: [9, 8, 1], at: [0.5, 17, -0.5] },
];

/** Height of the model in blocks. */
export const PIN_HEIGHT = 28 / PIN_TEXELS_PER_BLOCK;

/** A face's texel width and height as it is seen from outside. */
function faceTexels(
  size: [number, number, number],
  face: Face,
): [number, number] {
  const [x, y, z] = size;
  if (face === "px" || face === "nx") return [z, y];
  if (face === "py" || face === "ny") return [x, z];
  return [x, y];
}

export type FaceRect = {
  part: Part;
  face: Face;
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Shelf-packs every face of every part into an atlas, one texel per pixel. */
export function layoutAtlas(parts: readonly Part[], width = 32) {
  const rects: FaceRect[] = [];
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const part of parts) {
    for (const face of ["pz", "nz", "px", "nx", "py", "ny"] as Face[]) {
      const [fw, fh] = faceTexels(part.size, face).map((v) => Math.ceil(v));
      if (x + fw > width) {
        x = 0;
        y += shelf;
        shelf = 0;
      }
      rects.push({ part, face, x, y, w: fw, h: fh });
      x += fw;
      shelf = Math.max(shelf, fh);
    }
  }
  return { rects, width, height: y + shelf };
}

/**
 * The model's geometry: per face, four corners in blocks, a normal, and UVs
 * spanning exactly the face's texel rectangle (so world size and texture
 * size agree on both axes).
 */
export function buildGeometry(
  rects: readonly FaceRect[],
  atlasWidth: number,
  atlasHeight: number,
): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const t = PIN_TEXELS_PER_BLOCK;
  for (const r of rects) {
    const [sx, sy, sz] = r.part.size.map((v) => v / t);
    const [ax, ay, az] = r.part.at.map((v) => v / t);
    const [bx, by, bz] = [ax + sx, ay + sy, az + sz];
    // Corners listed left-bottom, right-bottom, right-top, left-top as seen
    // from outside the face.
    const corners: Record<Face, number[][]> = {
      pz: [
        [ax, ay, bz],
        [bx, ay, bz],
        [bx, by, bz],
        [ax, by, bz],
      ],
      nz: [
        [bx, ay, az],
        [ax, ay, az],
        [ax, by, az],
        [bx, by, az],
      ],
      px: [
        [bx, ay, bz],
        [bx, ay, az],
        [bx, by, az],
        [bx, by, bz],
      ],
      nx: [
        [ax, ay, az],
        [ax, ay, bz],
        [ax, by, bz],
        [ax, by, az],
      ],
      py: [
        [ax, by, bz],
        [bx, by, bz],
        [bx, by, az],
        [ax, by, az],
      ],
      ny: [
        [ax, ay, az],
        [bx, ay, az],
        [bx, ay, bz],
        [ax, ay, bz],
      ],
    };
    const normal: Record<Face, number[]> = {
      pz: [0, 0, 1],
      nz: [0, 0, -1],
      px: [1, 0, 0],
      nx: [-1, 0, 0],
      py: [0, 1, 0],
      ny: [0, -1, 0],
    };
    const [fw, fh] = faceTexels(r.part.size, r.face);
    const u0 = r.x / atlasWidth;
    const u1 = (r.x + fw) / atlasWidth;
    const v1 = 1 - r.y / atlasHeight;
    const v0 = 1 - (r.y + fh) / atlasHeight;
    const base = positions.length / 3;
    for (const c of corners[r.face]) positions.push(...c);
    for (let i = 0; i < 4; i++) normals.push(...normal[r.face]);
    uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.setAttribute(
    "normal",
    new BufferAttribute(new Float32Array(normals), 3),
  );
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  return geometry;
}

export type PinColors = {
  cloth: string;
  pole: string;
  cap: string;
  letter: string;
};

/** Uniforms the model shares with the chunk shader, so it is lit like the terrain. */
export type PinLighting = Record<
  | "sunDirection"
  | "sunColor"
  | "sunlightIntensity"
  | "ambientColor"
  | "minLightLevel"
  | "baseAmbient"
  | "faceShades",
  { value: unknown }
>;

const D = CHUNK_DAYLIGHT;

const VERTEX = `
varying vec2 vUv;
varying vec3 vNormal;
void main() {
  vUv = uv;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}`;

// The chunk shader's open-face daylight (CHUNK_DAYLIGHT), without fog: a
// pin should read at any distance.
const FRAGMENT = `
uniform sampler2D uMap;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uSunlightIntensity;
uniform vec3 uAmbientColor;
uniform float uMinLightLevel;
uniform float uBaseAmbient;
uniform vec4 uFaceShades;
varying vec2 vUv;
varying vec3 vNormal;
void main() {
  vec4 texel = texture2D(uMap, vUv);
  if (texel.a < 0.5) discard;
  vec3 albedo = texel.rgb;
  vec3 normal = normalize(vNormal);
  float NdotL = max(dot(normal, uSunDirection) * ${D.sunWrap.scale} + ${D.sunWrap.bias}, 0.0);
  vec3 sun = uSunColor * NdotL * uSunlightIntensity;
  float hemisphere = normal.y * 0.5 + 0.5;
  vec3 skyAmbient = mix(uAmbientColor * ${D.groundAmbient}, uAmbientColor, hemisphere);
  float ambientFloor = max(uMinLightLevel + uBaseAmbient, 0.0);
  vec3 globalAmbient = vec3(${D.starlight}) + uAmbientColor * ambientFloor;
  vec3 weights = abs(normal);
  weights /= max(weights.x + weights.y + weights.z, 0.0001);
  float verticalShade = normal.y > 0.0 ? uFaceShades.w : uFaceShades.z;
  float faceShade = weights.x * uFaceShades.x + weights.z * uFaceShades.y + weights.y * verticalShade;
  vec3 light = (skyAmbient + sun + globalAmbient) * vec3(${D.daylightBalance}) * faceShade;
  light = (light * (${D.toneMap.a} * light + ${D.toneMap.b})) / (light * (${D.toneMap.c} * light + ${D.toneMap.d}) + ${D.toneMap.e});
  light = max(light, vec3(ambientFloor) * faceShade);
  gl_FragColor = vec4(albedo * light, 1.0);
}`;

/** One pin's voxel banner; `group` stands on the ground at its origin. */
export class PinModel {
  readonly group = new Group();

  private texture: Texture;

  private material: ShaderMaterial;

  private canvas: HTMLCanvasElement;

  private atlas = layoutAtlas(PIN_PARTS);

  constructor(
    private colors: PinColors,
    private label: string,
    lighting: PinLighting,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.atlas.width;
    this.canvas.height = this.atlas.height;
    this.paint();
    this.texture = new CanvasTexture(this.canvas);
    this.texture.magFilter = NearestFilter;
    this.texture.minFilter = NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = SRGBColorSpace;
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uMap: { value: this.texture },
        uSunDirection: lighting.sunDirection,
        uSunColor: lighting.sunColor,
        uSunlightIntensity: lighting.sunlightIntensity,
        uAmbientColor: lighting.ambientColor,
        uMinLightLevel: lighting.minLightLevel,
        uBaseAmbient: lighting.baseAmbient,
        uFaceShades: lighting.faceShades,
      },
    });
    const mesh = new Mesh(
      buildGeometry(this.atlas.rects, this.atlas.width, this.atlas.height),
      this.material,
    );
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  /** Repaints the banner for a new label or colour. */
  restyle(colors: PinColors, label: string) {
    this.colors = colors;
    this.label = label;
    this.paint();
    this.texture.needsUpdate = true;
  }

  dispose() {
    for (const child of this.group.children) {
      if (child instanceof Mesh) child.geometry.dispose();
    }
    this.material.dispose();
    this.texture.dispose();
  }

  private paint() {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context to paint the pin with");
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const { cloth, pole, cap, letter } = this.colors;
    for (const r of this.atlas.rects) {
      const { x, y, w, h } = r;
      const side = r.face !== "py" && r.face !== "ny";
      if (r.part.name === "pole") {
        if (side) paintPole(ctx, x, y, w, h, pole);
        else paintFlat(ctx, x, y, w, h, pole, r.face === "py" ? 1.1 : 0.6);
      } else if (r.part.name === "cap") {
        if (side) paintCap(ctx, x, y, w, h, cap);
        else paintFlat(ctx, x, y, w, h, cap, r.face === "py" ? 1.15 : 0.7);
      } else if (r.face === "pz" || r.face === "nz") {
        paintCloth(ctx, x, y, w, h, cloth, letter, this.label);
      } else {
        paintClothEdge(ctx, x, y, w, h, cloth);
      }
    }
  }
}
