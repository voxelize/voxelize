import { AABB } from "@voxelize/aabb";
import { BoxBufferGeometry, Mesh, MeshBasicMaterial } from "three";

class Trigger {
  public mesh: Mesh;

  constructor(
    public name: string,
    public aabb: AABB,
    position: [number, number, number]
  ) {
    const geo = new BoxBufferGeometry(aabb.width, aabb.height, aabb.depth);
    const mat = new MeshBasicMaterial({ wireframe: true });
    this.mesh = new Mesh(geo, mat);

    const [x, y, z] = position;
    this.setPosition(x, y, z);
  }

  setPosition = (x: number, y: number, z: number) => {
    this.aabb.setPosition([
      x - this.aabb.width / 2,
      y - this.aabb.height / 2,
      z - this.aabb.depth / 2,
    ]);
    this.mesh.position.set(x, y, z);
  };

  onTrigger: () => void;
}

export { Trigger };
