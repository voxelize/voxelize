import {
  buildFarLandMesh,
  buildFarSkyMesh,
  FarMeshData,
  FarMeshInput,
} from "../far-terrain-mesh";

const buffersOf = (mesh: FarMeshData | null): ArrayBuffer[] =>
  mesh
    ? [
        mesh.position.buffer as ArrayBuffer,
        mesh.column.buffer as ArrayBuffer,
        mesh.material.buffer as ArrayBuffer,
        mesh.tint.buffer as ArrayBuffer,
        mesh.index.buffer as ArrayBuffer,
      ]
    : [];

onmessage = (event: MessageEvent<{ input: FarMeshInput }>) => {
  const { input } = event.data;
  const startedAt = performance.now();
  const land = buildFarLandMesh(input);
  const sky = buildFarSkyMesh(input);
  postMessage(
    { land, sky, buildMs: performance.now() - startedAt },
    { transfer: [...buffersOf(land), ...buffersOf(sky)] },
  );
};
