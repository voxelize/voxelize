use hashbrown::{HashMap, HashSet};
use log::info;
use serde::{Deserialize, Serialize};

use crate::BlockFace;

use super::voxels::Block;

const TEXTURE_BLEEDING_OFFSET: f32 = 1.0 / 64.0;

/// Serializable struct representing a UV coordinate.
#[derive(Debug, Clone, Serialize, Deserialize)]
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

/// A collection of blocks to use in a Voxelize server. One server has one registry and one
/// registry only. Once a registry is added to a server, it cannot be changed.
#[derive(Default, Clone)]
pub struct Registry {
    /// A map of the UV's to the block faces on the texture atlas.
    pub ranges: HashMap<String, UV>,

    /// Block records, name -> Block.
    pub blocks_by_name: HashMap<String, Block>,

    /// Block records, id -> Block.
    pub blocks_by_id: HashMap<u32, Block>,

    /// List of textures that this registry has. Textures are then applied onto block sides.
    pub textures: HashSet<String>,

    /// Map of ID -> name.
    name_map: HashMap<u32, String>,

    /// Map of name -> ID.
    type_map: HashMap<String, u32>,
}

impl Registry {
    /// Create a registry instance. By default, the "Air" block is registered at ID of 0.
    pub fn new() -> Self {
        let air = Block::new("Air")
            .is_block(false)
            .is_empty(true)
            .is_x_transparent(true)
            .is_y_transparent(true)
            .is_z_transparent(true)
            .aabbs(&[])
            .build();

        let mut instance = Self::default();
        instance.record_block(&air);

        instance
    }

    /// Generate the UV coordinates of the blocks. Call this before the server starts!
    pub fn generate(&mut self) {
        let count_per_side = self.per_side();

        let mut row = 0;
        let mut col = 0;

        for texture in self.textures.iter() {
            if col >= count_per_side {
                col = 0;
                row += 1;
            }

            let start_x = col as f32;
            let start_y = row as f32;

            let offset = 1.0 / (count_per_side as f32 * 4.0);

            let start_u = start_x / count_per_side as f32;
            let end_u = (start_x + 1.0) / count_per_side as f32;
            let start_v = start_y / count_per_side as f32;
            let end_v = (start_y + 1.0) / count_per_side as f32;

            // Texture bleeding fix.
            let start_u = start_u + offset;
            let end_u = end_u - offset;
            let start_v = start_v + offset;
            let end_v = end_v - offset;

            self.ranges.insert(
                texture.to_owned(),
                UV {
                    start_u,
                    end_u,
                    start_v,
                    end_v,
                },
            );

            col += 1;
        }
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

    /// Get a block reference by block ID.
    pub fn get_block_by_id(&self, id: u32) -> &Block {
        self.blocks_by_id
            .get(&id)
            .unwrap_or_else(|| panic!("Block id not found: {id}"))
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

    /// Get block UV by id.
    pub fn get_uv_by_id(&self, id: u32) -> HashMap<String, &UV> {
        self.get_uv_map(self.get_block_by_id(id))
    }

    /// Get block UV by name.
    pub fn get_uv_by_name(&self, name: &str) -> HashMap<String, &UV> {
        self.get_uv_map(self.get_block_by_name(name))
    }

    /// Check if block is air by id.
    pub fn is_air(&self, id: u32) -> bool {
        self.get_block_by_id(id).name == "Air"
    }

    /// Check if block is fluid by id.
    pub fn is_fluid(&self, id: u32) -> bool {
        self.get_block_by_id(id).is_fluid
    }

    /// Check if block is a plant by id.
    pub fn is_plant(&self, id: u32) -> bool {
        self.get_block_by_id(id).is_plant
    }

    /// Check if block is plantable by id.
    pub fn is_plantable(&self, id: u32, above: u32) -> bool {
        self.get_block_by_id(id).is_plantable && self.get_block_by_id(above).is_empty
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
        let block = self.get_block_by_id(id);
        id != 0 && !block.is_plant
    }

    /// Check if registry contains type.
    pub fn has_type(&self, id: u32) -> bool {
        self.blocks_by_id.contains_key(&id)
    }

    /// Get UV map by block.
    pub fn get_uv_map(&self, block: &Block) -> HashMap<String, &UV> {
        let mut uv_map = HashMap::new();

        for source in block.faces.iter() {
            let uv = self
                .ranges
                .get(&Registry::make_side_name(&block.name, source))
                .unwrap_or_else(|| panic!("UV range not found: {:?}", source));

            uv_map.insert(source.name.to_owned(), uv);
        }

        uv_map
    }

    /// Calculate how many textures should be on each side.
    fn per_side(&self) -> usize {
        let mut i = 1.0;
        let sqrt = (self.textures.len() as f32).sqrt().ceil();
        while i < sqrt {
            i = i * 2.0;
        }
        i as usize
    }

    /// Record a block into the registry, adding this block into appropriate maps.
    fn record_block(&mut self, block: &Block) {
        let Block {
            id,
            name,
            faces,
            is_plant,
            ..
        } = block;

        let lower_name = name.to_lowercase();

        self.blocks_by_name
            .insert(lower_name.clone(), block.clone());
        self.blocks_by_id.insert(*id, block.clone());
        self.name_map.insert(*id, lower_name.clone());
        self.type_map.insert(lower_name.clone(), *id);

        for side in faces.iter() {
            let side_name = Registry::make_side_name(name, side);
            self.textures.insert(side_name);
        }
    }

    /// Create a name for the side texture.
    fn make_side_name(name: &str, side: &BlockFace) -> String {
        format!(
            "{}__{}",
            name.to_lowercase().replace(" ", "_"),
            side.name.to_lowercase()
        )
    }
}
