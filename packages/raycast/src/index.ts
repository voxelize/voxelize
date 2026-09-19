import { AABB } from "@voxelize/aabb";

/**
 * Entry and exit distances of a ray through one slab (the region between two
 * parallel planes on a single axis). A ray with no component along the axis
 * either runs inside the slab forever or never enters it; dividing by that
 * zero component would make `0 / 0 = NaN` whenever the origin sits exactly on
 * a plane, and a NaN distance poisons every comparison downstream into a
 * "hit" at a NaN point.
 */
function slabInterval(
  min: number,
  max: number,
  origin: number,
  component: number,
): [number, number] {
  if (component === 0) {
    return origin >= min && origin <= max
      ? [-Infinity, Infinity]
      : [Infinity, -Infinity];
  }
  const inv = 1 / component;
  const tNear = (min - origin) * inv;
  const tFar = (max - origin) * inv;
  return tNear < tFar ? [tNear, tFar] : [tFar, tNear];
}

export function raycastAABB(
  origin: number[],
  normal: number[],
  aabb: AABB,
  maxDistance = Infinity,
): { axis: number; distance: number } | null {
  const [nx, ny, nz] = normal;

  const [xNear, xFar] = slabInterval(aabb.minX, aabb.maxX, origin[0], nx);
  const [yNear, yFar] = slabInterval(aabb.minY, aabb.maxY, origin[1], ny);
  const [zNear, zFar] = slabInterval(aabb.minZ, aabb.maxZ, origin[2], nz);

  const tMin = Math.max(xNear, yNear, zNear);
  const tMinAxis = tMin === xNear ? 0 : tMin === yNear ? 1 : 2;
  const tMax = Math.min(xFar, yFar, zFar);
  const tMaxAxis = tMax === xFar ? 0 : tMax === yFar ? 1 : 2;

  // if tMax < 0, ray (line) is intersecting AABB, but whole AABB is behind us
  if (tMax < 0) {
    return null;
  }

  // if tMin > tMax, ray doesn't intersect AABB
  if (tMin > tMax) {
    return null;
  }

  if (tMin < 0) {
    if (tMax > maxDistance) {
      return null;
    }

    return {
      axis: tMaxAxis,
      distance: tMax,
    };
  }

  if (tMin > maxDistance) {
    return null;
  }

  return {
    axis: tMinAxis,
    distance: tMin,
  };
}

function raycast(
  getVoxel: (vx: number, vy: number, vz: number) => AABB[],
  origin: number[],
  direction: number[],
  maxDistance: number,
): { point: number[]; normal: number[]; voxel: number[] } | null {
  let dx = +direction[0];
  let dy = +direction[1];
  let dz = +direction[2];
  const ds = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (ds === 0) {
    throw new Error("Can't raycast along a zero vector");
  }

  dx /= ds;
  dy /= ds;
  dz /= ds;

  const [ox, oy, oz] = origin;

  let t = 0.0;
  let ix = Math.floor(ox) | 0;
  let iy = Math.floor(oy) | 0;
  let iz = Math.floor(oz) | 0;

  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;

  const txDelta = Math.abs(1 / dx);
  const tyDelta = Math.abs(1 / dy);
  const tzDelta = Math.abs(1 / dz);

  const xDist = stepX > 0 ? ix + 1 - ox : ox - ix;
  const yDist = stepY > 0 ? iy + 1 - oy : oy - iy;
  const zDist = stepZ > 0 ? iz + 1 - oz : oz - iz;

  let txMax = txDelta < Infinity ? txDelta * xDist : Infinity;
  let tyMax = tyDelta < Infinity ? tyDelta * yDist : Infinity;
  let tzMax = tzDelta < Infinity ? tzDelta * zDist : Infinity;

  while (t <= maxDistance) {
    // exit check
    const aabbs = getVoxel(ix, iy, iz) || [];

    let hit: any;
    aabbs.forEach((aabb) => {
      const result = raycastAABB(
        origin,
        [dx, dy, dz],
        aabb.clone(),
        maxDistance,
      );
      if (result) {
        hit = result;
      }
    });

    if (hit) {
      return {
        point: [
          ox + hit.distance * dx,
          oy + hit.distance * dy,
          oz + hit.distance * dz,
        ],
        normal: [
          hit.axis === 0 ? -stepX : 0,
          hit.axis === 1 ? -stepY : 0,
          hit.axis === 2 ? -stepZ : 0,
        ],
        voxel: [ix, iy, iz],
      };
    }

    // advance t to next nearest voxel boundary
    if (txMax < tyMax) {
      if (txMax < tzMax) {
        ix += stepX;
        t = txMax;
        txMax += txDelta;
      } else {
        iz += stepZ;
        t = tzMax;
        tzMax += tzDelta;
      }
    } else {
      if (tyMax < tzMax) {
        iy += stepY;
        t = tyMax;
        tyMax += tyDelta;
      } else {
        iz += stepZ;
        t = tzMax;
        tzMax += tzDelta;
      }
    }
  }

  return null;
}

export { raycast };
export default raycast;
