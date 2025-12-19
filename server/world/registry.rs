use std::sync::Arc;

use hashbrown::{HashMap, HashSet};
use log::info;
use serde::{Deserialize, Serialize};

use crate::{BlockFace, Vec3, VoxelAccess, VoxelUpdate};

use super::voxels::Block;

/// Serializable struct representing a UV coordinate.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UV {
    /// Starting u-coordinate.
    pub start_u: f32,

    /// Ending u-coordinate.
    pub end_u: f32,

    /// Starting v-coordinate.
    pub start_v: f32,

    /// Ending v-coordinate.
    pub end_v: f32,
}

impl Default for UV {
    fn default() -> Self {
        Self {
            start_u: 0.0,
            end_u: 1.0,
            start_v: 0.0,
            end_v: 1.0,
        }
    }
}

/// A collection of blocks to use in a Voxelize server. One server has one registry and one
/// registry only. Once a registry is added to a server, it cannot be changed.
#[derive(Default, Clone)]
pub struct Registry {
    /// Block records, name -> Block.
    pub blocks_by_name: HashMap<String, Block>,

    /// Block records, id -> Block.
    pub blocks_by_id: HashMap<u32, Block>,

    /// List of textures that this registry has. Textures are then applied onto block sides.
    pub textures: HashSet<(u32, usize, bool)>,

    /// Map of ID -> name.
    name_map: HashMap<u32, String>,

    /// Map of name -> ID.
    type_map: HashMap<String, u32>,
}

impl Registry {
    /// Create a registry instance. By default, the "Air" block is registered at ID of 0.
    pub fn new() -> Self {
        let air = Block::new("Air")
            .is_empty(true)
            .is_passable(true)
            .is_x_transparent(true)
            .is_y_transparent(true)
            .is_z_transparent(true)
            .aabbs(&[])
            .build();

        let mut instance = Self::default();
        instance.record_block(&air);

        instance
    }

    pub fn register_air_active_fn<
        F1: Fn(Vec3<i32>, &dyn VoxelAccess, &Registry) -> u64 + 'static + Send + Sync,
        F2: Fn(Vec3<i32>, &dyn VoxelAccess, &Registry) -> Vec<VoxelUpdate> + 'static + Send + Sync,
    >(
        &mut self,
        active_ticker: F1,
        active_updater: F2,
    ) {
        let mut air = self.blocks_by_id.remove(&0).unwrap();

        air.active_ticker = Some(Arc::new(active_ticker));
        air.active_updater = Some(Arc::new(active_updater));
        air.is_active = true;

        self.record_block(&air);
    }

    /// Generate the UV coordinates of the blocks. Call this before the server starts!
    pub fn generate(&mut self) {
        let all_blocks = self.blocks_by_id.values_mut().collect::<Vec<_>>();

        let mut texture_groups: HashSet<String> = HashSet::new();
        let mut ungrouped_faces = 0;

        for block in all_blocks.iter() {
            for face in block.faces.iter() {
                if face.independent || face.isolated {
                    continue;
                }

                if let Some(group) = &face.texture_group {
                    texture_groups.insert(group.clone());
                } else {
                    ungrouped_faces += 1;
                }
            }
        }

        let total_slots = texture_groups.len() + ungrouped_faces;

        if total_slots == 0 {
            return;
        }

        let mut count_per_side = 1.0;
        let sqrt = (total_slots as f32).sqrt().ceil();
        while count_per_side < sqrt {
            count_per_side *= 2.0;
        }

        let count_per_side = count_per_side as usize;
        let offset = 1.0 / (count_per_side as f32 * 4.0);

        let mut group_uvs: HashMap<String, UV> = HashMap::new();
        let mut row = 0;
        let mut col = 0;

        let mut allocate_slot = || {
            if col >= count_per_side {
                col = 0;
                row += 1;
            }

            let start_x = col as f32;
            let start_y = row as f32;

            let start_u = start_x / count_per_side as f32 + offset;
            let end_u = (start_x + 1.0) / count_per_side as f32 - offset;
            let start_v = start_y / count_per_side as f32 + offset;
            let end_v = (start_y + 1.0) / count_per_side as f32 - offset;

            col += 1;

            UV {
                start_u,
                end_u,
                start_v,
                end_v,
            }
        };

        for group in &texture_groups {
            group_uvs.insert(group.clone(), allocate_slot());
        }

        for block in all_blocks {
            for face in block.faces.iter_mut() {
                if face.independent || face.isolated {
                    continue;
                }

                if let Some(group) = &face.texture_group {
                    if let Some(uv) = group_uvs.get(group) {
                        face.range = uv.clone();
                    }
                } else {
                    face.range = allocate_slot();
                }
            }

            if let Some(dynamic_patterns) = block.dynamic_patterns.as_mut() {
                for pattern in dynamic_patterns {
                    for part in &mut pattern.parts {
                        for face in &mut part.faces {
                            let existing = block.faces.iter().find(|f| f.name == face.name);
                            if let Some(e) = existing {
                                face.range = e.range.clone();
                                face.texture_group = e.texture_group.clone();
                            }
                        }
                    }
                }
            }
        }

        self.blocks_by_id.values().for_each(|block| {
            let block_by_name = self
                .blocks_by_name
                .get_mut(&block.name.to_lowercase())
                .unwrap();
            block_by_name.faces = block.faces.clone();
            block_by_name.dynamic_patterns = block.dynamic_patterns.clone();
        });
    }

    /// Register multiple blocks into this world. The block ID's are assigned to the length of the blocks at registration.
    pub fn register_blocks(&mut self, blocks: &[Block]) {
        blocks.into_iter().for_each(|block| {
            self.register_block(block);
        });
    }

    /// Register a block into this world. The block ID is assigned to the length of the blocks registered.
    pub fn register_block(&mut self, block: &Block) {
        let mut block = block.to_owned();

        if block.id == 0 {
            let mut next_available = 1;

            loop {
                if self.blocks_by_id.contains_key(&next_available) {
                    next_available += 1;
                } else {
                    break;
                }
            }

            block.id = next_available;
        }

        if self.blocks_by_id.contains_key(&block.id) {
            panic!("Duplicated key: {}-{}", block.name, block.id);
        }

        self.record_block(&block);
    }

    /// Get a block reference by block name.
    pub fn get_block_by_name(&self, name: &str) -> &Block {
        self.blocks_by_name
            .get(&name.to_lowercase())
            .unwrap_or_else(|| panic!("Block name not found: {name}",))
    }

    /// Get a block reference by block ID. Returns Air if block ID not found.
    pub fn get_block_by_id(&self, id: u32) -> &Block {
        self.blocks_by_id
            .get(&id)
            .unwrap_or_else(|| self.blocks_by_id.get(&0).expect("Air block must exist"))
    }

    /// Get a block id by block name.
    pub fn get_id_by_name(&self, name: &str) -> u32 {
        *self
            .type_map
            .get(&name.to_lowercase())
            .unwrap_or_else(|| panic!("Block name not found: {name}"))
    }

    /// Get block fluidity by id.
    pub fn get_fluiditiy_by_id(&self, id: u32) -> bool {
        self.get_block_by_id(id).is_fluid
    }

    /// Get block fluidity by name.
    pub fn get_fluiditiy_by_name(&self, name: &str) -> bool {
        self.get_block_by_name(name).is_fluid
    }

    /// Get block opacity by id.
    pub fn get_opacity_by_id(&self, id: u32) -> bool {
        self.get_block_by_id(id).is_opaque
    }

    /// Get block opacity by name.
    pub fn get_opacity_by_name(&self, name: &str) -> bool {
        self.get_block_by_name(name).is_opaque
    }

    /// Get block emptiness by id.
    pub fn get_emptiness_by_id(&self, id: u32) -> bool {
        self.get_block_by_id(id).is_empty
    }

    /// Get block emptiness by name.
    pub fn get_emptiness_by_name(&self, name: &str) -> bool {
        self.get_block_by_name(name).is_empty
    }

    /// Get block faces by id.
    pub fn get_faces_by_id(&self, id: u32) -> &Vec<BlockFace> {
        &self.get_block_by_id(id).faces
    }

    /// Get block faces by name.
    pub fn get_faces_by_name(&self, name: &str) -> &Vec<BlockFace> {
        &self.get_block_by_name(name).faces
    }

    /// Check if block is air by id.
    pub fn is_air(&self, id: u32) -> bool {
        self.get_block_by_id(id).name == "Air"
    }

    /// Check if block is fluid by id.
    pub fn is_fluid(&self, id: u32) -> bool {
        self.get_block_by_id(id).is_fluid
    }

    /// Get type map of all blocks.
    pub fn get_type_map(&self, blocks: &[&str]) -> HashMap<String, u32> {
        let mut type_map = HashMap::new();

        for block in blocks {
            let &id = self
                .type_map
                .get(&block.to_lowercase())
                .unwrap_or_else(|| panic!("Block name not found: {}", block));

            type_map.insert((*block).to_owned(), id);
        }

        type_map
    }

    /// Logic for checking max height, returning true if id counts as valid max height.
    pub fn check_height(&self, id: u32) -> bool {
        id != 0
    }

    /// Check if registry contains type.
    pub fn has_type(&self, id: u32) -> bool {
        self.blocks_by_id.contains_key(&id)
    }

    /// Get UV map by block.
    pub fn get_uv_map(&self, block: &Block) -> HashMap<String, UV> {
        let mut uv_map = HashMap::new();

        for source in block.faces.iter() {
            let uv = source.range.to_owned();
            uv_map.insert(source.name.to_owned(), uv);
        }

        uv_map
    }

    /// Record a block into the registry, adding this block into appropriate maps.
    fn record_block(&mut self, block: &Block) {
        let Block {
            id, name, faces, ..
        } = block;

        let lower_name = name.to_lowercase();

        self.blocks_by_name.remove(&lower_name);
        self.blocks_by_id.remove(id);

        self.blocks_by_name
            .insert(lower_name.clone(), block.clone());
        self.blocks_by_id.insert(*id, block.clone());
        self.name_map.insert(*id, lower_name.clone());
        self.type_map.insert(lower_name.clone(), *id);

        for (idx, side) in faces.iter().enumerate() {
            self.textures.insert((*id, idx, side.independent));
        }
    }

    pub fn to_mesher_registry(&self) -> voxelize_mesher::Registry {
        let blocks_by_id: Vec<(u32, voxelize_mesher::Block)> = self
            .blocks_by_id
            .iter()
            .map(|(id, block)| (*id, block.to_mesher_block()))
            .collect();

        voxelize_mesher::Registry::new(blocks_by_id)
    }
}
