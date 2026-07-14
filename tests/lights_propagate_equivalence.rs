use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use voxelize::{
    Block, Chunk, ChunkOptions, Chunks, Lights, Registry, Vec2, Vec3, VoxelAccess, WorldConfig,
};

const STONE: u32 = 1;
const GLASS: u32 = 2;
const LEAVES: u32 = 3;
const TORCH: u32 = 4;

const CHUNK_SIZE: usize = 16;
const MAX_HEIGHT: usize = 256;
const PILLAR_TOP: i32 = 200;

const EXPECTED_HASH: u64 = 18324012094261871268;

fn create_registry() -> Registry {
    let mut registry = Registry::new();

    registry.register_block(&Block::new("stone").id(STONE).build());
    registry.register_block(&Block::new("glass").id(GLASS).is_transparent(true).build());
    registry.register_block(
        &Block::new("leaves")
            .id(LEAVES)
            .is_transparent(true)
            .light_reduce(true)
            .build(),
    );
    registry.register_block(
        &Block::new("torch")
            .id(TORCH)
            .is_passable(true)
            .is_transparent(true)
            .red_light_level(14)
            .green_light_level(11)
            .blue_light_level(7)
            .build(),
    );

    registry
}

fn base_height(x: i32, z: i32) -> i32 {
    30 + ((x * 7 + z * 13) % 25)
}

fn build_terrain(chunk: &mut Chunk) {
    for x in 0..CHUNK_SIZE as i32 {
        for z in 0..CHUNK_SIZE as i32 {
            let base = base_height(x, z);
            for y in 0..=base {
                chunk.set_voxel(x, y, z, STONE);
            }

            if x < 4 {
                chunk.set_voxel(x, base + 1, z, GLASS);
            } else if (5..8).contains(&x) {
                chunk.set_voxel(x, base + 1, z, LEAVES);
            }
        }
    }

    for y in 0..=PILLAR_TOP {
        chunk.set_voxel(8, y, 8, STONE);
    }

    chunk.set_voxel(3, 60, 3, TORCH);
    chunk.set_voxel(12, 70, 12, TORCH);
}

fn hash_state(
    space: &dyn VoxelAccess,
    queues: &[std::collections::VecDeque<voxelize::LightNode>],
    hasher: &mut DefaultHasher,
) {
    for vx in 0..CHUNK_SIZE as i32 {
        for vz in 0..CHUNK_SIZE as i32 {
            for vy in 0..MAX_HEIGHT as i32 {
                space.get_sunlight(vx, vy, vz).hash(hasher);
                space.get_red_light(vx, vy, vz).hash(hasher);
                space.get_green_light(vx, vy, vz).hash(hasher);
                space.get_blue_light(vx, vy, vz).hash(hasher);
            }
        }
    }

    for queue in queues {
        queue.len().hash(hasher);
        for node in queue {
            node.voxel.hash(hasher);
            node.level.hash(hasher);
        }
    }
}

#[test]
fn propagate_output_is_stable() {
    let config = WorldConfig {
        chunk_size: CHUNK_SIZE,
        max_height: MAX_HEIGHT,
        max_light_level: 15,
        sub_chunks: 8,
        min_chunk: [0, 0],
        max_chunk: [0, 0],
        ..Default::default()
    };

    let registry = create_registry();

    let mut chunks = Chunks::new(&config);
    let coords = Vec2(0, 0);

    let chunk_opts = ChunkOptions {
        size: config.chunk_size,
        max_height: config.max_height,
        sub_chunks: config.sub_chunks,
    };
    let mut chunk = Chunk::new("test", coords.0, coords.1, &chunk_opts);

    build_terrain(&mut chunk);
    chunk.calculate_max_height(&registry);
    chunks.add(chunk);

    let mut space = chunks
        .make_space(&coords, config.max_light_level as usize)
        .needs_voxels()
        .needs_lights()
        .needs_height_maps()
        .build();

    let min = Vec3(0, 0, 0);
    let shape = Vec3(CHUNK_SIZE, MAX_HEIGHT, CHUNK_SIZE);

    let queues = Lights::propagate(&mut space, &min, &shape, &registry, &config);

    let mut hasher = DefaultHasher::new();
    hash_state(&space, &queues, &mut hasher);
    let hash = hasher.finish();

    println!("propagate equivalence hash = {hash}");

    assert_eq!(
        hash, EXPECTED_HASH,
        "Lights::propagate output changed; expected {EXPECTED_HASH}, got {hash}"
    );
}
