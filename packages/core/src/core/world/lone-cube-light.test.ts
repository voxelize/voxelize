import { BufferAttribute, BufferGeometry, Group, Mesh } from "three";
import { describe, expect, it } from "vitest";

import {
  loneCubeCorner,
  loneCubeQuadFlips,
  type LoneCubeNeighborhood,
  relightLoneCube,
} from "./lone-cube-light";
import { computeQuadLightTwist } from "./quad-light";

/** The mesher test's `LitCornerSpace`: ground under the cube, a wall piece
 * at `+x -z`, an overhang at `-x +y +z`, light varying cell to cell. */
const isStone = (x: number, y: number, z: number) =>
  y === -1 ||
  (x === 1 && y === 0 && z === -1) ||
  (x === 1 && y === 1 && z === -1) ||
  (x === -1 && y === 1 && z === 1);

const level = (value: number) => Math.min(15, Math.max(0, value));

const litCorner: LoneCubeNeighborhood = {
  isOpaque: isStone,
  lights: (x, y, z) =>
    isStone(x, y, z)
      ? [0, 0, 0, 0]
      : [level(9 + 3 * y - 2 * x), level(6 + 2 * z - y), 0, level(3 - x - z)],
  isWet: () => false,
};

const DIRS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;

/** The mesher's corner order per face (`compute_face_ao_and_light`), which
 * is also the order the greedy path emits a quad's vertices in. */
const CORNERS: Record<string, [number, number, number][]> = {
  "1,0,0": [
    [1, 1, 1],
    [1, 0, 1],
    [1, 1, 0],
    [1, 0, 0],
  ],
  "-1,0,0": [
    [0, 1, 0],
    [0, 0, 0],
    [0, 1, 1],
    [0, 0, 1],
  ],
  "0,1,0": [
    [0, 1, 1],
    [1, 1, 1],
    [0, 1, 0],
    [1, 1, 0],
  ],
  "0,-1,0": [
    [1, 0, 1],
    [0, 0, 1],
    [1, 0, 0],
    [0, 0, 0],
  ],
  "0,0,1": [
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
  ],
  "0,0,-1": [
    [1, 0, 0],
    [0, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
  ],
};

/** `LIT_CORNER_PINS` in `crates/mesher/src/mesher/tests.rs`. */
const LIT_CORNER_PINS: [number[], number[], boolean][] = [
  [[3, 1, 1, 0], [34305, 30465, 34050, 30210], true],
  [[3, 1, 2, 1], [50180, 46340, 50691, 46851], true],
  [[2, 3, 3, 2], [50435, 46594, 54276, 46083], false],
  [[0, 0, 0, 0], [0, 0, 0, 0], false],
  [[1, 1, 2, 3], [43010, 34817, 42754, 38657], true],
  [[0, 1, 1, 3], [37892, 41988, 41732, 45828], true],
];

/** A one-voxel box laid out as the greedy mesher emits it: a quad per face,
 * its four vertices in corner order, split along `0-3`. */
function boxOf(lightBits = 0): Group {
  const positions: number[] = [];
  const normals: number[] = [];
  const lights: number[] = [];
  const indices: number[] = [];
  for (const dir of DIRS) {
    const n = positions.length / 3;
    for (const corner of CORNERS[dir.join(",")]) {
      positions.push(...corner);
      normals.push(...dir);
      lights.push(lightBits);
    }
    indices.push(n, n + 1, n + 2, n + 2, n + 1, n + 3);
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
  const words = new Int32Array(lights);
  geometry.setAttribute("light", new BufferAttribute(words, 1));
  geometry.setIndex(new BufferAttribute(new Uint32Array(indices), 1));
  geometry.setAttribute(
    "lightTwist",
    new BufferAttribute(computeQuadLightTwist(words, indices), 4),
  );
  const group = new Group();
  group.add(new Mesh(geometry));
  return group;
}

describe("a lone cube lit as the mesher lights it", () => {
  it("bakes the corners the mesher's own test pins", () => {
    const baked = DIRS.map((dir) => {
      const corners = CORNERS[dir.join(",")].map((corner) =>
        loneCubeCorner(dir, corner, litCorner),
      );
      const aos = corners.map(({ ao }) => ao);
      const lights = corners.map(({ light }) => light);
      return [aos, lights, loneCubeQuadFlips(aos, lights)];
    });
    expect(baked).toEqual(LIT_CORNER_PINS);
  });

  it("relights a box's quads in place and keeps the bits it does not own", () => {
    const GREEDY_BIT = 1 << 19;
    const box = boxOf(GREEDY_BIT | 0xffff | (3 << 16));
    expect(relightLoneCube(box, litCorner)).toBe(6);

    const geometry = (box.children[0] as Mesh).geometry;
    const words = geometry.getAttribute("light").array as Int32Array;
    const index = geometry.getIndex();
    expect(index).not.toBeNull();
    const indices = Array.from(index?.array ?? []);
    LIT_CORNER_PINS.forEach(([aos, lights, flips], face) => {
      const n = face * 4;
      for (let k = 0; k < 4; k++) {
        expect(words[n + k] & 0xffff).toBe(lights[k]);
        expect((words[n + k] >> 16) & 3).toBe(aos[k]);
        expect(words[n + k] & GREEDY_BIT).toBe(GREEDY_BIT);
      }
      expect(indices.slice(face * 6, face * 6 + 6)).toEqual(
        flips
          ? [n, n + 1, n + 3, n + 3, n + 2, n]
          : [n, n + 1, n + 2, n + 2, n + 1, n + 3],
      );
    });
    expect(
      Array.from(geometry.getAttribute("lightTwist").array as Uint8Array),
    ).toEqual(Array.from(computeQuadLightTwist(words, indices)));
  });

  it("reads corners through a box mesh's own fixed placement", () => {
    const box = boxOf();
    const mesh = box.children[0] as Mesh;
    // Laid out a cell in and scaled the way quantized boxes are.
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position");
    for (let v = 0; v < position.count; v++) {
      position.setXYZ(
        v,
        (position.getX(v) + 1) * 4,
        (position.getY(v) + 1) * 4,
        (position.getZ(v) + 1) * 4,
      );
    }
    mesh.matrixAutoUpdate = false;
    mesh.matrix.makeScale(0.25, 0.25, 0.25).setPosition(-1, 5, -1);
    relightLoneCube(box, litCorner);
    const words = geometry.getAttribute("light").array as Int32Array;
    LIT_CORNER_PINS.forEach(([, lights], face) => {
      for (let k = 0; k < 4; k++) {
        expect(words[face * 4 + k] & 0xffff).toBe(lights[k]);
      }
    });
    expect(mesh.matrix.elements[0]).toBe(0.25);
  });

  it("marks only the faces that meet water as wet", () => {
    const WATER_EXPOSED_BIT = 1 << 21;
    const box = boxOf();
    relightLoneCube(box, {
      ...litCorner,
      isWet: (x, y, z) => x === 0 && y === 1 && z === 0,
    });
    const words = (box.children[0] as Mesh).geometry.getAttribute("light")
      .array as Int32Array;
    DIRS.forEach((dir, face) => {
      const isTop = dir[1] === 1;
      for (let k = 0; k < 4; k++) {
        expect((words[face * 4 + k] & WATER_EXPOSED_BIT) !== 0).toBe(isTop);
      }
    });
  });

  it("darkens with the cell it stands in, never keeping the light it left", () => {
    const sunlit: LoneCubeNeighborhood = {
      isOpaque: () => false,
      lights: () => [15, 0, 0, 0],
      isWet: () => false,
    };
    const dark: LoneCubeNeighborhood = {
      ...sunlit,
      lights: () => [0, 0, 0, 0],
    };
    const box = boxOf();
    relightLoneCube(box, sunlit);
    const words = (box.children[0] as Mesh).geometry.getAttribute("light")
      .array as Int32Array;
    expect(Array.from(words, (word) => (word >> 12) & 0xf)).toEqual(
      new Array(24).fill(15),
    );
    relightLoneCube(box, dark);
    expect(Array.from(words, (word) => word & 0xffff)).toEqual(
      new Array(24).fill(0),
    );
  });
});
