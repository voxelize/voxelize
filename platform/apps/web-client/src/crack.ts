// The cracks drawn over a block while it is being mined, deepening in ten
// stages with the mining progress.

import * as THREE from "three";

export const CRACK_STAGES = 10;

/** Crack stage 0..9 for mining progress 0..1. */
export function crackStage(progress: number): number {
  return Math.max(0, Math.min(CRACK_STAGES - 1, Math.floor(progress * CRACK_STAGES)));
}

/** Pixels (16 x 16) of each stage's cracks: every stage keeps the earlier
 * ones and adds more, walking from the centre outwards. Deterministic. */
export function crackPixels(stage: number): Set<number> {
  const pixels = new Set<number>();
  let seed = 0x2f6b;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let s = 0; s <= stage; s++) {
    // Each stage adds two cracks from near the centre.
    for (let c = 0; c < 2; c++) {
      let x = 6 + Math.floor(random() * 4);
      let y = 6 + Math.floor(random() * 4);
      const length = 3 + s;
      for (let i = 0; i < length; i++) {
        pixels.add(y * 16 + x);
        x = Math.max(0, Math.min(15, x + Math.round(random() * 2 - 1)));
        y = Math.max(0, Math.min(15, y + Math.round(random() * 2 - 1)));
      }
    }
  }
  return pixels;
}

export class CrackView {
  readonly mesh: THREE.Mesh;
  private textures: THREE.Texture[] = [];
  private material: THREE.MeshBasicMaterial;

  constructor() {
    for (let stage = 0; stage < CRACK_STAGES; stage++) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 16;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      for (const p of crackPixels(stage)) ctx.fillRect(p % 16, Math.floor(p / 16), 1, 1);
      const texture = new THREE.CanvasTexture(canvas);
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      this.textures.push(texture);
    }
    this.material = new THREE.MeshBasicMaterial({
      map: this.textures[0],
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1.004, 1.004, 1.004), this.material);
    this.mesh.visible = false;
    this.mesh.renderOrder = 10;
  }

  /** Cracks on `voxel` at `progress`, or hide them. */
  show(voxel: [number, number, number] | null, progress = 0) {
    if (!voxel) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.mesh.position.set(voxel[0] + 0.5, voxel[1] + 0.5, voxel[2] + 0.5);
    const texture = this.textures[crackStage(progress)];
    if (this.material.map !== texture) {
      this.material.map = texture;
      this.material.needsUpdate = true;
    }
  }
}
