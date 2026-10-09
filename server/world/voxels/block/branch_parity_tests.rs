//! The server's half of the branch parity check.
//!
//! The server meshes its own `Block`s through `to_mesher_block` and collides
//! against `Block::get_aabbs`. A client re-meshing a chunk meshes the JSON the
//! server sent, passed through the mesh worker's `convertRegistryToWasm` into
//! the same mesher compiled to wasm, and collides and picks against
//! `branchAABBs` in `packages/core/src/core/world/branch.ts`. A field either
//! side drops draws a branch as its plain texture cube the moment a chunk
//! re-meshes locally; a layout the two disagree on lets a player stand on air
//! or walk through a limb. This writes the blocks as the client receives
//! them, a set of neighbourhoods, the geometry the server meshes and the boxes
//! the server collides with to `branch-parity.fixture.json`;
//! `packages/core/src/core/world/workers/branch-parity.test.ts` must match
//! both exactly.
//!
//! `UPDATE_BRANCH_PARITY=1` rewrites the fixture. Without it the committed
//! fixture must equal what the server computes today.

use serde_json::{json, Value};
use std::collections::HashMap;

use crate::{
    Block, BlockFaces, BranchKind, BranchSeat, BranchShape, BranchSocket, LightUtils, Registry,
    Vec3, VoxelAccess, WideBranchBits, WideBranchSection,
};

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/packages/core/src/core/world/workers/branch-parity.fixture.json"
);
const CHUNK_SIZE: usize = 16;
const MAX_HEIGHT: usize = 16;
const KEY: u32 = 3;
const STONE: u32 = 1;
const SOIL: u32 = 2;
const LIMB: u32 = 3;
const ROOT: u32 = 4;
const LEAF: u32 = 5;
const TRUNK: u32 = 6;
const FIN: u32 = 7;
const SHELL: u32 = 8;
const INNER: u32 = 9;

fn shape(seat: BranchSeat, kind: BranchKind) -> BranchShape {
    BranchShape {
        key: KEY,
        seat,
        kind,
        texels_per_block: 16,
        radius_mask: if kind == BranchKind::Core { 0 } else { 0b0111 },
        side_face: "px".into(),
        end_face: "py".into(),
    }
}

fn wood(name: &str, id: u32, seat: BranchSeat, kind: BranchKind) -> Block {
    let mut faces = BlockFaces::six_faces().texture_group("bark").build();
    for face in faces.iter_mut() {
        if face.name == "py" || face.name == "ny" {
            face.texture_group = Some("rings".into());
        }
    }
    Block::new(name)
        .id(id)
        .faces(&faces)
        .branch(shape(seat, kind))
        .is_transparent(true)
        .build()
}

fn shell(name: &str, id: u32, opaque: bool) -> Block {
    Block::new(name)
        .id(id)
        .faces(&BlockFaces::six_faces().texture_group("bark").build())
        .branch_shell()
        .is_transparent(!opaque)
        .build()
}

fn registry() -> Registry {
    let mut registry = Registry::new();
    registry.register_block(&Block::new("Stone").id(STONE).build());
    registry.register_block(
        &Block::new("Soil")
            .id(SOIL)
            .faces(&BlockFaces::six_faces().texture_group("soil").build())
            .regional_tint()
            .branch_socket(BranchSocket {
                key: KEY,
                max_radius: 8,
            })
            .build(),
    );
    registry.register_block(&wood("Limb", LIMB, BranchSeat::Centre, BranchKind::Voxel));
    registry.register_block(&wood("Root", ROOT, BranchSeat::Floor, BranchKind::Voxel));
    registry.register_block(&wood("Trunk", TRUNK, BranchSeat::Centre, BranchKind::Core));
    registry.register_block(&wood("Fin", FIN, BranchSeat::Floor, BranchKind::Fin));
    registry.register_block(&shell("Shell", SHELL, false));
    registry.register_block(&shell("Inner", INNER, true));
    registry.register_block(
        &Block::new("Leaf")
            .id(LEAF)
            .faces(&BlockFaces::six_faces().texture_group("leaf").build())
            .regional_tint()
            .is_transparent(true)
            .is_see_through(true)
            .transparent_standalone(true)
            .standalone_face_depth(2)
            .branch_socket(BranchSocket {
                key: KEY,
                max_radius: 1,
            })
            .build(),
    );
    registry.generate();
    registry
}

/// A voxel word: an id, with a radius for the branch-shaped ones.
fn voxel(id: u32, radius: u32) -> u32 {
    if radius == 0 {
        id
    } else {
        id | ((radius - 1) << 24)
    }
}

type Voxels = Vec<[u32; 4]>;

/// A fin `height` texels tall.
fn fin(radius: u32, height: u32) -> u32 {
    WideBranchBits::with_size(voxel(FIN, radius), height)
}

/// One level of a wide section around a core at `x, y, z`: the core holding
/// `radius` (cut or not), a shell pointing at it in every other cell the
/// tube reaches, opaque where the tube fills the cell.
fn level(x: u32, y: u32, z: u32, radius: u32, cut: bool) -> Voxels {
    let section = WideBranchSection {
        radius,
        texels_per_block: 16,
    };
    let reach = section.reach();
    let mut cells = Vec::new();
    for dx in -reach..=reach {
        for dz in -reach..=reach {
            let (cx, cz) = ((x as i32 + dx) as u32, (z as i32 + dz) as u32);
            let word = if (dx, dz) == (0, 0) {
                WideBranchBits::with_cut(WideBranchBits::with_size(TRUNK, radius), cut)
            } else {
                let id = if section.cell_area(dx, dz) == 256 {
                    INNER
                } else {
                    SHELL
                };
                WideBranchBits::with_shell_offset(id, -dx, -dz)
            };
            cells.push([cx, y, cz, word]);
        }
    }
    cells
}

/// Later voxels overwrite earlier ones at the same position.
fn scenes() -> Vec<(&'static str, Voxels)> {
    let column = |x: u32, z: u32, radii: &[u32], from: u32| -> Voxels {
        radii
            .iter()
            .enumerate()
            .map(|(i, &r)| [x, from + i as u32, z, voxel(LIMB, r)])
            .collect()
    };
    vec![
        (
            "a trunk tapering from soil into a twig inside a leaf",
            [
                vec![[6, 2, 6, SOIL]],
                column(6, 6, &[8, 7, 5, 3, 2, 1], 3),
                vec![[6, 9, 6, LEAF], [7, 8, 6, LEAF], [5, 8, 6, LEAF]],
            ]
            .concat(),
        ),
        (
            "a limb stepping out and up from a trunk",
            [
                column(6, 6, &[6, 6, 5, 5], 3),
                vec![
                    [7, 4, 6, voxel(LIMB, 4)],
                    [8, 4, 6, voxel(LIMB, 3)],
                    [8, 5, 6, voxel(LIMB, 3)],
                    [9, 5, 6, voxel(LIMB, 2)],
                    [9, 5, 7, voxel(LIMB, 1)],
                ],
            ]
            .concat(),
        ),
        (
            "roots flaring from a trunk base on soil",
            [
                vec![[6, 2, 6, SOIL], [6, 3, 6, voxel(LIMB, 5)]],
                vec![
                    [7, 3, 6, voxel(ROOT, 4)],
                    [8, 3, 6, voxel(ROOT, 2)],
                    [5, 3, 6, voxel(ROOT, 6)],
                    [6, 3, 7, voxel(ROOT, 3)],
                    [6, 3, 8, voxel(ROOT, 1)],
                ],
                vec![[6, 4, 6, voxel(LIMB, 5)]],
            ]
            .concat(),
        ),
        (
            "a thick limb passing a leaf a twig joins",
            vec![
                [5, 5, 6, voxel(LIMB, 4)],
                [6, 5, 6, LEAF],
                [6, 6, 6, voxel(LIMB, 1)],
                [6, 7, 6, LEAF],
            ],
        ),
        (
            "a full trunk against stone and a lone voxel",
            vec![
                [6, 4, 6, voxel(LIMB, 8)],
                [7, 4, 6, STONE],
                [6, 4, 5, STONE],
                [10, 4, 10, voxel(LIMB, 3)],
            ],
        ),
        (
            "a three-wide trunk on soil narrowing into one voxel",
            [
                vec![[6, 2, 6, SOIL]],
                level(6, 3, 6, 20, false),
                level(6, 4, 6, 20, false),
                level(6, 5, 6, 12, false),
                column(6, 6, &[8, 6], 6),
            ]
            .concat(),
        ),
        (
            "a five-wide bole stepping in to three, its core cut",
            [level(6, 3, 6, 40, false), level(6, 4, 6, 24, true)].concat(),
        ),
        (
            "a limb and fins leaving a wide level",
            [
                vec![[6, 2, 6, SOIL], [4, 2, 6, SOIL], [3, 2, 6, SOIL]],
                level(6, 3, 6, 20, false),
                level(6, 4, 6, 20, false),
                vec![
                    [8, 4, 6, voxel(LIMB, 3)],
                    [9, 4, 6, voxel(LIMB, 2)],
                    [4, 3, 6, fin(3, 16)],
                    [3, 3, 6, fin(2, 10)],
                    [2, 3, 6, fin(2, 5)],
                    [4, 4, 6, fin(3, 8)],
                ],
            ]
            .concat(),
        ),
        (
            "a shell whose core is gone draws nothing",
            vec![
                [10, 4, 10, WideBranchBits::with_shell_offset(SHELL, 1, 0)],
                [6, 4, 6, voxel(LIMB, 4)],
            ],
        ),
    ]
}

struct SceneVoxels(HashMap<(i32, i32, i32), u32>);

impl VoxelAccess for SceneVoxels {
    fn get_raw_voxel(&self, vx: i32, vy: i32, vz: i32) -> u32 {
        self.0.get(&(vx, vy, vz)).copied().unwrap_or(0)
    }
}

fn mesh(registry: &Registry, voxels: &Voxels, light: u32) -> Vec<Value> {
    let mut data = vec![0u32; CHUNK_SIZE * MAX_HEIGHT * CHUNK_SIZE];
    for &[x, y, z, raw] in voxels {
        data[x as usize * MAX_HEIGHT * CHUNK_SIZE + y as usize * CHUNK_SIZE + z as usize] = raw;
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

/// The boxes the server collides each branch voxel with, in blocks of it.
fn aabbs(registry: &Registry, voxels: &Voxels) -> Vec<Value> {
    let space = SceneVoxels(
        voxels
            .iter()
            .map(|&[x, y, z, raw]| ((x as i32, y as i32, z as i32), raw))
            .collect(),
    );
    let mut boxes: Vec<Value> = space
        .0
        .iter()
        .filter_map(|(&(x, y, z), &raw)| {
            let block = registry.get_block_by_id(raw & 0xFFFF);
            if block.branch.is_none() && !block.branch_shell {
                return None;
            }
            let aabbs = block.get_aabbs(&Vec3(x, y, z), &space, registry);
            Some(json!({
                "at": [x, y, z],
                "aabbs": aabbs
                    .iter()
                    .map(|a| [a.min_x, a.min_y, a.min_z, a.max_x, a.max_y, a.max_z])
                    .collect::<Vec<_>>(),
            }))
        })
        .collect();
    boxes.sort_by_key(|b| b["at"].to_string());
    boxes
}

#[test]
fn branch_parity_fixture_is_what_the_server_meshes_and_collides() {
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
                "aabbs": aabbs(&registry, &voxels),
            })
        })
        .collect();
    assert!(
        scenes.iter().all(|s| {
            s["geometries"].as_array().is_some_and(|g| !g.is_empty())
                && s["aabbs"].as_array().is_some_and(|a| !a.is_empty())
        }),
        "every neighbourhood meshes and collides with something"
    );
    let fixture = json!({
        "chunkSize": CHUNK_SIZE,
        "maxHeight": MAX_HEIGHT,
        "light": light,
        "blocks": blocks,
        "scenes": scenes,
    });
    let written = serde_json::to_string(&fixture).expect("fixture serializes") + "\n";
    if std::env::var_os("UPDATE_BRANCH_PARITY").is_some() {
        std::fs::write(FIXTURE, &written).expect("fixture is writable");
        return;
    }
    let committed = std::fs::read_to_string(FIXTURE).unwrap_or_default();
    assert!(
        committed == written,
        "{FIXTURE} is stale: rerun with UPDATE_BRANCH_PARITY=1 and commit it"
    );
}

#[test]
fn branch_aabbs_follow_the_drawn_shape() {
    // A twig's boxes are thin, a full trunk is one full cube, and a branch
    // never reports the static cube its texture faces describe.
    let registry = registry();
    let space = SceneVoxels(
        [
            ((0, 0, 0), voxel(LIMB, 1)),
            ((0, 1, 0), voxel(LIMB, 1)),
            ((5, 0, 5), voxel(LIMB, 8)),
        ]
        .into_iter()
        .collect(),
    );
    let limb = registry.get_block_by_id(LIMB);
    let twig = limb.get_aabbs(&Vec3(0, 0, 0), &space, &registry);
    assert!(twig.iter().all(|a| a.max_x - a.min_x <= 2.0 / 16.0 + 1e-6));
    let trunk = limb.get_aabbs(&Vec3(5, 0, 5), &space, &registry);
    assert_eq!(trunk.len(), 1);
    assert_eq!(
        [
            trunk[0].min_x,
            trunk[0].max_x,
            trunk[0].min_y,
            trunk[0].max_y
        ],
        [0.0, 1.0, 0.0, 1.0]
    );
    assert!(limb.is_dynamic, "branches report dynamic shape to gameplay");
}
