import { BatchedMesh, MeshBasicMaterial, Object3D } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChunkLayer, type ChunkShadowCasters } from "./chunk-layer";
import type { ViewerMaterials } from "./materials";
import type { MeshedChunk, MeshGroup, MeshWorkerResult } from "./mesh-worker";

class StubWorker {
  static last: StubWorker | null = null;
  onmessage: ((event: MessageEvent<MeshWorkerResult>) => void) | null = null;
  posted: { type: string; id?: number }[] = [];
  constructor() {
    StubWorker.last = this;
  }
  postMessage(message: { type: string; id?: number }) {
    this.posted.push(message);
  }
  terminate() {}
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function group(material: string): MeshGroup {
  return {
    material,
    quantized: false,
    minY: 64,
    maxY: 64,
    positions: new Float32Array([0, 64, 0, 1, 64, 0, 0, 64, 1]),
    uvs: new Float32Array(6),
    lights: new Int32Array(3),
    indices: new Uint32Array([0, 1, 2]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    lightTwist: new Uint8Array(12),
    biomeTint: new Uint8Array(9),
  };
}

function chunk(cx: number, cz: number): MeshedChunk {
  return {
    cx,
    cz,
    key: null,
    empty: false,
    chunkSize: 16,
    summary: null,
    groups: [group("water"), group("stone")],
    vertices: 6,
  };
}

/** Records what a chunk layer keeps out of the shadow maps. */
function recorder() {
  const never = new Set<Object3D>();
  const casters: ChunkShadowCasters = {
    addNeverCaster: (object) => {
      never.add(object);
    },
    removeNeverCaster: (object) => {
      never.delete(object);
    },
  };
  return { never, casters };
}

describe("a chunk layer's arenas", () => {
  it("draws neighbouring chunks of a material as one batch, keeps water out of the shadow maps, and reuses slots after eviction", () => {
    vi.stubGlobal("Worker", StubWorker);
    const water = new MeshBasicMaterial();
    water.userData.skipShadow = true;
    const stone = new MeshBasicMaterial();
    const materials = {
      keyTables: () => ({
        blockKeys: {},
        faceKeys: {},
        quantized: [],
        positionUnits: 1,
      }),
      materialFor: (key: string) => (key === "water" ? water : stone),
      isFluid: (key: string) => key === "water",
      isCutout: () => false,
    } as unknown as ViewerMaterials;
    const layer = new ChunkLayer("http://viewer/chunks", materials, 16, {
      workers: 1,
      // Every arrival lands in the frame it arrives.
      uploadBytesPerFrame: Infinity,
    });
    const { never, casters } = recorder();
    layer.setShadowCasters(casters);

    layer.update(8, 8, 1);
    const worker = StubWorker.last;
    const load = worker?.posted.find((m) => m.type === "load");
    expect(load?.id).toBeDefined();
    worker?.onmessage?.({
      data: {
        type: "loaded",
        id: load?.id ?? 0,
        chunks: [chunk(0, 0), chunk(1, 0)],
        ms: 1,
        bytes: 1,
      },
    } as MessageEvent<MeshWorkerResult>);
    layer.update(8, 8, 1);

    // One group per material, and both chunks in one page's batch.
    const groups = layer.group.children;
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      expect(group.children).toHaveLength(1);
      const batch = group.children[0] as BatchedMesh;
      expect(batch).toBeInstanceOf(BatchedMesh);
      expect(batch.instanceCount).toBe(2);
    }
    expect(layer.poolStats).toMatchObject({ pages: 2, slots: 4 });
    expect(never.size).toBe(1);
    const [waterGroup] = [...never];
    expect((waterGroup.children[0] as BatchedMesh).material).toBe(water);

    // Attached late, a second set of maps still learns of the water.
    const late = recorder();
    layer.setShadowCasters(late.casters);
    expect(late.never.size).toBe(1);
    expect(never.size).toBe(0);

    // Leaving hides the sections and keeps their slots, so the next chunks
    // in reuse them: no page is made or regrown.
    layer.update(16 * 40, 16 * 40, 0);
    expect(layer.poolStats).toMatchObject({ pages: 2, slots: 0, freeSlots: 4 });
    const next = worker?.posted.filter((m) => m.type === "load").at(-1);
    worker?.onmessage?.({
      data: {
        type: "loaded",
        id: next?.id ?? 0,
        chunks: [chunk(40, 40)],
        ms: 1,
        bytes: 1,
      },
    } as MessageEvent<MeshWorkerResult>);
    layer.update(16 * 40, 16 * 40, 0);
    expect(layer.poolStats).toMatchObject({ pages: 2, slots: 2, freeSlots: 2 });
  });
});
