//! The server's half of the stage-faces parity check.
//!
//! The server meshes its own `Block`s through `to_mesher_block`. A client
//! re-meshing a chunk meshes the JSON the server sent, passed through the
//! mesh worker's `convertRegistryToWasm` into the same mesher compiled to
//! wasm. If either side drops a block's stage faces, a voxel whose stage
//! picks its other look changes back to its plain one the moment its chunk
//! re-meshes locally. This writes the blocks as the client receives them, a
//! set of neighbourhoods (raw voxel words, stage bits and all), and the
//! geometry the server meshes for each to `stage-faces-parity.fixture.json`;
//! `packages/core/src/core/world/workers/stage-faces-parity.test.ts` meshes
//! the same neighbourhoods through the worker's path and must match it
//! exactly.
//!
//! `UPDATE_STAGE_FACES_PARITY=1` rewrites the fixture. Without it the
//! committed fixture must equal what the server meshes today.

use serde_json::{json, Value};

use crate::{Block, BlockFaces, BlockUtils, LightUtils, Registry};

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/packages/core/src/core/world/workers/stage-faces-parity.fixture.json"
);
const CHUNK_SIZE: usize = 16;
const MAX_HEIGHT: usize = 16;
const STONE: u32 = 1;
const CANOPY: u32 = 2;
const WALL: u32 = 3;
/// The canopy's flowering bit, and a bit beside it the mask does not name.
const FLOWERING: u32 = 0b0001;
const PLACED: u32 = 0b1000;
/// The wall's painted bit.
const PAINTED: u32 = 0b0010;

fn registry() -> Registry {
    let canopy = Block::new("Canopy")
        .id(CANOPY)
        .faces(&BlockFaces::six_faces().texture_group("leaves").build())
        .regional_tint()
        .is_transparent(true)
        .is_see_through(true)
        .transparent_standalone(true)
        .standalone_face_depth(2)
        .stage_faces(
            FLOWERING,
            &BlockFaces::six_faces().texture_group("flowers").build(),
        )
        .build();
    let wall = Block::new("Wall")
        .id(WALL)
        .faces(&BlockFaces::six_faces().texture_group("plaster").build())
        .stage_faces(
            PAINTED,
            &BlockFaces::six_faces().texture_group("paint").build(),
        )
        .build();
    let mut registry = Registry::new();
    registry.register_block(&Block::new("Stone").id(STONE).build());
    registry.register_block(&canopy);
    registry.register_block(&wall);
    registry.generate();
    registry
}

type Voxels = Vec<[u32; 4]>;

fn raw(id: u32, stage: u32) -> u32 {
    BlockUtils::insert_stage(id, stage)
}

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

/// Later voxels overwrite earlier ones at the same position.
fn scenes() -> Vec<(&'static str, Voxels)> {
    vec![
        (
            "a canopy all in leaf",
            fill((5, 4, 5), (7, 5, 7), |_, _, _| raw(CANOPY, 0)),
        ),
        (
            "a canopy all in flower",
            fill((5, 4, 5), (7, 5, 7), |_, _, _| raw(CANOPY, FLOWERING)),
        ),
        (
            "a canopy flowering in a checker",
            fill((4, 4, 4), (8, 6, 8), |x, y, z| {
                raw(CANOPY, if (x + y + z) % 2 == 0 { FLOWERING } else { 0 })
            }),
        ),
        (
            "placed canopy, one piece in flower",
            fill((5, 4, 5), (7, 4, 5), |x, _, _| {
                raw(CANOPY, if x == 6 { FLOWERING | PLACED } else { PLACED })
            }),
        ),
        (
            "a wall with its middle painted, on stone",
            [
                fill((3, 3, 6), (9, 3, 6), |_, _, _| STONE),
                fill((4, 4, 6), (8, 6, 6), |x, y, _| {
                    raw(WALL, if (x, y) == (6, 5) { PAINTED } else { 0 })
                }),
            ]
            .concat(),
        ),
        (
            "a wall bit its mask does not name",
            fill((4, 4, 6), (6, 5, 6), |_, _, _| raw(WALL, FLOWERING)),
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

/// The lowest u each geometry's quads sample, so a scene says which slot of
/// the atlas it drew from.
fn slots(geometries: &[Value]) -> Vec<f64> {
    let mut slots: Vec<f64> = geometries
        .iter()
        .flat_map(|g| {
            g["uvs"]
                .as_array()
                .expect("uvs")
                .chunks_exact(8)
                .map(|uvs| {
                    (0..4)
                        .map(|v| uvs[v * 2].as_f64().expect("u"))
                        .fold(f64::MAX, f64::min)
                })
                .collect::<Vec<_>>()
        })
        .collect();
    slots.sort_by(f64::total_cmp);
    slots.dedup_by(|a, b| (*a - *b).abs() < 1e-6);
    slots
}

#[test]
fn stage_faces_parity_fixture_is_what_the_server_meshes() {
    let registry = registry();
    let light = LightUtils::insert_sunlight(0, 15);
    let mut blocks: Vec<&Block> = registry.blocks_by_id.values().collect();
    blocks.sort_by_key(|block| block.id);
    let meshed: Vec<(&str, Voxels, Vec<Value>)> = scenes()
        .into_iter()
        .map(|(name, voxels)| {
            let geometries = mesh(&registry, &voxels, light);
            (name, voxels, geometries)
        })
        .collect();
    // The scenes draw what they say: a leafy canopy and a flowering one in
    // different slots, a checker in both, a bit the mask does not name in
    // the plain slot.
    let slots_of = |name: &str| {
        slots(
            &meshed
                .iter()
                .find(|(scene, ..)| *scene == name)
                .expect("scene")
                .2,
        )
    };
    let (leaf, flower) = (
        slots_of("a canopy all in leaf"),
        slots_of("a canopy all in flower"),
    );
    assert_eq!((leaf.len(), flower.len()), (1, 1));
    assert_ne!(leaf, flower);
    assert_eq!(slots_of("a canopy flowering in a checker").len(), 2);
    assert_eq!(slots_of("placed canopy, one piece in flower").len(), 2);
    assert_eq!(slots_of("a wall bit its mask does not name").len(), 1);
    let scenes: Vec<Value> = meshed
        .into_iter()
        .map(|(name, voxels, geometries)| {
            json!({
                "name": name,
                "voxels": voxels,
                "geometries": geometries,
            })
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
    if std::env::var_os("UPDATE_STAGE_FACES_PARITY").is_some() {
        std::fs::write(FIXTURE, &written).expect("fixture is writable");
        return;
    }
    let committed = std::fs::read_to_string(FIXTURE).unwrap_or_default();
    assert!(
        committed == written,
        "{FIXTURE} is stale: rerun with UPDATE_STAGE_FACES_PARITY=1 and commit it"
    );
}
