use criterion::{black_box, criterion_group, criterion_main, Criterion};
use voxelize::{
    Block, Chunk, ChunkOptions, Chunks, LightColor, Lights, LightNode, Registry, Vec2, Vec3, WorldConfig,
};

fn create_test_registry() -> Registry {
    let mut registry = Registry::new();
    
    registry.register_block(&Block::new("stone")
        .id(1)
        .build());
    
    registry.register_block(&Block::new("torch")
        .id(2)
        .is_passable(true)
        .red_light_level(14)
        .build());
    
    registry
}

fn bench_light_propagation(c: &mut Criterion) {
    let config = WorldConfig {
        chunk_size: 16,
        max_height: 256,
        max_light_level: 15,
        sub_chunks: 8,
        min_chunk: [0, 0],
        max_chunk: [0, 0],
        ..Default::default()
    };
    
    let registry = create_test_registry();
    
    c.bench_function("propagate_sunlight_16x64x16", |b| {
        b.iter(|| {
            let mut chunks = Chunks::new(&config);
            let coords = Vec2(0, 0);
            
            let chunk_opts = ChunkOptions {
                size: config.chunk_size,
                max_height: config.max_height,
                sub_chunks: config.sub_chunks,
            };
            let chunk = Chunk::new("test", coords.0, coords.1, &chunk_opts);
            chunks.add(chunk);
            
            let mut space = chunks.make_space(&coords, 1)
                .needs_voxels()
                .needs_lights()
                .build();
            
            let min = Vec3(0, 0, 0);
            let shape = Vec3(16, 64, 16);
            
            Lights::propagate(
                black_box(&mut space),
                black_box(&min),
                black_box(&shape),
                black_box(&registry),
                black_box(&config),
            )
        })
    });
}

fn bench_flood_light(c: &mut Criterion) {
    let config = WorldConfig {
        chunk_size: 16,
        max_height: 256,
        max_light_level: 15,
        sub_chunks: 8,
        min_chunk: [0, 0],
        max_chunk: [0, 0],
        ..Default::default()
    };
    
    let registry = create_test_registry();
    
    c.bench_function("flood_sunlight_16x64x16", |b| {
        b.iter(|| {
            let mut chunks = Chunks::new(&config);
            let coords = Vec2(0, 0);
            
            let chunk_opts = ChunkOptions {
                size: config.chunk_size,
                max_height: config.max_height,
                sub_chunks: config.sub_chunks,
            };
            let chunk = Chunk::new("test", coords.0, coords.1, &chunk_opts);
            chunks.add(chunk);
            
            let mut space = chunks.make_space(&coords, 1)
                .needs_voxels()
                .needs_lights()
                .build();
            
            let min = Vec3(0, 0, 0);
            let shape = Vec3(16, 64, 16);
            
            let mut queue = Vec::new();
            for x in 0..16 {
                for z in 0..16 {
                    queue.push(LightNode {
                        voxel: [x, 32, z],
                        level: 15,
                    });
                }
            }
            
            Lights::flood_light(
                black_box(&mut space),
                black_box(queue),
                black_box(&LightColor::Sunlight),
                black_box(&registry),
                black_box(&config),
                Some(black_box(&min)),
                Some(black_box(&shape)),
            );
        })
    });
}

criterion_group!(benches, bench_light_propagation, bench_flood_light);
criterion_main!(benches);
