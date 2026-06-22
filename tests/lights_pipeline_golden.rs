//! Golden snapshot of the full server-side lighting pipeline.
//!
//! This mirrors the `Mesher::process` load path: for the center chunk it runs
//! `Lights::propagate` over the full 3x3 chunk neighborhood and then floods the
//! collected seed queues with `Lights::flood_light`, exactly like the engine.
//! The resulting sunlight + RGB light arrays across the entire space are hashed
//! into a single value so that any change to lighting output is caught.
//!
//! The fixture intentionally exercises every behavior the lighting code cares
//! about: opaque blocks, fully transparent blocks (glass), `light_reduce`
//! blocks (leaves), RGB torches with distinct per-channel levels, floating
//! overhangs (sunlight occlusion + horizontal bleed), tall pillars, dug pits
//! that let sunlight reach the floor, chunk seams, and wide-open sky.

use std::collections::hash_map::DefaultHasher;
use std::collections::VecDeque;
use std::hash::{Hash, Hasher};

use voxelize::{
    Block, Chunk, ChunkOptions, Chunks, LightColor, LightNode, Lights, Registry, Vec2, Vec3,
    VoxelAccess, WorldConfig,
};

const STONE: u32 = 1;
const GLASS: u32 = 2;
const LEAVES: u32 = 3;
const TORCH_RGB: u32 = 4;
const TORCH_RED: u32 = 5;
const TORCH_BLUE: u32 = 6;

const CHUNK_SIZE: usize = 16;
const MAX_HEIGHT: usize = 256;
const MAX_LIGHT_LEVEL: u32 = 15;

const EXPECTED_HASH: u64 = 13203955574907064839;

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
    registry.register_block(
        &Block::new("torch_blue")
            .id(TORCH_BLUE)
            .is_passable(true)
            .is_transparent(true)
            .blue_light_level(13)
            .build(),
    );

    registry
}

fn ground_height(vx: i32, vz: i32) -> i32 {
    30 + vx.rem_euclid(11) + vz.rem_euclid(7)
}

/// Resolve the block id for a global voxel coordinate. `None` means air.
fn terrain_at(vx: i32, vy: i32, vz: i32) -> Option<u32> {
    let h = ground_height(vx, vz);

    // A dug pit punched all the way down to the floor; lets sunlight reach y=0.
    let in_pit = (20..24).contains(&vx) && (2..6).contains(&vz);

    // Solid ground up to the surface (unless carved out by a pit).
    if vy <= h && !in_pit {
        // Surface decoration: glass strip and a light_reduce leaves canopy.
        if vy == h {
            if (-12..-4).contains(&vx) {
                return Some(GLASS);
            }
            if (-4..2).contains(&vx) {
                return Some(LEAVES);
            }
        }
        return Some(STONE);
    }

    // A floating opaque overhang with open air beneath it.
    if vy == 64 && (4..10).contains(&vx) && (4..10).contains(&vz) {
        return Some(STONE);
    }

    // A tall pillar reaching high into the sky.
    if vx == 8 && vz == 20 && vy <= 200 {
        return Some(STONE);
    }

    // RGB torch tucked under the overhang.
    if (vx, vy, vz) == (6, 60, 6) {
        return Some(TORCH_RGB);
    }
    // Red torch sitting right on a chunk seam (x == 0).
    if (vx, vy, vz) == (0, 40, 7) {
        return Some(TORCH_RED);
    }
    // Blue torch in a neighbor chunk near another seam (x == 16).
    if (vx, vy, vz) == (16, 38, 9) {
        return Some(TORCH_BLUE);
    }
    // RGB torch floating in open sky.
    if (vx, vy, vz) == (25, 90, 25) {
        return Some(TORCH_RGB);
    }

    None
}

fn build_chunk(cx: i32, cz: i32, registry: &Registry) -> Chunk {
    let chunk_opts = ChunkOptions {
        size: CHUNK_SIZE,
        max_height: MAX_HEIGHT,
        sub_chunks: 8,
    };
    let mut chunk = Chunk::new("test", cx, cz, &chunk_opts);

    for lx in 0..CHUNK_SIZE as i32 {
        for lz in 0..CHUNK_SIZE as i32 {
            let vx = cx * CHUNK_SIZE as i32 + lx;
            let vz = cz * CHUNK_SIZE as i32 + lz;
            for vy in 0..MAX_HEIGHT as i32 {
                if let Some(id) = terrain_at(vx, vy, vz) {
                    chunk.set_voxel(vx, vy, vz, id);
                }
            }
        }
    }

    chunk.calculate_max_height(registry);
    chunk
}

fn hash_space_lights(space: &dyn VoxelAccess, hasher: &mut DefaultHasher) {
    // Hash the whole 3x3 neighborhood footprint over the full height.
    for vx in -(CHUNK_SIZE as i32)..2 * CHUNK_SIZE as i32 {
        for vz in -(CHUNK_SIZE as i32)..2 * CHUNK_SIZE as i32 {
            for vy in 0..MAX_HEIGHT as i32 {
                space.get_sunlight(vx, vy, vz).hash(hasher);
                space.get_red_light(vx, vy, vz).hash(hasher);
                space.get_green_light(vx, vy, vz).hash(hasher);
                space.get_blue_light(vx, vy, vz).hash(hasher);
            }
        }
    }
}

#[test]
fn full_pipeline_output_is_stable() {
    let config = WorldConfig {
        chunk_size: CHUNK_SIZE,
        max_height: MAX_HEIGHT,
        max_light_level: MAX_LIGHT_LEVEL,
        sub_chunks: 8,
        min_chunk: [-1, -1],
        max_chunk: [1, 1],
        ..Default::default()
    };

    let registry = create_registry();
    let mut chunks = Chunks::new(&config);

    for cx in -1..=1 {
        for cz in -1..=1 {
            chunks.add(build_chunk(cx, cz, &registry));
        }
    }

    let coords = Vec2(0, 0);
    let chunk_size = config.chunk_size as i32;

    let mut space = chunks
        .make_space(&coords, config.max_light_level as usize)
        .needs_voxels()
        .needs_lights()
        .needs_height_maps()
        .build();

    let space_min = space.min.to_owned();
    let space_shape = space.shape.to_owned();

    let light_colors = [
        LightColor::Sunlight,
        LightColor::Red,
        LightColor::Green,
        LightColor::Blue,
    ];

    // Mirror the mesher load path: propagate the full 3x3 neighborhood, keeping
    // every seed queue, then flood once per color over the whole space.
    let mut light_queues: Vec<VecDeque<LightNode>> = vec![VecDeque::new(); 4];

    for dx in -1..=1 {
        for dz in -1..=1 {
            let min = Vec3(
                (coords.0 + dx) * chunk_size - if dx == 0 && dz == 0 { 1 } else { 0 },
                0,
                (coords.1 + dz) * chunk_size - if dx == 0 && dz == 0 { 1 } else { 0 },
            );
            let shape = Vec3(
                CHUNK_SIZE + if dx == 0 && dz == 0 { 2 } else { 0 },
                MAX_HEIGHT,
                CHUNK_SIZE + if dx == 0 && dz == 0 { 2 } else { 0 },
            );

            let subqueues = Lights::propagate(&mut space, &min, &shape, &registry, &config);
            for (queue, subqueue) in light_queues.iter_mut().zip(subqueues.into_iter()) {
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
                &registry,
                &config,
                Some(&space_min),
                Some(&space_shape),
            );
        }
    }

    let mut hasher = DefaultHasher::new();
    hash_space_lights(&space, &mut hasher);
    let hash = hasher.finish();

    println!("full pipeline lighting hash = {hash}");

    assert_eq!(
        hash, EXPECTED_HASH,
        "Full lighting pipeline output changed; expected {EXPECTED_HASH}, got {hash}"
    );
}
