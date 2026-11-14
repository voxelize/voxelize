use crate::{BlockRotation, LightColor};

pub trait VoxelAccess {
    fn get_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32;
    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32;
    fn get_voxel_rotation(&self, vx: i32, vy: i32, vz: i32) -> BlockRotation;
    fn get_voxel_stage(&self, vx: i32, vy: i32, vz: i32) -> u32;
    fn get_voxel_waterlogged(&self, vx: i32, vy: i32, vz: i32) -> bool;
    /// The level of fluid standing in this voxel, from whichever field owns
    /// it: a waterlogged block's own level field, or a fluid block's `stage`.
    fn get_voxel_fluid_level(&self, vx: i32, vy: i32, vz: i32) -> u32;
    fn get_sunlight(&self, vx: i32, vy: i32, vz: i32) -> u32;
    fn get_torch_light(&self, vx: i32, vy: i32, vz: i32, color: LightColor) -> u32;
    fn get_all_lights(&self, vx: i32, vy: i32, vz: i32) -> (u32, u32, u32, u32);
    fn get_max_height(&self, vx: i32, vz: i32) -> u32;
    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool;

    /// Whether this access is plain voxel storage: for every voxel it holds,
    /// `get_voxel_rotation`, `get_voxel_stage`, `get_voxel_waterlogged` and
    /// `get_voxel_fluid_level` are `BlockUtils`' decoding of `get_raw_voxel`.
    /// A caller that has read a voxel's raw word may then decode the rest
    /// itself instead of asking again. `false`, the default, makes no such
    /// promise (an access that computes or overrides a field).
    fn decodes_raw_voxels(&self) -> bool {
        false
    }

    /// The row of cells `(vx, vy, vz..vz + voxels.len())` in one call:
    /// `voxels[i]` as `get_raw_voxel`, `lights[i]` as `get_all_lights` packed
    /// `sun << 12 | red << 8 | green << 4 | blue`, `present[i]` as `contains`.
    /// The three slices are the same length. Storage that keeps a row
    /// together overrides this to copy it; the default asks cell by cell.
    fn read_row(
        &self,
        vx: i32,
        vy: i32,
        vz: i32,
        voxels: &mut [u32],
        lights: &mut [u16],
        present: &mut [bool],
    ) {
        for i in 0..voxels.len() {
            let z = vz + i as i32;
            voxels[i] = self.get_raw_voxel(vx, vy, z);
            let (sun, red, green, blue) = self.get_all_lights(vx, vy, z);
            lights[i] = ((sun << 12) | (red << 8) | (green << 4) | blue) as u16;
            present[i] = self.contains(vx, vy, z);
        }
    }
}
