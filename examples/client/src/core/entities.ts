import { BaseEntity, Client, NameTag } from "@voxelize/client";
import { BoxBufferGeometry, Mesh, MeshNormalMaterial } from "three";

class Box extends BaseEntity {
  public static geometry: BoxBufferGeometry;
  public static material: MeshNormalMaterial;

  constructor() {
    super();

    if (!Box.geometry) {
      Box.geometry = new BoxBufferGeometry(0.5, 0.5, 0.5);
      Box.material = new MeshNormalMaterial();
    }

    this.mesh = new Mesh(Box.geometry, Box.material);

    const nameTag = new NameTag("BOX", {
      backgroundColor: "#00000077",
      fontSize: 0.2,
      yOffset: 0.3,
    });

    this.mesh.add(nameTag);
  }
}

export function setupEntities(client: Client) {
  client.entities.registerEntity("Box", Box);
}
