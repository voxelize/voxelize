use voxelize_core::VoxelAccess;

use super::*;

/// Face order for connectivity bits: -X, +X, -Y, +Y, -Z, +Z. The client BFS
/// mirrors this order; change neither side alone.
pub const CONNECTIVITY_FACES: usize = 6;

/// All fifteen unordered face pairs connected — the encoding for a section
/// the eye passes straight through (all air, or unknowable).
pub const CONNECTIVITY_FULL: u32 = 0x7FFF;

/// No pairs connected — a section sealed solid.
pub const CONNECTIVITY_SEALED: u32 = 0;

/// Bit index of the unordered face pair `(a, b)`, `a < b`, in the packed
/// connectivity word. Fifteen pairs for six faces.
#[inline]
pub fn connectivity_pair_bit(a: usize, b: usize) -> u32 {
    debug_assert!(a < b && b < CONNECTIVITY_FACES);
    let offset = a * (2 * CONNECTIVITY_FACES - a - 1) / 2;
    1 << (offset + (b - a - 1))
}

/// Which of a section's six faces can see which others through its non-opaque
/// voxels, as Sodium's visibility graph asks it: flood-fill every connected
/// component of non-opaque cells and mark every pair of boundary faces the
/// component touches. The BFS that consumes this walks section to section,
/// only continuing through a section when the face it entered connects to the
/// face it wants to leave by.
pub fn compute_section_connectivity<S: VoxelAccess>(
    min: &[i32; 3],
    max: &[i32; 3],
    space: &S,
    registry: &Registry,
) -> u32 {
    let size_x = (max[0] - min[0]) as usize;
    let size_y = (max[1] - min[1]) as usize;
    let size_z = (max[2] - min[2]) as usize;
    if size_x == 0 || size_y == 0 || size_z == 0 {
        return CONNECTIVITY_FULL;
    }

    let cell_count = size_x * size_y * size_z;
    let mut visited = vec![false; cell_count];
    let mut queue: Vec<usize> = Vec::new();
    let mut connectivity = CONNECTIVITY_SEALED;

    let index_of = |x: usize, y: usize, z: usize| (x * size_y + y) * size_z + z;
    let is_passable = |x: usize, y: usize, z: usize| {
        let id = space.get_voxel(
            min[0] + x as i32,
            min[1] + y as i32,
            min[2] + z as i32,
        );
        registry
            .get_block_by_id(id)
            .is_none_or(|block| !block.is_opaque)
    };

    for start in 0..cell_count {
        if visited[start] {
            continue;
        }
        let sx = start / (size_y * size_z);
        let sy = (start / size_z) % size_y;
        let sz = start % size_z;
        if !is_passable(sx, sy, sz) {
            visited[start] = true;
            continue;
        }

        let mut faces_touched = 0u8;
        visited[start] = true;
        queue.clear();
        queue.push(start);

        while let Some(cell) = queue.pop() {
            let x = cell / (size_y * size_z);
            let y = (cell / size_z) % size_y;
            let z = cell % size_z;

            if x == 0 {
                faces_touched |= 1 << 0;
            }
            if x == size_x - 1 {
                faces_touched |= 1 << 1;
            }
            if y == 0 {
                faces_touched |= 1 << 2;
            }
            if y == size_y - 1 {
                faces_touched |= 1 << 3;
            }
            if z == 0 {
                faces_touched |= 1 << 4;
            }
            if z == size_z - 1 {
                faces_touched |= 1 << 5;
            }

            let mut visit = |nx: usize, ny: usize, nz: usize| {
                let neighbor = index_of(nx, ny, nz);
                if !visited[neighbor] {
                    visited[neighbor] = true;
                    if is_passable(nx, ny, nz) {
                        queue.push(neighbor);
                    }
                }
            };

            if x > 0 {
                visit(x - 1, y, z);
            }
            if x + 1 < size_x {
                visit(x + 1, y, z);
            }
            if y > 0 {
                visit(x, y - 1, z);
            }
            if y + 1 < size_y {
                visit(x, y + 1, z);
            }
            if z > 0 {
                visit(x, y, z - 1);
            }
            if z + 1 < size_z {
                visit(x, y, z + 1);
            }
        }

        for a in 0..CONNECTIVITY_FACES {
            if faces_touched & (1 << a) == 0 {
                continue;
            }
            for b in (a + 1)..CONNECTIVITY_FACES {
                if faces_touched & (1 << b) != 0 {
                    connectivity |= connectivity_pair_bit(a, b);
                }
            }
        }

        if connectivity == CONNECTIVITY_FULL {
            break;
        }
    }

    connectivity
}
