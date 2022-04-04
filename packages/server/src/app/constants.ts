import { Coords2, Coords3, SixFaces } from "@voxelize/common";

/**
 * All adjacent voxel neighbors, including the y-axis.
 */
export const VOXEL_NEIGHBORS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [0, 1, 0],
  [0, -1, 0],
];

/**
 * All horizontal neighbors.
 */
export const ADJACENT_NEIGHBORS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/**
 * Horizontal neighbors, 3x3 - 1 = 8 in total.
 */
export const HORIZONTAL_NEIGHBORS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

type CornerData = {
  pos: Coords3;
  uv: Coords2;
};

/**
 * Essential data for meshing a single block. Contains what UV's to use for each block face.
 */
export const BLOCK_FACES: {
  dir: Coords3;
  side: keyof SixFaces;
  corners: [CornerData, CornerData, CornerData, CornerData];
}[] = [
  // viewing from -x to +x (head towards +y) (indices):
  // 0 1 2
  // 3 i 4 (i for irrelevant)
  // 5 6 7

  // corners:
  // 0,1,1  0,1,0
  // 0,0,1  0,0,0

  // left
  {
    dir: [-1, 0, 0],
    side: "nx",
    corners: [
      {
        pos: [0, 1, 0],
        uv: [0, 1],
      },
      {
        pos: [0, 0, 0],
        uv: [0, 0],
      },
      {
        pos: [0, 1, 1],
        uv: [1, 1],
      },
      {
        pos: [0, 0, 1],
        uv: [1, 0],
      },
    ],
  },
  // viewing from +x to -x (head towards +y) (indices):
  // 2 1 0
  // 4 i 3 (i for irrelevant)
  // 7 6 5

  // corners:
  // 1,1,1  1,1,0
  // 1,0,1  1,0,0

  // right
  {
    dir: [1, 0, 0],
    side: "px",
    corners: [
      {
        pos: [1, 1, 1],
        uv: [0, 1],
      },
      {
        pos: [1, 0, 1],
        uv: [0, 0],
      },
      {
        pos: [1, 1, 0],
        uv: [1, 1],
      },
      {
        pos: [1, 0, 0],
        uv: [1, 0],
      },
    ],
  },
  // viewing from -y to +y (head towards +z) (indices):
  // 0 1 2
  // 3 i 4 (i for irrelevant)
  // 5 6 7

  // corners:
  // 0,0,1  1,0,1
  // 0,0,0  1,0,0

  // bottom
  {
    dir: [0, -1, 0],
    side: "ny",
    corners: [
      {
        pos: [1, 0, 1],
        uv: [1, 0],
      },
      {
        pos: [0, 0, 1],
        uv: [0, 0],
      },
      {
        pos: [1, 0, 0],
        uv: [1, 1],
      },
      {
        pos: [0, 0, 0],
        uv: [0, 1],
      },
    ],
  },
  // viewing from -y to +y (head towards +z) (indices):
  // 0 1 2
  // 3 i 4 (i for irrelevant)
  // 5 6 7

  // corners:
  // 0,0,1  1,0,1
  // 0,0,0  1,0,0

  // bottom
  {
    dir: [0, 1, 0],
    side: "py",
    corners: [
      {
        pos: [0, 1, 1],
        uv: [1, 1],
      },
      {
        pos: [1, 1, 1],
        uv: [0, 1],
      },
      {
        pos: [0, 1, 0],
        uv: [1, 0],
      },
      {
        pos: [1, 1, 0],
        uv: [0, 0],
      },
    ],
  },
  // viewing from -z to +z (head towards +y) (indices):
  // 0 1 2
  // 3 i 4 (i for irrelevant)
  // 5 6 7

  // corners:
  // 1,1,0  0,1,0
  // 1,0,0  0,0,0

  // back
  {
    dir: [0, 0, -1],
    side: "nz",
    corners: [
      {
        pos: [1, 0, 0],
        uv: [0, 0],
      },
      {
        pos: [0, 0, 0],
        uv: [1, 0],
      },
      {
        pos: [1, 1, 0],
        uv: [0, 1],
      },
      {
        pos: [0, 1, 0],
        uv: [1, 1],
      },
    ],
  },
  // viewing from +z to -z (head towards +y) (indices):
  // 2 1 0
  // 4 i 3 (i for irrelevant)
  // 7 6 5

  // corners:
  // 0,1,1  1,1,1
  // 0,0,1  1,0,1

  // front
  {
    dir: [0, 0, 1],
    side: "pz",
    corners: [
      {
        pos: [0, 0, 1],
        uv: [0, 0],
      },
      {
        pos: [1, 0, 1],
        uv: [1, 0],
      },
      {
        pos: [0, 1, 1],
        uv: [0, 1],
      },
      {
        pos: [1, 1, 1],
        uv: [1, 1],
      },
    ],
  },
];
