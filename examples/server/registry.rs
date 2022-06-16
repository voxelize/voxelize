use voxelize::{Block, BlockFaces, Registry};

pub fn setup_registry() -> Registry {
    let mut registry = Registry::new();

    registry.register_blocks(&[
        Block::new("Dirt").is_plantable(true).build(),
        Block::new("Stone").build(),
        Block::new("Sand").build(),
        Block::new("Marble").build(),
        Block::new("Orange Concrete").build(),
        Block::new("Blue Concrete").build(),
        Block::new("Red Concrete").build(),
        Block::new("White Concrete").build(),
        Block::new("Yellow Concrete").build(),
        Block::new("Black Concrete").build(),
        Block::new("Ivory Block").build(),
        Block::new("Lol").build(),
        Block::new("Obsidian").build(),
        Block::new("Granite").build(),
        Block::new("Graphite").build(),
        Block::new("Andesite").build(),
        Block::new("Slate").build(),
        Block::new("Oak Planks").build(),
        Block::new("Oak Log")
            .rotatable(true)
            .faces(&[BlockFaces::Top, BlockFaces::Side, BlockFaces::Bottom])
            .build(),
        Block::new("Birch Log")
            .rotatable(true)
            .faces(&[BlockFaces::Top, BlockFaces::Side, BlockFaces::Bottom])
            .build(),
        Block::new("Oak Leaves")
            .is_transparent(true)
            .transparent_standalone(true)
            .build(),
        Block::new("Snow").build(),
        Block::new("Grass")
            .faces(&[BlockFaces::Top, BlockFaces::Side, BlockFaces::Bottom])
            .is_plantable(true)
            .build(),
        Block::new("Color").build(),
        Block::new("Color2").build(),
        Block::new("Water")
            .is_transparent(true)
            .is_fluid(true)
            .is_solid(false)
            .aabbs(&[])
            .build(),
    ]);

    registry
}
