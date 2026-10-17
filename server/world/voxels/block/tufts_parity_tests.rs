//! The server's half of the tufts parity check.
//!
//! A client re-meshing a chunk meshes the JSON the server sent, passed
//! through the mesh worker's `convertRegistryToWasm` into the same mesher
//! compiled to wasm. If either side drops a block's tufts, a canopy loses its
//! soft outline the moment its chunk re-meshes locally (a leaf placed, a leaf
//! broken). This writes the blocks as the client receives them, a set of
//! neighbourhoods and the geometry the server meshes for each to
//! `tufts-parity.fixture.json`; `packages/core/src/core/world/workers/
//! tufts-parity.test.ts` meshes the same neighbourhoods through the worker's
//! path and must match it exactly.
//!
//! `UPDATE_TUFTS_PARITY=1` rewrites the fixture. Without it the committed
//! fixture must equal what the server meshes today.

use serde_json::{json, Value};

use crate::{Block, BlockFace, BlockFaces, BlockUtils, CornerData, LightUtils, Registry};

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/packages/core/src/core/world/workers/tufts-parity.fixture.json"
);
const CHUNK_SIZE: usize = 16;
const MAX_HEIGHT: usize = 16;
const CANOPY: u32 = 2;
const FLOWERING: u32 = 0b0001;

fn tuft(group: &str) -> Vec<BlockFace> {
    let corner = |pos: [f32; 3], uv: [f32; 2]| CornerData { pos, uv };
    let mut face = BlockFace::new(
        "tuft".to_string(),
        false,
        false,
        [0, 0, 0],
        [
            corner([-0.2, 1.2, 0.5], [0.0, 1.0]),
            corner([-0.2, -0.2, 0.5], [0.0, 0.0]),
            corner([1.2, 1.2, 0.5], [1.0, 1.0]),
            corner([1.2, -0.2, 0.5], [1.0, 0.0]),
        ],
    );
    face.set_texture_group(group);
    vec![face]
}

fn registry() -> Registry {
    let canopy = Block::new("Canopy")
        .id(CANOPY)
        .faces(&BlockFaces::six_faces().texture_group("leaves").build())
        .tufts(&tuft("leaves_tuft"), 0.12, 0.6)
        .regional_tint()
        .is_transparent(true)
        .is_see_through(true)
        .transparent_standalone(true)
        .standalone_face_depth(2)
        .stage_faces(
            FLOWERING,
            &BlockFaces::six_faces().texture_group("flowers").build(),
        )
        .stage_tufts(&tuft("flowers_tuft"))
        .build();
    let mut registry = Registry::new();
    registry.register_block(&canopy);
    registry.generate();
    registry
}

type Voxels = Vec<[u32; 4]>;

fn fill(from: (u32, u32, u32), to: (u32, u32, u32), word: impl Fn(u32, u32, u32) -> u32) -> Voxels {
    let mut voxels = vec![];
    for x in from.0..=to.0 {
        for y in from.1..=to.1 {
            for z in from.2..=to.2 {
                voxels.push([x, y, z, word(x, y, z)]);
            }
        }
    }
    voxels
}

fn scenes() -> Vec<(&'static str, Voxels)> {
    vec![
        ("a lone leaf", fill((7, 7, 7), (7, 7, 7), |_, _, _| CANOPY)),
        (
            "a solid crown, its heart buried",
            fill((5, 5, 5), (9, 9, 9), |_, _, _| CANOPY),
        ),
        (
            "a crown in flower in a checker",
            fill((4, 4, 4), (6, 6, 6), |x, y, z| {
                BlockUtils::insert_stage(CANOPY, if (x + y + z) % 2 == 0 { FLOWERING } else { 0 })
            }),
        ),
    ]
}

fn mesh(registry: &Registry, voxels: &Voxels, light: u32) -> Vec<Value> {
    let mut data = vec![0u32; CHUNK_SIZE * MAX_HEIGHT * CHUNK_SIZE];
    for &[x, y, z, word] in voxels {
        data[x as usize * MAX_HEIGHT * CHUNK_SIZE + y as usize * CHUNK_SIZE + z as usize] = word;
    }
    let center = voxelize_mesher::ChunkData {
        voxels: data,
        lights: vec![light; CHUNK_SIZE * MAX_HEIGHT * CHUNK_SIZE],
        shape: [CHUNK_SIZE, MAX_HEIGHT, CHUNK_SIZE],
        min: [0, 0, 0],
    };
    let mut chunks: Vec<Option<voxelize_mesher::ChunkData>> = (0..9).map(|_| None).collect();
    chunks[4] = Some(center);
    let mut mesher_registry = registry.to_mesher_registry();
    mesher_registry.build_cache();
    let output = voxelize_mesher::mesh_chunk_with_registry_chunks(
        &chunks,
        [0, 0, 0],
        [CHUNK_SIZE as i32, MAX_HEIGHT as i32, CHUNK_SIZE as i32],
        voxelize_mesher::MeshConfig {
            chunk_size: CHUNK_SIZE as i32,
        },
        &mesher_registry,
    );
    let mut geometries: Vec<Value> = output
        .geometries
        .iter()
        .map(|g| serde_json::to_value(g).expect("geometry serializes"))
        .collect();
    geometries.sort_by_key(|g| (g["voxel"].as_u64(), g["faceName"].to_string()));
    geometries
}

#[test]
fn tufts_parity_fixture_is_what_the_server_meshes() {
    let registry = registry();
    let light = LightUtils::insert_sunlight(0, 15);
    let mut blocks: Vec<&Block> = registry.blocks_by_id.values().collect();
    blocks.sort_by_key(|block| block.id);
    let scenes: Vec<Value> = scenes()
        .into_iter()
        .map(|(name, voxels)| {
            let geometries = mesh(&registry, &voxels, light);
            // Every scene lays its tufts apart from its cube.
            assert!(
                geometries
                    .iter()
                    .any(|g| g["faceName"] == voxelize_mesher::TUFTS_FACE_NAME),
                "{name} lays no tufts"
            );
            json!({ "name": name, "voxels": voxels, "geometries": geometries })
        })
        .collect();
    let fixture = json!({
        "chunkSize": CHUNK_SIZE,
        "maxHeight": MAX_HEIGHT,
        "light": light,
        "blocks": blocks,
        "scenes": scenes,
    });
    let written = serde_json::to_string(&fixture).expect("fixture serializes") + "\n";
    if std::env::var_os("UPDATE_TUFTS_PARITY").is_some() {
        std::fs::write(FIXTURE, &written).expect("fixture is writable");
        return;
    }
    let committed = std::fs::read_to_string(FIXTURE).unwrap_or_default();
    assert!(
        committed == written,
        "{FIXTURE} is stale: rerun with UPDATE_TUFTS_PARITY=1 and commit it"
    );
}
