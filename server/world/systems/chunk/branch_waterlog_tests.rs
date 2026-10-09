//! A branch voxel holds water beside its wood only while it is thinner than
//! a full block: the update intake carries water into a thin one, keeps a
//! full one dry, and commits dry a waterlogged one written at full radius;
//! the fluid simulation fills round the thin ones and never a full one.

use std::time::{Duration, Instant};

use crate::{
    Block, BlockUtils, BranchKind, BranchSeat, BranchShape, Chunk, ChunkStage, FluidConfig,
    Registry, Resources, Space, Vec3, VoxelAccess, World, WorldConfig,
};

const GROUND_ID: u32 = 1;
const WATER_ID: u32 = 2;
const TWIG_ID: u32 = 3;
const Y: i32 = 1;
const WORLD_EDGE: i32 = 1;
const WAIT_DEADLINE: Duration = Duration::from_secs(60);

struct FloorStage;

impl ChunkStage for FloorStage {
    fn name(&self) -> String {
        "Floor".to_owned()
    }

    fn process(&self, mut chunk: Chunk, _: Resources, _: Option<Space>) -> Chunk {
        let Vec3(min_x, _, min_z) = chunk.min;
        let Vec3(max_x, _, max_z) = chunk.max;
        for vx in min_x..max_x {
            for vz in min_z..max_z {
                chunk.set_voxel(vx, 0, vz, GROUND_ID);
            }
        }
        chunk
    }
}

fn twig() -> BranchShape {
    BranchShape {
        key: 1,
        seat: BranchSeat::Centre,
        kind: BranchKind::Voxel,
        texels_per_block: 16,
        radius_mask: 0b0111,
        side_face: "px".into(),
        end_face: "py".into(),
    }
}

fn twig_raw(radius: u32) -> u32 {
    BlockUtils::insert_stage(
        BlockUtils::insert_id(0, TWIG_ID),
        twig().with_radius(0, radius),
    )
}

fn world(fluid: bool) -> World {
    let config = WorldConfig::new()
        .min_chunk([-WORLD_EDGE, -WORLD_EDGE])
        .max_chunk([WORLD_EDGE, WORLD_EDGE])
        .chunk_size(16)
        .max_height(16)
        .sub_chunks(1)
        .preload(true)
        .preload_radius(WORLD_EDGE as usize)
        .saving(false)
        .build();

    let mut registry = Registry::new();
    registry.register_block(&Block::new("Ground").id(GROUND_ID).build());
    let water = Block::new("Water")
        .id(WATER_ID)
        .is_fluid(true)
        .is_waterlogging_fluid(true);
    let water = if fluid {
        water.fluid_simulation(FluidConfig::new())
    } else {
        water
    };
    registry.register_block(&water.build());
    registry.register_block(
        &Block::new("Twig")
            .id(TWIG_ID)
            .faces(&crate::BlockFaces::six_faces().build())
            .branch(twig())
            .is_transparent(true)
            .is_waterloggable(true)
            .build(),
    );

    let mut world = World::new("branch-waterlog", &config);
    world.ecs_mut().insert(registry);
    world.pipeline_mut().add_stage(FloorStage);
    world.prepare();
    world.preload();
    let deadline = Instant::now() + WAIT_DEADLINE;
    while world.preloading {
        assert!(Instant::now() < deadline, "world never finished preloading");
        world.tick();
        std::thread::sleep(Duration::from_millis(1));
    }
    world
}

/// Write `raw` at `voxel` through the update intake and wait until it lands.
fn write(world: &mut World, voxel: Vec3<i32>, raw: u32) {
    world.chunks_mut().update_voxel(&voxel, raw);
    let deadline = Instant::now() + WAIT_DEADLINE;
    loop {
        let landed = {
            let chunks = world.chunks();
            let now = chunks.get_raw_voxel(voxel.0, voxel.1, voxel.2);
            BlockUtils::extract_id(now) == BlockUtils::extract_id(raw)
                && BlockUtils::extract_stage(now) == BlockUtils::extract_stage(raw)
        };
        if landed {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "the intake never wrote {voxel:?}"
        );
        world.tick();
        std::thread::sleep(Duration::from_millis(1));
    }
}

fn raw_at(world: &World, voxel: &Vec3<i32>) -> u32 {
    world.chunks().get_raw_voxel(voxel.0, voxel.1, voxel.2)
}

#[test]
fn the_intake_carries_water_into_a_thin_branch_and_never_a_full_one() {
    let mut world = world(false);
    let water = BlockUtils::insert_id(0, WATER_ID);

    let thin = Vec3(2, Y, 2);
    write(&mut world, thin.clone(), water);
    write(&mut world, thin.clone(), twig_raw(4));
    assert!(
        BlockUtils::extract_waterlogged(raw_at(&world, &thin)),
        "a radius-4 twig placed in water keeps the water"
    );

    let full = Vec3(4, Y, 2);
    write(&mut world, full.clone(), water);
    write(&mut world, full.clone(), twig_raw(8));
    assert!(
        !BlockUtils::extract_waterlogged(raw_at(&world, &full)),
        "a full branch displaces the water"
    );

    // A waterlogged twig thickened to a full block by a writer that kept its
    // waterlog bits: the intake commits it dry.
    let grown = Vec3(6, Y, 2);
    write(&mut world, grown.clone(), water);
    write(&mut world, grown.clone(), twig_raw(7));
    let wet = raw_at(&world, &grown);
    assert!(BlockUtils::extract_waterlogged(wet));
    let thickened = BlockUtils::insert_stage(wet, twig().with_radius(0, 8));
    write(&mut world, grown.clone(), thickened);
    let after = raw_at(&world, &grown);
    assert_eq!(BlockUtils::extract_id(after), TWIG_ID);
    assert!(
        !BlockUtils::extract_waterlogged(after),
        "a full branch left waterlogged is committed dry"
    );
    assert_eq!(BlockUtils::extract_waterlog_level(after), 0);
}

#[test]
fn water_spreads_round_a_thin_branch_and_leaves_a_full_one_dry() {
    let mut world = world(true);
    let thin = Vec3(3, Y, 2);
    let full = Vec3(5, Y, 2);
    write(&mut world, thin.clone(), twig_raw(3));
    write(&mut world, full.clone(), twig_raw(8));
    write(
        &mut world,
        Vec3(1, Y, 2),
        BlockUtils::insert_id(0, WATER_ID),
    );

    let deadline = Instant::now() + WAIT_DEADLINE;
    while !BlockUtils::extract_waterlogged(raw_at(&world, &thin)) {
        assert!(
            Instant::now() < deadline,
            "the water never reached the thin twig"
        );
        world.tick();
        std::thread::sleep(Duration::from_millis(1));
    }
    for _ in 0..200 {
        world.tick();
    }
    let reached = (2..=6).filter(|x| *x != 3 && *x != 5).all(|x| {
        let raw = raw_at(&world, &Vec3(x, Y, 2));
        BlockUtils::extract_id(raw) == WATER_ID || BlockUtils::extract_waterlogged(raw)
    });
    assert!(reached, "the water spread on past both twigs");
    assert!(
        !BlockUtils::extract_waterlogged(raw_at(&world, &full)),
        "the fluid never fills a full branch"
    );
}
