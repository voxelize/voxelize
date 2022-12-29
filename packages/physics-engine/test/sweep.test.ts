import { assert, describe, expect, it } from 'vitest';
import { AABB } from '../src/aabb';

describe('sweep', () => {
  it('works - basics', () => {
    // let getVoxels = () => [];
    // let box = new AABB(0, 0, 0, 1, 1, 1);
    // let dir = [0,0,0]
    // let collided =false
    // const callback = (dist, axis, dir, lest) => {
    //   collided = true;
    //   return true;
    // }
    // let getVoxels: (...args: any) => boolean = () => false;
    // let box = new AABB(0.25, 0.25, 0.25, 0.75, 0.75, 0.75);
    // let dir = [0, 0, 0];
    // let collided = false;
    // let callback = (
    //   dist: number,
    //   axis: number,
    //   dir: number,
    //   left: number[],
    // ) => {
    //   collided = true;
    //   return true;
    // };
    // let res = sweep(getVoxels, box, dir, callback);
    // assert(!collided, 'No movement with empty vector');
    // expect(res, 'No movement with empty vector').toBe(0);
    // expect(box.minX, 'No movement with empty vector').toBe(0.25);
    // expect(box.minY, 'No movement with empty vector').toBe(0.25);
    // expect(box.minZ, 'No movement with empty vector').toBe(0.25);
    // dir = [10, -5, -15];
    // box.setPosition([0.25, 0.25, 0.25]);
    // collided = false;
    // res = sweep(getVoxels, box, dir, callback);
    // assert(!collided, 'No collision moving through empty voxels');
    // expect(res, 'Full movement through empty voxels').toEqual(
    //   Math.sqrt(100 + 25 + 225),
    // );
    // expect(box.minX, 'Full movement through empty voxels').toEqual(
    //   0.25 + dir[0],
    // );
    // expect(box.minY, 'Full movement through empty voxels').toEqual(
    //   0.25 + dir[1],
    // );
    // expect(box.minZ, 'Full movement through empty voxels').toEqual(
    //   0.25 + dir[2],
    // );
    // getVoxels = () => true;
    // dir = [0, 0, 0];
    // box.setPosition([0.25, 0.25, 0.25]);
    // collided = false;
    // res = sweep(getVoxels, box, dir, callback);
    // assert(!collided, 'No collision not moving through full voxels');
    // expect(res, 'No collision not moving through full voxels').toBe(0);
    // dir = [1, 0, 0];
    // box.setPosition([0.25, 0.25, 0.25]);
    // collided = false;
    // res = sweep(getVoxels, box, dir, callback);
    // assert(collided, 'Collision moving through full voxels');
    // expect(res, 'Collision moving through full voxels').toBe(0.25);
    // expect(box.minX, 'Collision moving through full voxels').toBe(0.5);
    // expect(box.minY, 'Collision moving through full voxels').toBe(0.25);
    // expect(box.minZ, 'Collision moving through full voxels').toBe(0.25);
    // box = new AABB(0, 0, 0, 10, 10, 10);
    // dir = [0, 5, 0];
    // getVoxels = (x: number, y: number, z: number) => {
    //   return x === 8 && z === 8 && y === 13;
    // };
    // collided = false;
    // res = sweep(getVoxels, box, dir, callback);
    // assert(collided, 'Big box collides with single voxel');
    // expect(res, 'Big box collides with single voxel').toBe(3);
    // expect(box.minX, 'Big box collides with single voxel').toBe(0);
    // expect(box.minY, 'Big box collides with single voxel').toBe(3);
    // expect(box.minZ, 'Big box collides with single voxel').toBe(0);
    // box = new AABB(0, 0, 0, 1, 1, 1);
    // dir = [10, 10, 0];
    // getVoxels = function (x: number, y: number, z: number) {
    //   return x > 5;
    // };
    // collided = false;
    // callback = function (dist, axis, dir, left) {
    //   collided = true;
    //   left[axis] = 0;
    //   return false;
    // };
    // res = sweep(getVoxels, box, dir, callback);
    // assert(collided, 'Collides with wall and keeps going on other axis');
    // const tgtDist = Math.sqrt(25 + 25) + 5;
    // expect(res, 'Collides with wall and keeps going on other axis').toBe(
    //   tgtDist,
    // );
    // expect(box.minX, 'Collides with wall and keeps going on other axis').toBe(
    //   5,
    // );
    // expect(box.minY, 'Collides with wall and keeps going on other axis').toBe(
    //   10,
    // );
    // expect(box.minZ, 'Collides with wall and keeps going on other axis').toBe(
    //   0,
    // );
    // box = new AABB(0, 0, 0, 1, 1, 1);
    // dir = [1, 1, 1];
    // getVoxels = () => false;
    // callback = (...args: any) => {
    //   return false;
    // };
    // res = sweep(getVoxels, box, dir, callback, false);
    // expect(box.minX, 'No translation when translate is falsy').toBe(0);
    // expect(box.minY, 'No translation when translate is falsy').toBe(0);
    // expect(box.minZ, 'No translation when translate is falsy').toBe(0);
  });
});
