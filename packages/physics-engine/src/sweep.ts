import { Engine } from '.';
import { AABB } from '@voxelize/voxel-aabb';

function lineToPlane(unit: number[], vector: number[], normal: number[]) {
  const [ux, uy, uz] = unit;
  const [vx, vy, vz] = vector;
  const [nx, ny, nz] = normal;

  // Check if parallel
  const NdotU = nx * ux + ny * uy + nz * uz;
  if (NdotU === 0) return Infinity;

  return (nx * vx + ny * vy + nz * vz) / NdotU;
}

function between(x: number, a: number, b: number) {
  return x >= a && x <= b;
}

function sweepAABB(self: AABB, other: AABB, vector: number[]) {
  const mx = other.minX - self.maxX;
  const my = other.minY - self.maxY;
  const mz = other.minZ - self.maxZ;
  const mhx = self.width + other.width;
  const mhy = self.height + other.height;
  const mhz = self.depth + other.depth;

  const [dx, dy, dz] = vector;

  let h = 1,
    s = 0,
    nx = 0,
    ny = 0,
    nz = 0;

  // X min
  s = lineToPlane(vector, [mx, my, mz], [-1, 0, 0]);
  if (
    s >= 0 &&
    dx > 0 &&
    s < h &&
    between(s * dy, my, my + mhy) &&
    between(s * dz, mz, mz + mhz)
  ) {
    h = s;
    nx = -1;
    ny = 0;
    nz = 0;
  }

  // X max
  s = lineToPlane(vector, [mx + mhx, my, mz], [1, 0, 0]);
  if (
    s >= 0 &&
    dx < 0 &&
    s < h &&
    between(s * dy, my, my + mhy) &&
    between(s * dz, mz, mz + mhz)
  ) {
    h = s;
    nx = 1;
    ny = 0;
    nz = 0;
  }

  // Y min
  s = lineToPlane(vector, [mx, my, mz], [0, -1, 0]);
  if (
    s >= 0 &&
    dy > 0 &&
    s < h &&
    between(s * dx, mx, mx + mhx) &&
    between(s * dz, mz, mz + mhz)
  ) {
    h = s;
    nx = 0;
    ny = -1;
    nz = 0;
  }

  // Y max
  s = lineToPlane(vector, [mx, my + mhy, mz], [0, 1, 0]);
  if (
    s >= 0 &&
    dy < 0 &&
    s < h &&
    between(s * dx, mx, mx + mhx) &&
    between(s * dz, mz, mz + mhz)
  ) {
    h = s;
    nx = 0;
    ny = 1;
    nz = 0;
  }

  // Z min
  s = lineToPlane(vector, [mx, my, mz], [0, 0, -1]);
  if (
    s >= 0 &&
    dz > 0 &&
    s < h &&
    between(s * dx, mx, mx + mhx) &&
    between(s * dy, my, my + mhy)
  ) {
    h = s;
    nx = 0;
    ny = 0;
    nz = -1;
  }

  // Z max
  s = lineToPlane(vector, [mx, my, mz + mhz], [0, 0, 1]);
  if (
    s >= 0 &&
    dz < 0 &&
    s < h &&
    between(s * dx, mx, mx + mhx) &&
    between(s * dy, my, my + mhy)
  ) {
    h = s;
    nx = 0;
    ny = 0;
    nz = 1;
  }

  return {
    h,
    nx,
    ny,
    nz,
  };
}

export function sweep(
  getVoxels: (vx: number, vy: number, vz: number) => AABB[],
  box: AABB,
  velocity: number[],
  callback: (
    dist: number,
    axis: number,
    dir: number,
    leftover: number[],
    voxel?: number[],
  ) => boolean,
  translate = true,
  maxIterations = 100,
) {
  if (maxIterations <= 0) return;

  const [vx, vy, vz] = velocity;
  const mag = Math.sqrt(vx * vx + vy * vy + vz * vz);

  // Calculate the broadphase of the box
  const minX = Math.floor(vx > 0 ? box.minX : box.minX + vx) - 1;
  const minY = Math.floor(vy > 0 ? box.minY : box.minY + vy) - 1;
  const minZ = Math.floor(vz > 0 ? box.minZ : box.minZ + vz) - 1;
  const maxX = Math.floor(vx > 0 ? box.maxX + vx : box.maxX) + 1;
  const maxY = Math.floor(vy > 0 ? box.maxY + vy : box.maxY) + 1;
  const maxZ = Math.floor(vz > 0 ? box.maxZ + vz : box.maxZ) + 1;

  let voxel: number[] = [];
  let closest = { h: 1, nx: 0, ny: 0, nz: 0 };

  for (let vx = minX; vx <= maxX; vx++) {
    for (let vz = minZ; vz <= maxZ; vz++) {
      for (let vy = minY; vy <= maxY; vy++) {
        const AABBs = getVoxels(vx, vy, vz);

        for (const aabb of AABBs) {
          const collision = sweepAABB(box, aabb, velocity);

          //Check if this collision is closer than the closest so far.
          if (collision.h < closest.h) {
            closest = collision;
            voxel = [vx, vy, vz];
          }
        }
      }
    }
  }

  // Update the entity's position
  // We move the entity slightly away from the block in order to miss seams.
  const dx = closest.h * vx + Engine.EPSILON * closest.nx;
  const dy = closest.h * vy + Engine.EPSILON * closest.ny;
  const dz = closest.h * vz + Engine.EPSILON * closest.nz;

  if (translate) {
    box.translate([dx, dy, dz]);
  }

  // No collision
  if (closest.h === 1) return;

  const axis = closest.nx !== 0 ? 0 : closest.ny !== 0 ? 1 : 2;
  const dir = -(closest.nx + closest.ny + closest.nz);
  const leftover = [
    (1 - closest.h) * vx,
    (1 - closest.h) * vy,
    (1 - closest.h) * vz,
  ];

  // Bail out on truthy response
  if (dir !== 0 && callback(mag * closest.h, axis, dir, leftover, voxel)) {
    return;
  }

  // Continue to handle
  if (leftover[0] ** 2 + leftover[1] ** 2 + leftover[2] ** 2 != 0.0) {
    sweep(getVoxels, box, leftover, callback, translate, maxIterations - 1);
  }
}
