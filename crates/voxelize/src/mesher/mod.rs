mod region;
mod registry;
mod vertex;

use hashbrown::HashMap;
pub use region::RegionMesher;
pub use registry::MesherRegistry;
pub use vertex::vertex_ao;

use crate::{chunks::Voxel, BlockAccess, BlockIdentity, BlockRegistry, Face, TextureAtlas};
use voxelize_protocol::GeometryData;

pub trait Mesher<T: BlockIdentity>: Sync + Send + 'static {
    /// Convert voxel data to a 3D mesh representation.
    fn mesh(
        &self,
        min: &Voxel,
        max: &Voxel,
        voxel: &Voxel,
        block_access: &dyn BlockAccess,
        registry: &BlockRegistry<T>,
        texture_atlas: &TextureAtlas,
    ) -> Vec<GeometryData>;

    /// Whether this mesher is applicable to the provided block ID.
    fn is_applicable(&self, block_id: u32) -> bool;
}
