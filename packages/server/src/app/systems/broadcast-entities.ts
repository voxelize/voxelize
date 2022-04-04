import {
  Entity,
  IDComponent,
  MetadataComponent,
  System,
  TypeComponent,
} from "@voxelize/common";

import {
  HeadingComponent,
  Position3DComponent,
  TargetComponent,
} from "../comps";
import { Entities } from "../entities";

/**
 * An ECS system that broadcasts entities' data to all clients
 * in the same room.
 *
 * @extends {System}
 */
class BroadcastEntitiesSystem extends System {
  constructor(private entities: Entities) {
    super([
      IDComponent.type,
      Position3DComponent.type,
      TargetComponent.type,
      HeadingComponent.type,
      TypeComponent.type,
      MetadataComponent.type,
    ]);
  }

  update(entity: Entity) {
    const id = IDComponent.get(entity).data;
    const position = Position3DComponent.get(entity).data;
    const target = TargetComponent.get(entity).data;
    const heading = HeadingComponent.get(entity).data;
    const type = TypeComponent.get(entity).data;
    const data = MetadataComponent.get(entity).data;

    const { x: px, y: py, z: pz } = position;
    const { x: tx, y: ty, z: tz } = target;
    const { x: hx, y: hy, z: hz } = heading;

    this.entities.addPacket({
      id,
      type,
      position: { x: px, y: py, z: pz },
      target: { x: tx, y: ty, z: tz },
      heading: { x: hx, y: hy, z: hz },
      data: JSON.stringify(data || {}),
    });
  }
}

export { BroadcastEntitiesSystem };
