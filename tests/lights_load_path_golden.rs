use std::collections::hash_map::DefaultHasher;
use std::collections::VecDeque;
use std::hash::{Hash, Hasher};

use voxelize::{
    Block, Chunk, ChunkOptions, Chunks, LightColor, Lights, Registry, Vec2, Vec3, VoxelAccess,
    WorldConfig,
};

const AIR: u32 = 0;
const STONE: u32 = 1;
const GLASS: u32 = 2;
const LEAVES: u32 = 3;
const TORCH_R: u32 = 4;
const TORCH_G: u32 = 5;
const TORCH_B: u32 = 6;
const TORCH_RGB: u32 = 7;

const CHUNK_SIZE: usize = 16;
const MAX_HEIGHT: usize = 128;
const SUB_CHUNKS: usize = 8;

// Golden hash of the full propagated + flooded light state over the 3x3
// neighborhood produced by the mesher load path. Captured from the algorithm
// before the per-voxel overhead optimizations; any divergence means the output
// changed.
const EXPECTED_HASH: u64 = 2331721970131544895;

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
        &Block::new("torch_r")
            .id(TORCH_R)
            .is_passable(true)
            .is_transparent(true)
            .red_light_level(14)
            .build(),
    );
    registry.register_block(
        &Block::new("torch_g")
            .id(TORCH_G)
            .is_passable(true)
            .is_transparent(true)
            .green_light_level(13)
            .build(),
    );
    registry.register_block(
        &Block::new("torch_b")
            .id(TORCH_B)
            .is_passable(true)
            .is_transparent(true)
            .blue_light_level(9)
            .build(),
    );
    registry.register_block(
        &Block::new("torch_rgb")
            .id(TORCH_RGB)
            .is_passable(true)
            .is_transparent(true)
            .red_light_level(15)
            .green_light_level(11)
            .blue_light_level(7)
            .build(),
    );

    registry
}

/// Deterministic terrain that is continuous across chunk seams (a pure function
/// of world coordinates), with varied heights, transparent and light-reducing
/// surface cover, a floating overhang, a tall pillar, caves, and torches.
fn world_block(vx: i32, vy: i32, vz: i32) -> u32 {
    let base = 20 + (vx * 7 + vz * 13).rem_euclid(15);

    // Tall pillar to exercise vertical sunlight occlusion across many rows.
    if vx == 4 && vz == 4 && vy <= 90 {
        return STONE;
    }

    // Floating overhang slab: covers a patch, leaving sheltered air beneath it.
    if (6..11).contains(&vx) && (6..11).contains(&vz) && vy == 40 {
        return STONE;
    }

    if vy <= base {
        // Carve a horizontal cave tunnel through the solid ground.
        if vy == base - 4 && (-3..12).contains(&vx) {
            // Place a few colored torches inside the tunnel.
            if vx.rem_euclid(5) == 0 && vz.rem_euclid(4) == 0 {
                return match (vx + vz).rem_euclid(4) {
                    0 => TORCH_R,
                    1 => TORCH_G,
                    2 => TORCH_B,
                    _ => TORCH_RGB,
                };
            }
            return AIR;
        }
        return STONE;
    }

    // Surface cover one block above the ground: glass and leaves in patches.
    if vy == base + 1 {
        let patch = (vx.rem_euclid(6), vz.rem_euclid(6));
        if patch.0 < 2 {
            return GLASS;
        } else if (2..4).contains(&patch.0) {
            return LEAVES;
        }
    }

    // A surface torch sitting out in the open sky.
    if vy == base + 2 && vx.rem_euclid(8) == 3 && vz.rem_euclid(8) == 5 {
        return TORCH_RGB;
    }

    AIR
}

fn build_chunk(cx: i32, cz: i32, registry: &Registry) -> Chunk {
    let opts = ChunkOptions {
        size: CHUNK_SIZE,
        max_height: MAX_HEIGHT,
        sub_chunks: SUB_CHUNKS,
    };
    let mut chunk = Chunk::new("golden", cx, cz, &opts);

    let min_x = cx * CHUNK_SIZE as i32;
    let min_z = cz * CHUNK_SIZE as i32;

    for lx in 0..CHUNK_SIZE as i32 {
        for lz in 0..CHUNK_SIZE as i32 {
            let vx = min_x + lx;
            let vz = min_z + lz;
            for vy in 0..MAX_HEIGHT as i32 {
                let id = world_block(vx, vy, vz);
                if id != AIR {
                    chunk.set_voxel(vx, vy, vz, id);
                }
            }
        }
    }

    chunk.calculate_max_height(registry);
    chunk
}

/// Replicates `Mesher::process` load path for the center chunk: propagate over
/// the full 3x3 neighborhood, then flood the accumulated queues, returning the
/// space so the resulting light arrays can be snapshotted.
fn run_load_path(config: &WorldConfig, registry: &Registry) -> voxelize::Space {
    let mut chunks = Chunks::new(config);

    for cx in -1..=1 {
        for cz in -1..=1 {
            chunks.add(build_chunk(cx, cz, registry));
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
                MAX_HEIGHT,
                chunk_size as usize + if dx == 0 && dz == 0 { 2 } else { 0 },
            );

            let subqueues = Lights::propagate(&mut space, &sub_min, &sub_shape, registry, config);

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
                registry,
                config,
                Some(&min),
                Some(&shape),
            );
        }
    }

    space
}

fn hash_lights(space: &voxelize::Space, hasher: &mut DefaultHasher) {
    for cx in -1..=1 {
        for cz in -1..=1 {
            let lights = space
                .get_lights(cx, cz)
                .expect("space should contain loaded chunk lights");
            lights.data.hash(hasher);
        }
    }
}

#[test]
fn load_path_light_output_is_stable() {
    let config = WorldConfig {
        chunk_size: CHUNK_SIZE,
        max_height: MAX_HEIGHT,
        max_light_level: 15,
        sub_chunks: SUB_CHUNKS,
        min_chunk: [-1, -1],
        max_chunk: [1, 1],
        ..Default::default()
    };

    let registry = create_registry();

    let space = run_load_path(&config, &registry);

    let mut hasher = DefaultHasher::new();
    hash_lights(&space, &mut hasher);
    let hash = hasher.finish();

    println!("load-path light golden hash = {hash}");

    // Sanity: lighting actually ran (some non-zero light exists in the center).
    let center = space.get_lights(0, 0).unwrap();
    assert!(
        center.data.iter().any(|&l| l != 0),
        "center chunk has no light; fixture or load path is broken"
    );

    assert_eq!(
        hash, EXPECTED_HASH,
        "load-path light output changed; expected {EXPECTED_HASH}, got {hash}"
    );
}
