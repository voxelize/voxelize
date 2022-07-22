use voxelize::{Block, BlockFace, Registry, AABB};

pub fn setup_registry() -> Registry {
    let mut registry = Registry::new();

    let mut root = BlockFace::six_faces()
        .scale_x(0.3)
        .offset_x(0.35)
        .scale_z(0.3)
        .offset_z(0.35)
        .scale_y(0.2)
        .prefix("bottom")
        .concat("-")
        .build();

    root.append(
        &mut BlockFace::six_faces()
            .scale_x(0.4)
            .offset_x(0.3)
            .scale_z(0.4)
            .offset_z(0.3)
            .scale_y(0.3)
            .offset_y(0.2)
            .prefix("top")
            .concat("-")
            .build(),
    );

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
            .is_py_transparent(false)
            .is_ny_transparent(true)
            .is_x_transparent(true)
            .is_z_transparent(true)
            .rotatable(true)
            .faces(&BlockFace::six_faces().scale_y(0.5).offset_y(0.5).build())
            .aabbs(&[AABB::new().scale_y(0.5).offset_y(0.5).build()])
            .build(),
        Block::new("Oak Slab Bottom")
            .id(42)
            .is_py_transparent(true)
            .is_ny_transparent(false)
            .is_x_transparent(true)
            .is_z_transparent(true)
            .faces(&BlockFace::six_faces().scale_y(0.5).build())
            .aabbs(&[AABB::new().scale_y(0.5).build()])
            .build(),
        Block::new("Oak Log").id(43).rotatable(true).build(),
        Block::new("Oak Leaves")
            .id(44)
            .is_x_transparent(true)
            .is_y_transparent(true)
            .is_z_transparent(true)
            .is_see_through(true)
            .transparent_standalone(true)
            .build(),
        Block::new("Oak Pole")
            .id(45)
            .is_x_transparent(true)
            .is_y_transparent(true)
            .is_z_transparent(true)
            .rotatable(true)
            .faces(
                &BlockFace::six_faces()
                    .scale_x(0.4)
                    .offset_x(0.3)
                    .scale_z(0.4)
                    .offset_z(0.3)
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
            .is_fluid(true)
            .aabbs(&[])
            .build(),
        Block::new("Glass")
            .id(160)
            .is_transparent(true)
            .is_see_through(true)
            .build(),
        Block::new("Lol")
            .id(200)
            .faces(&BlockFace::six_faces().scale_y(0.2).offset_y(0.4).build())
            .aabbs(&[AABB::new().scale_y(0.2).offset_y(0.4).build()])
            .rotatable(true)
            .is_x_transparent(true)
            .is_z_transparent(true)
            .build(),
        Block::new("Color").id(201).build(),
        Block::new("Color2").id(202).build(),
        Block::new("ChoGe")
            .id(300)
            .faces(&BlockFace::six_faces().scale_x(0.2).offset_x(0.4).build())
            .aabbs(&[AABB::new().scale_x(0.2).offset_x(0.4).build()])
            // .rotatable(true)
            .is_x_transparent(true)
            .is_z_transparent(true)
            .build(),
        Block::new("Mushroom")
            .id(400)
            .faces(&root)
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
            .build(),
        Block::new("Biggie")
            .id(500)
            .faces(
                &BlockFace::six_faces()
                    .scale_x(4.0)
                    .scale_y(2.0)
                    .scale_z(0.1)
                    .offset_x(-1.5)
                    .build(),
            )
            .aabbs(&[AABB::new().offset_x(0.4).scale_x(0.2).scale_z(0.1).build()])
            .rotatable(true)
            .is_transparent(true)
            .build(),
        // Register 50 blocks
        Block::new("Test1").id(501).build(),
        Block::new("Test2").id(502).build(),
        Block::new("Test3").id(503).build(),
        Block::new("Test4").id(504).build(),
        Block::new("Test5").id(505).build(),
        Block::new("Test6").id(506).build(),
        Block::new("Test7").id(507).build(),
        Block::new("Test8").id(508).build(),
        Block::new("Test9").id(509).build(),
        Block::new("Test10").id(510).build(),
        Block::new("Test11").id(511).build(),
        Block::new("Test12").id(512).build(),
        Block::new("Test13").id(513).build(),
        Block::new("Test14").id(514).build(),
        Block::new("Test15").id(515).build(),
        Block::new("Test16").id(516).build(),
        Block::new("Test17").id(517).build(),
        Block::new("Test18").id(518).build(),
        Block::new("Test19").id(519).build(),
        Block::new("Test20").id(520).build(),
        Block::new("Test21").id(521).build(),
        Block::new("Test22").id(522).build(),
        Block::new("Test23").id(523).build(),
        Block::new("Test24").id(524).build(),
        Block::new("Test25").id(525).build(),
        Block::new("Test26").id(526).build(),
        Block::new("Test27").id(527).build(),
        Block::new("Test28").id(528).build(),
        Block::new("Test29").id(529).build(),
        Block::new("Test30").id(530).build(),
        Block::new("Test31").id(531).build(),
        Block::new("Test32").id(532).build(),
        Block::new("Test33").id(533).build(),
    ]);

    registry
}
