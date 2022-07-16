import {
  BaseEntity,
  Client,
  EntityFlag,
  MetadataComponent,
  Position3DComponent,
  System,
} from "@voxelize/client";
import { Vector3 } from "three";

class UpdateBoxSystem extends System {
  constructor() {
    super([EntityFlag.type, Position3DComponent.type, MetadataComponent.type]);
  }

  update(entity: BaseEntity) {
    const { mesh } = entity;
    const metadata = MetadataComponent.get(entity).data;

    if (metadata.position) {
      entity.position.set(
        metadata.position[0],
        metadata.position[1],
        metadata.position[2]
      );
    }

    mesh.position.lerp(
      entity.position.clone().add(new Vector3(0, 0, 0)),
      BaseEntity.LERP_FACTOR
    );
  }
}

export function setupSystems(client: Client) {
  client.ecs.addSystem(new UpdateBoxSystem());
}
