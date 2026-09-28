/**
 * Bilinear voxel light across each quad.
 *
 * The mesher gives every quad corner its own light (four 4-bit channels in
 * the packed `light` attribute) and the GPU interpolates them over the
 * quad's two triangles. Linear interpolation per triangle is not the
 * bilinear blend the four corners describe: wherever the corners do not lie
 * on a plane, the field creases along the quad's diagonal, and a quad with
 * one lit corner draws its light as a triangle ending on that diagonal. A
 * coloured light makes it worse, because its channels fall off at different
 * corners and no single diagonal suits all of them, so its patches ended in
 * hard triangle edges across walls.
 *
 * The fix corrects the interpolated value per fragment. For corners `a` at
 * (0, 0), `b` at (1, 0), `c` at (0, 1) and `d` at (1, 1), split along the
 * a-d diagonal, the bilinear blend equals the per-triangle linear one minus
 * `K * wa * wd`, where `K = a + d - b - c` is the quad's twist and `wa`,
 * `wd` are the fragment's barycentric weights of the two diagonal corners
 * (in either triangle). A quad split along b-c is the same quad relabelled
 * so that its split runs from (0, 0) to (1, 1), which negates `K`.
 *
 * So every vertex carries four bytes, derived here from the packed lights
 * and the index pattern the mesher emits (four vertices per quad, indices
 * `0 1 3 3 2 0` or `0 1 2 2 1 3`): each channel's twist biased by
 * {@link QUAD_LIGHT_TWIST_BIAS}, with {@link QUAD_LIGHT_CORNER_FLAG} set on
 * the first byte of the diagonal corner the twist rides on and on the
 * second byte of the opposite diagonal corner. The vertex shader turns
 * those into two varyings, `twist * wa` and `wd`, whose product is the
 * correction: exact, one multiply-add per channel in the fragment stage,
 * and zero on every quad edge, so neighbours still meet on the corner
 * values they share. A geometry or quad without the pattern reads the
 * neutral bytes and keeps the per-triangle blend.
 *
 * Deriving this on the client keeps it off the wire, and one function serves
 * server-meshed and worker-meshed chunks alike, so the two cannot disagree.
 */

/** Twist bias: a twist spans -30..30 (four corners of 0..15), stored 0..60. */
export const QUAD_LIGHT_TWIST_BIAS = 30;

/** Flag added to a byte whose vertex is a diagonal corner (never reached by a twist). */
export const QUAD_LIGHT_CORNER_FLAG = 64;

/**
 * What a vertex without the attribute reads: no twist, not a diagonal
 * corner. Materials bind it as the attribute's default value.
 */
export const QUAD_LIGHT_TWIST_NEUTRAL: readonly [
  number,
  number,
  number,
  number,
] = [
  QUAD_LIGHT_TWIST_BIAS,
  QUAD_LIGHT_TWIST_BIAS,
  QUAD_LIGHT_TWIST_BIAS,
  QUAD_LIGHT_TWIST_BIAS,
];

/**
 * Shift of each output byte's channel in the packed light word, in the
 * order the shader's `unpackLight` builds `vLight`: red, green, blue, sun.
 */
const CHANNEL_SHIFTS = [8, 4, 0, 12] as const;

/**
 * Per-vertex twist bytes (four per vertex) for a chunk geometry's packed
 * lights and indices. Quads that do not follow the mesher's index pattern
 * keep the neutral bytes.
 */
export function computeQuadLightTwist(
  lights: ArrayLike<number>,
  indices: ArrayLike<number>,
): Uint8Array {
  const vertexCount = lights.length;
  const twist = new Uint8Array(vertexCount * 4).fill(QUAD_LIGHT_TWIST_BIAS);

  for (let i = 0; i + 5 < indices.length; i += 6) {
    const n = indices[i];
    if (indices[i + 1] !== n + 1 || n + 3 >= vertexCount) continue;
    const i2 = indices[i + 2];
    const i3 = indices[i + 3];
    const i4 = indices[i + 4];
    const i5 = indices[i + 5];

    // Which corners end the diagonal the two triangles share; the twist
    // rides on `head`, the other end is `tail`.
    let head: number;
    let tail: number;
    let sign: number;
    if (i2 === n + 3 && i3 === n + 3 && i4 === n + 2 && i5 === n) {
      head = n;
      tail = n + 3;
      sign = 1;
    } else if (i2 === n + 2 && i3 === n + 2 && i4 === n + 1 && i5 === n + 3) {
      head = n + 2;
      tail = n + 1;
      sign = -1;
    } else {
      continue;
    }

    const la = lights[n];
    const lb = lights[n + 1];
    const lc = lights[n + 2];
    const ld = lights[n + 3];
    for (let channel = 0; channel < 4; channel++) {
      const shift = CHANNEL_SHIFTS[channel];
      const k =
        sign *
        (((la >> shift) & 0xf) +
          ((ld >> shift) & 0xf) -
          ((lb >> shift) & 0xf) -
          ((lc >> shift) & 0xf));
      const byte = k + QUAD_LIGHT_TWIST_BIAS;
      for (let v = n; v < n + 4; v++) twist[v * 4 + channel] = byte;
    }
    twist[head * 4] += QUAD_LIGHT_CORNER_FLAG;
    twist[tail * 4 + 1] += QUAD_LIGHT_CORNER_FLAG;
  }

  return twist;
}

/**
 * Vertex-stage GLSL: decodes the `lightTwist` attribute into the two
 * varyings the fragment stage multiplies. `vLightTwist` is in the same
 * 0..1 units as `vLight`.
 */
export const QUAD_LIGHT_VERTEX_GLSL = `
float quadLightHead = step(${QUAD_LIGHT_CORNER_FLAG.toFixed(1)}, lightTwist.x);
float quadLightTail = step(${QUAD_LIGHT_CORNER_FLAG.toFixed(1)}, lightTwist.y);
vec4 quadLightTwist = lightTwist
  - vec4(quadLightHead, quadLightTail, 0.0, 0.0) * ${QUAD_LIGHT_CORNER_FLAG.toFixed(1)}
  - ${QUAD_LIGHT_TWIST_BIAS.toFixed(1)};
vLightTwist = quadLightTwist * (quadLightHead / 15.0);
vQuadLightTail = quadLightTail;
`;
