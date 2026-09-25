//! The server's half of the joined-glass parity check.
//!
//! The server meshes its own `Block`s through `to_mesher_block`. A client
//! re-meshing a chunk meshes the JSON the server sent, passed through the
//! mesh worker's `convertRegistryToWasm` into the same mesher compiled to
//! wasm. A field either side drops turns joined glass back into a lattice
//! the moment a chunk re-meshes locally. This writes the blocks as the client
//! receives them, a set of neighbourhoods, and the geometry the server meshes
//! for each to `connected-parity.fixture.json`;
//! `packages/core/src/core/world/workers/connected-parity.test.ts` meshes the
//! same neighbourhoods through the worker's path and must match it exactly.
//!
//! `UPDATE_CONNECTED_PARITY=1` rewrites the fixture. Without it the committed
//! fixture must equal what the server meshes today.

use serde_json::{json, Value};

use crate::{
    Block, BlockConditionalPart, BlockDynamicPattern, BlockFaces, BlockRule, BlockRuleLogic,
    BlockSimpleRule, ConnectedFrame, LightUtils, Registry, Vec3,
};

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/packages/core/src/core/world/workers/connected-parity.fixture.json"
);
const CHUNK_SIZE: usize = 16;
const MAX_HEIGHT: usize = 16;
const STONE: u32 = 1;
const GLASS: u32 = 2;
const CLEAR: u32 = 3;
const PANE: u32 = 4;

/// Clear Glass reflects its joined borders and has no corner shading; the
/// others leave joined borders undrawn, carry their frame past a shaded
/// corner and keep one joined interior in three, so every path crosses the
/// wire.
fn frame(key: u32) -> ConnectedFrame {
    ConnectedFrame {
        key,
        frame_texels: 1,
        corner_texels: if key == CLEAR { 0 } else { 4 },
        texels_per_block: 16,
        clear_interior: key != CLEAR,
        interior_one_in: if key == CLEAR { 0 } else { 3 },
    }
}

fn is(offset: Vec3<i32>, id: u32) -> BlockRule {
    BlockRule::Simple(BlockSimpleRule {
        offset,
        id: Some(id),
        rotation: None,
        stage: None,
    })
}

fn not(rule: BlockRule) -> BlockRule {
    BlockRule::Combination {
        logic: BlockRuleLogic::Not,
        rules: vec![rule],
    }
}

/// A pane joins another pane, or anything but air and full glass.
fn joins(offset: Vec3<i32>) -> BlockRule {
    BlockRule::Combination {
        logic: BlockRuleLogic::Or,
        rules: vec![
            is(offset.clone(), PANE),
            BlockRule::Combination {
                logic: BlockRuleLogic::And,
                rules: vec![not(is(offset.clone(), 0)), not(is(offset, GLASS))],
            },
        ],
    }
}

fn part_faces(prefix: &str, scale: [f32; 3], offset: [f32; 3]) -> BlockFaces {
    BlockFaces::six_faces()
        .scale_x(scale[0])
        .scale_y(scale[1])
        .scale_z(scale[2])
        .offset_x(offset[0])
        .offset_y(offset[1])
        .offset_z(offset[2])
        .prefix(prefix)
        .concat("-")
        .auto_uv_offset(true)
        .texture_group("pane")
        .build()
}

/// A two-texel pane: a flat slab through a straight run, otherwise a post
/// with an arm toward each neighbour it joins.
fn pane() -> Block {
    let (inset, thick) = (7.0 / 16.0, 2.0 / 16.0);
    let px = || joins(Vec3(1, 0, 0));
    let nx = || joins(Vec3(-1, 0, 0));
    let pz = || joins(Vec3(0, 0, 1));
    let nz = || joins(Vec3(0, 0, -1));
    let straight =
        |a: BlockRule, b: BlockRule, c: BlockRule, d: BlockRule| BlockRule::Combination {
            logic: BlockRuleLogic::And,
            rules: vec![a, b, not(c), not(d)],
        };
    let parts = [
        (
            straight(px(), nx(), pz(), nz()),
            part_faces("flat-x", [1.0, 1.0, thick], [0.0, 0.0, inset]),
            0,
        ),
        (
            straight(pz(), nz(), px(), nx()),
            part_faces("flat-z", [thick, 1.0, 1.0], [inset, 0.0, 0.0]),
            1,
        ),
        (
            BlockRule::None,
            part_faces("post", [thick, 1.0, thick], [inset, 0.0, inset]),
            2,
        ),
        (
            px(),
            part_faces("arm-px", [inset, 1.0, thick], [inset + thick, 0.0, inset]),
            2,
        ),
        (
            nx(),
            part_faces("arm-nx", [inset, 1.0, thick], [0.0, 0.0, inset]),
            2,
        ),
        (
            pz(),
            part_faces("arm-pz", [thick, 1.0, inset], [inset, 0.0, inset + thick]),
            2,
        ),
        (
            nz(),
            part_faces("arm-nz", [thick, 1.0, inset], [inset, 0.0, 0.0]),
            2,
        ),
    ];
    let mut patterns: Vec<BlockDynamicPattern> = (0..3)
        .map(|_| BlockDynamicPattern { parts: vec![] })
        .collect();
    let mut all_faces = BlockFaces::empty();
    for (rule, faces, pattern) in parts {
        all_faces = all_faces.join(BlockFaces::from_faces(faces.to_vec()));
        patterns[pattern].parts.push(BlockConditionalPart {
            rule,
            faces: faces.to_vec(),
            is_transparent: [true; 6],
            ..Default::default()
        });
    }
    Block::new("Pane")
        .id(PANE)
        .faces(&all_faces)
        .dynamic_patterns(&patterns)
        .is_transparent(true)
        .is_see_through(true)
        .transparent_standalone(true)
        .connected_frame(frame(PANE))
        .build()
}

fn registry() -> Registry {
    let glass = |name: &str, id: u32| {
        Block::new(name)
            .id(id)
            .is_transparent(true)
            .is_see_through(true)
            .connected_frame(frame(id))
            .build()
    };
    let mut registry = Registry::new();
    registry.register_block(&Block::new("Stone").id(STONE).build());
    registry.register_block(&glass("Glass", GLASS));
    registry.register_block(&glass("Clear Glass", CLEAR));
    registry.register_block(&pane());
    registry.generate();
    registry
}

type Voxels = Vec<[u32; 4]>;

fn cells(points: &[(u32, u32, u32)], id: u32) -> Voxels {
    points.iter().map(|&(x, y, z)| [x, y, z, id]).collect()
}

fn fill(from: (u32, u32, u32), to: (u32, u32, u32), id: u32) -> Voxels {
    let mut voxels = vec![];
    for x in from.0..=to.0 {
        for y in from.1..=to.1 {
            for z in from.2..=to.2 {
                voxels.push([x, y, z, id]);
            }
        }
    }
    voxels
}

/// Later voxels overwrite earlier ones at the same position.
fn scenes() -> Vec<(&'static str, Voxels)> {
    vec![
        ("a lone glass block", cells(&[(6, 4, 6)], GLASS)),
        ("a 2x2 glass window", fill((5, 4, 6), (6, 5, 6), GLASS)),
        (
            "a glass L beside clear glass",
            [
                cells(&[(5, 4, 6), (6, 4, 6), (5, 5, 6)], GLASS),
                cells(&[(7, 4, 6)], CLEAR),
            ]
            .concat(),
        ),
        (
            "glass meeting glass at a crease",
            cells(&[(5, 4, 6), (6, 4, 6), (6, 4, 7)], GLASS),
        ),
        ("a 3x2 pane wall", fill((5, 4, 6), (7, 5, 6), PANE)),
        (
            "two pane walls meeting at a corner",
            cells(&[(5, 4, 6), (6, 4, 6), (5, 4, 7)], PANE),
        ),
        (
            "a pane T junction",
            cells(&[(5, 4, 6), (6, 4, 6), (4, 4, 6), (5, 4, 7)], PANE),
        ),
        (
            "panes in a stone wall",
            [
                fill((4, 3, 6), (7, 6, 6), STONE),
                fill((5, 4, 6), (6, 5, 6), PANE),
            ]
            .concat(),
        ),
    ]
}

fn mesh(registry: &Registry, voxels: &Voxels, light: u32) -> Vec<Value> {
    let mut data = vec![0u32; CHUNK_SIZE * MAX_HEIGHT * CHUNK_SIZE];
    for &[x, y, z, id] in voxels {
        data[x as usize * MAX_HEIGHT * CHUNK_SIZE + y as usize * CHUNK_SIZE + z as usize] = id;
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
fn connected_parity_fixture_is_what_the_server_meshes() {
    let registry = registry();
    let light = LightUtils::insert_sunlight(0, 15);
    let mut blocks: Vec<&Block> = registry.blocks_by_id.values().collect();
    blocks.sort_by_key(|block| block.id);
    let scenes: Vec<Value> = scenes()
        .into_iter()
        .map(|(name, voxels)| {
            json!({
                "name": name,
                "voxels": voxels,
                "geometries": mesh(&registry, &voxels, light),
            })
        })
        .collect();
    assert!(
        scenes
            .iter()
            .all(|s| s["geometries"].as_array().is_some_and(|g| !g.is_empty())),
        "every neighbourhood meshes something"
    );
    let fixture = json!({
        "chunkSize": CHUNK_SIZE,
        "maxHeight": MAX_HEIGHT,
        "light": light,
        "blocks": blocks,
        "scenes": scenes,
    });
    let written = serde_json::to_string(&fixture).expect("fixture serializes") + "\n";
    if std::env::var_os("UPDATE_CONNECTED_PARITY").is_some() {
        std::fs::write(FIXTURE, &written).expect("fixture is writable");
        return;
    }
    let committed = std::fs::read_to_string(FIXTURE).unwrap_or_default();
    assert!(
        committed == written,
        "{FIXTURE} is stale: rerun with UPDATE_CONNECTED_PARITY=1 and commit it"
    );
}
