import { Group, Matrix4, Mesh, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { Coords3 } from "../../types";

import { Block, BlockRotation, PY_ROTATION } from "./block";
import { BlockAnimation, BlockAnimations } from "./block-animations";

const DOOR_ID = 700;
const DOOR_TOP_ID = 701;
const CHUNK_SIZE = 16;
const THICKNESS = 1 / 16;
const SWING_MS = 320;

const doorHinge: BlockAnimation = {
  pivot: [THICKNESS, 0, THICKNESS],
  axis: [0, 1, 0],
  restPose: ({ stage }) => ({ angle: stage === 1 ? -Math.PI / 2 : 0 }),
  durationMs: SWING_MS,
};

function block(
  overrides: Partial<Block> & { id: number; name: string },
): Block {
  return {
    rotatable: false,
    yRotatable: true,
    coupledParts: [],
    isCoupledAnchor: false,
    isAnimated: true,
    ...overrides,
  } as Block;
}

const blocks = new Map<number, Block>([
  [
    DOOR_ID,
    block({
      id: DOOR_ID,
      name: "Oak Door",
      isCoupledAnchor: true,
      coupledParts: [{ offset: [0, 1, 0], id: DOOR_TOP_ID }],
    }),
  ],
  [
    DOOR_TOP_ID,
    block({
      id: DOOR_TOP_ID,
      name: "Oak Door Top",
      coupledParts: [{ offset: [0, -1, 0], id: DOOR_ID }],
    }),
  ],
]);

function pack(id: number, yRotation: number, stage: number): number {
  return id | (PY_ROTATION << 16) | (yRotation << 20) | (stage << 24);
}

/** A world of nothing but the voxels a test writes into it. */
class Host {
  voxels = new Map<string, number>();

  set(voxel: Coords3, raw: number) {
    this.voxels.set(voxel.join(","), raw);
  }

  getBlockByIdSafe = (id: number) => blocks.get(id);

  getRawVoxelAt = (vx: number, vy: number, vz: number) =>
    this.voxels.get(`${vx},${vy},${vz}`) ?? 0;
}

/**
 * A chunk mesh as `buildChunkMesh` leaves it: parked at the chunk origin,
 * in the chunk's group (a mesh that has left its group is no longer moved).
 */
function placedMesh(voxel: Coords3): Mesh {
  const mesh = new Mesh();
  const cx = Math.floor(voxel[0] / CHUNK_SIZE);
  const cz = Math.floor(voxel[2] / CHUNK_SIZE);
  mesh.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;
  mesh.userData.animatedAt = [...voxel];
  new Group().add(mesh);
  return mesh;
}

/**
 * The eight corners of a slab, turned the way the mesher turns geometry
 * (about the cell centre, by the voxel's y-rotation), in world space.
 */
function slabCorners(
  voxel: Coords3,
  yRotation: number,
  min: Coords3,
  max: Coords3,
): Vector3[] {
  const rotation = BlockRotation.encode(PY_ROTATION, yRotation);
  const corners: Vector3[] = [];
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        const node: Coords3 = [x, y, z];
        rotation.rotateNode(node, true, true);
        corners.push(
          new Vector3(
            node[0] + voxel[0],
            node[1] + voxel[1],
            node[2] + voxel[2],
          ),
        );
      }
    }
  }
  return corners;
}

/** World-space corners of the open leaf as the mesh currently poses them. */
function posedOpenCorners(
  mesh: Mesh,
  voxel: Coords3,
  yRotation: number,
): Vector3[] {
  const cx = Math.floor(voxel[0] / CHUNK_SIZE);
  const cz = Math.floor(voxel[2] / CHUNK_SIZE);
  return slabCorners(
    voxel,
    yRotation,
    [THICKNESS, 0, 0],
    [2 * THICKNESS, 1, 1],
  ).map((corner) =>
    corner
      .sub(new Vector3(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE))
      .applyMatrix4(mesh.matrix),
  );
}

function sortedKey(points: Vector3[]): string[] {
  return points
    .map((p) => [p.x, p.y, p.z].map((n) => n.toFixed(4)).join(","))
    .sort();
}

function sectionOf(voxel: Coords3): [number, number, number] {
  return [
    Math.floor(voxel[0] / CHUNK_SIZE),
    Math.floor(voxel[2] / CHUNK_SIZE),
    0,
  ];
}

describe("BlockAnimations", () => {
  describe.each([0, 4, 8, 12])("a door facing y-rotation %i", (yRotation) => {
    const voxel: Coords3 = [37, 64, -21];

    function openingDoor() {
      const host = new Host();
      const animations = new BlockAnimations(host);
      animations.register(["Oak Door", "Oak Door Top"], doorHinge);

      host.set(voxel, pack(DOOR_ID, yRotation, 0));
      const closed = placedMesh(voxel);
      animations.handleSectionMeshed(...sectionOf(voxel), [closed], 0);
      expect(animations.activeCount).toBe(0);

      host.set(voxel, pack(DOOR_ID, yRotation, 1));
      const open = placedMesh(voxel);
      const rest = open.matrix.clone();
      animations.handleSectionMeshed(...sectionOf(voxel), [open], 1000);
      return { animations, open, rest };
    }

    it("starts the open leaf exactly where the closed leaf was", () => {
      const { animations, open } = openingDoor();
      expect(animations.activeCount).toBe(1);

      const closedCorners = slabCorners(
        voxel,
        yRotation,
        [0, 0, 0],
        [1, 1, THICKNESS],
      );
      expect(sortedKey(posedOpenCorners(open, voxel, yRotation))).toEqual(
        sortedKey(closedCorners),
      );
    });

    it("comes to rest on its own geometry when the swing is over", () => {
      const { animations, open, rest } = openingDoor();
      animations.update(1000 + SWING_MS / 2);
      expect(open.matrix.equals(rest)).toBe(false);

      animations.update(1000 + SWING_MS);
      expect(animations.activeCount).toBe(0);
      expect(open.matrix.equals(rest)).toBe(true);
    });

    it("keeps the leaf inside its own cell all the way through", () => {
      const { animations, open } = openingDoor();
      // The hinge sits at the inner corner of the leaf's hinge-side end, so
      // that one-sixteenth square turns about its own corner and its far
      // point sweeps a hair (√2/16 − 1/16) into the jamb midway. The rest of
      // the leaf, and both rest poses, stay in the cell.
      const hingeSweep = Math.SQRT2 * THICKNESS - THICKNESS + 1e-4;
      for (let step = 0; step <= 10; step++) {
        animations.update(1000 + (SWING_MS * step) / 10);
        for (const corner of posedOpenCorners(open, voxel, yRotation)) {
          expect(corner.x).toBeGreaterThanOrEqual(voxel[0] - hingeSweep);
          expect(corner.x).toBeLessThanOrEqual(voxel[0] + 1 + hingeSweep);
          expect(corner.z).toBeGreaterThanOrEqual(voxel[2] - hingeSweep);
          expect(corner.z).toBeLessThanOrEqual(voxel[2] + 1 + hingeSweep);
        }
      }
    });
  });

  it("carries a swing over onto a remesh that shows the same state", () => {
    const voxel: Coords3 = [3, 10, 3];
    const host = new Host();
    const animations = new BlockAnimations(host);
    animations.register("Oak Door", doorHinge);

    host.set(voxel, pack(DOOR_ID, 0, 0));
    animations.handleSectionMeshed(...sectionOf(voxel), [placedMesh(voxel)], 0);
    host.set(voxel, pack(DOOR_ID, 0, 1));
    const first = placedMesh(voxel);
    animations.handleSectionMeshed(...sectionOf(voxel), [first], 1000);
    animations.update(1100);
    const midway = first.matrix.clone();

    // A neighbour's edit remeshes the section: same voxel state, new mesh.
    const second = placedMesh(voxel);
    animations.handleSectionMeshed(...sectionOf(voxel), [second], 1100);
    expect(animations.activeCount).toBe(1);
    expect(second.matrix.equals(midway)).toBe(true);

    animations.update(1000 + SWING_MS);
    expect(animations.activeCount).toBe(0);
  });

  it("swings back from wherever the leaf is when interrupted", () => {
    const voxel: Coords3 = [3, 10, 3];
    const host = new Host();
    const animations = new BlockAnimations(host);
    animations.register("Oak Door", doorHinge);

    host.set(voxel, pack(DOOR_ID, 0, 0));
    animations.handleSectionMeshed(...sectionOf(voxel), [placedMesh(voxel)], 0);
    host.set(voxel, pack(DOOR_ID, 0, 1));
    const open = placedMesh(voxel);
    animations.handleSectionMeshed(...sectionOf(voxel), [open], 1000);
    animations.update(1100);
    const openCornersMidway = sortedKey(posedOpenCorners(open, voxel, 0));

    // Shut again before the swing finished: the closed geometry must pick
    // up from the same place, not jump back to fully open first.
    host.set(voxel, pack(DOOR_ID, 0, 0));
    const closed = placedMesh(voxel);
    animations.handleSectionMeshed(...sectionOf(voxel), [closed], 1100);
    const closedCornersNow = slabCorners(
      voxel,
      0,
      [0, 0, 0],
      [1, 1, THICKNESS],
    ).map((corner) => corner.applyMatrix4(closed.matrix));
    expect(sortedKey(closedCornersNow)).toEqual(openCornersMidway);
  });

  it("snaps instead of swinging when the door is re-placed facing another way", () => {
    const voxel: Coords3 = [3, 10, 3];
    const host = new Host();
    const animations = new BlockAnimations(host);
    animations.register("Oak Door", doorHinge);

    host.set(voxel, pack(DOOR_ID, 0, 0));
    animations.handleSectionMeshed(...sectionOf(voxel), [placedMesh(voxel)], 0);
    host.set(voxel, pack(DOOR_ID, 4, 1));
    const turned = placedMesh(voxel);
    const rest = turned.matrix.clone();
    animations.handleSectionMeshed(...sectionOf(voxel), [turned], 1000);
    expect(animations.activeCount).toBe(0);
    expect(turned.matrix.equals(rest)).toBe(true);
  });

  it("lets a late leaf join the swing its partner already began", () => {
    const bottom: Coords3 = [3, 15, 3];
    const top: Coords3 = [3, 16, 3];
    const host = new Host();
    const animations = new BlockAnimations(host);
    animations.register(["Oak Door", "Oak Door Top"], doorHinge);

    host.set(bottom, pack(DOOR_ID, 8, 0));
    host.set(top, pack(DOOR_TOP_ID, 8, 0));
    // The two leaves straddle a section boundary and land separately.
    animations.handleSectionMeshed(0, 0, 0, [placedMesh(bottom)], 0);
    animations.handleSectionMeshed(0, 0, 1, [placedMesh(top)], 0);

    host.set(bottom, pack(DOOR_ID, 8, 1));
    host.set(top, pack(DOOR_TOP_ID, 8, 1));
    const bottomMesh = placedMesh(bottom);
    animations.handleSectionMeshed(0, 0, 0, [bottomMesh], 1000);
    const topMesh = placedMesh(top);
    animations.handleSectionMeshed(0, 0, 1, [topMesh], 1080);

    animations.update(1200);
    const rotationOf = (mesh: Mesh) => {
      const m = new Matrix4().copy(mesh.matrix);
      m.setPosition(0, 0, 0);
      return m.elements.map((n) => n.toFixed(6));
    };
    expect(rotationOf(topMesh)).toEqual(rotationOf(bottomMesh));

    animations.update(1000 + SWING_MS);
    expect(animations.activeCount).toBe(0);
  });

  it("forgets a section's voxels when it unloads", () => {
    const voxel: Coords3 = [3, 10, 3];
    const host = new Host();
    const animations = new BlockAnimations(host);
    animations.register("Oak Door", doorHinge);

    host.set(voxel, pack(DOOR_ID, 0, 0));
    animations.handleSectionMeshed(...sectionOf(voxel), [placedMesh(voxel)], 0);
    host.set(voxel, pack(DOOR_ID, 0, 1));
    animations.handleSectionMeshed(
      ...sectionOf(voxel),
      [placedMesh(voxel)],
      1000,
    );
    expect(animations.activeCount).toBe(1);

    animations.handleSectionUnloaded(...sectionOf(voxel));
    expect(animations.activeCount).toBe(0);

    // Loaded again later: the door is simply open, nothing to swing from.
    const reloaded = placedMesh(voxel);
    const rest = reloaded.matrix.clone();
    animations.handleSectionMeshed(...sectionOf(voxel), [reloaded], 5000);
    expect(animations.activeCount).toBe(0);
    expect(reloaded.matrix.equals(rest)).toBe(true);
  });
});
