/**
 * Flat per-face normals for indexed chunk geometry: every vertex of a
 * triangle gets that triangle's normal (chunk quads never share vertices
 * across faces). Dependency-free so a worker can import it alone.
 */
export function computeNormalsFromBuffers(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3;
    const ib = indices[i + 1] * 3;
    const ic = indices[i + 2] * 3;
    const e1x = positions[ib] - positions[ia];
    const e1y = positions[ib + 1] - positions[ia + 1];
    const e1z = positions[ib + 2] - positions[ia + 2];
    const e2x = positions[ic] - positions[ia];
    const e2y = positions[ic + 1] - positions[ia + 1];
    const e2z = positions[ic + 2] - positions[ia + 2];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    }
    normals[ia] = nx;
    normals[ia + 1] = ny;
    normals[ia + 2] = nz;
    normals[ib] = nx;
    normals[ib + 1] = ny;
    normals[ib + 2] = nz;
    normals[ic] = nx;
    normals[ic + 1] = ny;
    normals[ic + 2] = nz;
  }
  return normals;
}
