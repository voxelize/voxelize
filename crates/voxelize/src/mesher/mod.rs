mod default;
mod region;
mod registry;

pub use registry::MesherRegistry;

use crate::{chunks::Voxel, BlockAccess};
use voxelize_protocol::GeometryData;

pub trait Mesher {
    /// Convert voxel data to a 3D mesh representation.
    fn mesh(&self, voxel: &Voxel, block_access: &dyn BlockAccess) -> GeometryData;

    /// Whether this mesher is applicable to the provided block ID.
    fn is_applicable(&self, block_id: u32) -> bool;
}
