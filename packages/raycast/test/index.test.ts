import { raycast } from '../src';
import { AABB } from '@voxelize/voxel-aabb';
import { describe, expect, it } from 'vitest';

const fn =
  (aabbs: [number[], AABB[]][]) => (x: number, y: number, z: number) => {
    const result = aabbs.find(([pos, aabbs]) => {
      if (pos[0] === x && pos[1] === y && pos[2] === z) {
        return true;
      }
    });

    return result ? result[1] : [];
  };

describe('basic', () => {
  it('should work', () => {
    const voxel = fn([[[0, 0, 0], [new AABB(0, 0, 0, 1, 1, 1)]]]);
    const result = raycast(voxel, [-1, 0.5, 0.5], [1, 0, 0], 100);
    expect(result?.normal).toEqual([-1, 0, 0]);
    expect(result?.point).toEqual([1, 0.5, 0.5]);
    expect(result?.voxel).toEqual([0, 0, 0]);
  });
});
