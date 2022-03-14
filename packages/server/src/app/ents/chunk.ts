import { Vector2 } from "@math.gl/core";
import {
  ChunkComponent,
  ChunkUtils,
  Entity,
  IDComponent,
  NameComponent,
} from "@voxelize/common";
import { v4 as uuidv4 } from "uuid";

import { DirtyComponent, StageComponent, Position2DComponent } from "../comps";

class ChunkEntity extends Entity {
  public id: string;
  public name: string;
  public stage: number;

  constructor(x: number, z: number) {
    super();

    this.id = uuidv4();
    this.name = ChunkUtils.getChunkName([x, z]);

    this.add(new ChunkComponent());

    this.add(new IDComponent(this.id));
    this.add(new NameComponent(this.name));
    this.add(new Position2DComponent(new Vector2(x, z)));
    this.add(new DirtyComponent(true));
    this.add(new StageComponent(0));
  }
}

export { ChunkEntity };
