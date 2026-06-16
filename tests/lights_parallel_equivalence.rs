use std::collections::hash_map::DefaultHasher;
use std::collections::VecDeque;
use std::hash::{Hash, Hasher};

use voxelize::{
    Block, Chunk, ChunkOptions, Chunks, LightColor, LightNode, Lights, Registry, Space, Vec2, Vec3,
    VoxelAccess, WorldConfig,
};

const STONE: u32 = 1;
const GLASS: u32 = 2;
const LEAVES: u32 = 3;
const TORCH: u32 = 4;

const CHUNK_SIZE: usize = 16;
const MAX_HEIGHT: usize = 256;

const EXPECTED_HASH: u64 = 14400099104990328835;

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

fn base_height(wx: i32, wz: i32) -> i32 {
    40 + (wx * 7 + wz * 13).rem_euclid(20)
}

/// A deliberately varied fixture: rolling heights, transparent (glass) and
/// light-reducing (leaves) canopies, opaque pillars, a floating overhang slab,
/// torches both embedded above terrain and floating in open air, and features
/// placed right on chunk seams so cross-chunk propagation is exercised.
fn build_terrain(chunk: &mut Chunk, cx: i32, cz: i32) {
    let ox = cx * CHUNK_SIZE as i32;
    let oz = cz * CHUNK_SIZE as i32;

    for lx in 0..CHUNK_SIZE as i32 {
        for lz in 0..CHUNK_SIZE as i32 {
            let wx = ox + lx;
            let wz = oz + lz;
            let base = base_height(wx, wz);

            for y in 0..=base {
                chunk.set_voxel(wx, y, wz, STONE);
            }

            match wx.rem_euclid(5) {
                0 => {
                    chunk.set_voxel(wx, base + 1, wz, GLASS);
                }
                1 => {
                    chunk.set_voxel(wx, base + 1, wz, LEAVES);
                }
                _ => {}
            }

            if wx.rem_euclid(7) == 0 && wz.rem_euclid(7) == 0 {
                chunk.set_voxel(wx, base + 2, wz, TORCH);
            }
        }
    }

    // Opaque pillar casting a long vertical shadow.
    for y in 0..=120 {
        chunk.set_voxel(ox + 8, y, oz + 8, STONE);
    }

    // Floating overhang slab: shades the region beneath and leaves an air gap
    // through which sunlight squeezes sideways.
    for lx in 2..6 {
        for lz in 2..6 {
            chunk.set_voxel(ox + lx, 80, oz + lz, STONE);
        }
    }

    // Floating colored torches high in open air.
    chunk.set_voxel(ox + 4, 90, oz + 4, TORCH);
    chunk.set_voxel(ox + 12, 100, oz + 12, TORCH);

    // Seam torch on the +x edge so light crosses into the neighbor chunk.
    chunk.set_voxel(ox + CHUNK_SIZE as i32 - 1, 70, oz + 7, TORCH);
}

fn build_space(registry: &Registry, config: &WorldConfig) -> Space {
    let mut chunks = Chunks::new(config);

    for cx in -1..=1 {
        for cz in -1..=1 {
            let chunk_opts = ChunkOptions {
                size: config.chunk_size,
                max_height: config.max_height,
                sub_chunks: config.sub_chunks,
            };
            let mut chunk = Chunk::new("t", cx, cz, &chunk_opts);
            build_terrain(&mut chunk, cx, cz);
            chunk.calculate_max_height(registry);
            chunks.add(chunk);
        }
    }

    chunks
        .make_space(&Vec2(0, 0), config.max_light_level as usize)
        .needs_voxels()
        .needs_lights()
        .needs_height_maps()
        .build()
}

/// Verbatim reproduction of the original (pre-parallel) load-path lighting:
/// nine sequential `propagate` passes over the 3x3 neighborhood followed by a
/// sequential flood per color. Used as the source of truth for the parallel path.
fn reference_light_chunk(space: &mut Space, registry: &Registry, config: &WorldConfig) {
    let chunk_size = config.chunk_size as i32;
    let coords = space.coords.to_owned();
    let min = space.min.to_owned();
    let shape = space.shape.to_owned();

    let light_colors = [
        LightColor::Sunlight,
        LightColor::Red,
        LightColor::Green,
        LightColor::Blue,
    ];

    let mut light_queues: Vec<VecDeque<LightNode>> = vec![VecDeque::new(); 4];

    for dx in -1..=1 {
        for dz in -1..=1 {
            let pmin = Vec3(
                (coords.0 + dx) * chunk_size - if dx == 0 && dz == 0 { 1 } else { 0 },
                0,
                (coords.1 + dz) * chunk_size - if dx == 0 && dz == 0 { 1 } else { 0 },
            );
            let pshape = Vec3(
                chunk_size as usize + if dx == 0 && dz == 0 { 2 } else { 0 },
                config.max_height,
                chunk_size as usize + if dx == 0 && dz == 0 { 2 } else { 0 },
            );

            let subqueues = Lights::propagate(space, &pmin, &pshape, registry, config);

            for (queue, subqueue) in light_queues.iter_mut().zip(subqueues.into_iter()) {
                queue.extend(subqueue);
            }
        }
    }

    for (queue, color) in light_queues.into_iter().zip(light_colors.iter()) {
        if !queue.is_empty() {
            Lights::flood_light(
                space,
                queue,
                color,
                registry,
                config,
                Some(&min),
                Some(&shape),
            );
        }
    }
}

fn hash_center_lights(space: &Space, hasher: &mut DefaultHasher) {
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
}

fn config() -> WorldConfig {
    WorldConfig {
        chunk_size: CHUNK_SIZE,
        max_height: MAX_HEIGHT,
        max_light_level: 15,
        sub_chunks: 8,
        min_chunk: [-100, -100],
        max_chunk: [100, 100],
        ..Default::default()
    }
}

#[test]
fn parallel_lighting_matches_sequential_reference() {
    let config = config();
    let registry = create_registry();

    let mut reference_space = build_space(&registry, &config);
    reference_light_chunk(&mut reference_space, &registry, &config);

    let mut parallel_space = build_space(&registry, &config);
    Lights::light_chunk(&mut parallel_space, &registry, &config);

    let reference = reference_space.get_lights(0, 0).unwrap();
    let parallel = parallel_space.get_lights(0, 0).unwrap();

    assert_eq!(
        reference.data, parallel.data,
        "parallel light_chunk diverged from the sequential reference"
    );
}

#[test]
fn parallel_lighting_is_deterministic_across_runs() {
    let config = config();
    let registry = create_registry();

    let mut first = build_space(&registry, &config);
    Lights::light_chunk(&mut first, &registry, &config);

    for _ in 0..16 {
        let mut next = build_space(&registry, &config);
        Lights::light_chunk(&mut next, &registry, &config);

        assert_eq!(
            first.get_lights(0, 0).unwrap().data,
            next.get_lights(0, 0).unwrap().data,
            "parallel light_chunk produced non-deterministic output"
        );
    }
}

#[test]
fn parallel_lighting_golden_hash() {
    let config = config();
    let registry = create_registry();

    let mut space = build_space(&registry, &config);
    Lights::light_chunk(&mut space, &registry, &config);

    let mut hasher = DefaultHasher::new();
    hash_center_lights(&space, &mut hasher);
    let hash = hasher.finish();

    println!("parallel lighting golden hash = {hash}");

    assert_eq!(
        hash, EXPECTED_HASH,
        "golden light hash changed; expected {EXPECTED_HASH}, got {hash}"
    );
}
