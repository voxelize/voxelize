// Claim borders drawn in the world: posts along the edge of the land the
// player stands in (or last entered), shown for a while after entering and
// while the land panel is open.

import * as THREE from "three";

import { borderPosts } from "./land";

const REACH = 24;

export class BorderView {
  readonly lines: THREE.LineSegments;
  private land: { min: [number, number]; max: [number, number]; mine: boolean } | null = null;
  private until = 0;
  private lastKey = "";

  constructor() {
    this.lines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.8, depthTest: true }),
    );
    this.lines.visible = false;
    this.lines.frustumCulled = false;
  }

  /** The land to outline (null: none) and for how many seconds. */
  show(land: { min: [number, number]; max: [number, number]; mine: boolean } | null, seconds: number) {
    this.land = land;
    this.until = performance.now() + seconds * 1000;
    this.lastKey = "";
  }

  update(x: number, y: number, z: number, keep: boolean) {
    if (!this.land || (!keep && performance.now() > this.until)) {
      this.lines.visible = false;
      return;
    }
    const key = `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    this.lines.visible = true;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const points: number[] = [];
    const base = Math.floor(y) - 2;
    for (const [px, pz] of borderPosts(this.land.min, this.land.max, x, z, REACH)) {
      points.push(px, base, pz, px, base + 4, pz);
    }
    (this.lines.material as THREE.LineBasicMaterial).color.set(this.land.mine ? 0x6fe36f : 0xffd34d);
    this.lines.geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    this.lines.geometry.computeBoundingSphere();
  }
}
