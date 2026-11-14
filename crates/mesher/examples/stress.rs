//! Stress scenes for the mesher: how long one section takes to mesh, and a
//! hash of exactly what it meshed.
//!
//! ```text
//! cargo run --release -p voxelize-mesher --example stress -- [options]
//!   --save <file.json>      write this run's numbers and hashes
//!   --compare <file.json>   print this run beside a saved one: speedup per
//!                           scene, and whether the meshes are still the same
//!   --dump <dir>            write every scene (chunks + registry) for the
//!                           worker bench, scripts/bench-mesh-worker.mts
//!   --fixture <dir>         also mesh a scene dumped from a running game
//!                           (chunk_<x>_<z>.{voxels,lights}.bin, options.json,
//!                           registry.wasm.json)
//!   --only <name>           run the scenes whose name contains this
//!   --seconds <n>           time budget per scene (default 1.5)
//! ```
//!
//! Every scene is nine 32x256x32 chunks; the middle one's lowest section
//! (32x64x32) is what gets meshed, through `mesh_chunk_with_registry_chunks`,
//! the entry the client's worker and the tests share. The scenes are the
//! shapes that hurt: a 3D checkerboard of mixed blocks (every face drawn,
//! nothing merges), noise, a canopy of cutout leaves, a sea, slabs that never
//! greedy-mesh, next to ordinary terrain and a nearly empty section, so a
//! change that helps one and costs another shows up.
//!
//! `exact` hashes the output as emitted (geometries sorted by key); `quads`
//! hashes the same quads in any order. A rewrite that keeps `exact` changed
//! nothing a client could see or a fixture could catch.

use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::Instant,
};

use voxelize_mesher::{
    mesh_chunk_with_registry_chunks, pack_geometry, Block, BlockFace, BlockRotation, BlockUtils,
    ChunkData, CornerData, GeometryProtocol, LightUtils, MeshConfig, MeshOutput, Registry, AABB,
    UV,
};

const CHUNK_SIZE: i32 = 32;
const MAX_HEIGHT: i32 = 256;
const SECTION_HEIGHT: i32 = 64;
/// Scenes fill this high, so the meshed section has neighbours above it.
const FILL_HEIGHT: i32 = 72;

const AIR: u32 = 0;
const SOLID_FIRST: u32 = 1;
const SOLID_COUNT: u32 = 16;
const LEAVES: u32 = 17;
const WATER: u32 = 18;
const GLASS: u32 = 19;
const SLAB: u32 = 20;
const PLANT: u32 = 21;
const LOG: u32 = 22;
const LAMP: u32 = 23;

fn hash3(x: i32, y: i32, z: i32, seed: u32) -> u32 {
    let mut h = (x as u32).wrapping_mul(0x9E37_79B1)
        ^ (y as u32).wrapping_mul(0x85EB_CA77)
        ^ (z as u32).wrapping_mul(0xC2B2_AE3D)
        ^ seed.wrapping_mul(0x27D4_EB2F);
    h ^= h >> 15;
    h = h.wrapping_mul(0x2C1B_3C6D);
    h ^= h >> 12;
    h = h.wrapping_mul(0x297A_2D39);
    h ^ (h >> 15)
}

fn unit(x: i32, y: i32, z: i32, seed: u32) -> f32 {
    (hash3(x, y, z, seed) & 0xFFFF) as f32 / 65535.0
}

/// Value noise over a lattice `cell` blocks wide, in 0..1.
fn smooth2(x: i32, z: i32, cell: i32, seed: u32) -> f32 {
    let (gx, gz) = (x.div_euclid(cell), z.div_euclid(cell));
    let (fx, fz) = (
        x.rem_euclid(cell) as f32 / cell as f32,
        z.rem_euclid(cell) as f32 / cell as f32,
    );
    let (sx, sz) = (fx * fx * (3.0 - 2.0 * fx), fz * fz * (3.0 - 2.0 * fz));
    let at = |ix: i32, iz: i32| unit(ix, 0, iz, seed);
    let a = at(gx, gz) + (at(gx + 1, gz) - at(gx, gz)) * sx;
    let b = at(gx, gz + 1) + (at(gx + 1, gz + 1) - at(gx, gz + 1)) * sx;
    a + (b - a) * sz
}

fn cube_faces(height: f32, range_of: impl Fn(usize) -> UV) -> Vec<BlockFace> {
    let h = height;
    let faces: [(&str, [i32; 3], [[f32; 3]; 4], [[f32; 2]; 4]); 6] = [
        (
            "px",
            [1, 0, 0],
            [[1.0, h, 1.0], [1.0, 0.0, 1.0], [1.0, h, 0.0], [1.0, 0.0, 0.0]],
            [[0.0, 1.0], [0.0, 0.0], [1.0, 1.0], [1.0, 0.0]],
        ),
        (
            "nx",
            [-1, 0, 0],
            [[0.0, h, 0.0], [0.0, 0.0, 0.0], [0.0, h, 1.0], [0.0, 0.0, 1.0]],
            [[0.0, 1.0], [0.0, 0.0], [1.0, 1.0], [1.0, 0.0]],
        ),
        (
            "py",
            [0, 1, 0],
            [[0.0, h, 1.0], [1.0, h, 1.0], [0.0, h, 0.0], [1.0, h, 0.0]],
            [[1.0, 1.0], [0.0, 1.0], [1.0, 0.0], [0.0, 0.0]],
        ),
        (
            "ny",
            [0, -1, 0],
            [[1.0, 0.0, 1.0], [0.0, 0.0, 1.0], [1.0, 0.0, 0.0], [0.0, 0.0, 0.0]],
            [[1.0, 0.0], [0.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
        ),
        (
            "pz",
            [0, 0, 1],
            [[0.0, 0.0, 1.0], [1.0, 0.0, 1.0], [0.0, h, 1.0], [1.0, h, 1.0]],
            [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [1.0, 1.0]],
        ),
        (
            "nz",
            [0, 0, -1],
            [[1.0, 0.0, 0.0], [0.0, 0.0, 0.0], [1.0, h, 0.0], [0.0, h, 0.0]],
            [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [1.0, 1.0]],
        ),
    ];
    faces
        .into_iter()
        .enumerate()
        .map(|(i, (name, dir, pos, uv))| BlockFace {
            name: name.to_string(),
            dir,
            corners: [0, 1, 2, 3].map(|c| CornerData {
                pos: pos[c],
                uv: uv[c],
            }),
            range: range_of(i),
            ..Default::default()
        })
        .collect()
}

/// A 1/32 tile of an atlas, a different one per block and face, the way a
/// real registry hands the mesher its ranges.
fn atlas_range(block: u32, face: usize) -> UV {
    let slot = block * 6 + face as u32;
    let (col, row) = (slot % 32, slot / 32);
    UV {
        start_u: col as f32 / 32.0,
        end_u: (col + 1) as f32 / 32.0,
        start_v: row as f32 / 32.0,
        end_v: (row + 1) as f32 / 32.0,
    }
}

fn base_block(id: u32, name: &str) -> Block {
    Block {
        id,
        name: name.to_string(),
        name_lower: String::new(),
        rotatable: false,
        y_rotatable: false,
        is_empty: false,
        is_fluid: false,
        is_waterloggable: false,
        is_waterlogging_fluid: false,
        is_opaque: false,
        is_see_through: false,
        is_transparent: [false; 6],
        transparent_standalone: false,
        standalone_face_depth: 0,
        occludes_fluid: false,
        is_plant: false,
        stack_group: 0,
        is_animated: false,
        faces: cube_faces(1.0, |face| atlas_range(id, face)),
        aabbs: vec![AABB::create(0.0, 0.0, 0.0, 1.0, 1.0, 1.0)],
        dynamic_patterns: None,
        connected: None,
        branch: None,
        branch_sockets: vec![],
        branch_shell: false,
        stage_faces: None,
        tufts: None,
    }
}

fn stress_registry() -> Registry {
    let mut blocks = vec![Block {
        is_empty: true,
        faces: vec![],
        aabbs: vec![],
        ..base_block(AIR, "Air")
    }];
    for i in 0..SOLID_COUNT {
        let id = SOLID_FIRST + i;
        blocks.push(Block {
            is_opaque: true,
            ..base_block(id, &format!("Solid {id}"))
        });
    }
    blocks.push(Block {
        is_see_through: true,
        is_transparent: [true; 6],
        transparent_standalone: true,
        standalone_face_depth: 2,
        ..base_block(LEAVES, "Leaves")
    });
    blocks.push(Block {
        is_fluid: true,
        is_waterlogging_fluid: true,
        is_see_through: true,
        is_transparent: [true; 6],
        ..base_block(WATER, "Water")
    });
    blocks.push(Block {
        is_see_through: true,
        is_transparent: [true; 6],
        ..base_block(GLASS, "Glass")
    });
    blocks.push(Block {
        is_opaque: false,
        is_transparent: [true, true, true, false, true, true],
        faces: cube_faces(0.5, |face| atlas_range(SLAB, face)),
        aabbs: vec![AABB::create(0.0, 0.0, 0.0, 1.0, 0.5, 1.0)],
        ..base_block(SLAB, "Slab")
    });
    let diagonal = |name: &str, x0: f32, z0: f32, x1: f32, z1: f32, face: usize| BlockFace {
        name: name.to_string(),
        dir: [0, 0, 0],
        corners: [
            CornerData {
                pos: [x0, 1.0, z0],
                uv: [0.0, 1.0],
            },
            CornerData {
                pos: [x0, 0.0, z0],
                uv: [0.0, 0.0],
            },
            CornerData {
                pos: [x1, 1.0, z1],
                uv: [1.0, 1.0],
            },
            CornerData {
                pos: [x1, 0.0, z1],
                uv: [1.0, 0.0],
            },
        ],
        range: atlas_range(PLANT, face),
        ..Default::default()
    };
    blocks.push(Block {
        is_see_through: true,
        is_transparent: [true; 6],
        is_plant: true,
        faces: vec![
            diagonal("one", 0.0, 0.0, 1.0, 1.0, 0),
            diagonal("two", 1.0, 0.0, 0.0, 1.0, 1),
        ],
        aabbs: vec![AABB::create(0.2, 0.0, 0.2, 0.8, 0.8, 0.8)],
        ..base_block(PLANT, "Plant")
    });
    blocks.push(Block {
        is_opaque: true,
        rotatable: true,
        ..base_block(LOG, "Log")
    });
    let mut lamp = base_block(LAMP, "Lamp");
    lamp.is_opaque = true;
    for face in &mut lamp.faces {
        face.emissive = 2.0;
    }
    blocks.push(lamp);

    let mut registry = Registry::new(blocks.into_iter().map(|b| (b.id, b)).collect());
    registry.build_cache();
    registry
}

struct Scene {
    name: String,
    chunks: Vec<Option<ChunkData>>,
    registry: Registry,
    min: [i32; 3],
    max: [i32; 3],
    chunk_size: i32,
    max_height: i32,
    center: [i32; 2],
}

/// Nine chunks round (1, 1), filled by `voxel_at`, lit by `light_at`.
fn build_scene(
    name: &str,
    registry: &Registry,
    voxel_at: impl Fn(i32, i32, i32) -> u32,
    light_at: impl Fn(i32, i32, i32, &dyn Fn(i32, i32, i32) -> u32) -> u32,
) -> Scene {
    let span = CHUNK_SIZE * 3;
    let at = |x: i32, y: i32, z: i32| -> u32 {
        if x < 0 || z < 0 || x >= span || z >= span || !(0..FILL_HEIGHT).contains(&y) {
            AIR
        } else {
            voxel_at(x, y, z)
        }
    };
    let mut chunks = Vec::with_capacity(9);
    for dz in 0..3 {
        for dx in 0..3 {
            let len = (CHUNK_SIZE * MAX_HEIGHT * CHUNK_SIZE) as usize;
            let mut voxels = vec![0u32; len];
            let mut lights = vec![0u32; len];
            for lx in 0..CHUNK_SIZE {
                for ly in 0..MAX_HEIGHT {
                    for lz in 0..CHUNK_SIZE {
                        let (x, z) = (dx * CHUNK_SIZE + lx, dz * CHUNK_SIZE + lz);
                        let i = (lx * MAX_HEIGHT * CHUNK_SIZE + ly * CHUNK_SIZE + lz) as usize;
                        if ly < FILL_HEIGHT {
                            voxels[i] = at(x, ly, z);
                        }
                        lights[i] = light_at(x, ly, z, &at);
                    }
                }
            }
            chunks.push(Some(ChunkData {
                voxels,
                lights,
                shape: [
                    CHUNK_SIZE as usize,
                    MAX_HEIGHT as usize,
                    CHUNK_SIZE as usize,
                ],
                min: [dx * CHUNK_SIZE, 0, dz * CHUNK_SIZE],
            }));
        }
    }
    Scene {
        name: name.to_string(),
        chunks,
        registry: registry.clone(),
        min: [CHUNK_SIZE, 0, CHUNK_SIZE],
        max: [CHUNK_SIZE * 2, SECTION_HEIGHT, CHUNK_SIZE * 2],
        chunk_size: CHUNK_SIZE,
        max_height: MAX_HEIGHT,
        center: [1, 1],
    }
}

/// Daylight that dims through whatever is overhead, plus coloured lamps on a
/// lattice, so vertex light varies the way it does in a lit world instead of
/// being one flat value every face shares.
fn lit(x: i32, y: i32, z: i32, at: &dyn Fn(i32, i32, i32) -> u32) -> u32 {
    let id = at(x, y, z) & 0xFFFF;
    let is_solid = (SOLID_FIRST..SOLID_FIRST + SOLID_COUNT).contains(&id) || id == LOG;
    if is_solid {
        return 0;
    }
    let mut cover = 0;
    for up in 1..=6 {
        if at(x, y + up, z) & 0xFFFF != AIR {
            cover += 1;
        }
    }
    let sun = (15 - cover * 2).max(0) as u32;
    let lamp = |cell: i32, seed: u32| -> u32 {
        let (gx, gy, gz) = (
            x.div_euclid(cell) * cell + cell / 2,
            y.div_euclid(cell) * cell + cell / 2,
            z.div_euclid(cell) * cell + cell / 2,
        );
        if hash3(gx, gy, gz, seed) % 3 != 0 {
            return 0;
        }
        let distance = (x - gx).abs() + (y - gy).abs() + (z - gz).abs();
        (14 - distance).max(0) as u32
    };
    let mut light = LightUtils::insert_sunlight(0, sun);
    light = LightUtils::insert_red_light(light, lamp(16, 11));
    light = LightUtils::insert_green_light(light, lamp(20, 23));
    light = LightUtils::insert_blue_light(light, lamp(24, 37));
    light
}

fn random_solid(x: i32, y: i32, z: i32) -> u32 {
    SOLID_FIRST + hash3(x, y, z, 7) % SOLID_COUNT
}

fn scenes(registry: &Registry) -> Vec<Scene> {
    let mut all = Vec::new();

    all.push(build_scene(
        "checker-mixed",
        registry,
        |x, y, z| {
            if (x + y + z) & 1 == 0 {
                random_solid(x, y, z)
            } else {
                AIR
            }
        },
        lit,
    ));

    all.push(build_scene(
        "checker-one-block",
        registry,
        |x, y, z| if (x + y + z) & 1 == 0 { SOLID_FIRST } else { AIR },
        lit,
    ));

    all.push(build_scene(
        "noise-mixed",
        registry,
        |x, y, z| {
            if unit(x, y, z, 3) < 0.45 {
                random_solid(x / 3, y / 3, z / 3)
            } else {
                AIR
            }
        },
        lit,
    ));

    all.push(build_scene(
        "solid-mixed",
        registry,
        |x, y, z| if y < 60 { random_solid(x, y, z) } else { AIR },
        lit,
    ));

    let ground = |x: i32, z: i32| -> i32 {
        24 + (smooth2(x, z, 24, 1) * 14.0 + smooth2(x, z, 7, 2) * 4.0) as i32
    };
    all.push(build_scene(
        "terrain",
        registry,
        move |x, y, z| {
            let top = ground(x, z);
            if y < top - 3 {
                SOLID_FIRST
            } else if y < top {
                SOLID_FIRST + 1
            } else if y == top {
                SOLID_FIRST + 2
            } else if y == top + 1 && hash3(x, 0, z, 5) % 9 == 0 {
                PLANT
            } else {
                // A tree on a lattice: a rotatable trunk under a ball of leaves.
                let (tx, tz) = (x.div_euclid(11) * 11 + 5, z.div_euclid(11) * 11 + 5);
                let base = ground(tx, tz);
                let (dx, dz, dy) = (x - tx, z - tz, y - (base + 6));
                if dx == 0 && dz == 0 && y > base && y <= base + 5 {
                    BlockUtils::insert_rotation(LOG, &BlockRotation::PY(0.0))
                } else if dx * dx + dy * dy + dz * dz <= 10 && y > base {
                    LEAVES
                } else {
                    AIR
                }
            }
        },
        lit,
    ));

    all.push(build_scene(
        "canopy",
        registry,
        |x, y, z| {
            if (6..58).contains(&y) && unit(x, y, z, 9) > 0.15 {
                LEAVES
            } else {
                AIR
            }
        },
        lit,
    ));

    all.push(build_scene(
        "sea",
        registry,
        |x, y, z| {
            let bed = 20 + (smooth2(x, z, 16, 4) * 22.0) as i32;
            if y <= bed {
                SOLID_FIRST
            } else if y <= 40 {
                WATER
            } else {
                AIR
            }
        },
        lit,
    ));

    all.push(build_scene(
        "glass-and-lamps",
        registry,
        |x, y, z| match (x + y * 2 + z * 3).rem_euclid(5) {
            0 => GLASS,
            1 if hash3(x, y, z, 13) % 4 == 0 => LAMP,
            2 => random_solid(x, y, z),
            _ => AIR,
        },
        lit,
    ));

    all.push(build_scene(
        "slabs",
        registry,
        |x, y, z| {
            if y < 48 && (x + z) & 1 == 0 && y % 2 == 0 {
                SLAB
            } else {
                AIR
            }
        },
        lit,
    ));

    all.push(build_scene(
        "nearly-empty",
        registry,
        |x, y, z| {
            if y == 30 && x % 16 == 8 && z % 16 == 8 {
                LAMP
            } else {
                AIR
            }
        },
        lit,
    ));

    all
}

fn fnv(hash: &mut u64, bytes: &[u8]) {
    for byte in bytes {
        *hash ^= *byte as u64;
        *hash = hash.wrapping_mul(0x0000_0100_0000_01B3);
    }
}

const FNV_START: u64 = 0xCBF2_9CE4_8422_2325;

fn geometry_key(geometry: &GeometryProtocol) -> (u32, String, [i32; 3]) {
    (
        geometry.voxel,
        geometry.face_name.clone().unwrap_or_default(),
        geometry.at.unwrap_or([i32::MIN; 3]),
    )
}

struct Summary {
    exact: u64,
    quads: u64,
    geometries: usize,
    vertices: usize,
    quad_count: usize,
    bytes: usize,
}

fn summarize(output: &MeshOutput) -> Summary {
    let mut sorted: Vec<&GeometryProtocol> = output.geometries.iter().collect();
    sorted.sort_by_key(|a| geometry_key(a));

    let mut exact = FNV_START;
    let mut quads = 0u64;
    let (mut vertices, mut quad_count, mut bytes) = (0, 0, 0);
    fnv(&mut exact, &output.connectivity.to_le_bytes());
    for geometry in &sorted {
        let (voxel, face, at) = geometry_key(geometry);
        let mut header = FNV_START;
        fnv(&mut header, &voxel.to_le_bytes());
        fnv(&mut header, face.as_bytes());
        for c in at {
            fnv(&mut header, &c.to_le_bytes());
        }
        fnv(&mut exact, &header.to_le_bytes());
        for p in &geometry.positions {
            fnv(&mut exact, &p.to_bits().to_le_bytes());
        }
        for u in &geometry.uvs {
            fnv(&mut exact, &u.to_bits().to_le_bytes());
        }
        for l in &geometry.lights {
            fnv(&mut exact, &l.to_le_bytes());
        }
        for i in &geometry.indices {
            fnv(&mut exact, &i.to_le_bytes());
        }

        // The same triangles in any order: each hashed by the attributes of
        // its corners, then summed.
        for triangle in geometry.indices.chunks_exact(3) {
            let mut h = header;
            for &index in triangle {
                let v = index as usize;
                for p in &geometry.positions[v * 3..v * 3 + 3] {
                    fnv(&mut h, &p.to_bits().to_le_bytes());
                }
                for u in &geometry.uvs[v * 2..v * 2 + 2] {
                    fnv(&mut h, &u.to_bits().to_le_bytes());
                }
                fnv(&mut h, &geometry.lights[v].to_le_bytes());
            }
            quads = quads.wrapping_add(h);
        }

        vertices += geometry.lights.len();
        quad_count += geometry.indices.len() / 6;
        bytes += geometry.positions.len() * 4
            + geometry.uvs.len() * 4
            + geometry.lights.len() * 4
            + geometry.indices.len() * 4;
    }

    Summary {
        exact,
        quads,
        geometries: sorted.len(),
        vertices,
        quad_count,
        bytes,
    }
}

struct Measured {
    name: String,
    median_ms: f64,
    min_ms: f64,
    /// Packing the meshed geometries for upload (`pack_geometry`), which a
    /// client's worker does in the same call; not part of `median_ms`.
    pack_ms: f64,
    rounds: usize,
    summary: Summary,
}

fn measure(scene: &Scene, seconds: f64) -> Measured {
    let run = || {
        mesh_chunk_with_registry_chunks(
            &scene.chunks,
            scene.min,
            scene.max,
            MeshConfig {
                chunk_size: scene.chunk_size,
            },
            &scene.registry,
        )
    };
    let output = run();
    let summary = summarize(&output);
    drop(output);
    let _ = run();

    let mut times = Vec::new();
    let mut pack_times = Vec::new();
    let started = Instant::now();
    while times.len() < 5 || (started.elapsed().as_secs_f64() < seconds && times.len() < 400) {
        let at = Instant::now();
        let output = run();
        times.push(at.elapsed().as_secs_f64() * 1000.0);
        let at = Instant::now();
        for geometry in output.geometries {
            std::hint::black_box(pack_geometry(geometry, 256.0, true));
        }
        pack_times.push(at.elapsed().as_secs_f64() * 1000.0);
    }
    times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    pack_times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    Measured {
        name: scene.name.clone(),
        median_ms: times[times.len() / 2],
        min_ms: times[0],
        pack_ms: pack_times[pack_times.len() / 2],
        rounds: times.len(),
        summary,
    }
}

fn to_json(results: &[Measured]) -> String {
    let mut out = String::from("{\n");
    for (i, r) in results.iter().enumerate() {
        out.push_str(&format!(
            "  \"{}\": {{\"medianMs\": {:.4}, \"minMs\": {:.4}, \"packMs\": {:.4}, \"rounds\": {}, \"exact\": \"{:016x}\", \"quads\": \"{:016x}\", \"quadCount\": {}, \"vertices\": {}, \"geometries\": {}, \"bytes\": {}}}{}\n",
            r.name,
            r.median_ms,
            r.min_ms,
            r.pack_ms,
            r.rounds,
            r.summary.exact,
            r.summary.quads,
            r.summary.quad_count,
            r.summary.vertices,
            r.summary.geometries,
            r.summary.bytes,
            if i + 1 == results.len() { "" } else { "," }
        ));
    }
    out.push_str("}\n");
    out
}

/// Reads back what `to_json` wrote: one scene per line.
fn from_json(text: &str) -> BTreeMap<String, BTreeMap<String, String>> {
    let mut scenes = BTreeMap::new();
    for line in text.lines() {
        let line = line.trim().trim_end_matches(',');
        let Some((name, rest)) = line.split_once("\": {") else {
            continue;
        };
        let name = name.trim_start_matches('"').to_string();
        let mut fields = BTreeMap::new();
        for pair in rest.trim_end_matches('}').split(", ") {
            if let Some((key, value)) = pair.split_once(": ") {
                fields.insert(
                    key.trim_matches('"').to_string(),
                    value.trim_matches('"').to_string(),
                );
            }
        }
        scenes.insert(name, fields);
    }
    scenes
}

fn write_scene(dir: &Path, scene: &Scene) {
    let out = dir.join(&scene.name);
    fs::create_dir_all(&out).expect("scene directory");
    let as_bytes = |words: &[u32]| -> Vec<u8> { words.iter().flat_map(|w| w.to_le_bytes()).collect() };
    for (i, chunk) in scene.chunks.iter().enumerate() {
        let Some(chunk) = chunk else { continue };
        let (dx, dz) = (i as i32 % 3 - 1, i as i32 / 3 - 1);
        let (x, z) = (scene.center[0] + dx, scene.center[1] + dz);
        fs::write(out.join(format!("chunk_{x}_{z}.voxels.bin")), as_bytes(&chunk.voxels)).unwrap();
        fs::write(out.join(format!("chunk_{x}_{z}.lights.bin")), as_bytes(&chunk.lights)).unwrap();
    }
    let sub_chunks = scene.max_height / (scene.max[1] - scene.min[1]);
    fs::write(
        out.join("options.json"),
        format!(
            "{{\"chunkSize\": {}, \"maxHeight\": {}, \"subChunks\": {}, \"cx\": {}, \"cz\": {}, \"level\": {}}}\n",
            scene.chunk_size,
            scene.max_height,
            sub_chunks,
            scene.center[0],
            scene.center[1],
            scene.min[1] / (scene.max[1] - scene.min[1])
        ),
    )
    .unwrap();
    // The shape the client's `Registry.serialize` writes, so the worker bench
    // takes this registry through the worker's own conversion.
    let blocks: Vec<String> = scene
        .registry
        .blocks_by_id
        .iter()
        .map(|(id, block)| format!("[{id}, {}]", serde_json::to_string(block).unwrap()))
        .collect();
    let names: Vec<String> = scene
        .registry
        .blocks_by_id
        .iter()
        .map(|(id, block)| format!("[{}, {id}]", serde_json::to_string(&block.name.to_lowercase()).unwrap()))
        .collect();
    let ids: Vec<String> = scene
        .registry
        .blocks_by_id
        .iter()
        .map(|(id, block)| format!("[{id}, {}]", serde_json::to_string(&block.name.to_lowercase()).unwrap()))
        .collect();
    fs::write(
        out.join("registry.json"),
        format!(
            "{{\"version\": 2, \"blocksById\": [{}], \"nameMap\": [{}], \"idMap\": [{}]}}",
            blocks.join(","),
            names.join(","),
            ids.join(",")
        ),
    )
    .unwrap();
}

fn read_words(path: &Path) -> Option<Vec<u32>> {
    let bytes = fs::read(path).ok()?;
    Some(
        bytes
            .chunks_exact(4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .collect(),
    )
}

fn load_fixture(dir: &Path) -> Scene {
    let options: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(dir.join("options.json")).expect("options.json"))
            .expect("options.json parses");
    let field = |name: &str| options[name].as_i64().unwrap_or_else(|| panic!("options.{name}")) as i32;
    let (chunk_size, max_height, sub_chunks) = (field("chunkSize"), field("maxHeight"), field("subChunks"));
    let (cx, cz) = (field("cx"), field("cz"));
    let level = options["level"].as_i64().unwrap_or(0) as i32;
    let mut registry: Registry = serde_json::from_str(
        &fs::read_to_string(dir.join("registry.wasm.json")).expect("registry.wasm.json"),
    )
    .expect("registry.wasm.json matches the mesher's Registry");
    registry.build_cache();

    let mut chunks = Vec::new();
    for dz in -1..=1 {
        for dx in -1..=1 {
            let (x, z) = (cx + dx, cz + dz);
            let voxels = read_words(&dir.join(format!("chunk_{x}_{z}.voxels.bin")));
            let lights = read_words(&dir.join(format!("chunk_{x}_{z}.lights.bin")));
            chunks.push(match (voxels, lights) {
                (Some(voxels), Some(lights)) => Some(ChunkData {
                    voxels,
                    lights,
                    shape: [chunk_size as usize, max_height as usize, chunk_size as usize],
                    min: [x * chunk_size, 0, z * chunk_size],
                }),
                _ => None,
            });
        }
    }
    let section = max_height / sub_chunks;
    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "fixture".to_string());
    Scene {
        name: format!("fixture:{name}:{level}"),
        chunks,
        registry,
        min: [cx * chunk_size, section * level, cz * chunk_size],
        max: [(cx + 1) * chunk_size, section * (level + 1), (cz + 1) * chunk_size],
        chunk_size,
        max_height,
        center: [cx, cz],
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let value_of = |flag: &str| -> Option<String> {
        args.iter()
            .position(|a| a == flag)
            .and_then(|i| args.get(i + 1).cloned())
    };
    let values_of = |flag: &str| -> Vec<String> {
        args.iter()
            .enumerate()
            .filter(|(_, a)| *a == flag)
            .filter_map(|(i, _)| args.get(i + 1).cloned())
            .collect()
    };
    let seconds: f64 = value_of("--seconds").and_then(|s| s.parse().ok()).unwrap_or(1.5);
    let only = value_of("--only");

    let registry = stress_registry();
    let mut all = scenes(&registry);
    if let Some(dir) = value_of("--dump") {
        let dir = PathBuf::from(dir);
        for scene in &all {
            write_scene(&dir, scene);
        }
        println!("wrote {} scenes to {}", all.len(), dir.display());
    }
    for fixture in values_of("--fixture") {
        all.push(load_fixture(Path::new(&fixture)));
    }
    if let Some(only) = &only {
        all.retain(|scene| scene.name.contains(only.as_str()));
    }

    let baseline = value_of("--compare").map(|path| {
        from_json(&fs::read_to_string(&path).unwrap_or_else(|_| panic!("cannot read {path}")))
    });

    let mut results = Vec::new();
    println!(
        "{:<28} {:>9} {:>9} {:>8} {:>8} {:>7}  {}",
        "scene",
        "median ms",
        "min ms",
        "pack ms",
        "quads",
        "MB",
        if baseline.is_some() { "vs saved" } else { "exact hash" }
    );
    for scene in &all {
        let measured = measure(scene, seconds);
        let tail = match baseline.as_ref().and_then(|b| b.get(&measured.name)) {
            Some(saved) => {
                let saved_ms: f64 = saved.get("medianMs").and_then(|s| s.parse().ok()).unwrap_or(0.0);
                let same_exact = saved.get("exact") == Some(&format!("{:016x}", measured.summary.exact));
                let same_quads = saved.get("quads") == Some(&format!("{:016x}", measured.summary.quads));
                format!(
                    "{:>8.2} ms -> {:>5.1}x   {}",
                    saved_ms,
                    saved_ms / measured.median_ms,
                    if same_exact {
                        "same mesh"
                    } else if same_quads {
                        "same quads, new order"
                    } else {
                        "MESH DIFFERS"
                    }
                )
            }
            None => format!("{:016x}", measured.summary.exact),
        };
        println!(
            "{:<28} {:>9.2} {:>9.2} {:>8.2} {:>8} {:>7.2}  {}",
            measured.name,
            measured.median_ms,
            measured.min_ms,
            measured.pack_ms,
            measured.summary.quad_count,
            measured.summary.bytes as f64 / 1e6,
            tail
        );
        results.push(measured);
    }

    if let Some(path) = value_of("--save") {
        fs::write(&path, to_json(&results)).unwrap_or_else(|_| panic!("cannot write {path}"));
        println!("saved {path}");
    }
}
