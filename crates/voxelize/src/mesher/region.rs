use hashbrown::HashMap;
use voxelize_protocol::GeometryData;

use crate::{libs::Vec3, BlockAccess, BlockIdentity, BlockRegistry};

use super::MesherRegistry;

#[derive(Clone)]
pub struct RegionMesher<T: BlockIdentity> {
    mesher_registry: MesherRegistry<T>,
    block_registry: BlockRegistry<T>,
}

impl<T: BlockIdentity> RegionMesher<T> {
    pub fn new(mesher_registry: MesherRegistry<T>, block_registry: BlockRegistry<T>) -> Self {
        Self {
            mesher_registry,
            block_registry,
        }
    }

    pub fn mesh(
        &self,
        block_access: &dyn BlockAccess,
        min_coords: Vec3<i32>,
        max_coords: Vec3<i32>,
    ) -> Vec<GeometryData> {
        let mut all_geometries: HashMap<String, GeometryData> = HashMap::new();

        let get_identifier =
            |face_name: &Option<String>, block_id: u32| format!("{:?}:{}", face_name, block_id);

        for x in min_coords.0..=max_coords.0 {
            for y in min_coords.1..=max_coords.1 {
                for z in min_coords.2..=max_coords.2 {
                    let block_id = block_access.get_block_id(x, y, z);

                    if let Some(mesher) = self.mesher_registry.get_mesher_by_block_id(block_id) {
                        let geometries =
                            mesher.mesh(&Vec3(x, y, z), block_access, &self.block_registry);

                        for mut geometry in geometries {
                            let identifier = get_identifier(&geometry.face_name, block_id);

                            if all_geometries.contains_key(&identifier) {
                                all_geometries
                                    .get_mut(&identifier)
                                    .unwrap()
                                    .append(&mut geometry);
                            } else {
                                all_geometries.insert(identifier, geometry);
                            }
                        }
                    }
                }
            }
        }

        let mut geometry_list = vec![];

        for (_, geometry) in all_geometries {
            geometry_list.push(geometry);
        }

        geometry_list
    }
}
