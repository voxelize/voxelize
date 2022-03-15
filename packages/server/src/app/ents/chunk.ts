import { Vector2 } from "@math.gl/core";
import {
  ChunkComponent,
  ChunkUtils,
  Entity,
  IDComponent,
  NameComponent,
  DirtyComponent,
  Component,
} from "@voxelize/common";
import ndarray, { NdArray } from "ndarray";
import pool from "typedarray-pool";
import { v4 as uuidv4 } from "uuid";

import { StageComponent, Position2DComponent } from "../comps";

const VoxelsComponent = Component.register<NdArray<Uint8Array>>();
const LightsComponent = Component.register<NdArray<Uint8Array>>();

type ChunkParams = {
  chunkSize: number;
  padding: number;
  maxHeight: number;
};

class ChunkEntity extends Entity {
  public id: string;
  public name: string;
  public stage: number;

  public voxels: NdArray<Uint8Array>;
  public lights: NdArray<Uint8Array>;

  constructor(x: number, z: number, public params: ChunkParams) {
    super();

    this.id = uuidv4();
    this.name = ChunkUtils.getChunkName([x, z]);

    this.add(new ChunkComponent());

    this.add(new IDComponent(this.id));
    this.add(new NameComponent(this.name));
    this.add(new Position2DComponent(new Vector2(x, z)));
    this.add(new DirtyComponent());
    this.add(new StageComponent(0));

    const { chunkSize, maxHeight, padding } = params;

    this.voxels = ndarray(
      pool.mallocUint8(
        (chunkSize + padding * 2) * maxHeight * (chunkSize + padding * 2)
      ),
      [chunkSize + padding * 2, maxHeight, chunkSize + padding * 2]
    );
    this.lights = ndarray(
      pool.mallocUint8(
        (chunkSize + padding * 2) * maxHeight * (chunkSize + padding * 2)
      ),
      [chunkSize + padding * 2, maxHeight, chunkSize + padding * 2]
    );

    this.add(new VoxelsComponent(this.voxels));
    this.add(new LightsComponent(this.lights));
  }
}

export { ChunkEntity, ChunkParams, VoxelsComponent, LightsComponent };
