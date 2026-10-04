// Arrows in flight and lit blast charges, drawn from the server's
// `platform.combat` snapshots (ten a second), moved on between them.

import * as THREE from "three";

export type ArrowInfo = { id: number; pos: [number, number, number]; vel: [number, number, number] };
export type FuseInfo = { at: [number, number, number]; fuse: number };

const GRAVITY = 20;

/** Where an arrow will be `dt` seconds after a snapshot. */
export function arrowAt(a: ArrowInfo, dt: number): [number, number, number] {
  return [a.pos[0] + a.vel[0] * dt, a.pos[1] + a.vel[1] * dt - 0.5 * GRAVITY * dt * dt, a.pos[2] + a.vel[2] * dt];
}

/** A lit charge flashes faster as its fuse runs down: on or off now? */
export function fuseLit(fuse: number, time: number): boolean {
  const rate = fuse < 1 ? 8 : 3;
  return Math.floor(time * rate) % 2 === 0;
}

export class CombatView {
  readonly group = new THREE.Group();
  private arrows = new Map<number, { mesh: THREE.Mesh; info: ArrowInfo; since: number }>();
  private fuses: THREE.Mesh[] = [];
  private fuseInfo: FuseInfo[] = [];
  private arrowGeometry = new THREE.BoxGeometry(0.06, 0.06, 0.7);
  private arrowMaterial = new THREE.MeshBasicMaterial({ color: 0x8a6a3a });
  private fuseGeometry = new THREE.BoxGeometry(0.98, 0.98, 0.98);

  set(payload: { arrows: ArrowInfo[]; fuses: FuseInfo[] }) {
    const now = performance.now() / 1000;
    const seen = new Set<number>();
    for (const info of payload.arrows) {
      seen.add(info.id);
      let view = this.arrows.get(info.id);
      if (!view) {
        const mesh = new THREE.Mesh(this.arrowGeometry, this.arrowMaterial);
        this.group.add(mesh);
        view = { mesh, info, since: now };
        this.arrows.set(info.id, view);
      }
      view.info = info;
      view.since = now;
    }
    for (const [id, view] of this.arrows) {
      if (!seen.has(id)) {
        this.group.remove(view.mesh);
        this.arrows.delete(id);
      }
    }
    while (this.fuses.length < payload.fuses.length) {
      const mesh = new THREE.Mesh(this.fuseGeometry, new THREE.MeshBasicMaterial({ color: 0xc0392b }));
      this.group.add(mesh);
      this.fuses.push(mesh);
    }
    while (this.fuses.length > payload.fuses.length) this.group.remove(this.fuses.pop()!);
    this.fuseInfo = payload.fuses;
  }

  update() {
    const now = performance.now() / 1000;
    for (const view of this.arrows.values()) {
      const dt = Math.min(0.3, now - view.since);
      const [x, y, z] = arrowAt(view.info, dt);
      view.mesh.position.set(x, y, z);
      const v = view.info.vel;
      view.mesh.lookAt(x + v[0], y + v[1] - GRAVITY * dt, z + v[2]);
    }
    this.fuses.forEach((mesh, i) => {
      const f = this.fuseInfo[i];
      mesh.position.set(...f.at);
      (mesh.material as THREE.MeshBasicMaterial).color.setHex(fuseLit(f.fuse, now) ? 0xffffff : 0xc0392b);
    });
  }
}
