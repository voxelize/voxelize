use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use rayon::prelude::*;
use voxelize::{
    find_path, Block, Chunk, ChunkOptions, Chunks, Registry, Vec3, VoxelAccess, WorldConfig,
};

const GROUND_HEIGHT: i32 = 16;
const ENTITY_COUNT: usize = 64;

fn create_registry() -> Registry {
    let mut registry = Registry::new();
    registry.register_block(&Block::new("stone").id(1).build());
    registry
}

fn create_flat_chunks(config: &WorldConfig) -> Chunks {
    let mut chunks = Chunks::new(config);
    let chunk_opts = ChunkOptions {
        size: config.chunk_size,
        max_height: config.max_height,
        sub_chunks: config.sub_chunks,
    };
    let mut chunk = Chunk::new("flat", 0, 0, &chunk_opts);

    for x in 0..config.chunk_size as i32 {
        for z in 0..config.chunk_size as i32 {
            for y in 0..GROUND_HEIGHT {
                chunk.set_voxel(x, y, z, 1);
            }
        }
    }

    chunks.add(chunk);
    chunks
}

fn bench_pathfinding(c: &mut Criterion) {
    let config = WorldConfig {
        chunk_size: 64,
        max_height: 256,
        max_light_level: 15,
        sub_chunks: 8,
        ..Default::default()
    };
    let registry = create_registry();
    let chunks = create_flat_chunks(&config);

    // Real world-backed passability: read the voxel, look up the block.
    let raw_passable = |vx: i32, vy: i32, vz: i32| -> bool {
        let voxel = chunks.get_voxel(vx, vy, vz);
        let block = registry.get_block_by_id(voxel);
        block.is_passable || block.is_fluid
    };

    let height = 1.8_f32;
    let max_depth = 10_000;
    let max_time = Duration::from_secs(1);

    // Entities spread across the region, all heading to a far corner.
    let jobs: Vec<(Vec3<i32>, Vec3<i32>)> = (0..ENTITY_COUNT)
        .map(|i| {
            let sx = 2 + ((i % 8) * 3) as i32;
            let sz = 2 + ((i / 8) * 3) as i32;
            (Vec3(sx, GROUND_HEIGHT, sz), Vec3(60, GROUND_HEIGHT, 60))
        })
        .collect();

    // Guard against benchmarking a no-op: the search must actually find paths.
    {
        let (start, goal) = &jobs[0];
        let cache = RefCell::new(HashMap::new());
        let passable = |vx: i32, vy: i32, vz: i32| -> bool {
            *cache
                .borrow_mut()
                .entry((vx, vy, vz))
                .or_insert_with(|| raw_passable(vx, vy, vz))
        };
        assert!(
            find_path(start, goal, height, max_depth, max_time, &passable).is_some(),
            "benchmark setup produced no path; check the flat world",
        );
    }

    let mut group = c.benchmark_group("pathfinding_64_entities_parallel");

    // BEFORE: a single mutex-guarded cache shared across all parallel searches.
    group.bench_function("shared_mutex_cache", |b| {
        b.iter(|| {
            let cache: Mutex<HashMap<(i32, i32, i32), bool>> = Mutex::new(HashMap::new());
            jobs.par_iter().for_each(|(start, goal)| {
                let passable = |vx: i32, vy: i32, vz: i32| -> bool {
                    *cache
                        .lock()
                        .unwrap()
                        .entry((vx, vy, vz))
                        .or_insert_with(|| raw_passable(vx, vy, vz))
                };
                black_box(find_path(
                    start, goal, height, max_depth, max_time, &passable,
                ));
            });
        });
    });

    // AFTER: each search owns a local, lock-free cache.
    group.bench_function("per_entity_cache", |b| {
        b.iter(|| {
            jobs.par_iter().for_each(|(start, goal)| {
                let cache: RefCell<HashMap<(i32, i32, i32), bool>> = RefCell::new(HashMap::new());
                let passable = |vx: i32, vy: i32, vz: i32| -> bool {
                    *cache
                        .borrow_mut()
                        .entry((vx, vy, vz))
                        .or_insert_with(|| raw_passable(vx, vy, vz))
                };
                black_box(find_path(
                    start, goal, height, max_depth, max_time, &passable,
                ));
            });
        });
    });

    group.finish();
}

criterion_group!(benches, bench_pathfinding);
criterion_main!(benches);
