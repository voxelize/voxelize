//! A block whose rotation bits are state gets all 256 values of bits 16-23
//! back as they went in: through the update intake, a save and a reload. A
//! rotatable block written the same way shows what decoding them as a
//! rotation does to most of those values.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::{
    Block, BlockUtils, Chunk, ChunkStage, Registry, Resources, Space, Vec3, VoxelAccess, World,
    WorldConfig, ROTATION_BYTE_MASK,
};

const GROUND_ID: u32 = 1;
const STATEFUL_ID: u32 = 7;
const ROTATING_ID: u32 = 8;
const STATEFUL_Y: i32 = 2;
const ROTATING_Y: i32 = 4;
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

fn save_dir(label: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "voxelize-state-bits-{}-{}-{:?}",
        label,
        std::process::id(),
        std::thread::current().id()
    ));
    fs::remove_dir_all(&dir).ok();
    dir
}

fn preloaded_world(dir: &Path) -> World {
    let config = WorldConfig::new()
        .min_chunk([-WORLD_EDGE, -WORLD_EDGE])
        .max_chunk([WORLD_EDGE, WORLD_EDGE])
        .chunk_size(16)
        .max_height(16)
        .sub_chunks(1)
        .preload(true)
        .preload_radius(WORLD_EDGE as usize)
        .saving(true)
        .save_dir(dir.to_str().expect("utf-8 temp path"))
        .build();

    let mut registry = Registry::new();
    registry.register_block(&Block::new("Ground").id(GROUND_ID).build());
    registry.register_block(
        &Block::new("Stateful")
            .id(STATEFUL_ID)
            .is_transparent(true)
            .rotation_bits_are_state()
            .build(),
    );
    registry.register_block(
        &Block::new("Rotating")
            .id(ROTATING_ID)
            .rotatable(true)
            .build(),
    );

    let mut world = World::new("state-bits", &config);
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

/// Every value of the byte once, with a stage that differs from voxel to
/// voxel, laid out on a 16 x 16 square.
fn words(id: u32, y: i32) -> Vec<(Vec3<i32>, u32)> {
    (0..=255u32)
        .map(|byte| {
            let raw = BlockUtils::insert_stage(BlockUtils::insert_id(byte << 16, id), byte % 16);
            (Vec3(byte as i32 % 16, y, byte as i32 / 16), raw)
        })
        .collect()
}

fn write_and_wait(world: &mut World, words: &[(Vec3<i32>, u32)]) {
    {
        let mut chunks = world.chunks_mut();
        for (voxel, raw) in words {
            chunks.update_voxel(voxel, *raw);
        }
    }
    let deadline = Instant::now() + WAIT_DEADLINE;
    loop {
        let landed = {
            let chunks = world.chunks();
            words.iter().all(|(Vec3(x, y, z), raw)| {
                chunks.get_voxel(*x, *y, *z) == BlockUtils::extract_id(*raw)
            })
        };
        if landed {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "the intake never wrote every word"
        );
        world.tick();
        std::thread::sleep(Duration::from_millis(1));
    }
}

fn read(world: &World, words: &[(Vec3<i32>, u32)]) -> Vec<u32> {
    let chunks = world.chunks();
    words
        .iter()
        .map(|(Vec3(x, y, z), _)| chunks.get_raw_voxel(*x, *y, *z))
        .collect()
}

fn kept(raw: u32) -> u32 {
    raw & (ROTATION_BYTE_MASK | 0x0F00_FFFF)
}

#[test]
fn state_bits_survive_the_intake_a_save_and_a_reload() {
    let dir = save_dir("round-trip");
    let stateful = words(STATEFUL_ID, STATEFUL_Y);
    let rotating = words(ROTATING_ID, ROTATING_Y);

    let mut world = preloaded_world(&dir);
    write_and_wait(&mut world, &stateful);
    write_and_wait(&mut world, &rotating);

    let after_intake = read(&world, &stateful);
    for ((voxel, raw), got) in stateful.iter().zip(&after_intake) {
        assert_eq!(
            kept(*got),
            kept(*raw),
            "the intake changed the word at {voxel:?}"
        );
    }
    let decoded = read(&world, &rotating);
    assert!(
        rotating
            .iter()
            .zip(&decoded)
            .any(|((_, raw), got)| kept(*got) != kept(*raw)),
        "decoding as a rotation should have folded some values: the control proves nothing"
    );

    let deadline = Instant::now() + WAIT_DEADLINE;
    while !world.chunks().to_save.is_empty() || !saved(&dir) {
        assert!(
            Instant::now() < deadline,
            "the edited chunks were never saved"
        );
        world.tick();
        std::thread::sleep(Duration::from_millis(5));
    }
    for _ in 0..50 {
        world.tick();
        std::thread::sleep(Duration::from_millis(5));
    }
    drop(world);

    let reloaded = preloaded_world(&dir);
    let after_reload = read(&reloaded, &stateful);
    for ((voxel, raw), got) in stateful.iter().zip(&after_reload) {
        assert_eq!(
            kept(*got),
            kept(*raw),
            "a reload changed the word at {voxel:?}"
        );
    }

    drop(reloaded);
    fs::remove_dir_all(&dir).ok();
}

fn saved(dir: &Path) -> bool {
    fs::read_dir(dir.join("chunks")).is_ok_and(|entries| {
        entries
            .filter_map(|entry| entry.ok())
            .any(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
    })
}

#[test]
#[should_panic(expected = "cannot rotate")]
fn a_block_whose_rotation_bits_are_state_cannot_rotate() {
    Block::new("Both")
        .id(9)
        .rotatable(true)
        .rotation_bits_are_state()
        .build();
}

#[test]
#[should_panic(expected = "equally transparent")]
fn a_block_whose_rotation_bits_are_state_is_equally_transparent_all_round() {
    Block::new("Lopsided")
        .id(10)
        .is_py_transparent(true)
        .rotation_bits_are_state()
        .build();
}

#[test]
fn a_block_whose_rotation_bits_are_state_collides_unrotated() {
    let block = Block::new("Stateful")
        .id(STATEFUL_ID)
        .is_transparent(true)
        .rotation_bits_are_state()
        .build();
    let rotating = Block::new("Rotating")
        .id(ROTATING_ID)
        .rotatable(true)
        .build();
    for byte in 0..=255u32 {
        let raw = BlockUtils::insert_id(byte << 16, STATEFUL_ID);
        assert_eq!(block.rotation_of(raw), crate::BlockRotation::default());
        assert_eq!(rotating.rotation_of(raw), BlockUtils::extract_rotation(raw));
    }
}
