//! Golden snapshot for the server-side lighting "load" path.
//!
//! This replicates `Mesher::process`'s load branch (the 3x3 neighborhood
//! `Lights::propagate` sweep followed by the clamped `Lights::flood_light`)
//! over a comprehensive multi-chunk terrain fixture and hashes the resulting
//! sunlight + RGB arrays of the center chunk. Any change to the lighting
//! output - intentional or accidental - flips this hash.

use std::collections::hash_map::DefaultHasher;
use std::collections::VecDeque;
use std::hash::{Hash, Hasher};

use voxelize::{
    Block, Chunk, ChunkOptions, Chunks, LightColor, Lights, Registry, Vec2, Vec3, VoxelAccess,
    WorldConfig,
};

const STONE: u32 = 1;
const GLASS: u32 = 2;
const LEAVES: u32 = 3;
const TORCH_RGB: u32 = 4;
const TORCH_RED: u32 = 5;
const SLAB: u32 = 6;

const CHUNK_SIZE: usize = 16;
const MAX_HEIGHT: usize = 256;
const MAX_LIGHT_LEVEL: u32 = 15;
const SUB_CHUNKS: usize = 8;

const EXPECTED_HASH: u64 = 3981557178627028791;

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
        &Block::new("torch_rgb")
            .id(TORCH_RGB)
            .is_passable(true)
            .is_transparent(true)
            .red_light_level(14)
            .green_light_level(11)
            .blue_light_level(7)
            .build(),
    );
    registry.register_block(
        &Block::new("torch_red")
            .id(TORCH_RED)
            .is_passable(true)
            .is_transparent(true)
            .red_light_level(15)
            .build(),
    );
    // A "slab"-like opaque overhang block (still opaque, used for floating geometry).
    registry.register_block(&Block::new("slab").id(SLAB).build());

    registry
}

/// Continuous (cross-chunk) terrain height as a function of global coordinates.
fn terrain_height(gx: i32, gz: i32) -> i32 {
    let wave = ((gx * 5 + gz * 3).rem_euclid(23)) + ((gx * gz).rem_euclid(7));
    35 + wave
}

fn fill_chunk(chunk: &mut Chunk, cx: i32, cz: i32) {
    for x in 0..CHUNK_SIZE as i32 {
        for z in 0..CHUNK_SIZE as i32 {
            let gx = cx * CHUNK_SIZE as i32 + x;
            let gz = cz * CHUNK_SIZE as i32 + z;
            let h = terrain_height(gx, gz);

            for y in 0..=h {
                chunk.set_voxel(x, y, z, STONE);
            }

            // Surface decorations - transparent caps and light_reduce canopy.
            match gx.rem_euclid(5) {
                0 => {
                    chunk.set_voxel(x, h + 1, z, GLASS);
                }
                1 => {
                    chunk.set_voxel(x, h + 1, z, LEAVES);
                    chunk.set_voxel(x, h + 2, z, LEAVES);
                }
                _ => {}
            }

            // Overhang: a floating opaque slab with an air gap underneath,
            // creating shadowed pockets that exercise sunlight occlusion.
            if gx.rem_euclid(8) == 3 && gz.rem_euclid(8) == 3 {
                let slab_y = h + 6;
                chunk.set_voxel(x, slab_y, z, SLAB);
                chunk.set_voxel(x, slab_y + 1, z, SLAB);
            }
        }
    }

    // A tall pillar per chunk to force tall region tops and vertical seams.
    chunk.set_voxel(8, 180, 8, STONE);
    for y in 0..=180 {
        if y % 2 == 0 {
            chunk.set_voxel(2, y, 2, STONE);
        }
    }

    // Torches: RGB combo and a pure-red one, at varied heights / near seams.
    chunk.set_voxel(0, 60, 0, TORCH_RGB);
    chunk.set_voxel(15, 48, 15, TORCH_RED);
    chunk.set_voxel(7, 90, 1, TORCH_RGB);
}

fn build_world(registry: &Registry, config: &WorldConfig) -> Chunks {
    let mut chunks = Chunks::new(config);

    let chunk_opts = ChunkOptions {
        size: config.chunk_size,
        max_height: config.max_height,
        sub_chunks: config.sub_chunks,
    };

    for cx in config.min_chunk[0]..=config.max_chunk[0] {
        for cz in config.min_chunk[1]..=config.max_chunk[1] {
            let mut chunk = Chunk::new("golden", cx, cz, &chunk_opts);
            fill_chunk(&mut chunk, cx, cz);
            chunk.calculate_max_height(registry);
            chunks.add(chunk);
        }
    }

    chunks
}

/// Run the exact load-path lighting computation `Mesher::process` performs for
/// the center chunk, returning the resulting center-chunk light array hash.
fn compute_center_light_hash(registry: &Registry, config: &WorldConfig, chunks: &Chunks) -> u64 {
    let coords = Vec2(0, 0);
    let chunk_size = config.chunk_size as i32;

    let mut space = chunks
        .make_space(&coords, config.max_light_level as usize)
        .needs_voxels()
        .needs_lights()
        .needs_height_maps()
        .build();

    let min = space.min.to_owned();
    let shape = space.shape.to_owned();

    let light_colors = [
        LightColor::Sunlight,
        LightColor::Red,
        LightColor::Green,
        LightColor::Blue,
    ];

    let mut light_queues = vec![VecDeque::new(); 4];

    for dx in -1..=1 {
        for dz in -1..=1 {
            let sub_min = Vec3(
                (coords.0 + dx) * chunk_size - if dx == 0 && dz == 0 { 1 } else { 0 },
                0,
                (coords.1 + dz) * chunk_size - if dx == 0 && dz == 0 { 1 } else { 0 },
            );
            let sub_shape = Vec3(
                chunk_size as usize + if dx == 0 && dz == 0 { 2 } else { 0 },
                config.max_height,
                chunk_size as usize + if dx == 0 && dz == 0 { 2 } else { 0 },
            );

            let light_subqueues =
                Lights::propagate(&mut space, &sub_min, &sub_shape, registry, config);

            for (queue, subqueue) in light_queues.iter_mut().zip(light_subqueues.into_iter()) {
                queue.extend(subqueue);
            }
        }
    }

    for (queue, color) in light_queues.into_iter().zip(light_colors.iter()) {
        if !queue.is_empty() {
            Lights::flood_light(
                &mut space,
                queue,
                color,
                registry,
                config,
                Some(&min),
                Some(&shape),
            );
        }
    }

    let mut hasher = DefaultHasher::new();
    for vx in 0..CHUNK_SIZE as i32 {
        for vz in 0..CHUNK_SIZE as i32 {
            for vy in 0..MAX_HEIGHT as i32 {
                space.get_sunlight(vx, vy, vz).hash(&mut hasher);
                space.get_red_light(vx, vy, vz).hash(&mut hasher);
                space.get_green_light(vx, vy, vz).hash(&mut hasher);
                space.get_blue_light(vx, vy, vz).hash(&mut hasher);
            }
        }
    }
    hasher.finish()
}

#[test]
fn load_path_light_output_is_stable() {
    let config = WorldConfig {
        chunk_size: CHUNK_SIZE,
        max_height: MAX_HEIGHT,
        max_light_level: MAX_LIGHT_LEVEL,
        sub_chunks: SUB_CHUNKS,
        min_chunk: [-1, -1],
        max_chunk: [1, 1],
        ..Default::default()
    };

    let registry = create_registry();
    let chunks = build_world(&registry, &config);

    let hash = compute_center_light_hash(&registry, &config, &chunks);

    println!("load path golden hash = {hash}");

    assert_eq!(
        hash, EXPECTED_HASH,
        "Load-path lighting output changed; expected {EXPECTED_HASH}, got {hash}"
    );
}
