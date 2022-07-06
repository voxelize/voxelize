use voxelize::{Block, BlockFace, Registry, AABB};

pub fn setup_registry() -> Registry {
    let mut registry = Registry::new();

    registry.register_blocks(&[
        Block::new("Dirt").id(1).is_plantable(true).build(),
        Block::new("Stone").id(2).build(),
        Block::new("Sand").id(3).build(),
        Block::new("Grass").id(4).is_plantable(true).build(),
        Block::new("Snow").id(5).build(),
        Block::new("Obsidian").id(20).build(),
        Block::new("Granite").id(21).build(),
        Block::new("Graphite").id(22).build(),
        Block::new("Andesite").id(23).build(),
        Block::new("Slate").id(24).build(),
        Block::new("Oak Planks").id(40).build(),
        Block::new("Oak Slab Top")
            .id(41)
            .faces(&BlockFace::top_slab_faces())
            .aabbs(&[AABB::new(0.0, 0.5, 0.0, 1.0, 1.0, 1.0)])
            .build(),
        Block::new("Oak Slab Bottom")
            .id(42)
            .faces(&BlockFace::bottom_slab_faces())
            .aabbs(&[AABB::new(0.0, 0.0, 0.0, 1.0, 0.5, 1.0)])
            .build(),
        Block::new("Oak Log").id(43).rotatable(true).build(),
        Block::new("Oak Leaves")
            .id(44)
            .is_transparent(true)
            .transparent_standalone(true)
            .build(),
        Block::new("Birch Log").id(46).rotatable(true).build(),
        Block::new("Marble").id(60).build(),
        Block::new("Orange Concrete").id(80).build(),
        Block::new("Blue Concrete").id(81).build(),
        Block::new("Red Concrete").id(82).build(),
        Block::new("White Concrete").id(83).build(),
        Block::new("Yellow Concrete").id(84).build(),
        Block::new("Black Concrete").id(85).build(),
        Block::new("Ivory Block").id(100).build(),
        Block::new("Water")
            .id(150)
            .is_transparent(true)
            .is_fluid(true)
            .is_solid(false)
            .aabbs(&[])
            .build(),
        Block::new("Lol").id(200).build(),
        Block::new("Color").id(201).build(),
        Block::new("Color2").id(202).build(),
    ]);

    registry
}
