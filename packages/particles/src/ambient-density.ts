/** Scales every ambient emitter at once; 0 turns ambient particles off. */
let ambientDensity = 1;

export function setAmbientParticleDensity(density: number): void {
  ambientDensity = Math.max(0, density);
}

export function getAmbientParticleDensity(): number {
  return ambientDensity;
}
