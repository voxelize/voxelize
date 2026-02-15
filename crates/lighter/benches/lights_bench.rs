use std::collections::VecDeque;

use criterion::{black_box, criterion_group, criterion_main, BatchSize, Criterion};
use voxelize_lighter::{
    flood_light, propagate, remove_light, LightBlock, LightColor, LightConfig, LightNode,
    LightRegistry, LightVoxelAccess,
};
use voxelize_core::{BlockRotation, LightUtils};

#[derive(Clone)]
struct BenchSpace {
    min: [i32; 3],
    shape: [usize; 3],
    voxels: Vec<u32>,
    lights: Vec<u32>,
}

impl BenchSpace {
    fn new(min: [i32; 3], shape: [usize; 3]) -> Self {
        let size = shape[0] * shape[1] * shape[2];
        Self {
            min,
            shape,
            voxels: vec![0; size],
            lights: vec![0; size],
        }
    }

    #[inline]
    fn index(&self, vx: i32, vy: i32, vz: i32) -> Option<usize> {
        let lx = vx - self.min[0];
        let ly = vy - self.min[1];
        let lz = vz - self.min[2];

        if lx < 0
            || ly < 0
            || lz < 0
            || lx >= self.shape[0] as i32
            || ly >= self.shape[1] as i32
            || lz >= self.shape[2] as i32
        {
            return None;
        }

        Some(
            lx as usize * self.shape[1] * self.shape[2]
                + ly as usize * self.shape[2]
                + lz as usize,
        )
    }

    fn set_voxel(&mut self, vx: i32, vy: i32, vz: i32, id: u32) {
        if let Some(index) = self.index(vx, vy, vz) {
            self.voxels[index] = id;
        }
    }
}

impl LightVoxelAccess for BenchSpace {
    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        self.index(vx, vy, vz).map_or(0, |index| self.voxels[index])
    }

    fn get_voxel_rotation(&self, _vx: i32, _vy: i32, _vz: i32) -> BlockRotation {
        BlockRotation::default()
    }

    fn get_voxel_stage(&self, _vx: i32, _vy: i32, _vz: i32) -> u32 {
        0
    }

    fn get_raw_light(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        self.index(vx, vy, vz).map_or(0, |index| self.lights[index])
    }

    fn set_raw_light(&mut self, vx: i32, vy: i32, vz: i32, level: u32) -> bool {
        if let Some(index) = self.index(vx, vy, vz) {
            self.lights[index] = level;
            return true;
        }

        false
    }

    fn get_max_height(&self, _vx: i32, _vz: i32) -> u32 {
        self.shape[1] as u32
    }

    fn contains(&self, vx: i32, vy: i32, vz: i32) -> bool {
        self.index(vx, vy, vz).is_some()
    }
}

fn create_registry() -> LightRegistry {
    let mut air = LightBlock::default_air();
    air.id = 0;

    let stone = LightBlock::new(
        1,
        [false, false, false, false, false, false],
        true,
        0,
        0,
        0,
        None,
    );

    let torch = LightBlock::new(2, [true, true, true, true, true, true], false, 15, 0, 0, None);

    LightRegistry::new(vec![(0, air), (1, stone), (2, torch)])
}

fn create_config() -> LightConfig {
    LightConfig {
        chunk_size: 16,
        max_height: 64,
        max_light_level: 15,
        min_chunk: [0, 0],
        max_chunk: [0, 0],
    }
}

fn bench_propagate_air(c: &mut Criterion) {
    let config = create_config();
    let registry = create_registry();
    let base_space = BenchSpace::new([0, 0, 0], [16, 64, 16]);

    c.bench_function("propagate_air_16x64x16", |b| {
        b.iter_batched(
            || base_space.clone(),
            |mut space| {
                let queues = propagate(
                    black_box(&mut space),
                    black_box([0, 0, 0]),
                    black_box([16, 64, 16]),
                    black_box(&registry),
                    black_box(&config),
                );
                black_box(queues);
            },
            BatchSize::SmallInput,
        );
    });
}

fn bench_propagate_terrain(c: &mut Criterion) {
    let config = create_config();
    let registry = create_registry();
    let mut terrain = BenchSpace::new([0, 0, 0], [16, 64, 16]);
    for x in 0..16 {
        for z in 0..16 {
            for y in 0..32 {
                terrain.set_voxel(x, y, z, 1);
            }
        }
    }

    c.bench_function("propagate_terrain_16x64x16", |b| {
        b.iter_batched(
            || terrain.clone(),
            |mut space| {
                let queues = propagate(
                    black_box(&mut space),
                    black_box([0, 0, 0]),
                    black_box([16, 64, 16]),
                    black_box(&registry),
                    black_box(&config),
                );
                black_box(queues);
            },
            BatchSize::SmallInput,
        );
    });
}

fn bench_flood_single_torch(c: &mut Criterion) {
    let config = create_config();
    let registry = create_registry();
    let mut base_space = BenchSpace::new([0, 0, 0], [16, 64, 16]);
    base_space.set_voxel(8, 32, 8, 2);

    c.bench_function("flood_light_single_torch_16x64x16", |b| {
        b.iter_batched(
            || base_space.clone(),
            |mut space| {
                let source_level = 15;
                let raw = LightUtils::insert_red_light(0, source_level);
                space.set_raw_light(8, 32, 8, raw);

                flood_light(
                    black_box(&mut space),
                    black_box(VecDeque::from(vec![LightNode {
                        voxel: [8, 32, 8],
                        level: source_level,
                    }])),
                    black_box(&LightColor::Red),
                    black_box(&config),
                    black_box(None),
                    black_box(&registry),
                );
            },
            BatchSize::SmallInput,
        );
    });
}

fn bench_remove_single_torch(c: &mut Criterion) {
    let config = create_config();
    let registry = create_registry();

    let mut prelit = BenchSpace::new([0, 0, 0], [16, 64, 16]);
    prelit.set_voxel(8, 32, 8, 2);
    prelit.set_red_light(8, 32, 8, 15);
    flood_light(
        &mut prelit,
        VecDeque::from(vec![LightNode {
            voxel: [8, 32, 8],
            level: 15,
        }]),
        &LightColor::Red,
        &config,
        None,
        &registry,
    );

    c.bench_function("remove_light_single_torch_16x64x16", |b| {
        b.iter_batched(
            || prelit.clone(),
            |mut space| {
                remove_light(
                    black_box(&mut space),
                    black_box([8, 32, 8]),
                    black_box(&LightColor::Red),
                    black_box(&config),
                    black_box(&registry),
                );
            },
            BatchSize::SmallInput,
        );
    });
}

criterion_group!(
    benches,
    bench_propagate_air,
    bench_propagate_terrain,
    bench_flood_single_torch,
    bench_remove_single_torch
);
criterion_main!(benches);
