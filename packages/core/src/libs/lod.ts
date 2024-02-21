import { Camera, Object3D, Vector3 } from "three";

const v1 = new Vector3();
const v2 = new Vector3();

export class LOD extends Object3D {
  public currentLevel = 0;
  public autoUpdate = true;

  public type = "LOD";
  public isLOD = true;

  public levels: { distance: number; hysteresis: number; object: Object3D }[] =
    [];

  constructor() {
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

      const distance =
        Math.sqrt(Math.pow(v1.x - v2.x, 2) + Math.pow(v1.z - v2.z, 2)) /
        ((camera as any).zoom ?? 1);

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
