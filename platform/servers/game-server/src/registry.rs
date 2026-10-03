//! Content blocks -> engine registry.
//!
//! The engine knows nothing about this game's blocks; this module is where
//! content data becomes engine block properties. Engine block names are the
//! content keys, which are stable and unique; display names stay in content.

use platform_content::{BlockDef, Content, FluidKind, Orientation};
use voxelize::{Block, BlockFaces, FluidConfig, Registry, YRotatableSegments};

pub fn engine_block(def: &BlockDef) -> Block {
    let mut block = Block::new(&def.key).id(def.id);

    let is_cross_plant = def.material == "plant" && !def.collision;
    if is_cross_plant {
        block = block
            .faces(&BlockFaces::diagonal_faces().build())
            .is_plant(true)
            .is_see_through(true);
    }
    if def.transparent {
        block = block.is_transparent(true).is_see_through(true);
    }
    if !def.collision {
        block = block.is_passable(true);
    }
    if def.light_emission > 0 {
        block = block.torch_light_level(def.light_emission);
    }
    match def.orientation {
        Orientation::None => {}
        Orientation::Full => block = block.rotatable(true),
        Orientation::Horizontal => {
            block = block
                .y_rotatable(true)
                .y_rotatable_segments(&YRotatableSegments::Four)
        }
    }
    match def.fluid {
        None => {}
        Some(FluidKind::Water) => {
            block = block
                .is_fluid(true)
                .is_transparent(true)
                .is_see_through(true)
                .light_reduce(true)
                .fluid_simulation(FluidConfig::default());
        }
        Some(FluidKind::Lava) => {
            block = block.is_fluid(true).fluid_simulation(FluidConfig {
                tick_rate: 45,
                ..FluidConfig::default()
            });
        }
    }
    block.build()
}

pub fn build_registry(content: &Content) -> Registry {
    let mut registry = Registry::new();
    let blocks: Vec<Block> = content.blocks().iter().map(engine_block).collect();
    registry.register_blocks(&blocks);
    registry
}
