/**
 * Off the main thread: fetch a batch of chunk meshes from the viewer
 * server, decode them, merge each chunk's geometries by the material they
 * render with (every level into one block-space geometry), and derive the
 * attributes the chunk shader reads beside position, uv and light — flat
 * normals, the quad light twist and the biome tint — with the engine's own
 * helpers. The main thread only wraps the arrays in buffers.
 */
import { biomeTintAttribute } from "../../core/src/core/world/biome-tint";
import { computeNormalsFromBuffers } from "../../core/src/core/world/chunk-normals";
import { computeQuadLightTwist } from "../../core/src/core/world/quad-light";

import { decodeBundle, decodeChunkMesh, type MeshGeometry } from "./formats";

export type MeshWorkerInit = {
  type: "init";
  /** Material key of each block id's atlas faces. */
  blockKeys: Record<number, string>;
  /** Material key of an own-texture face, keyed `${id}:${face}`. */
  faceKeys: Record<string, string>;
};

export type MeshWorkerLoad = {
  type: "load";
  id: number;
  url: string;
  body: string;
};

export type MeshGroup = {
  material: string;
  positions: Float32Array;
  uvs: Float32Array;
  lights: Int32Array;
  indices: Uint32Array;
  normals: Float32Array;
  lightTwist: Uint8Array;
  biomeTint: Uint8Array;
};

export type MeshedChunk = {
  cx: number;
  cz: number;
  key: string | null;
  empty: boolean;
  chunkSize: number;
  summary: {
    top: Uint16Array;
    topId: Uint16Array;
    ground: Uint16Array;
    groundId: Uint16Array;
    water: Uint16Array;
  } | null;
  groups: MeshGroup[];
  vertices: number;
};

export type MeshWorkerResult =
  | {
      type: "loaded";
      id: number;
      chunks: MeshedChunk[];
      ms: number;
      bytes: number;
    }
  | { type: "failed"; id: number; error: string };

let blockKeys: Record<number, string> = {};
let faceKeys: Record<string, string> = {};

function materialOf(geometry: MeshGeometry): string {
  if (geometry.faceName) {
    const own = faceKeys[`${geometry.voxel}:${geometry.faceName}`];
    if (own) return own;
  }
  return blockKeys[geometry.voxel] ?? String(geometry.voxel);
}

function merge(
  parts: MeshGeometry[],
  levelHeight: number,
  tints: Uint8Array | null,
  chunkSize: number,
  material: string,
): MeshGroup {
  let vertices = 0;
  let indexCount = 0;
  for (const p of parts) {
    vertices += p.lights.length;
    indexCount += p.indices.length;
  }
  const positions = new Float32Array(vertices * 3);
  const uvs = new Float32Array(vertices * 2);
  const lights = new Int32Array(vertices);
  const indices = new Uint32Array(indexCount);
  const lightTwist = new Uint8Array(vertices * 4);
  let v = 0;
  let i = 0;
  for (const p of parts) {
    const base = p.level * levelHeight;
    const n = p.lights.length;
    for (let k = 0; k < n; k++) {
      positions[(v + k) * 3] = p.positions[k * 3];
      positions[(v + k) * 3 + 1] = p.positions[k * 3 + 1] + base;
      positions[(v + k) * 3 + 2] = p.positions[k * 3 + 2];
    }
    uvs.set(p.uvs, v * 2);
    lights.set(p.lights, v);
    lightTwist.set(computeQuadLightTwist(p.lights, p.indices), v * 4);
    for (let k = 0; k < p.indices.length; k++)
      indices[i + k] = p.indices[k] + v;
    v += n;
    i += p.indices.length;
  }
  const normals = computeNormalsFromBuffers(positions, indices);
  const biomeTint = biomeTintAttribute(
    positions,
    lights,
    tints ?? undefined,
    chunkSize,
  ).array as Uint8Array;
  return {
    material,
    positions,
    uvs,
    lights,
    indices,
    normals,
    lightTwist,
    biomeTint,
  };
}

async function load(message: MeshWorkerLoad): Promise<MeshWorkerResult> {
  const started = performance.now();
  const response = await fetch(message.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: message.body,
  });
  if (!response.ok) {
    return {
      type: "failed",
      id: message.id,
      error: `${response.status} ${await response.text()}`,
    };
  }
  const buffer = await response.arrayBuffer();
  const chunks: MeshedChunk[] = [];
  for (const entry of decodeBundle<{
    cx: number;
    cz: number;
    key?: string;
    empty?: boolean;
    error?: string;
  }>(buffer)) {
    const { header } = entry;
    if (header.error) throw new Error(header.error);
    if (header.empty || entry.length === 0) {
      chunks.push({
        cx: header.cx,
        cz: header.cz,
        key: null,
        empty: true,
        chunkSize: 0,
        summary: null,
        groups: [],
        vertices: 0,
      });
      continue;
    }
    const mesh = decodeChunkMesh(buffer, entry.offset, entry.length);
    const byMaterial = new Map<string, MeshGeometry[]>();
    for (const g of mesh.geometries) {
      if (g.lights.length === 0) continue;
      const material = materialOf(g);
      const list = byMaterial.get(material);
      if (list) list.push(g);
      else byMaterial.set(material, [g]);
    }
    const groups: MeshGroup[] = [];
    let vertices = 0;
    for (const [material, parts] of byMaterial) {
      const group = merge(
        parts,
        mesh.levelHeight,
        mesh.biomeTints,
        mesh.chunkSize,
        material,
      );
      vertices += group.lights.length;
      groups.push(group);
    }
    // The file may be shared by every chunk with the same neighbourhood; the
    // request names where this one goes.
    chunks.push({
      cx: header.cx,
      cz: header.cz,
      key: header.key ?? null,
      empty: false,
      chunkSize: mesh.chunkSize,
      summary: {
        top: mesh.summary.top,
        topId: mesh.summary.topId,
        ground: mesh.summary.ground,
        groundId: mesh.summary.groundId,
        water: mesh.summary.water,
      },
      groups,
      vertices,
    });
  }
  return {
    type: "loaded",
    id: message.id,
    chunks,
    ms: performance.now() - started,
    bytes: buffer.byteLength,
  };
}

function transferables(result: MeshWorkerResult): Transferable[] {
  if (result.type !== "loaded") return [];
  const out = new Set<ArrayBufferLike>();
  for (const chunk of result.chunks) {
    if (chunk.summary) {
      for (const a of Object.values(chunk.summary)) out.add(a.buffer);
    }
    for (const g of chunk.groups) {
      for (const a of [
        g.positions,
        g.uvs,
        g.lights,
        g.indices,
        g.normals,
        g.lightTwist,
        g.biomeTint,
      ]) {
        out.add(a.buffer);
      }
    }
  }
  // The summary arrays are copies; the fetched buffer is not transferred.
  return Array.from(out) as Transferable[];
}

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = (event: MessageEvent<MeshWorkerInit | MeshWorkerLoad>) => {
  const message = event.data;
  if (message.type === "init") {
    blockKeys = message.blockKeys;
    faceKeys = message.faceKeys;
    return;
  }
  load(message).then(
    (result) => scope.postMessage(result, transferables(result)),
    (error: unknown) =>
      scope.postMessage({
        type: "failed",
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      } satisfies MeshWorkerResult),
  );
};
