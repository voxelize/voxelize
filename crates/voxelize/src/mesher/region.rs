use hashbrown::HashMap;
use voxelize_protocol::GeometryData;

use crate::{libs::Vec3, BlockAccess};

use super::MesherRegistry;

pub struct RegionMesher<'a> {
    mesher_registry: &'a MesherRegistry,
}

impl<'a> RegionMesher<'a> {
    pub fn new(mesher_registry: &'a MesherRegistry) -> Self {
        Self { mesher_registry }
    }

    pub fn mesh(
        &self,
        block_access: &dyn BlockAccess,
        min_coords: (i32, i32, i32),
        max_coords: (i32, i32, i32),
    ) -> Vec<GeometryData> {
        let mut geometries: HashMap<u32, GeometryData> = HashMap::new();

        for x in min_coords.0..=max_coords.0 {
            for y in min_coords.1..=max_coords.1 {
                for z in min_coords.2..=max_coords.2 {
                    let block_id = block_access.get_block_id(x, y, z);

                    let mesher = self.mesher_registry.get_mesher_by_block_id(block_id);
                    let geometry = mesher.mesh(&Vec3(x, y, z), block_access);

                    if geometries.contains_key(&block_id) {
                        geometries
                            .get_mut(&block_id)
                            .unwrap()
                            .append(&mut geometry.clone());
                    } else {
                        geometries.insert(block_id, geometry);
                    }
                }
            }
        }

        let mut geometry_list = vec![];

        for (_, geometry) in geometries {
            geometry_list.push(geometry);
        }

        geometry_list
    }
}
