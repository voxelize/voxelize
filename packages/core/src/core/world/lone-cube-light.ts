import { BufferAttribute, Mesh, Object3D, Vector3 } from "three";

import { computeQuadLightTwist } from "./quad-light";

/**
 * A lone full cube lit as the chunk mesher lights it standing in a cell, for
 * a one-voxel box that moves through the world on the chunk materials (a
 * block falling, say): every face corner's occlusion and smooth light from
 * the 26 cells round the cell it is in, the water it touches, and the
 * diagonal each face's quad splits along. Relit cell by cell as it moves, it
 * darkens as it passes into the dark exactly as a block placed in each cell
 * would, and where it comes to rest it matches the block meshed there.
 *
 * A port of the opaque full-cube case of the mesher's
 * `compute_face_ao_and_light` (`crates/mesher/src/mesher/lighting.rs`) and
 * `quad_flips` (`greedy.rs`). The mesher's
 * `a_lone_cube_in_a_lit_corner_bakes_its_pinned_corners` and the test beside
 * this file pin the same corners; change one, change both.
 */

/** The cells round the cube, by offset from it. The cube's own cell is the
 * cube: opaque and unlit, whatever the world holds there while it moves. */
export type LoneCubeNeighborhood = {
  isOpaque(dx: number, dy: number, dz: number): boolean;
  /** Sunlight, red, green, blue. */
  lights(
    dx: number,
    dy: number,
    dz: number,
  ): readonly [number, number, number, number];
  /** Whether the cell holds a fluid or is waterlogged. */
  isWet(dx: number, dy: number, dz: number): boolean;
};

export type LoneCubeCorner = { ao: number; light: number };

const LIGHT_MASK = 0xffff;
const AO_SHIFT = 16;
const AO_MASK = 0x3 << AO_SHIFT;
const WATER_EXPOSED_BIT = 1 << 21;
const EMISSIVE_BIT = 1 << 30;

const vertexAo = (side1: boolean, side2: boolean, corner: boolean) => {
  const s1 = side1 ? 0 : 1;
  const s2 = side2 ? 0 : 1;
  const c = corner ? 0 : 1;
  if (s1 === 1 && s2 === 1) return 0;
  return 3 - (s1 + s2 + c);
};

const pack = (sun: number, red: number, green: number, blue: number) =>
  (sun << 12) | (red << 8) | (green << 4) | blue;

/**
 * The occlusion (0..3) and packed light the mesher bakes into the corner
 * of the cube at `corner` (each 0 or 1) on the face toward `dir`.
 */
export function loneCubeCorner(
  dir: readonly [number, number, number],
  corner: readonly [number, number, number],
  cells: LoneCubeNeighborhood,
): LoneCubeCorner {
  const opaque = (x: number, y: number, z: number) =>
    x === 0 && y === 0 && z === 0 ? true : cells.isOpaque(x, y, z);
  const lightsAt = (x: number, y: number, z: number) =>
    x === 0 && y === 0 && z === 0
      ? ([0, 0, 0, 0] as const)
      : cells.lights(x, y, z);

  const dx = corner[0] <= 0.01 ? -1 : 1;
  const dy = corner[1] <= 0.01 ? -1 : 1;
  const dz = corner[2] <= 0.01 ? -1 : 1;

  const b011 = !opaque(0, dy, dz);
  const b101 = !opaque(dx, 0, dz);
  const b110 = !opaque(dx, dy, 0);
  const b111 = !opaque(dx, dy, dz);
  const ao =
    Math.abs(dir[0]) === 1
      ? vertexAo(b110, b101, b111)
      : Math.abs(dir[1]) === 1
        ? vertexAo(b110, b011, b111)
        : vertexAo(b011, b101, b111);

  let sumSun = 0;
  let sumRed = 0;
  let sumGreen = 0;
  let sumBlue = 0;
  let count = 0;
  for (let x = 0; x <= 1; x++) {
    for (let y = 0; y <= 1; y++) {
      for (let z = 0; z <= 1; z++) {
        const ddx = x * dx;
        const ddy = y * dy;
        const ddz = z * dz;
        const [sun, red, green, blue] = lightsAt(ddx, ddy, ddz);
        if (sun === 0 && red === 0 && green === 0 && blue === 0) continue;

        const outward = dir[0] * ddx + dir[1] * ddy + dir[2] * ddz;
        if (opaque(ddx, ddy, ddz) && outward <= 0) continue;

        if (outward === 0 && opaque(ddx * dir[0], ddy * dir[1], ddz * dir[2])) {
          continue;
        }

        if (Math.abs(ddx) + Math.abs(ddy) + Math.abs(ddz) === 3) {
          const yz = opaque(0, ddy, ddz);
          const xz = opaque(ddx, 0, ddz);
          const xy = opaque(ddx, ddy, 0);
          if (yz && xz && xy) continue;
          if (xy && xz && opaque(0, ddy, 0) && opaque(0, 0, ddz)) continue;
          if (xy && yz && opaque(ddx, 0, 0) && opaque(0, 0, ddz)) continue;
          if (xz && yz && opaque(ddx, 0, 0) && opaque(0, ddy, 0)) continue;
        }

        sumSun += sun;
        sumRed += red;
        sumGreen += green;
        sumBlue += blue;
        count += 1;
      }
    }
  }

  if (count > 0) {
    return {
      ao,
      light: pack(
        Math.floor(sumSun / count),
        Math.floor(sumRed / count),
        Math.floor(sumGreen / count),
        Math.floor(sumBlue / count),
      ),
    };
  }
  const [sun, red, green, blue] = lightsAt(dir[0], dir[1], dir[2]);
  return { ao, light: pack(sun, red, green, blue) };
}

/**
 * Whether a quad's four corners (in emission order) split along their
 * `1-2` diagonal rather than `0-3` (the mesher's `quad_flips`).
 */
export function loneCubeQuadFlips(
  aos: readonly number[],
  lights: readonly number[],
): boolean {
  const channel = (shift: number) => lights.map((l) => (l >> shift) & 0xf);
  const fequals = aos[0] + aos[3] === aos[1] + aos[2];
  let isTwisted = false;
  for (const shift of [8, 4, 0]) {
    const [a, b, c, d] = channel(shift);
    const hasDark = a <= 0 || b <= 0 || c <= 0 || d <= 0;
    const ozao = a + d < b + c && fequals;
    const mid = (a + d) / 2;
    const anzp1 = (b > mid && mid > c) || (c > mid && mid > b);
    if (ozao || (hasDark && anzp1)) isTwisted = true;
  }
  return aos[0] + aos[3] > aos[1] + aos[2] || isTwisted;
}

const corner = new Vector3();
const normal = new Vector3();
const lowest = new Vector3();

/** Where `object`'s geometry sits in its parent: a box mesh carries its
 * placement (quantized positions' scale and bias) as a fixed matrix. */
const placementOf = (object: Object3D) => {
  if (object.matrixAutoUpdate) object.updateMatrix();
  return object.matrix;
};

/**
 * Relights every quad of a one-voxel box of a full opaque cube (its lowest
 * corner at the box's origin) as the mesher lights that cube in the cell
 * `cells` describes: the light and occlusion bits of each vertex, the
 * water-contact bit, the split of each quad and the light twist that rides
 * it. Everything else each vertex carries (tint, greedy and stack bits)
 * stays as the box was baked. Returns how many quads it relit.
 */
export function relightLoneCube(
  box: Object3D,
  cells: LoneCubeNeighborhood,
): number {
  // The cube's lowest corner, wherever the box laid its geometry out.
  lowest.set(Infinity, Infinity, Infinity);
  box.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const position = object.geometry.getAttribute("position");
    if (!position) return;
    const placement = placementOf(object);
    for (let v = 0; v < position.count; v++) {
      lowest.min(
        corner.fromBufferAttribute(position, v).applyMatrix4(placement),
      );
    }
  });
  if (!Number.isFinite(lowest.x)) return 0;

  let relit = 0;
  box.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const geometry = object.geometry;
    const position = geometry.getAttribute("position");
    const normals = geometry.getAttribute("normal");
    const light = geometry.getAttribute("light") as BufferAttribute | undefined;
    const index = geometry.getIndex();
    if (!position || !normals || !light || !index) return;
    const placement = placementOf(object);
    const words = light.array as Int32Array | Uint32Array;
    const indices = index.array;

    for (let i = 0; i + 5 < indices.length; i += 6) {
      const n = indices[i];
      if (indices[i + 1] !== n + 1 || n + 3 >= light.count) continue;
      normal.fromBufferAttribute(normals, n);
      const dir: [number, number, number] = [
        Math.round(normal.x),
        Math.round(normal.y),
        Math.round(normal.z),
      ];
      if (Math.abs(dir[0]) + Math.abs(dir[1]) + Math.abs(dir[2]) !== 1) {
        continue;
      }
      const aos = [0, 0, 0, 0];
      const lights = [0, 0, 0, 0];
      for (let k = 0; k < 4; k++) {
        corner
          .fromBufferAttribute(position, n + k)
          .applyMatrix4(placement)
          .sub(lowest);
        const lit = loneCubeCorner(
          dir,
          [Math.round(corner.x), Math.round(corner.y), Math.round(corner.z)],
          cells,
        );
        aos[k] = lit.ao;
        lights[k] = lit.light;
      }
      const isWet = cells.isWet(dir[0], dir[1], dir[2]);
      for (let k = 0; k < 4; k++) {
        const old = words[n + k];
        const isEmissive = (old & EMISSIVE_BIT) !== 0;
        let word =
          old & ~(LIGHT_MASK | WATER_EXPOSED_BIT | (isEmissive ? 0 : AO_MASK));
        word |= lights[k];
        if (!isEmissive) word |= aos[k] << AO_SHIFT;
        if (isWet) word |= WATER_EXPOSED_BIT;
        words[n + k] = word;
      }
      const order = loneCubeQuadFlips(aos, lights)
        ? [n, n + 1, n + 3, n + 3, n + 2, n]
        : [n, n + 1, n + 2, n + 2, n + 1, n + 3];
      for (let k = 0; k < 6; k++) indices[i + k] = order[k];
      relit += 1;
    }

    light.needsUpdate = true;
    index.needsUpdate = true;
    const twist = geometry.getAttribute("lightTwist") as
      | BufferAttribute
      | undefined;
    if (twist) {
      const fresh = computeQuadLightTwist(words, indices);
      if (fresh.length === twist.array.length) {
        (twist.array as Uint8Array).set(fresh);
        twist.needsUpdate = true;
      } else {
        geometry.setAttribute("lightTwist", new BufferAttribute(fresh, 4));
      }
    }
  });
  return relit;
}
