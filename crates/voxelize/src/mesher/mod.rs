mod region;
mod registry;

pub use region::RegionMesher;
pub use registry::MesherRegistry;

use crate::{chunks::Voxel, BlockAccess, BlockIdentity, BlockRegistry};
use voxelize_protocol::GeometryData;

pub trait Mesher<T: BlockIdentity>: Sync + Send + 'static {
    /// Convert voxel data to a 3D mesh representation.
    fn mesh(
        &self,
        voxel: &Voxel,
        block_access: &dyn BlockAccess,
        registry: &BlockRegistry<T>,
    ) -> Vec<GeometryData>;

    /// Whether this mesher is applicable to the provided block ID.
    fn is_applicable(&self, block_id: u32) -> bool;
}
