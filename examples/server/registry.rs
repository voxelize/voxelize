use voxelize::{
    Block, BlockConditionalPart, BlockDynamicPattern, BlockFaces, BlockRule, BlockRuleLogic,
    BlockSimpleRule, Registry, Vec3, VoxelPacker, YRotatableSegments, AABB, SIX_FACES_NX,
    SIX_FACES_PY, SIX_FACES_PZ,
};

const PLANT_SCALE: f32 = 0.6;

pub fn setup_registry() -> Registry {
    let mut registry = Registry::new();

    let grass_faces = BlockFaces::diagonal_faces()
        .scale_horizontal(PLANT_SCALE)
        .scale_vertical(PLANT_SCALE)
        .build();

    let biome_test_block_count = 21;
    let mut biome_test_blocks = Vec::new();

    for i in 0..biome_test_block_count {
        biome_test_blocks.push(
            Block::new(&format!("Biome Test {}", i))
                .id(2000 + i)
                .build(),
        );
    }

    let stairs_base_faces = BlockFaces::six_faces().scale_y(0.5).build();
    let stairs_base_aabb = AABB::from_faces(&stairs_base_faces);
    let stairs_top_faces = BlockFaces::six_faces()
        .scale_z(0.5)
        .scale_y(0.5)
        .offset_y(0.5)
        .build();
    let stairs_top_aabb = AABB::from_faces(&stairs_top_faces);
    let stairs_aabbs = vec![stairs_base_aabb, stairs_top_aabb];
    let stairs_faces = stairs_base_faces + stairs_top_faces;

    registry.register_block(
        &Block::new("Stairs")
            .id(13131)
            .aabbs(&stairs_aabbs)
            .faces(&stairs_faces)
            .is_x_transparent(true)
            .is_z_transparent(true)
            // .rotatable(true)
            .y_rotatable(true)
            .y_rotatable_segments(&YRotatableSegments::Four)
            .build(),
    );

    registry.register_blocks(&biome_test_blocks);

    registry.register_air_active_fn(
        |_, _, _| 0,
        |voxel, space, registry| {
            let Vec3(vx, vy, vz) = voxel;
            let mut updates = vec![];

            [
                [1, 0, 0],
                [-1, 0, 0],
                [0, 1, 0],
                [0, -1, 0],
                [0, 0, 1],
                [0, 0, -1],
            ]
            .into_iter()
            .for_each(|[dx, dy, dz]| {
                let id = space.get_voxel(vx + dx, vy + dy, vz + dz);

                if id == 0 {
                    return;
                }

                let block = registry.get_block_by_id(id);

                if block.is_active {
                    updates.push((
                        Vec3(vx + dx, vy + dy, vz + dz),
                        space.get_raw_voxel(vx + dx, vy + dy, vz + dz),
                    ));
                }
            });

            let voxel_above = space.get_voxel(vx, vy + 1, vz);

            if voxel_above == 1000 || voxel_above == 400 {
                updates.push((Vec3(vx, vy + 1, vz), 0));
            }

            updates
        },
    );

    let green_stone_id = 50000;
    let green_stone_base_xz_dimension = 0.2;
    let green_stone_base_height = 0.1;
    let green_stone_base_faces = BlockFaces::six_faces()
        .scale_y(green_stone_base_height)
        .scale_x(green_stone_base_xz_dimension)
        .scale_z(green_stone_base_xz_dimension)
        .offset_x((1.0 - green_stone_base_xz_dimension) / 2.0)
        .offset_z((1.0 - green_stone_base_xz_dimension) / 2.0)
        .build();
    let green_stone_pos_100_faces = BlockFaces::six_faces()
        .scale_y(green_stone_base_height / 2.0)
        .scale_x((1.0 - green_stone_base_xz_dimension) / 2.0)
        .scale_z(green_stone_base_xz_dimension / 2.0)
        .offset_x((1.0 - green_stone_base_xz_dimension) / 2.0 + green_stone_base_xz_dimension)
        .offset_z((1.0 - green_stone_base_xz_dimension) / 2.0 + green_stone_base_xz_dimension / 4.0)
        .build();
    let green_stone_pos_001_faces = BlockFaces::six_faces()
        .scale_y(green_stone_base_height / 2.0)
        .scale_z((1.0 - green_stone_base_xz_dimension) / 2.0)
        .scale_x(green_stone_base_xz_dimension / 2.0)
        .offset_z((1.0 - green_stone_base_xz_dimension) / 2.0 + green_stone_base_xz_dimension)
        .offset_x((1.0 - green_stone_base_xz_dimension) / 2.0 + green_stone_base_xz_dimension / 4.0)
        .build();
    let green_stone_neg_100_faces = BlockFaces::six_faces()
        .scale_y(green_stone_base_height / 2.0)
        .scale_x((1.0 - green_stone_base_xz_dimension) / 2.0)
        .scale_z(green_stone_base_xz_dimension / 2.0)
        .offset_z((1.0 - green_stone_base_xz_dimension) / 2.0 + green_stone_base_xz_dimension / 4.0)
        .build();
    let green_stone_neg_001_faces = BlockFaces::six_faces()
        .scale_y(green_stone_base_height / 2.0)
        .scale_z((1.0 - green_stone_base_xz_dimension) / 2.0)
        .scale_x(green_stone_base_xz_dimension / 2.0)
        .offset_x((1.0 - green_stone_base_xz_dimension) / 2.0 + green_stone_base_xz_dimension / 4.0)
        .build();
    let green_stone_base_aabb = AABB::from_faces(&green_stone_base_faces);
    let green_stone_pos_100_aabb = AABB::from_faces(&green_stone_pos_100_faces);
    let green_stone_neg_100_aabb = AABB::from_faces(&green_stone_neg_100_faces);
    let green_stone_pos_001_aabb = AABB::from_faces(&green_stone_pos_001_faces);
    let green_stone_neg_001_aabb = AABB::from_faces(&green_stone_neg_001_faces);
    let green_stone_dynamic_pattern = BlockDynamicPattern {
        parts: vec![
            BlockConditionalPart {
                rule: BlockRule::None,
                aabbs: vec![green_stone_base_aabb],
                faces: green_stone_base_faces.to_vec(),
                is_transparent: [true, true, true, true, true, true],
            },
            BlockConditionalPart {
                rule: BlockRule::Combination {
                    logic: BlockRuleLogic::Or,
                    rules: vec![
                        BlockRule::Simple(BlockSimpleRule {
                            offset: Vec3(1, 1, 0),
                            id: Some(green_stone_id),
                            rotation: None,
                            stage: None,
                        }),
                        BlockRule::Simple(BlockSimpleRule {
                            offset: Vec3(1, 0, 0),
                            id: Some(green_stone_id),
                            rotation: None,
                            stage: None,
                        }),
                        BlockRule::Simple(BlockSimpleRule {
                            offset: Vec3(1, -1, 0),
                            id: Some(green_stone_id),
                            rotation: None,
                            stage: None,
                        }),
                    ],
                },
                aabbs: vec![green_stone_pos_100_aabb],
                faces: green_stone_pos_100_faces.to_vec(),
                is_transparent: [true, true, true, true, true, true],
            },
            BlockConditionalPart {
                rule: BlockRule::Combination {
                    logic: BlockRuleLogic::Or,
                    rules: vec![
                        BlockRule::Simple(BlockSimpleRule {
                            offset: Vec3(-1, 1, 0),
                            id: Some(green_stone_id),
                            rotation: None,
                            stage: None,
                        }),
                        BlockRule::Simple(BlockSimpleRule {
                            offset: Vec3(-1, 0, 0),
                            id: Some(green_stone_id),
                            rotation: None,
                            stage: None,
                        }),
                        BlockRule::Simple(BlockSimpleRule {
                            offset: Vec3(-1, -1, 0),
                            id: Some(green_stone_id),
                            rotation: None,
                            stage: None,
                        }),
                    ],
                },
                aabbs: vec![green_stone_neg_100_aabb],
                faces: green_stone_neg_100_faces.to_vec(),
                is_transparent: [true, true, true, true, true, true],
            },
            BlockConditionalPart {
                rule: BlockRule::Combination {
                    logic: BlockRuleLogic::Or,
                    rules: vec![
                        BlockRule::Simple(BlockSimpleRule {
                            offset: Vec3(0, 1, 1),
                            id: Some(green_stone_id),
                            rotation: None,
                            stage: None,
                        }),
                        BlockRule::Simple(BlockSimpleRule {
                            offset: Vec3(0, 0, 1),
                            id: Some(green_stone_id),
                            rotation: None,
                            stage: None,
                        }),
                        BlockRule::Simple(BlockSimpleRule {
                            offset: Vec3(0, -1, 1),
                            id: Some(green_stone_id),
                            rotation: None,
                            stage: None,
                        }),
                    ],
                },
                aabbs: vec![green_stone_pos_001_aabb],
                faces: green_stone_pos_001_faces.to_vec(),
                is_transparent: [true, true, true, true, true, true],
            },
            BlockConditionalPart {
                rule: BlockRule::Combination {
                    logic: BlockRuleLogic::Or,
                    rules: vec![
                        BlockRule::Simple(BlockSimpleRule {
                            offset: Vec3(0, 1, -1),
                            id: Some(green_stone_id),
                            rotation: None,
                            stage: None,
                        }),
                        BlockRule::Simple(BlockSimpleRule {
                            offset: Vec3(0, 0, -1),
                            id: Some(green_stone_id),
                            rotation: None,
                            stage: None,
                        }),
                        BlockRule::Simple(BlockSimpleRule {
                            offset: Vec3(0, -1, -1),
                            id: Some(green_stone_id),
                            rotation: None,
                            stage: None,
                        }),
                    ],
                },
                aabbs: vec![green_stone_neg_001_aabb],
                faces: green_stone_neg_001_faces.to_vec(),
                is_transparent: [true, true, true, true, true, true],
            },
        ],
    };
    let green_stone_block = Block::new("Green Stone")
        .id(green_stone_id)
        .dynamic_patterns(&[green_stone_dynamic_pattern])
        .is_passable(true)
        .is_transparent(true)
        .transparent_standalone(true)
        .build();

    registry.register_block(&green_stone_block);

    registry.register_blocks(&[
        Block::new("Dirt")
            .id(1)
            // .active_fn(
            //     |_, _, _| 100,
            //     |voxel, space, registry| {
            //         // TODO
            //         vec![(Vec3(voxel.0, voxel.1 + 1, voxel.2), 2)]
            //     },
            // )
            .build(),
        Block::new("Stone")
            .id(2)
            // .active_fn(
            //     |_, _, _| 0,
            //     |voxel, space, registry| {
            //         // TODO
            //         vec![(Vec3(voxel.0, voxel.1 + 1, voxel.2), 1)]
            //     },
            // )
            .build(),
        Block::new("Sand")
            .id(3)
            .faces(&BlockFaces::six_faces().build().independent_at(SIX_FACES_NX))
            .build(),
        Block::new("Grass Block").id(4).build(),
        Block::new("Snow").id(5).build(),
        Block::new("Obsidian").id(20).torch_light_level(15).build(),
        Block::new("Granite").id(21).build(),
        Block::new("Graphite").id(22).build(),
        Block::new("Andesite").id(23).green_light_level(10).build(),
        Block::new("Slate").id(24).blue_light_level(10).build(),
        Block::new("Oak Planks").id(40).build(),
        Block::new("Oak Slab Top")
            .id(41)
            .is_py_transparent(false)
            .is_ny_transparent(true)
            .is_x_transparent(true)
            .is_z_transparent(true)
            .rotatable(true)
            .faces(&BlockFaces::six_faces().scale_y(0.5).offset_y(0.5).build())
            .aabbs(&[AABB::new().scale_y(0.5).offset_y(0.5).build()])
            .build(),
        Block::new("Oak Slab Bottom")
            .id(42)
            .is_py_transparent(true)
            .is_ny_transparent(false)
            .is_x_transparent(true)
            .is_z_transparent(true)
            .faces(&BlockFaces::six_faces().scale_y(0.5).build())
            .aabbs(&[AABB::new().scale_y(0.5).build()])
            .build(),
        Block::new("Oak Log").id(43).rotatable(true).build(),
        Block::new("Oak Leaves")
            .id(44)
            .faces(
                &BlockFaces::six_faces().build().join(
                    BlockFaces::diagonal_faces()
                        .offset_x(0.1)
                        .offset_z(0.1)
                        .scale_horizontal(1.2)
                        .build(),
                ),
            )
            .is_transparent(true)
            .is_see_through(true)
            .light_reduce(true)
            .transparent_standalone(true)
            .build(),
        Block::new("Oak Pole")
            .id(45)
            .is_x_transparent(true)
            .is_y_transparent(true)
            .is_z_transparent(true)
            .rotatable(true)
            // .active_fn(
            //     |_, _, _| 100,
            //     |voxel, space, registry| {
            //         // TODO
            //         vec![(Vec3(voxel.0, voxel.1 + 1, voxel.2), 45)]
            //     },
            // )
            .faces(
                &BlockFaces::six_faces()
                    .scale_x(0.4)
                    .offset_x(0.3)
                    .scale_z(0.4)
                    .offset_z(0.3)
                    .uv_scale_x(0.4)
                    .uv_scale_z(0.4)
                    .uv_offset_x(0.3)
                    .uv_offset_z(0.3)
                    .build(),
            )
            .aabbs(&[AABB::new()
                .scale_x(0.4)
                .offset_x(0.3)
                .scale_z(0.4)
                .offset_z(0.3)
                .build()])
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
            .is_see_through(true)
            .light_reduce(true)
            .is_fluid(true)
            .is_passable(true)
            .faces(&BlockFaces::six_faces().build().independent_at(SIX_FACES_PY))
            .dynamic_patterns(&[BlockDynamicPattern {
                parts: vec![
                    BlockConditionalPart {
                        rule: BlockRule::Combination {
                            logic: BlockRuleLogic::And, // Assuming you want an AND logic for demonstration
                            rules: vec![
                                BlockRule::Simple(BlockSimpleRule {
                                    offset: Vec3(0, 1, 0),
                                    id: Some(0),
                                    rotation: None,
                                    stage: None,
                                }),
                                // Add more BlockRule::Simple or BlockRule::Combination here as needed
                            ],
                        },
                        aabbs: vec![AABB::new().scale_y(0.8).build()],
                        faces: BlockFaces::six_faces()
                            .scale_y(0.8)
                            .build()
                            .independent_at(SIX_FACES_PY)
                            .to_vec(),
                        is_transparent: [true, true, true, true, true, true],
                    },
                    // You can add more BlockConditionalPart here as needed
                ],
            }])
            .aabbs(&[AABB::new().build()])
            .active_fn(
                |_, _, _| 100,
                |voxel, space, _| {
                    let Vec3(vx, vy, vz) = voxel;

                    let curr_stage = space.get_voxel_stage(vx, vy, vz);

                    let mut updates = vec![];

                    if space.get_voxel(vx, vy - 1, vz) == 0 {
                        updates.push((
                            Vec3(vx, vy - 1, vz),
                            VoxelPacker::new().with_id(150).with_stage(0).pack(),
                        ));
                    } else {
                        [[-1, 0], [1, 0], [0, -1], [0, 1]]
                            .into_iter()
                            .for_each(|[dx, dz]| {
                                if space.get_voxel(vx + dx, vy, vz + dz) == 0 && curr_stage < 2 {
                                    updates.push((
                                        Vec3(vx + dx, vy, vz + dz),
                                        VoxelPacker::new()
                                            .with_id(150)
                                            .with_stage(curr_stage + 1)
                                            .pack(),
                                    ));
                                }
                            });
                    }

                    updates
                },
            )
            .build(),
        Block::new("Glass")
            .id(160)
            .is_transparent(true)
            .is_see_through(true)
            .build(),
        Block::new("Lol")
            .id(200)
            .faces(&BlockFaces::six_faces().scale_y(0.2).offset_y(0.4).build())
            .aabbs(&[AABB::new().scale_y(0.2).offset_y(0.4).build()])
            .rotatable(true)
            .is_x_transparent(true)
            .is_z_transparent(true)
            .build(),
        Block::new("Color").id(201).build(),
        Block::new("Color2").id(202).build(),
        Block::new("ChoGe")
            .id(300)
            .faces(&BlockFaces::six_faces().scale_x(0.2).offset_x(0.4).build())
            .aabbs(&[AABB::new().scale_x(0.2).offset_x(0.4).build()])
            // .rotatable(true)
            .is_x_transparent(true)
            .is_z_transparent(true)
            .build(),
        Block::new("Mushroom")
            .id(400)
            .is_entity(true)
            .faces(
                &BlockFaces::six_faces()
                    .scale_x(0.3)
                    .offset_x(0.35)
                    .scale_z(0.3)
                    .offset_z(0.35)
                    .scale_y(0.2)
                    .prefix("bottom")
                    .concat("-")
                    .build()
                    .join(
                        BlockFaces::six_faces()
                            .scale_x(0.4)
                            .offset_x(0.3)
                            .scale_z(0.4)
                            .offset_z(0.3)
                            .scale_y(0.3)
                            .offset_y(0.2)
                            .prefix("top")
                            .concat("-")
                            .build()
                            .isolated_at(SIX_FACES_PY)
                            .independent_at(SIX_FACES_PY),
                    ),
            )
            .aabbs(&[
                AABB::new()
                    .scale_x(0.3)
                    .offset_x(0.35)
                    .scale_z(0.3)
                    .offset_z(0.35)
                    .scale_y(0.2)
                    .build(),
                AABB::new()
                    .scale_x(0.4)
                    .offset_x(0.3)
                    .scale_z(0.4)
                    .offset_z(0.3)
                    .scale_y(0.3)
                    .offset_y(0.2)
                    .build(),
            ])
            .is_transparent(true)
            .rotatable(true)
            .torch_light_level(15)
            .build(),
        Block::new("Biggie")
            .id(500)
            .faces(
                &BlockFaces::six_faces()
                    .scale_x(4.0)
                    .scale_y(2.0)
                    .scale_z(0.1)
                    .offset_x(-1.5)
                    .build()
                    .independent_at(SIX_FACES_PZ),
            )
            .aabbs(&[AABB::new().offset_x(0.4).scale_x(0.2).scale_z(0.1).build()])
            .rotatable(true)
            .is_transparent(true)
            .build(),
        // Plants
        Block::new("Grass")
            .id(1000)
            .aabbs(&[AABB::from_faces(&grass_faces)])
            .is_passable(true)
            .faces(&grass_faces)
            .is_transparent(true)
            .is_see_through(true)
            .transparent_standalone(true)
            .build(),
        Block::new("Test")
            .id(10000)
            .faces(
                &BlockFaces::six_faces()
                    .scale_x(0.2)
                    .offset_x(0.4)
                    .scale_z(0.2)
                    .offset_z(0.4)
                    .build(),
            )
            .aabbs(&[AABB::new()
                .scale_x(0.2)
                .offset_x(0.4)
                .scale_z(0.2)
                .offset_z(0.4)
                .build()])
            .is_transparent(true)
            .rotatable(true)
            .y_rotatable(true)
            .build(),
    ]);

    registry
}
