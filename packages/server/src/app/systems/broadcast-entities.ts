import { Entity, System } from "@voxelize/common";

import {
  TypeComponent,
  HeadingComponent,
  PositionComponent,
  MetadataComponent,
  TargetComponent,
} from "../comps";
import { Entities } from "../entities";

class BroadcastEntitiesSystem extends System {
  constructor(private entities: Entities) {
    super([
      PositionComponent.type,
      TargetComponent.type,
      HeadingComponent.type,
      TypeComponent.type,
      MetadataComponent.type,
    ]);
  }

  update(entity: Entity): void {
    const position = PositionComponent.get(entity).data;
    const target = TargetComponent.get(entity).data;
    const heading = HeadingComponent.get(entity).data;
    const type = TypeComponent.get(entity).data;
    const data = MetadataComponent.get(entity).data;

    const { x: px, y: py, z: pz } = position;
    const { x: tx, y: ty, z: tz } = target;
    const { x: hx, y: hy, z: hz } = heading;

    this.entities.addPacket({
      id: entity.id,
      type: type,
      position: { x: px, y: py, z: pz },
      target: { x: tx, y: ty, z: tz },
      heading: { x: hx, y: hy, z: hz },
      data: JSON.stringify(data || {}),
    });
  }
}

export { BroadcastEntitiesSystem };
