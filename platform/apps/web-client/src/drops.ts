// Dropped items, rendered from the server's `platform.drops` snapshots:
// small spinning, bobbing blocks (or flat item tiles) that glide to their
// latest reported position.

import * as THREE from "three";

import { Content } from "./content";
import { Hud } from "./hud";
import { textureCanvas } from "./textures";

type DropInfo = { id: number; item: number; count: number; p: [number, number, number] };

export class DropsView {
  readonly group = new THREE.Group();
  private meshes = new Map<number, { mesh: THREE.Object3D; target: THREE.Vector3 }>();
  private materials = new Map<number, THREE.Material>();

  constructor(
    private readonly content: Content,
    private readonly hud: Hud,
  ) {}

  private material(itemId: number): { material: THREE.Material; block: boolean } {
    const item = this.content.itemsById.get(itemId);
    const block = item?.placesBlock ? this.content.pack.blocks.find((b) => b.key === item.placesBlock) : undefined;
    let material = this.materials.get(itemId);
    if (!material) {
      const canvas = block ? textureCanvas(block.texture.side ?? block.texture.all) : undefined;
      let texture: THREE.Texture;
      if (canvas) {
        texture = new THREE.CanvasTexture(canvas);
      } else {
        const img = new Image();
        img.src = item ? this.hud.icon(item) : "";
        texture = new THREE.Texture(img);
        img.onload = () => (texture.needsUpdate = true);
      }
      texture.magFilter = THREE.NearestFilter;
      texture.colorSpace = THREE.SRGBColorSpace;
      material = new THREE.MeshBasicMaterial({ map: texture, transparent: !block, alphaTest: 0.1, side: THREE.DoubleSide });
      this.materials.set(itemId, material);
    }
    return { material, block: !!block };
  }

  set(items: DropInfo[]) {
    const seen = new Set<number>();
    for (const d of items) {
      seen.add(d.id);
      const target = new THREE.Vector3(...d.p);
      const existing = this.meshes.get(d.id);
      if (existing) {
        existing.target.copy(target);
        continue;
      }
      const { material, block } = this.material(d.item);
      const geometry = block ? new THREE.BoxGeometry(0.25, 0.25, 0.25) : new THREE.PlaneGeometry(0.4, 0.4);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(target);
      this.group.add(mesh);
      this.meshes.set(d.id, { mesh, target });
    }
    for (const [id, { mesh }] of this.meshes) {
      if (!seen.has(id)) {
        this.group.remove(mesh);
        (mesh as THREE.Mesh).geometry.dispose();
        this.meshes.delete(id);
      }
    }
  }

  update(time: number) {
    for (const [id, { mesh, target }] of this.meshes) {
      mesh.position.lerp(target, 0.3);
      mesh.position.y = THREE.MathUtils.lerp(mesh.position.y, target.y + 0.2 + Math.sin(time / 400 + id) * 0.06, 0.3);
      mesh.rotation.y = time / 900 + id;
    }
  }
}
