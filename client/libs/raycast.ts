import { Coords3 } from "../types";

type GetVoxel = (vx: number, vy: number, vz: number) => boolean;

function traceRay(
  getVoxel: GetVoxel,
  px: number,
  py: number,
  pz: number,
  dx: number,
  dy: number,
  dz: number,
  maxD: number,
  hitPos: Coords3,
  hitNorm: Coords3
) {
  // consider raycast vector to be parametrized by t
  //   vec = [px,py,pz] + t * [dx,dy,dz]

  // algo below is as described by this paper:
  // http://www.cse.chalmers.se/edu/year/2010/course/TDA361/grid.pdf

  let t = 0.0,
    ix = Math.floor(px) | 0,
    iy = Math.floor(py) | 0,
    iz = Math.floor(pz) | 0;
  const stepX = dx > 0 ? 1 : -1,
    stepY = dy > 0 ? 1 : -1,
    stepZ = dz > 0 ? 1 : -1;
  // dx,dy,dz are already normalized
  const txDelta = Math.abs(1 / dx),
    tyDelta = Math.abs(1 / dy),
    tzDelta = Math.abs(1 / dz),
    xDist = stepX > 0 ? ix + 1 - px : px - ix,
    yDist = stepY > 0 ? iy + 1 - py : py - iy,
    zDist = stepZ > 0 ? iz + 1 - pz : pz - iz;
  // location of nearest voxel boundary, in units of t
  let txMax = txDelta < Infinity ? txDelta * xDist : Infinity,
    tyMax = tyDelta < Infinity ? tyDelta * yDist : Infinity,
    tzMax = tzDelta < Infinity ? tzDelta * zDist : Infinity,
    steppedIndex = -1;

  // main loop along raycast vector
  while (t <= maxD) {
    const hx = px + t * dx;
    const hy = py + t * dy;
    const hz = pz + t * dz;

    // exit check
    const b = getVoxel(ix, iy, iz);
    if (b) {
      if (hitPos) {
        hitPos[0] = hx;
        hitPos[1] = hy;
        hitPos[2] = hz;
      }
      if (hitNorm) {
        hitNorm[0] = hitNorm[1] = hitNorm[2] = 0;
        if (steppedIndex === 0) hitNorm[0] = -stepX;
        if (steppedIndex === 1) hitNorm[1] = -stepY;
        if (steppedIndex === 2) hitNorm[2] = -stepZ;
      }
      return b;
    }

    // advance t to next nearest voxel boundary
    if (txMax < tyMax) {
      if (txMax < tzMax) {
        ix += stepX;
        t = txMax;
        txMax += txDelta;
        steppedIndex = 0;
      } else {
        iz += stepZ;
        t = tzMax;
        tzMax += tzDelta;
        steppedIndex = 2;
      }
    } else {
      if (tyMax < tzMax) {
        iy += stepY;
        t = tyMax;
        tyMax += tyDelta;
        steppedIndex = 1;
      } else {
        iz += stepZ;
        t = tzMax;
        tzMax += tzDelta;
        steppedIndex = 2;
      }
    }
  }

  // no voxel hit found
  if (hitPos) {
    hitPos[0] = px + t * dx;
    hitPos[1] = py + t * dy;
    hitPos[2] = pz + t * dz;
  }
  if (hitNorm) {
    hitNorm[0] = hitNorm[1] = hitNorm[2] = 0;
  }

  return 0;
}

// conform inputs

function raycast(
  getVoxel: GetVoxel,
  origin: Coords3,
  direction: Coords3,
  maxD: number,
  hitPos: Coords3 = [0, 0, 0],
  hitNorm: Coords3 = [0, 0, 0]
) {
  const px = +origin[0];
  const py = +origin[1];
  const pz = +origin[2];

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

  return traceRay(getVoxel, px, py, pz, dx, dy, dz, maxD, hitPos, hitNorm);
}

export { raycast };
