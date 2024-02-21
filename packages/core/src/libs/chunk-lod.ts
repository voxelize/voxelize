import { Camera, Object3D, Vector3 } from "three";
import { ChunkUtils } from "utils";

const v1 = new Vector3();
const v2 = new Vector3();

export class ChunkLOD extends Object3D {
  public currentLevel = 0;
  public autoUpdate = true;

  public type = "LOD";
  public isLOD = true;

  public levels: { distance: number; hysteresis: number; object: Object3D }[] =
    [];

  constructor(public chunkSize: number) {
    super();
  }

  addLevel(object: Object3D, distance = 0, hysteresis = 0) {
    distance = Math.abs(distance);

    const levels = this.levels;

    let l: number;

    for (l = 0; l < levels.length; l++) {
      if (distance < levels[l].distance) {
        break;
      }
    }

    levels.splice(l, 0, {
      distance: distance,
      hysteresis: hysteresis,
      object: object,
    });

    this.add(object);

    return this;
  }

  update(camera: Camera) {
    const levels = this.levels;

    if (levels.length > 1) {
      v1.setFromMatrixPosition(camera.matrixWorld);
      v2.setFromMatrixPosition(this.matrixWorld);

      const v1Chunk = ChunkUtils.mapVoxelToChunk(v1.toArray(), this.chunkSize);
      const v2Chunk = ChunkUtils.mapVoxelToChunk(v2.toArray(), this.chunkSize);

      const distance =
        Math.sqrt(
          Math.pow(v1Chunk[0] - v2Chunk[0], 2) +
            Math.pow(v1Chunk[1] - v2Chunk[1], 2)
        ) / ((camera as any).zoom ?? 1);

      levels[0].object.visible = true;

      let i: number, l: number;

      for (i = 1, l = levels.length; i < l; i++) {
        let levelDistance = levels[i].distance;

        if (levels[i].object.visible) {
          levelDistance -= levelDistance * levels[i].hysteresis;
        }

        if (distance >= levelDistance) {
          levels[i - 1].object.visible = false;
          levels[i].object.visible = true;
        } else {
          break;
        }
      }

      this.currentLevel = i - 1;

      for (; i < l; i++) {
        levels[i].object.visible = false;
      }
    }
  }
}
