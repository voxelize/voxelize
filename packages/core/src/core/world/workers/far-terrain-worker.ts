import {
  buildFarLandMesh,
  buildFarSkyMesh,
  FarMeshData,
  FarMeshInput,
} from "../far-terrain-mesh";
import {
  FarShadowInput,
  farShadowLines,
  toHalfFloat,
} from "../far-terrain-shadow";

const buffersOf = (mesh: FarMeshData | null): ArrayBuffer[] =>
  mesh
    ? [
        mesh.position.buffer as ArrayBuffer,
        mesh.column.buffer as ArrayBuffer,
        mesh.material.buffer as ArrayBuffer,
        mesh.tint.buffer as ArrayBuffer,
      ]
    : [];

onmessage = (
  event: MessageEvent<{ input?: FarMeshInput; shadow?: FarShadowInput }>,
) => {
  const { input, shadow } = event.data;
  const startedAt = performance.now();
  if (shadow) {
    // The shadow lines as half floats, the texture's own format.
    const lines = farShadowLines(shadow);
    const halves = new Uint16Array(lines.length);
    for (let at = 0; at < lines.length; at++) {
      halves[at] = toHalfFloat(lines[at]);
    }
    postMessage(
      { lines: halves, buildMs: performance.now() - startedAt },
      { transfer: [halves.buffer] },
    );
    return;
  }
  if (!input) return;
  const land = buildFarLandMesh(input);
  const sky = buildFarSkyMesh(input);
  postMessage(
    { land, sky, buildMs: performance.now() - startedAt },
    { transfer: [...buffersOf(land), ...buffersOf(sky)] },
  );
};
