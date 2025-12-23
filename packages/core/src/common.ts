import { Object3D, Vector3 } from "three";

export const TRANSPARENT_RENDER_ORDER = 100000;
export const TRANSPARENT_FLUID_RENDER_ORDER = 100001;
export const OPAQUE_RENDER_ORDER = 100;

const _worldPos = new Vector3();
const _localCamPos = new Vector3();
const _camWorldPos = new Vector3();

export const TRANSPARENT_SORT = (object: Object3D) => (a: any, b: any) => {
  const aObj = a.object;
  const bObj = b.object;

  if (aObj?.isMesh && bObj?.isMesh) {
    const aClosest = new Vector3();
    const bClosest = new Vector3();

    const aGeo = aObj.geometry;
    const bGeo = bObj.geometry;

    object.getWorldPosition(_camWorldPos);

    if (aGeo?.boundingBox) {
      aObj.getWorldPosition(_worldPos);
      _localCamPos.copy(_camWorldPos).sub(_worldPos);
      aGeo.boundingBox.clampPoint(_localCamPos, aClosest);
      aClosest.add(_worldPos);
    } else if (aGeo) {
      if (!aGeo.boundingBox) aGeo.computeBoundingBox();
      if (aGeo.boundingBox) {
        aObj.getWorldPosition(_worldPos);
        _localCamPos.copy(_camWorldPos).sub(_worldPos);
        aGeo.boundingBox.clampPoint(_localCamPos, aClosest);
        aClosest.add(_worldPos);
      } else {
        aObj.getWorldPosition(aClosest);
      }
    } else {
      aObj.getWorldPosition(aClosest);
    }

    if (bGeo?.boundingBox) {
      bObj.getWorldPosition(_worldPos);
      _localCamPos.copy(_camWorldPos).sub(_worldPos);
      bGeo.boundingBox.clampPoint(_localCamPos, bClosest);
      bClosest.add(_worldPos);
    } else if (bGeo) {
      if (!bGeo.boundingBox) bGeo.computeBoundingBox();
      if (bGeo.boundingBox) {
        bObj.getWorldPosition(_worldPos);
        _localCamPos.copy(_camWorldPos).sub(_worldPos);
        bGeo.boundingBox.clampPoint(_localCamPos, bClosest);
        bClosest.add(_worldPos);
      } else {
        bObj.getWorldPosition(bClosest);
      }
    } else {
      bObj.getWorldPosition(bClosest);
    }

    const aDist = aClosest.distanceToSquared(_camWorldPos);
    const bDist = bClosest.distanceToSquared(_camWorldPos);

    if (aObj.renderOrder !== bObj.renderOrder) {
      return aObj.renderOrder - bObj.renderOrder;
    }
    return bDist - aDist > 0 ? 1 : -1;
  }

  if (a.groupOrder !== b.groupOrder) {
    return a.groupOrder - b.groupOrder;
  } else if (a.renderOrder !== b.renderOrder) {
    return a.renderOrder - b.renderOrder;
  } else if (a.z !== b.z) {
    return b.z - a.z;
  } else {
    return a.id - b.id;
  }
};

/**
 * Literally do nothing.
 *
 * @hidden
 */
export const noop = () => {
  // Do nothing.
};

export type CameraPerspective =
  | "px"
  | "nx"
  | "py"
  | "ny"
  | "pz"
  | "nz"
  | "pxy"
  | "nxy"
  | "pxz"
  | "nxz"
  | "pyz"
  | "nyz"
  | "pxyz"
  | "nxyz";
