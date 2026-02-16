import { Mesh, Object3D, Vector3 } from "three";

export const TRANSPARENT_RENDER_ORDER = 100000;
export const TRANSPARENT_FLUID_RENDER_ORDER = 100001;
export const OPAQUE_RENDER_ORDER = 100;

const _worldPos = new Vector3();
const _localCamPos = new Vector3();
const _camWorldPos = new Vector3();
const _closest = new Vector3();

interface CachedDistance {
  dist: number;
  epoch: number;
}

type TransparentSortItem = {
  object?: Object3D;
  renderOrder?: number;
  groupOrder: number;
  z: number;
  id: number;
};

const OBJECT_SORT_THRESHOLD_SQ = 0.5;
const _distanceCache = new WeakMap<object, CachedDistance>();
let _sortEpoch = 0;
let _lastCamX = Infinity;
let _lastCamY = Infinity;
let _lastCamZ = Infinity;
let _camPosValid = false;

function computeDistance(
  obj: Mesh,
  camX: number,
  camY: number,
  camZ: number
): number {
  const geo = obj.geometry;
  if (geo?.boundingBox) {
    obj.getWorldPosition(_worldPos);
    _localCamPos.set(
      camX - _worldPos.x,
      camY - _worldPos.y,
      camZ - _worldPos.z
    );
    geo.boundingBox.clampPoint(_localCamPos, _closest);
    return (
      (_closest.x + _worldPos.x - camX) ** 2 +
      (_closest.y + _worldPos.y - camY) ** 2 +
      (_closest.z + _worldPos.z - camZ) ** 2
    );
  }
  if (geo && !geo.boundingBox) {
    geo.computeBoundingBox();
    if (geo.boundingBox) {
      obj.getWorldPosition(_worldPos);
      _localCamPos.set(
        camX - _worldPos.x,
        camY - _worldPos.y,
        camZ - _worldPos.z
      );
      geo.boundingBox.clampPoint(_localCamPos, _closest);
      return (
        (_closest.x + _worldPos.x - camX) ** 2 +
        (_closest.y + _worldPos.y - camY) ** 2 +
        (_closest.z + _worldPos.z - camZ) ** 2
      );
    }
  }
  obj.getWorldPosition(_worldPos);
  return (
    (_worldPos.x - camX) ** 2 +
    (_worldPos.y - camY) ** 2 +
    (_worldPos.z - camZ) ** 2
  );
}

function getDistance(
  obj: Mesh,
  camX: number,
  camY: number,
  camZ: number
): number {
  const cached = _distanceCache.get(obj);
  if (cached && cached.epoch === _sortEpoch) {
    return cached.dist;
  }
  const dist = computeDistance(obj, camX, camY, camZ);
  if (cached) {
    cached.dist = dist;
    cached.epoch = _sortEpoch;
  } else {
    _distanceCache.set(obj, { dist, epoch: _sortEpoch });
  }
  return dist;
}

export const TRANSPARENT_SORT = (object: Object3D) => {
  return (a: TransparentSortItem, b: TransparentSortItem) => {
    const aObj = a.object;
    const bObj = b.object;

    const aRenderOrder = aObj?.renderOrder ?? a.renderOrder ?? 0;
    const bRenderOrder = bObj?.renderOrder ?? b.renderOrder ?? 0;
    if (aRenderOrder !== bRenderOrder) {
      return aRenderOrder - bRenderOrder;
    }

    if (aObj instanceof Mesh && bObj instanceof Mesh) {
      if (!_camPosValid) {
        object.getWorldPosition(_camWorldPos);
        const dx = _camWorldPos.x - _lastCamX;
        const dy = _camWorldPos.y - _lastCamY;
        const dz = _camWorldPos.z - _lastCamZ;
        if (dx * dx + dy * dy + dz * dz > OBJECT_SORT_THRESHOLD_SQ) {
          _sortEpoch++;
          _lastCamX = _camWorldPos.x;
          _lastCamY = _camWorldPos.y;
          _lastCamZ = _camWorldPos.z;
        }
        _camPosValid = true;
        queueMicrotask(() => {
          _camPosValid = false;
        });
      }

      const aDist = getDistance(aObj, _lastCamX, _lastCamY, _lastCamZ);
      const bDist = getDistance(bObj, _lastCamX, _lastCamY, _lastCamZ);
      const distanceDelta = bDist - aDist;
      if (distanceDelta !== 0) {
        return distanceDelta > 0 ? 1 : -1;
      }
      return a.id - b.id;
    }

    if (a.groupOrder !== b.groupOrder) {
      return a.groupOrder - b.groupOrder;
    } else if (a.z !== b.z) {
      return b.z - a.z;
    } else {
      return a.id - b.id;
    }
  };
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

export const getCameraPerspectiveFactors = (perspective: CameraPerspective) => {
  let negative = 1;
  let xFactor = 0;
  let yFactor = 0;
  let zFactor = 0;

  const perspectiveLength = perspective.length;
  for (let index = 0; index < perspectiveLength; index++) {
    const charCode = perspective.charCodeAt(index);
    if (charCode === 110) {
      negative = -1;
    } else if (charCode === 120) {
      xFactor = 1;
    } else if (charCode === 121) {
      yFactor = 1;
    } else if (charCode === 122) {
      zFactor = 1;
    }
  }

  return { negative, xFactor, yFactor, zFactor };
};
