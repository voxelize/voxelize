use std::borrow::Cow;
use std::sync::{Arc, OnceLock};

use hashbrown::{HashMap, HashSet};
use log::warn;
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
#[derive(Default)]
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

    mesher_registry_cache: OnceLock<Arc<voxelize_mesher::Registry>>,
    lighter_registry_cache: OnceLock<Arc<voxelize_lighter::LightRegistry>>,
}

impl Clone for Registry {
    fn clone(&self) -> Self {
        Self {
            blocks_by_name: self.blocks_by_name.clone(),
            blocks_by_id: self.blocks_by_id.clone(),
            textures: self.textures.clone(),
            name_map: self.name_map.clone(),
            type_map: self.type_map.clone(),
            mesher_registry_cache: OnceLock::new(),
            lighter_registry_cache: OnceLock::new(),
        }
    }
}

impl Registry {
    #[inline]
    fn fallback_air_block() -> &'static Block {
        static AIR_BLOCK: OnceLock<Block> = OnceLock::new();
        AIR_BLOCK.get_or_init(|| {
            Block::new("Air")
                .is_empty(true)
                .is_passable(true)
                .is_x_transparent(true)
                .is_y_transparent(true)
                .is_z_transparent(true)
                .aabbs(&[])
                .build()
        })
    }

    #[inline]
    fn normalized_name<'a>(name: &'a str) -> Cow<'a, str> {
        let mut has_non_ascii = false;
        for &byte in name.as_bytes() {
            if byte.is_ascii_uppercase() {
                return Cow::Owned(name.to_lowercase());
            }
            if !byte.is_ascii() {
                has_non_ascii = true;
            }
        }
        if !has_non_ascii {
            Cow::Borrowed(name)
        } else {
            for ch in name.chars() {
                if ch.is_uppercase() {
                    return Cow::Owned(name.to_lowercase());
                }
            }
            Cow::Borrowed(name)
        }
    }

    /// Create a registry instance. By default, the "Air" block is registered at ID of 0.
    pub fn new() -> Self {
        let air = Self::fallback_air_block().clone();

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
        let Some(mut air) = self.blocks_by_id.get(&0).cloned() else {
            warn!("Air block missing; skipping air active function registration");
            return;
        };

        air.active_ticker = Some(Arc::new(active_ticker));
        air.active_updater = Some(Arc::new(active_updater));
        air.is_active = true;

        self.invalidate_cached_registries();
        self.record_block(&air);
    }

    /// Generate the UV coordinates of the blocks. Call this before the server starts!
    pub fn generate(&mut self) {
        self.invalidate_cached_registries();

        let mut texture_groups: HashSet<String> = HashSet::new();
        let mut ungrouped_faces = 0;

        for block in self.blocks_by_id.values() {
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

        let mut group_uvs: HashMap<String, UV> = HashMap::with_capacity(texture_groups.len());
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

        for block in self.blocks_by_id.values_mut() {
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

        for (block_id, block_name) in self.name_map.iter() {
            let Some(block) = self.blocks_by_id.get(block_id) else {
                continue;
            };
            if let Some(block_by_name) = self.blocks_by_name.get_mut(block_name) {
                block_by_name.faces = block.faces.clone();
                block_by_name.dynamic_patterns = block.dynamic_patterns.clone();
            }
        }
    }

    /// Register multiple blocks into this world. Blocks with ID 0 are auto-assigned to the next available non-zero ID.
    pub fn register_blocks(&mut self, blocks: &[Block]) {
        if blocks.is_empty() {
            return;
        }

        let blocks = self.prepare_blocks_for_registration(blocks);

        self.invalidate_cached_registries();
        for block in &blocks {
            self.record_block(block);
        }
    }

    /// Register a block into this world. If the block ID is 0, it is auto-assigned to the next available non-zero ID.
    pub fn register_block(&mut self, block: &Block) {
        let block = self.prepare_block_for_registration(block);

        self.invalidate_cached_registries();
        self.record_block(&block);
    }

    /// Get a block reference by block name.
    pub fn get_block_by_name(&self, name: &str) -> &Block {
        let normalized_name = Self::normalized_name(name);
        if let Some(block) = self.blocks_by_name.get(normalized_name.as_ref()) {
            return block;
        }
        warn!("Block name not found: {}", name);
        self.blocks_by_id
            .get(&0)
            .unwrap_or_else(|| Self::fallback_air_block())
    }

    /// Get a block reference by block ID. Returns Air if block ID not found.
    pub fn get_block_by_id(&self, id: u32) -> &Block {
        if let Some(block) = self.blocks_by_id.get(&id) {
            return block;
        }
        if let Some(block) = self.blocks_by_id.get(&0) {
            return block;
        }
        Self::fallback_air_block()
    }

    /// Get a block id by block name.
    pub fn get_id_by_name(&self, name: &str) -> u32 {
        let normalized_name = Self::normalized_name(name);
        if let Some(id) = self.type_map.get(normalized_name.as_ref()) {
            return *id;
        }
        warn!("Block name not found: {}", name);
        0
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

    /// Get normalized block name by id.
    pub fn get_name_by_id(&self, id: u32) -> &str {
        if let Some(name) = self.name_map.get(&id) {
            return name.as_str();
        }
        if let Some(name) = self.name_map.get(&0) {
            return name.as_str();
        }
        "air"
    }

    /// Check if block is air by id.
    pub fn is_air(&self, id: u32) -> bool {
        self.blocks_by_id
            .get(&id)
            .map(|block| block.name == "Air")
            .unwrap_or(true)
    }

    /// Check if block is fluid by id.
    pub fn is_fluid(&self, id: u32) -> bool {
        self.blocks_by_id
            .get(&id)
            .map(|block| block.is_fluid)
            .unwrap_or(false)
    }

    /// Get type map of all blocks.
    pub fn get_type_map(&self, blocks: &[&str]) -> HashMap<String, u32> {
        let mut type_map = HashMap::with_capacity(blocks.len());

        for block in blocks {
            let normalized_name = Self::normalized_name(block);
            let id = match self.type_map.get(normalized_name.as_ref()) {
                Some(id) => *id,
                None => {
                    warn!("Block name not found in get_type_map: {}", block);
                    0
                }
            };

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

    #[inline]
    pub fn get_known_block_by_id(&self, id: u32) -> Option<&Block> {
        self.blocks_by_id.get(&id)
    }

    /// Get UV map by block.
    pub fn get_uv_map(&self, block: &Block) -> HashMap<String, UV> {
        let mut uv_map = HashMap::with_capacity(block.faces.len());

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

        let lower_name = Self::normalized_name(name).into_owned();
        let existing_id_for_name = self.blocks_by_name.get(&lower_name).map(|existing| existing.id);
        let existing_name_for_id = self.name_map.get(id).cloned();

        if let Some(existing_id) = existing_id_for_name {
            self.blocks_by_id.remove(&existing_id);
            self.name_map.remove(&existing_id);
        }
        if let Some(existing_name) = existing_name_for_id {
            self.blocks_by_name.remove(&existing_name);
            self.type_map.remove(&existing_name);
        }

        self.blocks_by_name.remove(&lower_name);
        self.blocks_by_id.remove(id);
        self.name_map.remove(id);
        self.type_map.remove(&lower_name);
        self.textures.retain(|(texture_id, _, _)| {
            if *texture_id == *id {
                return false;
            }

            if let Some(existing_id) = existing_id_for_name {
                return *texture_id != existing_id;
            }

            true
        });

        self.blocks_by_name
            .insert(lower_name.clone(), block.clone());
        self.blocks_by_id.insert(*id, block.clone());
        self.name_map.insert(*id, lower_name.clone());
        self.type_map.insert(lower_name.clone(), *id);

        for (idx, side) in faces.iter().enumerate() {
            self.textures.insert((*id, idx, side.independent));
        }
    }

    fn prepare_block_for_registration(&self, block: &Block) -> Block {
        if let Some(prepared) = self
            .prepare_blocks_for_registration(std::slice::from_ref(block))
            .into_iter()
            .next()
        {
            prepared
        } else {
            block.clone()
        }
    }

    fn prepare_blocks_for_registration(&self, blocks: &[Block]) -> Vec<Block> {
        let mut occupied_ids = self
            .blocks_by_id
            .keys()
            .copied()
            .collect::<HashSet<u32>>();
        let mut name_to_id = self
            .blocks_by_name
            .iter()
            .map(|(name, block)| (name.clone(), block.id))
            .collect::<HashMap<String, u32>>();
        let mut id_to_name = self.name_map.clone();
        let mut reserved_explicit_ids = blocks
            .iter()
            .filter(|block| block.id != 0)
            .map(|block| block.id)
            .collect::<HashSet<u32>>();
        let mut prepared_blocks = Vec::with_capacity(blocks.len());
        let mut next_available = 1;

        for block in blocks {
            let mut block = block.to_owned();
            let lower_name = Self::normalized_name(&block.name).into_owned();
            let existing_id_for_name = name_to_id.get(&lower_name).copied();

            if block.id != 0 {
                reserved_explicit_ids.remove(&block.id);
            }

            if block.id == 0 {
                while occupied_ids.contains(&next_available)
                    || reserved_explicit_ids.contains(&next_available)
                {
                    next_available += 1;
                }
                block.id = next_available;
            } else if occupied_ids.contains(&block.id) {
                warn!(
                    "Duplicated block id detected for '{}': {}. Reassigning.",
                    block.name, block.id
                );
                while occupied_ids.contains(&next_available)
                    || reserved_explicit_ids.contains(&next_available)
                {
                    next_available += 1;
                }
                block.id = next_available;
            }

            if let Some(existing_id) = existing_id_for_name {
                occupied_ids.remove(&existing_id);
                id_to_name.remove(&existing_id);
                if existing_id < next_available {
                    next_available = existing_id;
                }
            }

            if let Some(existing_name) = id_to_name.remove(&block.id) {
                name_to_id.remove(&existing_name);
            }

            occupied_ids.insert(block.id);
            id_to_name.insert(block.id, lower_name.clone());
            name_to_id.insert(lower_name, block.id);
            if block.id == next_available {
                while occupied_ids.contains(&next_available)
                    || reserved_explicit_ids.contains(&next_available)
                {
                    next_available += 1;
                }
            }
            prepared_blocks.push(block);
        }

        prepared_blocks
    }

    pub fn mesher_registry_ref(&self) -> &Arc<voxelize_mesher::Registry> {
        self.mesher_registry_cache.get_or_init(|| {
            let mut blocks_by_id = Vec::with_capacity(self.blocks_by_id.len());
            for (id, block) in self.blocks_by_id.iter() {
                blocks_by_id.push((*id, block.to_mesher_block()));
            }

            let mut registry = voxelize_mesher::Registry::new(blocks_by_id);
            registry.build_cache();
            Arc::new(registry)
        })
    }

    pub fn mesher_registry(&self) -> Arc<voxelize_mesher::Registry> {
        Arc::clone(self.mesher_registry_ref())
    }

    pub fn to_mesher_registry(&self) -> voxelize_mesher::Registry {
        self.mesher_registry_ref().as_ref().clone()
    }

    pub fn lighter_registry_ref(&self) -> &Arc<voxelize_lighter::LightRegistry> {
        self.lighter_registry_cache.get_or_init(|| {
            let mut blocks_by_id = Vec::with_capacity(self.blocks_by_id.len());
            for (id, block) in self.blocks_by_id.iter() {
                blocks_by_id.push((*id, block.to_lighter_block()));
            }

            Arc::new(voxelize_lighter::LightRegistry::new(blocks_by_id))
        })
    }

    pub fn lighter_registry(&self) -> Arc<voxelize_lighter::LightRegistry> {
        Arc::clone(self.lighter_registry_ref())
    }

    pub fn to_lighter_registry(&self) -> voxelize_lighter::LightRegistry {
        self.lighter_registry_ref().as_ref().clone()
    }

    fn invalidate_cached_registries(&mut self) {
        self.mesher_registry_cache = OnceLock::new();
        self.lighter_registry_cache = OnceLock::new();
    }
}

#[cfg(test)]
mod tests {
    use super::Registry;
    use crate::Block;

    #[test]
    fn unknown_block_name_lookups_fall_back_to_air() {
        let registry = Registry::new();

        assert_eq!(registry.get_id_by_name("missing-block"), 0);
        assert_eq!(registry.get_block_by_name("missing-block").id, 0);
        assert_eq!(registry.get_block_by_name("missing-block").name, "Air");
    }

    #[test]
    fn get_type_map_returns_zero_for_missing_blocks() {
        let registry = Registry::new();
        let type_map = registry.get_type_map(&["air", "missing"]);

        assert_eq!(type_map.get("air"), Some(&0));
        assert_eq!(type_map.get("missing"), Some(&0));
    }

    #[test]
    fn register_blocks_reassigns_duplicate_explicit_ids() {
        let mut registry = Registry::new();
        let first = Block::new("first").id(7).build();
        let second = Block::new("second").id(7).build();

        registry.register_blocks(&[first, second]);

        let first_id = registry.get_id_by_name("first");
        let second_id = registry.get_id_by_name("second");
        assert_eq!(first_id, 7);
        assert_ne!(second_id, 7);
        assert_ne!(first_id, second_id);
    }
}
