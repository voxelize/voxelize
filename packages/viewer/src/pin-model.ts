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
  type Color,
  Group,
  Mesh,
  NearestFilter,
  NodeMaterial,
  SRGBColorSpace,
  type Texture,
  type UniformNode,
  type Vector3,
  type Vector4,
} from "three/webgpu";
import {
  abs,
  Discard,
  dot,
  Fn,
  max,
  mix,
  normalize,
  normalWorld,
  select,
  texture,
  uv,
  vec3,
  vec4,
} from "three/tsl";

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
export type PinLighting = {
  sunDirection: UniformNode<"vec3", Vector3>;
  sunColor: UniformNode<"vec3", Color>;
  sunlightIntensity: UniformNode<"float", number>;
  ambientColor: UniformNode<"vec3", Color>;
  minLightLevel: UniformNode<"float", number>;
  baseAmbient: UniformNode<"float", number>;
  faceShades: UniformNode<"vec4", Vector4>;
};

const D = CHUNK_DAYLIGHT;

/**
 * The chunk shader's open-face daylight (CHUNK_DAYLIGHT) on the banner's
 * texels, without fog: a pin should read at any distance.
 */
function pinMaterial(map: Texture, l: PinLighting): NodeMaterial {
  const material = new NodeMaterial();
  material.name = "viewer-pin";
  material.fog = false;
  material.lights = false;
  material.fragmentNode = Fn(() => {
    const texel = texture(map, uv());
    Discard(texel.a.lessThan(0.5));
    const albedo = texel.rgb;
    const normal = normalize(normalWorld).toVar("pinNormal");
    const ndotl = max(
      dot(normal, l.sunDirection).mul(D.sunWrap.scale).add(D.sunWrap.bias),
      0,
    );
    const sun = l.sunColor.mul(ndotl).mul(l.sunlightIntensity);
    const hemisphere = normal.y.mul(0.5).add(0.5);
    const skyAmbient = mix(
      l.ambientColor.mul(D.groundAmbient),
      l.ambientColor,
      hemisphere,
    );
    const ambientFloor = max(l.minLightLevel.add(l.baseAmbient), 0);
    const globalAmbient = vec3(...D.starlight).add(
      l.ambientColor.mul(ambientFloor),
    );
    const a = abs(normal);
    const weights = a.div(max(a.x.add(a.y).add(a.z), 0.0001));
    const verticalShade = select(
      normal.y.greaterThan(0),
      l.faceShades.w,
      l.faceShades.z,
    );
    const faceShade = weights.x
      .mul(l.faceShades.x)
      .add(weights.z.mul(l.faceShades.y))
      .add(weights.y.mul(verticalShade));
    const light = skyAmbient
      .add(sun)
      .add(globalAmbient)
      .mul(vec3(...D.daylightBalance))
      .mul(faceShade)
      .toVar("pinLight");
    const { a: ta, b: tb, c: tc, d: td, e: te } = D.toneMap;
    const mapped = light
      .mul(light.mul(ta).add(tb))
      .div(light.mul(light.mul(tc).add(td)).add(te));
    return vec4(albedo.mul(max(mapped, vec3(ambientFloor).mul(faceShade))), 1);
  })();
  return material;
}

/** One pin's voxel banner; `group` stands on the ground at its origin. */
export class PinModel {
  readonly group = new Group();

  private texture: Texture;

  private material: NodeMaterial;

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
    this.material = pinMaterial(this.texture, lighting);
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
