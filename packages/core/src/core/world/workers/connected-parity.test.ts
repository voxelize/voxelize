import { readFileSync } from "node:fs";
import path from "node:path";

import init, { mesh_chunk_fast, set_registry } from "@voxelize/wasm-mesher";
import { beforeAll, describe, expect, it } from "vitest";

// The client's half of the joined-glass parity check. The fixture holds the
// blocks exactly as the server sends them and the geometry the server meshed
// for each neighbourhood (server/world/voxels/block/connected_parity_tests.rs
// writes it); meshing the same neighbourhoods through the worker's registry
// conversion and the wasm mesher must give the same geometry, float for float.

type Geometry = {
  voxel: number;
  at: [number, number, number] | null;
  faceName: string | null;
  positions: number[];
  indices: number[];
  uvs: number[];
  lights: number[];
};

type Fixture = {
  chunkSize: number;
  maxHeight: number;
  light: number;
  blocks: { id: number; name: string }[];
  scenes: {
    name: string;
    voxels: [number, number, number, number][];
    geometries: Geometry[];
  }[];
};

const fixture: Fixture = JSON.parse(
  readFileSync(path.join(__dirname, "connected-parity.fixture.json"), "utf8"),
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
  for (const [x, y, z, id] of voxels) {
    data[x * maxHeight * chunkSize + y * chunkSize + z] = id;
  }
  return {
    voxels: data,
    lights: new Uint32Array(data.length).fill(light),
    shape: [chunkSize, maxHeight, chunkSize],
    min: [0, 0, 0],
  };
}

describe("joined glass meshes the same on the client as on the server", () => {
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

  it("carries every block's connected frame into the worker", async () => {
    const { convertRegistryToWasm } = await import("./mesh-worker");
    const converted = convertRegistryToWasm({
      blocksById: fixture.blocks.map((block) => [block.id, block as never]),
      blocksByName: [],
    });
    for (const [id, block] of converted.blocksById) {
      const sent = fixture.blocks.find((b) => b.id === id) as {
        connected?: unknown;
      };
      expect(block.connected).toEqual(sent.connected ?? null);
    }
    expect(converted.blocksById.some(([, block]) => block.connected)).toBe(
      true,
    );
  });

  for (const scene of fixture.scenes) {
    it(scene.name, () => {
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
  }
});
