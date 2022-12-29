use voxelize::{Block, BlockFaces, Registry, Vec3, AABB, SIX_FACES_NX, SIX_FACES_PY, SIX_FACES_PZ};

const PLANT_SCALE: f32 = 0.6;

pub fn setup_registry() -> Registry {
    let mut registry = Registry::new();

    let grass_faces = BlockFaces::diagonal_faces()
        .scale_horizontal(PLANT_SCALE)
        .scale_vertical(PLANT_SCALE)
        .build();

    registry.register_blocks(&[
        Block::new("Dirt").id(1).build(),
        Block::new("Stone").id(2).build(),
        Block::new("Sand")
            .id(3)
            .faces(&BlockFaces::six_faces().build().independent_at(SIX_FACES_NX))
            .build(),
        Block::new("Grass Block").id(4).build(),
        Block::new("Snow").id(5).build(),
        Block::new("Obsidian").id(20).build(),
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
            .faces(
                &BlockFaces::six_faces()
                    .scale_y(0.8)
                    .build()
                    .independent_at(SIX_FACES_PY),
            )
            .dynamic_fn(|center, space, _| {
                let Vec3(vx, vy, vz) = center;

                let mut top_is_water = false;

                for ox in -1..=1 {
                    for oz in -1..=1 {
                        if space.get_voxel(vx + ox, vy + 1, vz + oz) == 150 {
                            top_is_water = true;
                        }
                    }
                }

                (
                    BlockFaces::six_faces()
                        .scale_y(if top_is_water { 1.0 } else { 0.8 })
                        .build()
                        .independent_at(SIX_FACES_PY)
                        .to_vec(),
                    vec![AABB::new()
                        .scale_y(if top_is_water { 1.0 } else { 0.8 })
                        .build()],
                    [true, true, true, true, true, true],
                )
            })
            .aabbs(&[AABB::new().scale_y(0.8).build()])
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
                            .build(),
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
            .torch_light_level(5)
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
