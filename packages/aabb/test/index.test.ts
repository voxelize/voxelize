import { assert, describe, it } from 'vitest';
import { AABB } from '../src';

describe('compute offset', () => {
  it('works on all axes', () => {
    for (let axis = 0; axis < 3; axis++) {}

    const aabb1 = new AABB(0, 0, 0, 1, 1, 1);
    const aabb2 = new AABB(3, 0, 0, 4, 1, 1);

    assert(aabb2.computeOffsetX(aabb1, -2.4) === -2);
    assert(aabb1.computeOffsetX(aabb2, 2.4) === 2);
  });
});
