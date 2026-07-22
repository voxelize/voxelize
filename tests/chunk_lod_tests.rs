//! Integration tests for opt-in LOD chunk meshing: the mesher-built pyramid,
//! the LOD chunk protocol model, and — critically — the wire round-trip of
//! the new `Mesh.lod` field through the real prost encode/decode path.

use std::time::{Duration, Instant};

use voxelize::{
    decode_message, encode_message, Block, Chunk, ChunkLodConfig, ChunkOptions, Chunks,
    GeometryProtocol, MeshProtocol, Mesher, Message, MessageType, Registry, Vec2, VoxelAccess,
    WorldConfig,
};

const STONE: u32 = 1;
const GRASS: u32 = 2;

const CHUNK_SIZE: usize = 16;
const MAX_HEIGHT: usize = 64;

fn create_registry() -> Registry {
    let mut registry = Registry::new();
    registry.register_block(&Block::new("Stone").id(STONE).build());
    registry.register_block(&Block::new("Grass Block").id(GRASS).build());
    registry
}

fn create_config(chunk_lod: Option<ChunkLodConfig>, client_only_meshing: bool) -> WorldConfig {
    WorldConfig {
        chunk_size: CHUNK_SIZE,
        max_height: MAX_HEIGHT,
        max_light_level: 15,
        sub_chunks: 4,
        min_chunk: [0, 0],
        max_chunk: [0, 0],
        client_only_meshing,
        chunk_lod,
        ..Default::default()
    }
}

/// Build a single ready chunk with hilly terrain and run it through the real
/// `Mesher::process` thread pool, returning the meshed chunk.
fn mesh_terrain_chunk(config: &WorldConfig, registry: &Registry) -> Chunk {
    let mut chunks = Chunks::new(config);

    let mut chunk = Chunk::new(
        "lod-test",
        0,
        0,
        &ChunkOptions {
            size: config.chunk_size,
            max_height: config.max_height,
            sub_chunks: config.sub_chunks,
        },
    );

    for x in 0..CHUNK_SIZE as i32 {
        for z in 0..CHUNK_SIZE as i32 {
            let height = 6 + ((x * 7 + z * 13) % 9);
            for y in 0..height {
                chunk.set_voxel(x, y, z, STONE);
            }
            chunk.set_voxel(x, height, z, GRASS);
        }
    }

    chunk.calculate_max_height(registry);
    chunks.renew(chunk.clone(), false);

    let space = chunks
        .make_space(&Vec2(0, 0), config.max_light_level as usize)
        .needs_height_maps()
        .needs_voxels()
        .needs_lights()
        .build();

    let mut mesher = Mesher::new();
    mesher.add_chunk(&Vec2(0, 0), false);
    mesher.process(
        vec![(chunk, space)],
        &MessageType::Load,
        registry,
        config,
    );

    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if let Some((chunk, _)) = mesher.results().into_iter().next() {
            return chunk;
        }
        assert!(Instant::now() < deadline, "mesher did not produce a result");
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn mesher_builds_lod_pyramid_when_enabled() {
    let registry = create_registry();
    let config = create_config(Some(ChunkLodConfig { max_level: 2 }), true);

    let chunk = mesh_terrain_chunk(&config, &registry);

    assert!(
        chunk.meshes.is_none(),
        "client_only_meshing worlds still skip full meshes"
    );

    let lod_meshes = chunk
        .lod_meshes
        .as_ref()
        .expect("LOD pyramid must be built when chunk_lod is enabled");

    for level in 1..=2u32 {
        let mesh = lod_meshes
            .get(&level)
            .unwrap_or_else(|| panic!("missing LOD level {level}"));
        assert_eq!(mesh.lod, level);
        assert_eq!(mesh.level, 0, "LOD meshes span the whole column");
        assert!(
            !mesh.geometries.is_empty(),
            "terrain chunk must produce LOD geometry at level {level}"
        );

        for geometry in &mesh.geometries {
            for (index, value) in geometry.positions.iter().enumerate() {
                let axis_max = if index % 3 == 1 {
                    MAX_HEIGHT as f32
                } else {
                    CHUNK_SIZE as f32
                };
                assert!(
                    *value >= 0.0 && *value <= axis_max,
                    "LOD geometry must stay within chunk bounds in block units, \
                     got {value} on axis {}",
                    index % 3
                );
            }
        }
    }

    // Higher LOD levels must not have more geometry than lower ones.
    let vertex_count = |mesh: &MeshProtocol| -> usize {
        mesh.geometries
            .iter()
            .map(|geometry| geometry.positions.len())
            .sum()
    };
    assert!(
        vertex_count(&lod_meshes[&2]) <= vertex_count(&lod_meshes[&1]),
        "coarser LOD must not increase vertex count"
    );
}

#[test]
fn mesher_builds_no_pyramid_when_disabled() {
    let registry = create_registry();
    let config = create_config(None, true);

    let chunk = mesh_terrain_chunk(&config, &registry);

    assert!(
        chunk.lod_meshes.is_none(),
        "worlds without chunk_lod must not pay for LOD meshing"
    );
}

#[test]
fn lod_pyramid_coexists_with_server_side_meshing() {
    let registry = create_registry();
    let config = create_config(Some(ChunkLodConfig { max_level: 1 }), false);

    let chunk = mesh_terrain_chunk(&config, &registry);

    let meshes = chunk.meshes.as_ref().expect("full meshes still built");
    assert!(!meshes.is_empty());
    assert!(meshes.values().all(|mesh| mesh.lod == 0));

    let lod_meshes = chunk.lod_meshes.as_ref().expect("pyramid built");
    assert!(lod_meshes.contains_key(&1));
}

#[test]
fn to_lod_model_is_mesh_only() {
    let registry = create_registry();
    let config = create_config(Some(ChunkLodConfig { max_level: 2 }), true);

    let chunk = mesh_terrain_chunk(&config, &registry);

    let model = chunk.to_lod_model(1).expect("LOD level 1 model");
    assert_eq!(model.meshes.len(), 1);
    assert_eq!(model.meshes[0].lod, 1);
    assert!(
        model.voxels.is_none() && model.lights.is_none(),
        "LOD models must not carry chunk data"
    );

    assert!(
        chunk.to_lod_model(3).is_none(),
        "levels beyond the configured pyramid must not resolve"
    );
}

/// The regression this feature must never reintroduce: a protocol field that
/// exists in Rust but is dropped on the wire. Encode a LOAD message holding a
/// LOD mesh through the real prost path and decode it back.
#[test]
fn mesh_lod_field_survives_wire_roundtrip() {
    let registry = create_registry();
    let config = create_config(Some(ChunkLodConfig { max_level: 2 }), true);

    let chunk = mesh_terrain_chunk(&config, &registry);
    let model = chunk.to_lod_model(2).expect("LOD level 2 model");
    let sent_geometry_count = model.meshes[0].geometries.len();

    let message = Message::new(&MessageType::Load).chunks(&[model]).build();
    let encoded = encode_message(&message);

    // Large chunk messages pass through LZ4 frame compression; make sure the
    // test exercises the same framing the client sees.
    let decoded = if encoded.len() > 4096 {
        let mut decompressed = Vec::new();
        let mut decoder = lz4_flex::frame::FrameDecoder::new(&encoded[..]);
        std::io::Read::read_to_end(&mut decoder, &mut decompressed).unwrap();
        decode_message(&decompressed).unwrap()
    } else {
        decode_message(&encoded).unwrap()
    };

    assert_eq!(decoded.chunks.len(), 1);
    let mesh = &decoded.chunks[0].meshes[0];
    assert_eq!(mesh.lod, 2, "Mesh.lod must survive encode/decode");
    assert_eq!(mesh.level, 0);
    assert_eq!(mesh.geometries.len(), sent_geometry_count);
    assert!(decoded.chunks[0].voxels.is_empty());
    assert!(decoded.chunks[0].lights.is_empty());
}

#[test]
fn full_detail_meshes_report_lod_zero_on_wire() {
    let registry = create_registry();
    let config = create_config(None, false);

    let chunk = mesh_terrain_chunk(&config, &registry);
    let model = chunk.to_model(true, false, 0..4);
    assert!(!model.meshes.is_empty());

    let message = Message::new(&MessageType::Load).chunks(&[model]).build();
    let encoded = encode_message(&message);
    let decoded = if encoded.len() > 4096 {
        let mut decompressed = Vec::new();
        let mut decoder = lz4_flex::frame::FrameDecoder::new(&encoded[..]);
        std::io::Read::read_to_end(&mut decoder, &mut decompressed).unwrap();
        decode_message(&decompressed).unwrap()
    } else {
        decode_message(&encoded).unwrap()
    };

    assert!(decoded.chunks[0].meshes.iter().all(|mesh| mesh.lod == 0));
}

#[test]
#[should_panic(expected = "Invalid chunk_lod config")]
fn config_rejects_indivisible_max_height() {
    WorldConfig::new()
        .max_height(100)
        .sub_chunks(4)
        .chunk_lod(Some(ChunkLodConfig { max_level: 3 }))
        .build();
}

#[test]
#[should_panic(expected = "Invalid chunk_lod config")]
fn config_rejects_out_of_range_level() {
    WorldConfig::new()
        .chunk_lod(Some(ChunkLodConfig { max_level: 5 }))
        .build();
}

#[test]
fn config_defaults_to_disabled() {
    let config = WorldConfig::new().build();
    assert!(config.chunk_lod.is_none());
}

#[test]
fn geometry_protocol_default_has_no_lod_data() {
    // Guard against accidental Default changes leaking LOD info into
    // full-detail paths.
    let geometry = GeometryProtocol::default();
    assert!(geometry.positions.is_empty());
    let mesh = MeshProtocol::default();
    assert_eq!(mesh.lod, 0);
}
