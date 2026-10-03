// Creatures, rendered from the server's `platform.mobs` snapshots with the
// box models their content defines. The server owns where they are and how
// much health they have; this only draws and interpolates.

import * as THREE from "three";

import { Content, MobDef } from "./content";

export type MobInfo = {
  id: number;
  key: string;
  p: [number, number, number];
  yaw: number;
  health: number;
  hurt: boolean;
  baby: boolean;
  moving: boolean;
  love: boolean;
};

type View = {
  group: THREE.Group;
  legs: THREE.Object3D[];
  target: THREE.Vector3;
  yaw: number;
  info: MobInfo;
  materials: THREE.MeshBasicMaterial[];
};

export class MobsView {
  readonly group = new THREE.Group();
  private views = new Map<number, View>();
  private raycaster = new THREE.Raycaster();

  constructor(private readonly content: Content) {}

  private build(def: MobDef, info: MobInfo): View {
    const group = new THREE.Group();
    const legs: THREE.Object3D[] = [];
    const materials: THREE.MeshBasicMaterial[] = [];
    for (const part of def.model) {
      const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(part.color) });
      materials.push(material);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...part.size), material);
      if (part.leg) {
        // Swing legs from the hip: pivot at the top of the leg.
        const pivot = new THREE.Group();
        pivot.position.set(part.offset[0], part.offset[1] + part.size[1] / 2, part.offset[2]);
        mesh.position.set(0, -part.size[1] / 2, 0);
        pivot.add(mesh);
        group.add(pivot);
        legs.push(pivot);
      } else {
        mesh.position.set(...part.offset);
        group.add(mesh);
      }
      mesh.userData.mobId = info.id;
    }
    group.scale.setScalar(info.baby ? 0.5 : 1);
    group.position.set(...info.p);
    this.group.add(group);
    return { group, legs, target: new THREE.Vector3(...info.p), yaw: info.yaw, info, materials };
  }

  set(mobs: MobInfo[]) {
    const seen = new Set<number>();
    for (const info of mobs) {
      seen.add(info.id);
      let view = this.views.get(info.id);
      if (!view) {
        const def = this.content.mobsByKey.get(info.key);
        if (!def) continue;
        view = this.build(def, info);
        this.views.set(info.id, view);
      }
      view.target.set(...info.p);
      view.yaw = info.yaw;
      view.info = info;
      view.group.scale.setScalar(info.baby ? 0.5 : 1);
    }
    for (const [id, view] of this.views) {
      if (!seen.has(id)) {
        this.group.remove(view.group);
        view.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
        view.materials.forEach((m) => m.dispose());
        this.views.delete(id);
      }
    }
  }

  update(time: number) {
    for (const view of this.views.values()) {
      view.group.position.lerp(view.target, 0.25);
      let delta = view.yaw - view.group.rotation.y;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      view.group.rotation.y += delta * 0.25;
      const swing = view.info.moving ? Math.sin(time / 120) * 0.6 : 0;
      view.legs.forEach((leg, i) => (leg.rotation.x = i % 2 === 0 ? swing : -swing));
      const flash = view.info.hurt ? 0xff4040 : view.info.love ? 0xff9ad5 : null;
      view.materials.forEach((m, i) => {
        const def = this.content.mobsByKey.get(view.info.key);
        const base = def?.model[i]?.color ?? "#ffffff";
        m.color.set(flash ?? base);
      });
    }
  }

  /** The creature under the crosshair within `reach`, with its distance. */
  pick(camera: THREE.Camera, reach: number): { id: number; distance: number } | null {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    this.raycaster.far = reach;
    const hit = this.raycaster.intersectObjects(this.group.children, true)[0];
    if (!hit) return null;
    return { id: hit.object.userData.mobId as number, distance: hit.distance };
  }
}
