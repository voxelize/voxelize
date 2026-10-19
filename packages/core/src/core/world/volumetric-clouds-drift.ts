/**
 * A slab's drift along one axis, in blocks, as the shifts the shader adds:
 * the cell grid's within one cell, the detail noise's within one tile of
 * the volume, and the coverage map's within one of its own tiles (which are
 * `coverageScale` volume tiles wide). Each wraps where the field repeats,
 * so the deck looks the same, and the shifts stay small enough for a
 * float32 uniform to move smoothly at any clock. Worked in doubles here.
 */
export function driftShift(
  drift: number,
  cell: number,
  noiseSize: number,
  coverageScale: number,
) {
  const tile = cell * noiseSize;
  return {
    grid: wrapUnit(drift / cell) * cell,
    noise: wrapUnit(drift / tile),
    coverage: wrapUnit(drift / (tile * coverageScale)),
  };
}

function wrapUnit(value: number) {
  return value - Math.floor(value);
}
