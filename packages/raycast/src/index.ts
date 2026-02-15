import { AABB } from "@voxelize/aabb";

const EMPTY_AABBS: AABB[] = [];

function raycastAABBAt(
  ox: number,
  oy: number,
  oz: number,
  nx: number,
  ny: number,
  nz: number,
  aabb: AABB,
  maxDistance = Infinity
): { axis: number; distance: number } | null {
  const t1 = (aabb.minX - ox) / nx;
  const t2 = (aabb.maxX - ox) / nx;
  const t3 = (aabb.minY - oy) / ny;
  const t4 = (aabb.maxY - oy) / ny;
  const t5 = (aabb.minZ - oz) / nz;
  const t6 = (aabb.maxZ - oz) / nz;

  const tMin = Math.max(
    Math.max(Math.min(t1, t2), Math.min(t3, t4)),
    Math.min(t5, t6)
  );
  const tMinAxis =
    tMin === t1 || tMin === t2 ? 0 : tMin === t3 || tMin === t4 ? 1 : 2;
  const tMax = Math.min(
    Math.min(Math.max(t1, t2), Math.max(t3, t4)),
    Math.max(t5, t6)
  );
  const tMaxAxis =
    tMax === t1 || tMax === t2 ? 0 : tMax === t3 || tMax === t4 ? 1 : 2;

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

export function raycastAABB(
  origin: number[],
  normal: number[],
  aabb: AABB,
  maxDistance = Infinity
): { axis: number; distance: number } | null {
  return raycastAABBAt(
    origin[0],
    origin[1],
    origin[2],
    normal[0],
    normal[1],
    normal[2],
    aabb,
    maxDistance
  );
}

function raycast(
  getVoxel: (vx: number, vy: number, vz: number) => AABB[],
  origin: number[],
  direction: number[],
  maxDistance: number
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
    const aabbs = getVoxel(ix, iy, iz) || EMPTY_AABBS;

    let hit: { axis: number; distance: number } | null = null;
    for (let aabbIndex = 0; aabbIndex < aabbs.length; aabbIndex++) {
      const aabb = aabbs[aabbIndex];
      const result = raycastAABBAt(ox, oy, oz, dx, dy, dz, aabb, maxDistance);
      if (result && (!hit || result.distance < hit.distance)) {
        hit = result;
      }
    }

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
