import { Vector3 } from "@math.gl/core";
import {
  Entity,
  IDComponent,
  MetadataComponent,
  EntityFlag,
} from "@voxelize/common";
import { v4 as uuidv4 } from "uuid";

import {
  CurrentChunkComponent,
  HeadingComponent,
  Position3DComponent,
  TargetComponent,
} from "../comps";

/**
 * A completely customizable base entity for all "living" entities.
 * This includes animals, monsters, or even item drops.
 *
 * Contains the following components by default:
 * - `EntityFlag`
 * - `IDComponent`
 * - `Position3DComponent`
 * - `HeadingComponent`
 * - `TargetComponent`
 * - `MetadataComponent`
 * - `CurrentChunkComponent`
 *
 * @extends {Entity}
 */
class BaseEntity extends Entity {
  public id: string;

  constructor() {
    super();

    this.id = uuidv4();

    this.add(new EntityFlag());
    this.add(new IDComponent(this.id));
    this.add(new Position3DComponent(new Vector3()));
    this.add(new HeadingComponent(new Vector3()));
    this.add(new TargetComponent(new Vector3()));
    this.add(new MetadataComponent({}));

    this.add(
      new CurrentChunkComponent({
        changed: true,
        chunk: {
          x: 0,
          z: 0,
        },
      })
    );
  }
}

export { BaseEntity };
