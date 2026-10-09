import { readFileSync } from "node:fs";
import path from "node:path";

import init, { mesh_chunk_fast, set_registry } from "@voxelize/wasm-mesher";
import { beforeAll, describe, expect, it } from "vitest";

import { branchAABBs, type BranchShape, type BranchSocket } from "../branch";

// The client's half of the branch parity check. The fixture holds the blocks
// exactly as the server sends them, a set of neighbourhoods, the geometry the
// server meshed for each and the boxes it collides each branch voxel with
// (server/world/voxels/block/branch_parity_tests.rs writes it). Meshing the
// same neighbourhoods through the worker's registry conversion and the wasm
// mesher, and laying out every branch voxel with `branchAABBs`, must give the
// same numbers, float for float.

type Geometry = {
  voxel: number;
  at: [number, number, number] | null;
  faceName: string | null;
  positions: number[];
  indices: number[];
  uvs: number[];
  lights: number[];
};

type FixtureBlock = {
  id: number;
  name: string;
  branch: BranchShape | null;
  branchSockets: BranchSocket[];
  faces: { regionalTint?: boolean }[];
};

type Fixture = {
  chunkSize: number;
  maxHeight: number;
  light: number;
  blocks: FixtureBlock[];
  scenes: {
    name: string;
    voxels: [number, number, number, number][];
    geometries: Geometry[];
    aabbs: { at: [number, number, number]; aabbs: number[][] }[];
  }[];
};

const fixture: Fixture = JSON.parse(
  readFileSync(path.join(__dirname, "branch-parity.fixture.json"), "utf8"),
);
const wasmPath = path.resolve(
  __dirname,
  "../../../../../../crates/wasm-mesher/pkg/voxelize_wasm_mesher_bg.wasm",
);

const byKey = (a: Geometry, b: Geometry) =>
  a.voxel - b.voxel || String(a.faceName).localeCompare(String(b.faceName));

function chunkOf(voxels: Fixture["scenes"][number]["voxels"]) {
  const { chunkSize, maxHeight, light } = fixture;
  const data = new Uint32Array(chunkSize * maxHeight * chunkSize);
  for (const [x, y, z, raw] of voxels) {
    data[x * maxHeight * chunkSize + y * chunkSize + z] = raw;
  }
  return {
    voxels: data,
    lights: new Uint32Array(data.length).fill(light),
    shape: [chunkSize, maxHeight, chunkSize],
    min: [0, 0, 0],
  };
}

describe("branches mesh and collide the same on the client as on the server", () => {
  beforeAll(async () => {
    // The worker module assigns the worker global `onmessage` on load.
    (globalThis as { onmessage?: unknown }).onmessage = null;
    const { convertRegistryToWasm } = await import("./mesh-worker");
    await init({ module_or_path: readFileSync(wasmPath) });
    set_registry(
      convertRegistryToWasm({
        blocksById: fixture.blocks.map((block) => [block.id, block as never]),
        blocksByName: fixture.blocks.map((block) => [
          block.name.toLowerCase(),
          block as never,
        ]),
      }),
    );
  });

  it("carries every branch, socket and regional tint into the worker", async () => {
    const { convertRegistryToWasm } = await import("./mesh-worker");
    const converted = convertRegistryToWasm({
      blocksById: fixture.blocks.map((block) => [block.id, block as never]),
      blocksByName: [],
    });
    for (const [id, block] of converted.blocksById) {
      const sent = fixture.blocks.find((b) => b.id === id);
      if (!sent) throw new Error(`block ${id} is not in the fixture`);
      expect(block.branch).toEqual(sent.branch ?? null);
      expect(block.branchSockets).toEqual(sent.branchSockets ?? []);
      expect(block.faces.map((face) => face.regionalTint)).toEqual(
        sent.faces.map((face) => face.regionalTint ?? false),
      );
    }
    expect(converted.blocksById.some(([, block]) => block.branch)).toBe(true);
    expect(
      converted.blocksById.some(([, block]) => block.branchSockets.length),
    ).toBe(true);
  });

  for (const scene of fixture.scenes) {
    it(`${scene.name}: the same geometry`, () => {
      const { chunkSize, maxHeight } = fixture;
      const chunks = Array.from({ length: 9 }, (_, i) =>
        i === 4 ? chunkOf(scene.voxels) : null,
      );
      const result = mesh_chunk_fast(
        chunks,
        new Int32Array([0, 0, 0]),
        new Int32Array([chunkSize, maxHeight, chunkSize]),
        chunkSize,
      ) as { geometries: Geometry[] };
      const client = [...result.geometries].sort(byKey);
      const server = [...scene.geometries].sort(byKey);
      // wasm hands back `undefined` where the server's JSON wrote `null`.
      expect(client.map((g) => [g.voxel, g.faceName ?? null])).toEqual(
        server.map((g) => [g.voxel, g.faceName]),
      );
      client.forEach((geometry, i) => {
        const expected = server[i];
        expect(Array.from(geometry.indices)).toEqual(expected.indices);
        expect(Array.from(geometry.lights)).toEqual(expected.lights);
        expect(Array.from(geometry.positions)).toEqual(
          expected.positions.map(Math.fround),
        );
        expect(Array.from(geometry.uvs)).toEqual(expected.uvs.map(Math.fround));
      });
    });

    it(`${scene.name}: the same collision boxes`, () => {
      const voxels = new Map(
        scene.voxels.map(([x, y, z, raw]) => [`${x},${y},${z}`, raw]),
      );
      const raw = (x: number, y: number, z: number) =>
        voxels.get(`${x},${y},${z}`) ?? 0;
      const lookup = {
        getVoxelAt: (x: number, y: number, z: number) => raw(x, y, z) & 0xffff,
        getVoxelStageAt: (x: number, y: number, z: number) =>
          (raw(x, y, z) >>> 24) & 0xf,
        getBlockById: (id: number) => fixture.blocks.find((b) => b.id === id),
      };
      for (const { at, aabbs } of scene.aabbs) {
        const [x, y, z] = at;
        const shape = lookup.getBlockById(lookup.getVoxelAt(x, y, z))?.branch;
        if (!shape) throw new Error(`no branch at ${at}`);
        const client = branchAABBs(shape, x, y, z, lookup).map((a) => [
          a.minX,
          a.minY,
          a.minZ,
          a.maxX,
          a.maxY,
          a.maxZ,
        ]);
        expect(client, `boxes at ${at}`).toEqual(aabbs);
      }
    });
  }
});
