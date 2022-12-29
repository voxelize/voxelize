import { assert, describe, expect, it } from 'vitest';
import { AABB } from '../src';

describe('aabb', () => {
  it('touches slightly', () => {
    const aabb1 = new AABB(0, 0, 0, 1, 0.5, 1);
    const aabb2 = new AABB(0, 0.5, 0, 1, 1, 1);

    assert(aabb1.touches(aabb2), 'Touching AABBs should touch');
    assert(!aabb1.intersects(aabb2), 'Touching AABBs do not intersect');
  });

  it('computes offset', () => {
    // let aabb1 = new AABB(0, 0, 0, 1, 1, 1);
    // let obstacles = [
    //   // bottom slab
    //   new AABB(0, 0, 0, 1, 0.5, 1).translate([2, 0, 0]),
    // ];
    // aabb1.moveTowards([10, 0, 0], obstacles);
    // expect(aabb1.minX, 'Offset computation for bottom slab').toBe(1);
    // aabb1.setPosition([0, 0, 0]);
    // obstacles = [
    //   // top slab
    //   new AABB(0, 0.5, 0, 1, 1, 1).translate([2, 0, 0]),
    // ];
    // aabb1.moveTowards([10, 0, 0], obstacles);
    // expect(aabb1.minX, 'Offset computation for top slab').toBe(1);
    // aabb1.setPosition([0, 0, 0]);
    // obstacles = [
    //   // Four slabs
    //   new AABB(0, 0, 0, 1, 0.5, 1).translate([2, 0, 0]),
    //   new AABB(0, 0, 0, 1, 0.5, 1).translate([2, 0, 1]),
    //   new AABB(0, 0.5, 0, 1, 1, 1).translate([0, 0, 2]),
    //   new AABB(0, 0.5, 0, 1, 1, 1).translate([1, 0, 2]),
    // ];
    // aabb1.moveTowards([10, 0, 10], obstacles);
    // expect(aabb1.minX, 'Offset computation for two slab walls').toBe(1);
    // expect(aabb1.minZ, 'Offset computation for two slab walls').toBe(1);
    // aabb1.setPosition([0, 0, 0]);
    // obstacles = [
    //   // Stairs
    //   new AABB(0, 0, 0, 1, 0.5, 1).translate([2, 0, 0]),
    //   new AABB(0, 0.5, 0, 0.5, 1, 1).translate([2, 0, 0]),
    // ];
    // aabb1.moveTowards([10, 0, 0], obstacles);
    // expect(aabb1.minX, 'Offset computation for stairs').toBe(1);
    // aabb1 = new AABB(0, 0, 0, 1, 0.5, 1).translate([0, 0.5, 0]);
    // obstacles = [
    //   // Two slabs with gap in between
    //   new AABB(0, 0, 0, 1, 0.5, 1).translate([2, 0, 0]),
    //   new AABB(0, 1, 0, 1, 1.5, 1).translate([2, 0, 0]),
    // ];
    // aabb1.moveTowards([10, 0, 0], obstacles);
    // expect(aabb1.minX, 'Offset computations for gap between slabs').toBe(10);
    // aabb1.setPosition([0, 0, 0]);
    // obstacles = [
    //   // Diagonal in the way
    //   new AABB(0, 0, 0, 1, 0.5, 1).translate([2, 0, 2]),
    // ];
    // aabb1.moveTowards([10, 0, 10], obstacles);
    // expect(aabb1.minX, 'Offset computations for diagonal obstacle').toBe(1);
    // expect(aabb1.minZ, 'Offset computations for diagonal obstacle').toBe(1);
  });
});
