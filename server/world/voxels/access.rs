use crate::{BlockUtils, LightColor, LightUtils, Ndarray, Registry};

use super::block::BlockRotation;

#[allow(unused)]
pub trait VoxelAccess {
    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        todo!("Voxel access `get_raw_voxel` is not implemented.");
    }

    fn set_raw_voxel(&mut self, vx: i32, vy: i32, vz: i32, voxel: u32) -> bool {
        todo!("Voxel access `set_raw_voxel` is not implemented.");
    }

    fn get_raw_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        todo!("Voxel access `get_raw_light` is not implemented.");
    }

    fn set_raw_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        todo!("Voxel access `set_raw_voxel` is not implemented.");
    }

    fn get_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        BlockUtils::extract_id(self.get_raw_voxel(vx, vy, vz))
    }

    fn set_voxel(&mut self, vx: i32, vy: i32, vz: i32, id: u32) -> bool {
        let value = BlockUtils::insert_id(0, id);
        self.set_raw_voxel(vx, vy, vz, value)
    }

    fn get_voxel_rotation(&self, vx: i32, vy: i32, vz: i32) -> BlockRotation {
        if !self.contains(vx, vy, vz) {
            return BlockRotation::PX(0.0);
        }

        BlockUtils::extract_rotation(self.get_raw_voxel(vx, vy, vz))
    }

    fn set_voxel_rotation(&mut self, vx: i32, vy: i32, vz: i32, rotation: &BlockRotation) -> bool {
        let value = BlockUtils::insert_rotation(self.get_raw_voxel(vx, vy, vz), rotation);
        self.set_raw_voxel(vx, vy, vz, value)
    }

    fn get_voxel_stage(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        BlockUtils::extract_stage(self.get_raw_voxel(vx, vy, vz))
    }

    fn set_voxel_stage(&mut self, vx: i32, vy: i32, vz: i32, stage: u32) -> bool {
        let value = BlockUtils::insert_stage(self.get_raw_voxel(vx, vy, vz), stage);
        self.set_raw_voxel(vx, vy, vz, value)
    }

    fn get_voxel_waterlogged(&self, vx: i32, vy: i32, vz: i32) -> bool {
        BlockUtils::extract_waterlogged(self.get_raw_voxel(vx, vy, vz))
    }

    /// Whether this voxel holds fluid — either because its block is a fluid,
    /// or because it is a block waterlogged with one.
    ///
    /// Ask this rather than `registry.is_fluid(get_voxel(..))` whenever the
    /// question is "is there water here": a submerged stair or plant is water
    /// to swim through even though its block is not a fluid.
    fn is_fluid_at(&self, registry: &Registry, vx: i32, vy: i32, vz: i32) -> bool {
        self.get_voxel_waterlogged(vx, vy, vz) || registry.is_fluid(self.get_voxel(vx, vy, vz))
    }

    fn set_voxel_waterlogged(&mut self, vx: i32, vy: i32, vz: i32, is_waterlogged: bool) -> bool {
        let value = BlockUtils::insert_waterlogged(self.get_raw_voxel(vx, vy, vz), is_waterlogged);
        self.set_raw_voxel(vx, vy, vz, value)
    }

    fn get_voxel_waterlog_level(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        BlockUtils::extract_waterlog_level(self.get_raw_voxel(vx, vy, vz))
    }

    fn set_voxel_waterlog_level(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        let value = BlockUtils::insert_waterlog_level(self.get_raw_voxel(vx, vy, vz), level);
        self.set_raw_voxel(vx, vy, vz, value)
    }

    /// The level of fluid standing in this voxel, from whichever field owns
    /// it. See [`BlockUtils::extract_fluid_level`].
    fn get_voxel_fluid_level(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        BlockUtils::extract_fluid_level(self.get_raw_voxel(vx, vy, vz))
    }

    /// Set a voxel while keeping any fluid already standing in it: the
    /// worldgen counterpart of the update queue's `resolve_waterlogging`.
    ///
    /// A waterloggable block written into the waterlogging fluid (or into an
    /// already waterlogged voxel) carries that water into its waterlog field
    /// at the level it found — kelp grown through the ocean must not leave a
    /// column of air-shaped holes in the sea. Every other write is a plain
    /// `set_voxel`.
    fn set_voxel_keeping_fluid(
        &mut self,
        registry: &Registry,
        vx: i32,
        vy: i32,
        vz: i32,
        id: u32,
    ) -> bool {
        let current_raw = self.get_raw_voxel(vx, vy, vz);
        let holds_fluid = BlockUtils::extract_waterlogged(current_raw)
            || registry.waterlogging_fluid_id() == Some(BlockUtils::extract_id(current_raw));

        if holds_fluid && registry.is_waterloggable(id) {
            let level = BlockUtils::extract_fluid_level(current_raw);
            let raw = BlockUtils::insert_waterlog_level(
                BlockUtils::insert_waterlogged(BlockUtils::insert_id(0, id), true),
                level,
            );
            return self.set_raw_voxel(vx, vy, vz, raw);
        }

        self.set_voxel(vx, vy, vz, id)
    }

    fn get_sunlight(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        LightUtils::extract_sunlight(self.get_raw_light(vx, vy, vz))
    }

    fn set_sunlight(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        self.set_raw_light(
            vx,
            vy,
            vz,
            LightUtils::insert_sunlight(self.get_raw_light(vx, vy, vz), level),
        )
    }

    fn fill_sunlight_column(
        &mut self,
        vx: i32,
        vz: i32,
        y_from: i32,
        y_to: i32,
        level: u32,
    ) -> bool {
        // Sets the sunlight level for a vertical run of voxels in one
        // column, inclusive on both ends. Semantically identical to calling
        // `set_sunlight` per voxel; implementations may override this with a
        // bulk write (used by the open-sky fill in light propagation).
        let mut is_all_set = true;
        for vy in y_from..=y_to {
            is_all_set &= self.set_sunlight(vx, vy, vz, level);
        }
        is_all_set
    }

    fn get_red_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        LightUtils::extract_red_light(self.get_raw_light(vx, vy, vz))
    }

    fn set_red_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        self.set_raw_light(
            vx,
            vy,
            vz,
            LightUtils::insert_red_light(self.get_raw_light(vx, vy, vz), level),
        )
    }

    fn get_green_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        LightUtils::extract_green_light(self.get_raw_light(vx, vy, vz))
    }

    fn set_green_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        self.set_raw_light(
            vx,
            vy,
            vz,
            LightUtils::insert_green_light(self.get_raw_light(vx, vy, vz), level),
        )
    }

    fn get_blue_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        LightUtils::extract_blue_light(self.get_raw_light(vx, vy, vz))
    }

    fn set_blue_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        self.set_raw_light(
            vx,
            vy,
            vz,
            LightUtils::insert_blue_light(self.get_raw_light(vx, vy, vz), level),
        )
    }

    fn get_torch_light(&self, vx: i32, vy: i32, vz: i32, color: &LightColor) -> u32 {
        match color {
            LightColor::Red => self.get_red_light(vx, vy, vz),
            LightColor::Green => self.get_green_light(vx, vy, vz),
            LightColor::Blue => self.get_blue_light(vx, vy, vz),
            LightColor::Sunlight => panic!("Getting torch light of Sunlight!"),
        }
    }

    fn set_torch_light(
        &mut self,
        vx: i32,
        vy: i32,
        vz: i32,
        level: u32,
        color: &LightColor,
    ) -> bool {
        match color {
            LightColor::Red => self.set_red_light(vx, vy, vz, level),
            LightColor::Green => self.set_green_light(vx, vy, vz, level),
            LightColor::Blue => self.set_blue_light(vx, vy, vz, level),
            LightColor::Sunlight => panic!("Setting torch light of Sunlight!"),
        }
    }

    fn get_max_height(&self, vx: i32, vz: i32) -> u32 {
        todo!("Voxel access `get_max_height` is not implemented.");
    }

    fn set_max_height(&mut self, vx: i32, vz: i32, height: u32) -> bool {
        todo!("Voxel access `set_max_height` is not implemented.");
    }

    fn get_voxels(&self, cx: i32, cz: i32) -> Option<&Ndarray<u32>> {
        todo!("Voxel assess `get_voxels` is not implemented.");
    }

    fn get_lights(&self, cx: i32, cz: i32) -> Option<&Ndarray<u32>> {
        todo!("Voxel assess `get_lights` is not implemented.");
    }

    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        todo!("Voxel access `contains` is not implemented.");
    }
}

#[cfg(test)]
mod set_voxel_keeping_fluid_tests {
    use super::*;
    use crate::{Block, Chunk, ChunkOptions};

    const WATER_ID: u32 = 100;
    const KELP_ID: u32 = 200;
    const SEAGRASS_ID: u32 = 300;
    const STONE_ID: u32 = 400;

    fn test_registry() -> Registry {
        let mut registry = Registry::new();
        registry.register_block(
            &Block::new("Water")
                .id(WATER_ID)
                .is_fluid(true)
                .is_waterlogging_fluid(true)
                .build(),
        );
        registry.register_block(
            &Block::new("Kelp")
                .id(KELP_ID)
                .is_waterloggable(true)
                .build(),
        );
        registry.register_block(
            &Block::new("Seagrass")
                .id(SEAGRASS_ID)
                .is_waterloggable(true)
                .build(),
        );
        registry.register_block(&Block::new("Stone").id(STONE_ID).build());
        registry
    }

    fn test_chunk() -> Chunk {
        Chunk::new(
            "test",
            0,
            0,
            &ChunkOptions {
                size: 16,
                max_height: 64,
                sub_chunks: 1,
            },
        )
    }

    #[test]
    fn waterloggable_block_keeps_the_fluid_it_replaces() {
        let registry = test_registry();
        let mut chunk = test_chunk();

        chunk.set_voxel(1, 2, 3, WATER_ID);
        chunk.set_voxel_stage(1, 2, 3, 3);

        chunk.set_voxel_keeping_fluid(&registry, 1, 2, 3, KELP_ID);

        assert_eq!(chunk.get_voxel(1, 2, 3), KELP_ID);
        assert!(chunk.get_voxel_waterlogged(1, 2, 3));
        assert_eq!(chunk.get_voxel_waterlog_level(1, 2, 3), 3);
    }

    #[test]
    fn waterloggable_block_keeps_water_held_by_the_block_it_replaces() {
        let registry = test_registry();
        let mut chunk = test_chunk();

        chunk.set_voxel(1, 2, 3, KELP_ID);
        chunk.set_voxel_waterlogged(1, 2, 3, true);
        chunk.set_voxel_waterlog_level(1, 2, 3, 2);

        chunk.set_voxel_keeping_fluid(&registry, 1, 2, 3, SEAGRASS_ID);

        assert_eq!(chunk.get_voxel(1, 2, 3), SEAGRASS_ID);
        assert!(chunk.get_voxel_waterlogged(1, 2, 3));
        assert_eq!(chunk.get_voxel_waterlog_level(1, 2, 3), 2);
    }

    #[test]
    fn non_waterloggable_block_displaces_the_fluid() {
        let registry = test_registry();
        let mut chunk = test_chunk();

        chunk.set_voxel(1, 2, 3, WATER_ID);

        chunk.set_voxel_keeping_fluid(&registry, 1, 2, 3, STONE_ID);

        assert_eq!(chunk.get_voxel(1, 2, 3), STONE_ID);
        assert!(!chunk.get_voxel_waterlogged(1, 2, 3));
    }

    #[test]
    fn placement_into_air_stays_dry() {
        let registry = test_registry();
        let mut chunk = test_chunk();

        chunk.set_voxel_keeping_fluid(&registry, 1, 2, 3, KELP_ID);

        assert_eq!(chunk.get_voxel(1, 2, 3), KELP_ID);
        assert!(!chunk.get_voxel_waterlogged(1, 2, 3));
    }
}
