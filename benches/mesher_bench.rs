use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use voxelize::{
    Block, Chunk, ChunkOptions, Chunks, Mesher, Registry, Vec2, Vec3, VoxelAccess, WorldConfig,
};

fn create_test_registry() -> Registry {
    let mut registry = Registry::new();
    
    registry.register_block(&Block::new("stone")
        .id(1)
        .build());
    
    registry.register_block(&Block::new("grass")
        .id(2)
        .build());
    
    registry.register_block(&Block::new("water")
        .id(3)
        .is_passable(true)
        .is_see_through(true)
        .build());
    
    registry
}

fn create_test_chunks(config: &WorldConfig) -> Chunks {
    let mut chunks = Chunks::new(config);
    let coords = Vec2(0, 0);
    
    let chunk_opts = ChunkOptions {
        size: config.chunk_size,
        max_height: config.max_height,
        sub_chunks: config.sub_chunks,
    };
    let mut chunk = Chunk::new("test", coords.0, coords.1, &chunk_opts);
    
    for x in 0..config.chunk_size as i32 {
        for z in 0..config.chunk_size as i32 {
            for y in 0..32 {
                let voxel_id = if y < 16 {
                    1
                } else if y < 24 {
                    2
                } else if y < 28 {
                    3
                } else {
                    0
                };
                
                chunk.set_voxel(x, y, z, voxel_id);
            }
        }
    }
    
    chunks.add(chunk);
    chunks
}

fn bench_mesh_space(c: &mut Criterion) {
    let config = WorldConfig {
        chunk_size: 16,
        max_height: 256,
        max_light_level: 15,
        sub_chunks: 8,
        ..Default::default()
    };
    
    let registry = create_test_registry();
    let chunks = create_test_chunks(&config);
    let coords = Vec2(0, 0);
    
    let space = chunks.make_space(&coords, 1)
        .needs_voxels()
        .needs_height_maps()
        .build();
    
    let min = Vec3(0, 0, 0);
    let max = Vec3(16, 32, 16);
    
    c.bench_function("mesh_space_16x32x16", |b| {
        b.iter(|| {
            Mesher::mesh_space(
                black_box(&min),
                black_box(&max),
                black_box(&space as &dyn VoxelAccess),
                black_box(&registry),
            )
        })
    });
}

fn bench_mesh_space_sizes(c: &mut Criterion) {
    let mut group = c.benchmark_group("mesh_space_varying_sizes");
    
    let config = WorldConfig {
        chunk_size: 16,
        max_height: 256,
        max_light_level: 15,
        sub_chunks: 8,
        ..Default::default()
    };
    
    let registry = create_test_registry();
    
    for height in [8, 16, 32, 64].iter() {
        let chunks = create_test_chunks(&config);
        let coords = Vec2(0, 0);
        
        let space = chunks.make_space(&coords, 1)
            .needs_voxels()
            .build();
        
        let min = Vec3(0, 0, 0);
        let max = Vec3(16, *height, 16);
        
        group.bench_with_input(
            BenchmarkId::from_parameter(format!("16x{}x16", height)),
            height,
            |b, _| {
                b.iter(|| {
                    Mesher::mesh_space(
                        black_box(&min),
                        black_box(&max),
                        black_box(&space as &dyn VoxelAccess),
                        black_box(&registry),
                    )
                })
            },
        );
    }
    
    group.finish();
}

criterion_group!(benches, bench_mesh_space, bench_mesh_space_sizes);
criterion_main!(benches);
