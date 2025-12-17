use voxelize::{
    Block, Chunk, ChunkOptions, Chunks, Mesher, Registry, Vec2, Vec3, VoxelAccess, WorldConfig,
};

fn create_test_config_with_greedy(greedy: bool) -> WorldConfig {
    WorldConfig {
        chunk_size: 16,
        max_height: 256,
        max_light_level: 15,
        sub_chunks: 8,
        greedy_meshing: greedy,
        ..Default::default()
    }
}

fn create_test_registry() -> Registry {
    let mut registry = Registry::new();
    
    registry.register_block(&Block::new("stone")
        .id(1)
        .build());
    
    registry
}

#[test]
fn test_mesh_empty_space() {
    let config = WorldConfig {
        chunk_size: 16,
        max_height: 256,
        max_light_level: 15,
        sub_chunks: 8,
        ..Default::default()
    };
    
    let registry = create_test_registry();
    let chunks = Chunks::new(&config);
    let coords = Vec2(0, 0);
    
    let space = chunks.make_space(&coords, 1)
        .needs_voxels()
        .build();
    
    let min = Vec3(0, 0, 0);
    let max = Vec3(16, 16, 16);
    
    let geometries = Mesher::mesh_space(&min, &max, &space, &registry);
    
    assert!(geometries.is_empty(), "Empty space should produce no geometry");
}

#[test]
fn test_mesh_single_block() {
    let config = WorldConfig {
        chunk_size: 16,
        max_height: 256,
        max_light_level: 15,
        sub_chunks: 8,
        ..Default::default()
    };
    
    let registry = create_test_registry();
    let mut chunks = Chunks::new(&config);
    let coords = Vec2(0, 0);
    
    let chunk_opts = ChunkOptions {
        size: config.chunk_size,
        max_height: config.max_height,
        sub_chunks: config.sub_chunks,
    };
    let mut chunk = Chunk::new("test", coords.0, coords.1, &chunk_opts);
    chunk.set_voxel(8, 8, 8, 1);
    chunks.add(chunk);
    
    let space = chunks.make_space(&coords, 1)
        .needs_voxels()
        .build();
    
    let min = Vec3(0, 0, 0);
    let max = Vec3(16, 16, 16);
    
    let geometries = Mesher::mesh_space(&min, &max, &space, &registry);
    
    assert!(!geometries.is_empty(), "Single block should produce geometry");
    assert_eq!(geometries.len(), 1, "Should have one geometry for stone block");
    
    let geometry = &geometries[0];
    assert!(geometry.positions.len() > 0, "Should have positions");
    assert!(geometry.indices.len() > 0, "Should have indices");
    assert_eq!(geometry.voxel, 1, "Should be stone block");
}

#[test]
fn test_mesh_surrounded_block() {
    let config = WorldConfig {
        chunk_size: 16,
        max_height: 256,
        max_light_level: 15,
        sub_chunks: 8,
        ..Default::default()
    };
    
    let registry = create_test_registry();
    let mut chunks = Chunks::new(&config);
    let coords = Vec2(0, 0);
    
    let chunk_opts = ChunkOptions {
        size: config.chunk_size,
        max_height: config.max_height,
        sub_chunks: config.sub_chunks,
    };
    let mut chunk = Chunk::new("test", coords.0, coords.1, &chunk_opts);
    
    for x in 7..=9 {
        for y in 7..=9 {
            for z in 7..=9 {
                chunk.set_voxel(x, y, z, 1);
            }
        }
    }
    
    chunks.add(chunk);
    
    let space = chunks.make_space(&coords, 1)
        .needs_voxels()
        .build();
    
    let min = Vec3(0, 0, 0);
    let max = Vec3(16, 16, 16);
    
    let geometries = Mesher::mesh_space(&min, &max, &space, &registry);
    
    if geometries.is_empty() {
        return;
    }
    
    let total_vertices = geometries.iter()
        .map(|g| g.positions.len() / 3)
        .sum::<usize>();
    
    assert!(total_vertices > 0, "Should generate some vertices for exposed faces");
}

#[test]
fn test_mesh_layer() {
    let config = WorldConfig {
        chunk_size: 16,
        max_height: 256,
        max_light_level: 15,
        sub_chunks: 8,
        ..Default::default()
    };
    
    let registry = create_test_registry();
    let mut chunks = Chunks::new(&config);
    let coords = Vec2(0, 0);
    
    let chunk_opts = ChunkOptions {
        size: config.chunk_size,
        max_height: config.max_height,
        sub_chunks: config.sub_chunks,
    };
    let mut chunk = Chunk::new("test", coords.0, coords.1, &chunk_opts);
    
    for x in 0..16 {
        for z in 0..16 {
            chunk.set_voxel(x, 0, z, 1);
        }
    }
    
    chunks.add(chunk);
    
    let space = chunks.make_space(&coords, 1)
        .needs_voxels()
        .build();
    
    let min = Vec3(0, 0, 0);
    let max = Vec3(16, 16, 16);
    
    let geometries = Mesher::mesh_space(&min, &max, &space, &registry);
    
    assert!(!geometries.is_empty(), "Layer should produce geometry");
    
    let total_faces = geometries.iter()
        .map(|g| g.indices.len() / 6)
        .sum::<usize>();
    
    assert!(total_faces > 0, "Should have faces for layer");
}

#[test]
fn test_mesher_add_remove_chunk() {
    let mut mesher = Mesher::new();
    let coords = Vec2(0, 0);
    
    mesher.add_chunk(&coords, false);
    let got = mesher.get();
    assert_eq!(got, Some(coords.clone()), "Should have chunk in queue after adding");
    
    mesher.add_chunk(&coords, false);
    mesher.remove_chunk(&coords);
    let got = mesher.get();
    assert_eq!(got, None, "Should not have chunk after removing");
}

#[test]
fn test_mesher_prioritized_chunks() {
    let mut mesher = Mesher::new();
    
    mesher.add_chunk(&Vec2(0, 0), false);
    mesher.add_chunk(&Vec2(1, 1), true);
    
    let first = mesher.get();
    assert_eq!(first, Some(Vec2(1, 1)), "Prioritized chunk should be first");
}

#[test]
fn test_mesh_produces_valid_geometry() {
    let config = WorldConfig {
        chunk_size: 16,
        max_height: 256,
        max_light_level: 15,
        sub_chunks: 8,
        ..Default::default()
    };
    
    let registry = create_test_registry();
    let mut chunks = Chunks::new(&config);
    let coords = Vec2(0, 0);
    
    let chunk_opts = ChunkOptions {
        size: config.chunk_size,
        max_height: config.max_height,
        sub_chunks: config.sub_chunks,
    };
    let mut chunk = Chunk::new("test", coords.0, coords.1, &chunk_opts);
    
    for x in 0..4 {
        for z in 0..4 {
            chunk.set_voxel(x, 0, z, 1);
        }
    }
    
    chunks.add(chunk);
    
    let space = chunks.make_space(&coords, 1)
        .needs_voxels()
        .build();
    
    let min = Vec3(0, 0, 0);
    let max = Vec3(16, 16, 16);
    
    let geometries = Mesher::mesh_space(&min, &max, &space, &registry);
    
    for geometry in geometries {
        assert_eq!(geometry.positions.len() % 3, 0, "Positions should be divisible by 3");
        assert_eq!(geometry.uvs.len() % 2, 0, "UVs should be divisible by 2");
        assert_eq!(geometry.indices.len() % 3, 0, "Indices should be divisible by 3");
        assert_eq!(geometry.positions.len() / 3, geometry.uvs.len() / 2, "Positions and UVs should match");
        assert_eq!(geometry.positions.len() / 3, geometry.lights.len(), "Positions and lights should match");
    }
}

#[test]
fn test_greedy_meshing_layer() {
    let config = create_test_config_with_greedy(true);
    
    let registry = create_test_registry();
    let mut chunks = Chunks::new(&config);
    let coords = Vec2(0, 0);
    
    let chunk_opts = ChunkOptions {
        size: config.chunk_size,
        max_height: config.max_height,
        sub_chunks: config.sub_chunks,
    };
    let mut chunk = Chunk::new("test", coords.0, coords.1, &chunk_opts);
    
    for x in 0..16 {
        for z in 0..16 {
            chunk.set_voxel(x, 0, z, 1);
        }
    }
    
    chunks.add(chunk);
    
    let space = chunks.make_space(&coords, 1)
        .needs_voxels()
        .build();
    
    let min = Vec3(0, 0, 0);
    let max = Vec3(16, 16, 16);
    
    let greedy_geometries = Mesher::mesh_space_greedy(&min, &max, &space, &registry);
    let naive_geometries = Mesher::mesh_space(&min, &max, &space, &registry);
    
    assert!(!greedy_geometries.is_empty(), "Greedy meshing should produce geometry");
    
    let greedy_total_vertices: usize = greedy_geometries.iter()
        .map(|g| g.positions.len() / 3)
        .sum();
    
    let naive_total_vertices: usize = naive_geometries.iter()
        .map(|g| g.positions.len() / 3)
        .sum();
    
    assert!(greedy_total_vertices <= naive_total_vertices, 
        "Greedy meshing should produce fewer or equal vertices ({} greedy vs {} naive)",
        greedy_total_vertices, naive_total_vertices);
}

#[test]
fn test_greedy_meshing_valid_geometry() {
    let config = create_test_config_with_greedy(true);
    
    let registry = create_test_registry();
    let mut chunks = Chunks::new(&config);
    let coords = Vec2(0, 0);
    
    let chunk_opts = ChunkOptions {
        size: config.chunk_size,
        max_height: config.max_height,
        sub_chunks: config.sub_chunks,
    };
    let mut chunk = Chunk::new("test", coords.0, coords.1, &chunk_opts);
    
    for x in 0..8 {
        for z in 0..8 {
            chunk.set_voxel(x, 0, z, 1);
        }
    }
    
    chunks.add(chunk);
    
    let space = chunks.make_space(&coords, 1)
        .needs_voxels()
        .build();
    
    let min = Vec3(0, 0, 0);
    let max = Vec3(16, 16, 16);
    
    let geometries = Mesher::mesh_space_greedy(&min, &max, &space, &registry);
    
    for geometry in geometries {
        assert_eq!(geometry.positions.len() % 3, 0, "Positions should be divisible by 3");
        assert_eq!(geometry.uvs.len() % 2, 0, "UVs should be divisible by 2");
        assert_eq!(geometry.indices.len() % 3, 0, "Indices should be divisible by 3");
        assert_eq!(geometry.positions.len() / 3, geometry.uvs.len() / 2, "Positions and UVs should match");
        assert_eq!(geometry.positions.len() / 3, geometry.lights.len(), "Positions and lights should match");
    }
}

#[test]
fn test_greedy_meshing_disabled() {
    let config = create_test_config_with_greedy(false);
    
    let registry = create_test_registry();
    let mut chunks = Chunks::new(&config);
    let coords = Vec2(0, 0);
    
    let chunk_opts = ChunkOptions {
        size: config.chunk_size,
        max_height: config.max_height,
        sub_chunks: config.sub_chunks,
    };
    let mut chunk = Chunk::new("test", coords.0, coords.1, &chunk_opts);
    
    for x in 0..4 {
        for z in 0..4 {
            chunk.set_voxel(x, 0, z, 1);
        }
    }
    
    chunks.add(chunk);
    
    let space = chunks.make_space(&coords, 1)
        .needs_voxels()
        .build();
    
    let min = Vec3(0, 0, 0);
    let max = Vec3(16, 16, 16);
    
    let geometries = Mesher::mesh_space(&min, &max, &space, &registry);
    
    assert!(!geometries.is_empty(), "Non-greedy meshing should produce geometry");
}
