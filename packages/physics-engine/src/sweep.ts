import { AABB } from "@voxelize/aabb";

import { Engine } from ".";

/**
 * Where along `unit` the line from the origin meets the plane through
 * `vector` with `normal`. Numbers in and out, with nothing made on the way:
 * a body's sweep asks this six times for every voxel box around it, and as
 * arrays those calls were a tenth of everything the page allocated.
 */
function lineToPlane(
  ux: number,
  uy: number,
  uz: number,
  vx: number,
  vy: number,
  vz: number,
  nx: number,
  ny: number,
  nz: number,
) {
  // Check if parallel
  const NdotU = nx * ux + ny * uy + nz * uz;
  if (NdotU === 0) return Infinity;

  return (nx * vx + ny * vy + nz * vz) / NdotU;
}

function between(x: number, a: number, b: number) {
  return x >= a && x <= b;
}

type Hit = { h: number; nx: number; ny: number; nz: number };

/** The last `sweepAABB` answer: read before the next call. */
const hit: Hit = { h: 1, nx: 0, ny: 0, nz: 0 };

/**
 * How far along `vector` `self` travels before it meets `other` (1: not at
 * all), and the face it meets, left in {@link hit}.
 */
function sweepAABB(self: AABB, other: AABB, vector: number[]): Hit {
  const mx = other.minX - self.maxX;
  const my = other.minY - self.maxY;
  const mz = other.minZ - self.maxZ;
  const mhx = self.width + other.width;
  const mhy = self.height + other.height;
  const mhz = self.depth + other.depth;

  const dx = vector[0];
  const dy = vector[1];
  const dz = vector[2];

  let h = 1,
    s = 0,
    nx = 0,
    ny = 0,
    nz = 0;

  // X min
  s = lineToPlane(dx, dy, dz, mx, my, mz, -1, 0, 0);
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
  s = lineToPlane(dx, dy, dz, mx + mhx, my, mz, 1, 0, 0);
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
  s = lineToPlane(dx, dy, dz, mx, my, mz, 0, -1, 0);
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
  s = lineToPlane(dx, dy, dz, mx, my + mhy, mz, 0, 1, 0);
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
  s = lineToPlane(dx, dy, dz, mx, my, mz, 0, 0, -1);
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
  s = lineToPlane(dx, dy, dz, mx, my, mz + mhz, 0, 0, 1);
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

  hit.h = h;
  hit.nx = nx;
  hit.ny = ny;
  hit.nz = nz;
  return hit;
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
    aabb?: AABB,
  ) => boolean,
  translate = true,
  maxIterations = 100,
  extras: AABB[] = [],
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
  // Its own, since a sweep runs again for what is left over: the nearest
  // hit so far, copied out of `sweepAABB`'s shared answer.
  const closest: Hit = { h: 1, nx: 0, ny: 0, nz: 0 };
  // The box `closest` was found against: the box the sweep actually collided
  // with, for a callback that wants more than the voxel it stands in. A copy,
  // since a voxel's boxes are only the sweep's to read until it asks about
  // the next voxel.
  let hitBox: AABB | null = null;
  const take = (collision: Hit, against: AABB) => {
    closest.h = collision.h;
    closest.nx = collision.nx;
    closest.ny = collision.ny;
    closest.nz = collision.nz;
    if (!hitBox) {
      hitBox = against.clone();
      return;
    }
    hitBox.minX = against.minX;
    hitBox.minY = against.minY;
    hitBox.minZ = against.minZ;
    hitBox.maxX = against.maxX;
    hitBox.maxY = against.maxY;
    hitBox.maxZ = against.maxZ;
  };

  for (const e of extras) {
    const collision = sweepAABB(box, e, velocity);
    if (collision.h < closest.h) {
      take(collision, e);
      voxel = [vx, vy, vz];
    }
  }

  for (let vx = minX; vx <= maxX; vx++) {
    for (let vz = minZ; vz <= maxZ; vz++) {
      for (let vy = minY; vy <= maxY; vy++) {
        const AABBs = getVoxels(vx, vy, vz);

        for (const aabb of AABBs) {
          const collision = sweepAABB(box, aabb, velocity);

          // Check if this collision is closer than the closest so far.
          if (collision.h < closest.h) {
            take(collision, aabb);
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
  if (
    dir !== 0 &&
    callback(mag * closest.h, axis, dir, leftover, voxel, hitBox ?? undefined)
  ) {
    return;
  }

  // Continue to handle
  if (leftover[0] ** 2 + leftover[1] ** 2 + leftover[2] ** 2 != 0.0) {
    sweep(
      getVoxels,
      box,
      leftover,
      callback,
      translate,
      maxIterations - 1,
      extras,
    );
  }
}
