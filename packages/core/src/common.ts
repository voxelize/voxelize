import { Material, Mesh, Object3D, Vector3 } from "three";

export const TRANSPARENT_RENDER_ORDER = 100000;
export const TRANSPARENT_FLUID_RENDER_ORDER = 100001;
/**
 * The part of a blended see-through mesh (glass) in front of the water
 * draws here, after the water and the see-through effects in the camera's
 * medium: water composites a copy of everything drawn before it, so a pane
 * drawn first is painted over by the pool behind it. The part behind the
 * nearest water face stays at {@link TRANSPARENT_RENDER_ORDER}, where that
 * copy sees it; which part is which is decided per pixel (`WaterDepthPass`).
 * Layers a host draws at whole steps above
 * {@link TRANSPARENT_FLUID_RENDER_ORDER} (rain) still draw after both.
 */
export const TRANSPARENT_OVER_FLUID_RENDER_ORDER =
  TRANSPARENT_FLUID_RENDER_ORDER + 0.5;
/**
 * See-through chunk meshes that write depth (alpha-tested cutouts such as
 * foliage) draw before everything blended. A cutout hides what is behind its
 * painted texels either way, and its depth then hides a blended layer behind
 * it, where drawn after it the cutout would paint over one in front of it.
 */
export const TRANSPARENT_CUTOUT_RENDER_ORDER = TRANSPARENT_RENDER_ORDER - 1;
export const OPAQUE_RENDER_ORDER = 100;

/** The render order of a see-through chunk mesh. */
export const transparentChunkRenderOrder = (
  isFluid: boolean,
  depthWrite: boolean,
) =>
  isFluid
    ? TRANSPARENT_FLUID_RENDER_ORDER
    : depthWrite
      ? TRANSPARENT_CUTOUT_RENDER_ORDER
      : TRANSPARENT_RENDER_ORDER;

/** The medium a see-through effect sits in, as far as water is concerned. */
export type TransparentMedium = "air" | "water";

/**
 * The `userData` key a see-through object names its {@link TransparentMedium}
 * under (`@voxelize/particles` writes the same key on its soft layers).
 */
export const TRANSPARENT_MEDIUM_KEY = "transparentMedium";

/**
 * What {@link TRANSPARENT_SORT} asks about water: the camera's medium, and
 * the medium at a point. A `World` answers both.
 */
export interface TransparentMediumSource {
  isCameraSubmerged(): boolean;
  transparentMediumAt(x: number, y: number, z: number): TransparentMedium;
  /**
   * While the source draws its blended layers order-independently, the band
   * an item draws in (`OrderIndependentTransparency.bandOf`); undefined
   * leaves it to its render order and medium.
   */
  orderIndependentBandOf?(
    object: Object3D,
    material: Material | undefined,
  ): number | undefined;
}

/**
 * Where a see-through effect draws: anything transparent that writes no
 * depth and has no band of its own (particles, sprites, foam, weather). It
 * draws after the cutouts, whose depth hides it behind a canopy instead of
 * the canopy painting over it in front of one, and on the side of the water
 * its medium puts it. In the camera's medium it stands in front of any water
 * it overlaps, so it draws after the water, just before the panes in front
 * of the water (which cover it as a tinted layer); in the other medium it is
 * seen through the surface and draws before the water, just after the panes
 * seen through it, where the refraction copy holds it.
 */
export const transparentEffectRenderOrder = (isInCameraMedium: boolean) =>
  isInCameraMedium
    ? TRANSPARENT_FLUID_RENDER_ORDER + 0.25
    : TRANSPARENT_RENDER_ORDER + 0.5;

const _worldPos = new Vector3();
const _localCamPos = new Vector3();
const _camWorldPos = new Vector3();
const _closest = new Vector3();

interface CachedDistance {
  dist: number;
  epoch: number;
}

interface CachedMedium {
  medium: TransparentMedium;
  stamp: number;
}

interface TransparentSortItem {
  object?: Object3D;
  material?: Material;
  renderOrder: number;
  groupOrder: number;
  z: number;
  id: number;
}

/** An item's place in the transparent order: its band, then its order in it. */
interface TransparentPlace {
  band: number;
  sub: number;
}

const OBJECT_SORT_THRESHOLD_SQ = 0.5;
const _distanceCache = new WeakMap<object, CachedDistance>();
const _mediumCache = new WeakMap<object, CachedMedium>();
let _sortEpoch = 0;
let _lastCamX = Infinity;
let _lastCamY = Infinity;
let _lastCamZ = Infinity;
let _isSortBegun = false;
let _mediumStamp = 0;
let _isCameraSubmerged = false;
const _placeA: TransparentPlace = { band: 0, sub: 0 };
const _placeB: TransparentPlace = { band: 0, sub: 0 };

/**
 * Once per sort: where the camera is (distances are re-measured only once
 * it has moved), and which medium it is in.
 */
function beginSort(
  camera: Object3D,
  media: TransparentMediumSource | undefined,
) {
  if (_isSortBegun) return;
  _isSortBegun = true;
  queueMicrotask(() => {
    _isSortBegun = false;
  });

  camera.getWorldPosition(_camWorldPos);
  const dx = _camWorldPos.x - _lastCamX;
  const dy = _camWorldPos.y - _lastCamY;
  const dz = _camWorldPos.z - _lastCamZ;
  if (dx * dx + dy * dy + dz * dz > OBJECT_SORT_THRESHOLD_SQ) {
    _sortEpoch++;
    _lastCamX = _camWorldPos.x;
    _lastCamY = _camWorldPos.y;
    _lastCamZ = _camWorldPos.z;
  }

  _mediumStamp++;
  _isCameraSubmerged = media?.isCameraSubmerged() ?? false;
}

/**
 * Whether the sort places an object as a see-through effect by default: it
 * writes no depth, and its render order sits below the chunk bands (the
 * sky's negative orders aside), where it would draw before the cutouts and
 * the water and be painted over by both.
 */
function isUnbandedEffect(object: Object3D, material: Material | undefined) {
  return (
    material?.depthWrite === false &&
    object.renderOrder >= 0 &&
    object.renderOrder < TRANSPARENT_CUTOUT_RENDER_ORDER
  );
}

function mediumOf(
  object: Object3D,
  media: TransparentMediumSource | undefined,
): TransparentMedium {
  if (!media) return "air";
  const cached = _mediumCache.get(object);
  if (cached && cached.stamp === _mediumStamp) return cached.medium;
  object.getWorldPosition(_worldPos);
  const medium = media.transparentMediumAt(
    _worldPos.x,
    _worldPos.y,
    _worldPos.z,
  );
  if (cached) {
    cached.medium = medium;
    cached.stamp = _mediumStamp;
  } else {
    _mediumCache.set(object, { medium, stamp: _mediumStamp });
  }
  return medium;
}

/**
 * An item's own render order, or for a see-through effect the band its
 * medium puts it in, with its own order kept to rank it among effects. An
 * effect names its medium under {@link TRANSPARENT_MEDIUM_KEY}, which an
 * object drawn in many places at once (an instanced pool, a weather volume)
 * has to do; one that names none is placed by the medium at its position.
 */
function placeOf(
  item: TransparentSortItem,
  media: TransparentMediumSource | undefined,
  out: TransparentPlace,
): TransparentPlace {
  const object = item.object;
  out.sub = 0;
  if (!object) {
    out.band = item.renderOrder ?? 0;
    return out;
  }
  const band = media?.orderIndependentBandOf?.(object, item.material);
  if (band !== undefined) {
    out.band = band;
    return out;
  }
  const named = object.userData?.[TRANSPARENT_MEDIUM_KEY] as
    | TransparentMedium
    | undefined;
  if (named === undefined && !isUnbandedEffect(object, item.material)) {
    out.band = object.renderOrder;
    return out;
  }
  const medium = named ?? mediumOf(object, media);
  out.band = transparentEffectRenderOrder(
    (medium === "water") === _isCameraSubmerged,
  );
  out.sub = object.renderOrder;
  return out;
}

function computeDistance(
  obj: Mesh,
  camX: number,
  camY: number,
  camZ: number,
): number {
  const geo = obj.geometry;
  if (geo?.boundingBox) {
    obj.getWorldPosition(_worldPos);
    _localCamPos.set(
      camX - _worldPos.x,
      camY - _worldPos.y,
      camZ - _worldPos.z,
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
        camZ - _worldPos.z,
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
  camZ: number,
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

/**
 * The transparent sort for `renderer.setTransparentSort`: render order
 * first (see-through effects placed by their medium, see
 * {@link transparentEffectRenderOrder}, or every item by its band when the
 * source draws order-independently), then back to front. Without `media`
 * every effect is taken to share the camera's air.
 */
export const TRANSPARENT_SORT = (
  camera: Object3D,
  media?: TransparentMediumSource,
) => {
  return (a: TransparentSortItem, b: TransparentSortItem) => {
    beginSort(camera, media);

    const aPlace = placeOf(a, media, _placeA);
    const bPlace = placeOf(b, media, _placeB);
    if (aPlace.band !== bPlace.band) return aPlace.band - bPlace.band;
    if (aPlace.sub !== bPlace.sub) return aPlace.sub - bPlace.sub;

    const aObj = a.object;
    const bObj = b.object;
    if (aObj instanceof Mesh && bObj instanceof Mesh) {
      const aDist = getDistance(aObj, _lastCamX, _lastCamY, _lastCamZ);
      const bDist = getDistance(bObj, _lastCamX, _lastCamY, _lastCamZ);
      if (aDist !== bDist) return bDist - aDist;
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
