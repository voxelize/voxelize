use voxelize::world::{
    registry::Registry,
    voxels::block::{Block, BlockFaces},
};

pub fn setup_registry() -> Registry {
    let mut registry = Registry::new();

    registry.register_blocks(vec![
        Block::new("Dirt").build(),
        Block::new("Stone").build(),
        Block::new("Marble").build(),
        Block::new("Lol").build(),
        Block::new("Wood")
            .faces(&[BlockFaces::Top, BlockFaces::Side, BlockFaces::Bottom])
            .build(),
        Block::new("Leaves")
            // .is_transparent(true)
            // .transparent_standalone(true)
            .build(),
        Block::new("Snow").build(),
        Block::new("Grass")
            .faces(&[BlockFaces::Top, BlockFaces::Side, BlockFaces::Bottom])
            .build(),
        Block::new("Color")
            .is_light(true)
            .blue_light_level(10)
            .green_light_level(10)
            .red_light_level(10)
            .build(),
    ]);

    registry
}
