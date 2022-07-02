use voxelize::{Block, BlockFace, CornerData, Registry, AABB};

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
        Block::new("Oak Log").rotatable(true).build(),
        Block::new("Birch Log").rotatable(true).build(),
        Block::new("Oak Leaves")
            .is_transparent(true)
            .transparent_standalone(true)
            .build(),
        Block::new("Snow").build(),
        Block::new("Grass").is_plantable(true).build(),
        Block::new("Color").build(),
        Block::new("Color2").build(),
        Block::new("Water")
            .is_transparent(true)
            .is_fluid(true)
            .is_solid(false)
            .aabbs(&[])
            .build(),
        Block::new("Slab")
            .faces(&[
                BlockFace {
                    name: "nx".to_owned(),
                    dir: [-1, 0, 0],
                    corners: [
                        CornerData {
                            pos: [0.0, 0.5, 0.0],
                            uv: [0.0, 0.0],
                        },
                        CornerData {
                            pos: [0.0, 0.0, 0.0],
                            uv: [0.0, 0.0],
                        },
                        CornerData {
                            pos: [0.0, 0.5, 1.0],
                            uv: [1.0, 0.5],
                        },
                        CornerData {
                            pos: [0.0, 0.0, 1.0],
                            uv: [1.0, 0.0],
                        },
                    ]
                    .to_vec(),
                },
                BlockFace {
                    name: "px".to_owned(),
                    dir: [1, 0, 0],
                    corners: [
                        CornerData {
                            pos: [1.0, 0.5, 1.0],
                            uv: [0.0, 0.5],
                        },
                        CornerData {
                            pos: [1.0, 0.0, 1.0],
                            uv: [0.0, 0.0],
                        },
                        CornerData {
                            pos: [1.0, 0.5, 0.0],
                            uv: [1.0, 0.5],
                        },
                        CornerData {
                            pos: [1.0, 0.0, 0.0],
                            uv: [1.0, 0.0],
                        },
                    ]
                    .to_vec(),
                },
                BlockFace {
                    name: "ny".to_owned(),
                    dir: [0, -1, 0],
                    corners: [
                        CornerData {
                            pos: [1.0, 0.0, 1.0],
                            uv: [1.0, 0.0],
                        },
                        CornerData {
                            pos: [0.0, 0.0, 1.0],
                            uv: [0.0, 0.0],
                        },
                        CornerData {
                            pos: [1.0, 0.0, 0.0],
                            uv: [1.0, 1.0],
                        },
                        CornerData {
                            pos: [0.0, 0.0, 0.0],
                            uv: [0.0, 1.0],
                        },
                    ]
                    .to_vec(),
                },
                BlockFace {
                    name: "py".to_owned(),
                    dir: [0, 1, 0],
                    corners: [
                        CornerData {
                            pos: [0.0, 0.5, 1.0],
                            uv: [1.0, 1.0],
                        },
                        CornerData {
                            pos: [1.0, 0.5, 1.0],
                            uv: [0.0, 1.0],
                        },
                        CornerData {
                            pos: [0.0, 0.5, 0.0],
                            uv: [1.0, 0.0],
                        },
                        CornerData {
                            pos: [1.0, 0.5, 0.0],
                            uv: [0.0, 0.0],
                        },
                    ]
                    .to_vec(),
                },
                BlockFace {
                    name: "nz".to_owned(),
                    dir: [0, 0, -1],
                    corners: [
                        CornerData {
                            pos: [1.0, 0.0, 0.0],
                            uv: [0.0, 0.0],
                        },
                        CornerData {
                            pos: [0.0, 0.0, 0.0],
                            uv: [1.0, 0.0],
                        },
                        CornerData {
                            pos: [1.0, 0.5, 0.0],
                            uv: [0.0, 0.5],
                        },
                        CornerData {
                            pos: [0.0, 0.5, 0.0],
                            uv: [1.0, 0.5],
                        },
                    ]
                    .to_vec(),
                },
                BlockFace {
                    name: "pz".to_owned(),
                    dir: [0, 0, 1],
                    corners: [
                        CornerData {
                            pos: [0.0, 0.0, 1.0],
                            uv: [0.0, 0.0],
                        },
                        CornerData {
                            pos: [1.0, 0.0, 1.0],
                            uv: [1.0, 0.0],
                        },
                        CornerData {
                            pos: [0.0, 0.5, 1.0],
                            uv: [0.0, 0.5],
                        },
                        CornerData {
                            pos: [1.0, 0.5, 1.0],
                            uv: [1.0, 0.5],
                        },
                    ]
                    .to_vec(),
                },
            ])
            .aabbs(&[AABB::new(0.0, 0.0, 0.0, 1.0, 0.5, 1.0)])
            .build(),
    ]);

    registry
}
