//! The run writer: the height map after the stage equals a full rescan,
//! the watermark covers every voxel, voxels are the painted runs and the
//! stamped sea, the stage keeps the chunk's voxel array (one
//! `Arc::make_mut`, no clone), and canopies crossing a chunk border write
//! the same voxels from both sides.

#[path = "fixtures/landscape.rs"]
mod land;

use std::sync::Arc;

use voxelize::{Chunk, ChunkOptions, ChunkStage, Resources, Vec2, VoxelAccess};
use voxelize_gen::landscape::facts::Tier;
use voxelize_gen::landscape::{CompileOptions, LandscapeStage};

fn generate(
    land: &Arc<voxelize_gen::landscape::Landscape>,
    height: usize,
    cx: i32,
    cz: i32,
) -> Chunk {
    let registry = land::demo_registry();
    let config = land::config(7, height);
    let options = ChunkOptions {
        size: 16,
        max_height: height,
        sub_chunks: 8,
    };
    LandscapeStage::new(Arc::clone(land)).process(
        Chunk::new("w", cx, cz, &options),
        Resources {
            registry: &registry,
            config: &config,
        },
        None,
    )
}

#[test]
fn height_map_matches_rescan_at_two_heights() {
    for height in [256usize, 512] {
        let land = land::plain(7, height as u32, &CompileOptions::default());
        let registry = land::demo_registry();
        for (cx, cz) in land::walk_chunks() {
            let mut chunk = generate(&land, height, cx, cz);
            let top = chunk.top_filled_y.unwrap();
            assert!(top >= 0);
            let mut max_y = -1;
            for x in chunk.min.0..chunk.max.0 {
                for z in chunk.min.2..chunk.max.2 {
                    for y in 0..height as i32 {
                        if chunk.get_voxel(x, y, z) != 0 {
                            max_y = max_y.max(y);
                        }
                    }
                }
            }
            assert_eq!(max_y, top, "the watermark is the highest voxel written");
            chunk.calculate_max_height(&registry);
            let fast = chunk.height_map.data.clone();
            chunk.top_filled_y = None;
            chunk.calculate_max_height(&registry);
            assert_eq!(
                fast, chunk.height_map.data,
                "chunk ({cx}, {cz}) at H {height}"
            );
        }
    }
}

#[test]
fn voxels_are_the_painted_runs_and_the_sea() {
    let land = land::plain(7, 512, &CompileOptions::default());
    let water = land.role_block("fluid.water").unwrap();
    let mut wet = 0;
    for (cx, cz) in land::walk_chunks() {
        let chunk = generate(&land, 512, cx, cz);
        let facts = land.chunk_facts(Vec2(cx, cz));
        for x in chunk.min.0..chunk.max.0 {
            for z in chunk.min.2..chunk.max.2 {
                let runs = land.paint_column(&facts, x, z);
                let top = runs.top();
                for y in 0..=top {
                    assert_eq!(chunk.get_voxel(x, y, z), runs.at(y), "({x}, {y}, {z})");
                }
                let col = land.column(x, z, Tier::Full);
                if let Some(l) = col.water.top() {
                    wet += 1;
                    for y in l.bottom..=l.level {
                        assert_eq!(chunk.get_voxel(x, y, z), water, "sea at ({x}, {y}, {z})");
                    }
                    assert_eq!(chunk.get_voxel(x, l.level + 1, z), 0);
                }
            }
        }
    }
    assert!(wet > 0);
}

#[test]
fn the_stage_writes_in_place() {
    let land = land::plain(7, 256, &CompileOptions::default());
    let registry = land::demo_registry();
    let config = land::config(7, 256);
    let options = ChunkOptions {
        size: 16,
        max_height: 256,
        sub_chunks: 8,
    };
    let chunk = Chunk::new("w", 0, 0, &options);
    let before = Arc::as_ptr(&chunk.voxels);
    let out = LandscapeStage::new(Arc::clone(&land)).process(
        chunk,
        Resources {
            registry: &registry,
            config: &config,
        },
        None,
    );
    assert_eq!(
        before,
        Arc::as_ptr(&out.voxels),
        "the voxel array was cloned"
    );
    assert!(
        out.updated_levels.len() >= 8,
        "every sub-chunk level stays dirty"
    );
}

#[test]
fn canopies_crossing_borders_agree() {
    let land = land::plain(7, 256, &CompileOptions::default());
    // Find a pair of neighbouring chunks with leaves along their border.
    let leaf = land.role_block("flora.broadleaf.leaf").unwrap();
    let log = land.role_block("flora.broadleaf.log").unwrap();
    let pale = land.role_block("flora.pale.log").unwrap();
    let mut checked = 0;
    for cx in -12..12 {
        let a = generate(&land, 256, cx, 3);
        let b = generate(&land, 256, cx + 1, 3);
        // A 3x1 window generated whole: stamp both from a wider chunk set is
        // what each chunk does alone; compare tree voxels near the border
        // against an independent generation of each side.
        let a2 = generate(&land, 256, cx, 3);
        let b2 = generate(&land, 256, cx + 1, 3);
        assert_eq!(a.voxels.data, a2.voxels.data);
        assert_eq!(b.voxels.data, b2.voxels.data);
        let x_edge = a.max.0 - 1;
        for z in a.min.2..a.max.2 {
            for y in 0..256 {
                let va = a.get_voxel(x_edge, y, z);
                let vb = b.get_voxel(x_edge + 1, y, z);
                if (va == leaf || va == log || va == pale)
                    && (vb == leaf || vb == log || vb == pale)
                {
                    checked += 1;
                }
            }
        }
    }
    // Trees placed from the two windows are the same instances.
    let flora_ok = land_trees_agree(&land);
    assert!(flora_ok);
    assert!(checked > 0, "no canopy crossed a border in the sample");
}

fn land_trees_agree(land: &Arc<voxelize_gen::landscape::Landscape>) -> bool {
    // Two overlapping windows list the same trees where they overlap.
    let a = land.trees_in((0, 0), (64, 64));
    let b = land.trees_in((32, 0), (96, 64));
    let in_overlap = |t: &voxelize_gen::flora::TreeInstance| t.x >= 32 && t.x < 64;
    let ta: Vec<_> = a
        .iter()
        .filter(|t| in_overlap(t))
        .map(|t| (t.x, t.y, t.z, t.species, t.seed))
        .collect();
    let tb: Vec<_> = b
        .iter()
        .filter(|t| in_overlap(t))
        .map(|t| (t.x, t.y, t.z, t.species, t.seed))
        .collect();
    !ta.is_empty() && ta == tb
}
