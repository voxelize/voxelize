use voxelize_protocol::GeometryData;

use crate::{chunks::Voxel, BlockAccess};

use super::Mesher;

pub struct DefaultMesher;

impl Mesher for DefaultMesher {
    fn mesh(&self, voxel: &Voxel, block_access: &dyn BlockAccess) -> GeometryData {
        // Default logic for converting the given voxel to a 3D mesh
        // Use block.id or block.position as needed.
        // You can also utilize the neighbors to decide culling or adjacency details.

        todo!("Implement default mesher")
    }

    fn is_applicable(&self, _block_id: u32) -> bool {
        true // always applicable as a fallback
    }
}
