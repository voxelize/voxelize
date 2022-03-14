import { Vector3 } from "@math.gl/core";
import {
  Entity,
  IDComponent,
  MetadataComponent,
  EntityComponent,
} from "@voxelize/common";
import { v4 as uuidv4 } from "uuid";

import {
  DirtyComponent,
  HeadingComponent,
  Position3DComponent,
  TargetComponent,
  CurrentChunkComponent,
} from "../comps";

class BaseEntity extends Entity {
  public id: string;

  constructor() {
    super();

    this.id = uuidv4();

    this.add(new IDComponent(this.id));
    this.add(new EntityComponent());
    this.add(new Position3DComponent(new Vector3()));
    this.add(new HeadingComponent(new Vector3()));
    this.add(new TargetComponent(new Vector3()));
    this.add(new MetadataComponent({}));
    this.add(new DirtyComponent(true));

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
