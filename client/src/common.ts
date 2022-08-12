import { Object3D, Vector3 } from "three";

export const TRANSPARENT_RENDER_ORDER = 100000;
export const OPAQUE_RENDER_ORDER = 100;

export const TRANSPARENT_SORT = (object: Object3D) => (a: any, b: any) => {
  if (a.object && a.object.isMesh && b.object && b.object.isMesh) {
    const aPos = new Vector3();
    a.object.getWorldPosition(aPos);

    const bPos = new Vector3();
    b.object.getWorldPosition(bPos);

    return (
      bPos.distanceToSquared(object.position) -
      aPos.distanceToSquared(object.position)
    );
  }

  if (a.z !== b.z) {
    return b.z - a.z;
  }

  return a.id - b.id;
};
