import { MeshBasicMaterial, Object3D } from "three";
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

/** Records what a chunk layer tells the shadow maps. */
function recorder() {
  const skipped = new Set<Object3D>();
  const casters: ChunkShadowCasters = {
    addSkipShadowObject: (object) => {
      const material = (object as { material?: { userData?: object } }).material
        ?.userData as { skipShadow?: boolean } | undefined;
      if (material?.skipShadow) skipped.add(object);
    },
    removeSkipShadowObject: (object) => {
      skipped.delete(object);
    },
  };
  return { skipped, casters };
}

describe("a chunk layer and the sun's shadow maps", () => {
  it("reports streamed meshes whose material skips shadows, and forgets them on eviction", () => {
    vi.stubGlobal("Worker", StubWorker);
    const water = new MeshBasicMaterial();
    water.userData.skipShadow = true;
    const stone = new MeshBasicMaterial();
    const materials = {
      keyTables: () => ({}),
      materialFor: (key: string) => (key === "water" ? water : stone),
      isFluid: (key: string) => key === "water",
      isCutout: () => false,
    } as unknown as ViewerMaterials;
    const layer = new ChunkLayer("http://viewer/chunks", materials, 16, {
      workers: 1,
    });
    const { skipped, casters } = recorder();
    layer.setShadowCasters(casters);

    layer.update(8, 8, 0);
    const worker = StubWorker.last;
    const load = worker?.posted.find((m) => m.type === "load");
    expect(load?.id).toBeDefined();
    worker?.onmessage?.({
      data: {
        type: "loaded",
        id: load?.id ?? 0,
        chunks: [chunk(0, 0)],
        ms: 1,
        bytes: 1,
      },
    } as MessageEvent<MeshWorkerResult>);
    layer.update(8, 8, 0);

    const meshes = layer.group.children;
    expect(meshes).toHaveLength(2);
    expect(skipped.size).toBe(1);
    const [onlySkipped] = [...skipped];
    expect((onlySkipped as { material?: unknown }).material).toBe(water);

    // Attached late, a second set of maps still learns of what is resident.
    const late = recorder();
    layer.setShadowCasters(late.casters);
    expect(late.skipped.size).toBe(1);
    expect(skipped.size).toBe(0);

    layer.update(16 * 40, 16 * 40, 0);
    expect(layer.group.children).toHaveLength(0);
    expect(late.skipped.size).toBe(0);
  });
});
