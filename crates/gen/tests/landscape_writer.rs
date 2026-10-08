//! The run writer: the height map after the stage equals a full rescan,
//! the watermark covers every voxel (and keeps what an earlier stage
//! wrote), voxels are the painted runs and the stamped sea (air included,
//! when a surfacer carves), the stage keeps the chunk's voxel array (one
//! `Arc::make_mut`, no clone), canopies crossing a chunk border write the
//! same voxels as one stamp over the whole neighbourhood, and trees root
//! only on soil.

#[path = "fixtures/landscape.rs"]
mod land;

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use voxelize::{Chunk, ChunkOptions, ChunkStage, Resources, Vec2, VoxelAccess};
use voxelize_gen::landscape::facts::Tier;
use voxelize_gen::landscape::presets::RoleBinding;
use voxelize_gen::landscape::spec::{PaintNode, SpecError, Validate, Validator};
use voxelize_gen::landscape::{
    compile_with, CompileOptions, KindRegistry, LandscapeStage, MaterialRuns, PaintColumn,
    PaintCtx, RoleBlock, Surfacer, ROOT_DEPTH,
};

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

/// A game surfacer that carves the top `depth` voxels to air.
struct Carve {
    depth: i32,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct CarveParams {
    depth: u16,
}

impl Validate for CarveParams {
    fn validate(&self, v: &mut Validator) {
        v.check(
            "depth",
            (1..=4).contains(&self.depth),
            "depth must be 1..=4",
        );
    }
}

impl Surfacer for Carve {
    const KIND: &'static str = "test.carve";
    const VERSION: u32 = 1;
    type Params = CarveParams;

    fn build(p: Self::Params, _: &mut PaintCtx<'_>) -> Result<Self, SpecError> {
        Ok(Self {
            depth: p.depth as i32,
        })
    }

    fn paint(&self, col: &PaintColumn<'_>, runs: &mut MaterialRuns) {
        if !col.under_water() {
            runs.set_depth(0, self.depth - 1, RoleBlock::AIR);
        }
    }
}

#[test]
fn a_surfacer_can_carve_air() {
    let mut spec = land::plain_spec(256);
    spec.flora = None;
    spec.paint.push(PaintNode {
        kind: "test.carve".into(),
        params: serde_json::json!({ "depth": 1 }),
    });
    let mut kinds = KindRegistry::with_builtins();
    kinds.surfacer::<Carve>();
    let land = compile_with(
        &spec,
        &kinds,
        &RoleBinding::demo(),
        &land::demo_registry(),
        &land::config(7, 256),
        &CompileOptions::default(),
    )
    .unwrap();
    let registry = land::demo_registry();
    let mut carved = 0;
    for (cx, cz) in land::walk_chunks() {
        let mut chunk = generate(&land, 256, cx, cz);
        let facts = land.chunk_facts(Vec2(cx, cz));
        for x in chunk.min.0..chunk.max.0 {
            for z in chunk.min.2..chunk.max.2 {
                let runs = land.paint_column(&facts, x, z);
                for y in 0..=runs.top() {
                    assert_eq!(chunk.get_voxel(x, y, z), runs.at(y), "({x}, {y}, {z})");
                }
                if runs.at(runs.top()) == 0 {
                    carved += 1;
                }
            }
        }
        chunk.calculate_max_height(&registry);
        let fast = chunk.height_map.data.clone();
        chunk.top_filled_y = None;
        chunk.calculate_max_height(&registry);
        assert_eq!(fast, chunk.height_map.data, "chunk ({cx}, {cz})");
    }
    assert!(carved > 1000, "only {carved} columns carved");
}

#[test]
#[should_panic(expected = "already registered")]
fn a_kind_registers_once() {
    struct Shadow;
    impl Surfacer for Shadow {
        const KIND: &'static str = "zones";
        const VERSION: u32 = 9;
        type Params = CarveParams;
        fn build(_: Self::Params, _: &mut PaintCtx<'_>) -> Result<Self, SpecError> {
            Ok(Self)
        }
        fn paint(&self, _: &PaintColumn<'_>, _: &mut MaterialRuns) {}
    }
    let mut kinds = KindRegistry::with_builtins();
    let mut replaced = KindRegistry::with_builtins();
    replaced.replace_surfacer::<Shadow>();
    assert_eq!(replaced.surfacer_version("zones"), Some(9));
    kinds.surfacer::<Shadow>();
}

#[test]
fn an_earlier_stage_keeps_its_voxels_in_the_height_map() {
    let land = land::plain(7, 256, &CompileOptions::default());
    let registry = land::demo_registry();
    let config = land::config(7, 256);
    let block = land.role_block("rock.base").unwrap();
    let options = ChunkOptions {
        size: 16,
        max_height: 256,
        sub_chunks: 8,
    };
    let stage = LandscapeStage::new(Arc::clone(&land));
    let run = |chunk: Chunk| {
        stage.process(
            chunk,
            Resources {
                registry: &registry,
                config: &config,
            },
            None,
        )
    };
    // A known watermark rises to cover the earlier voxel.
    let mut chunk = Chunk::new("w", 0, 0, &options);
    chunk.set_voxel(3, 250, 5, block);
    let mut chunk = run(chunk);
    assert_eq!(chunk.get_voxel(3, 250, 5), block);
    assert!(chunk.top_filled_y.unwrap() >= 250);
    chunk.calculate_max_height(&registry);
    let fast = chunk.height_map.data.clone();
    chunk.top_filled_y = None;
    chunk.calculate_max_height(&registry);
    assert_eq!(fast, chunk.height_map.data);
    // An unknown watermark stays unknown.
    let mut chunk = Chunk::new("w", 0, 0, &options);
    chunk.top_filled_y = None;
    assert_eq!(run(chunk).top_filled_y, None);
}

#[test]
fn canopies_crossing_borders_agree() {
    // Each chunk alone against one stamp of every tree within 16 blocks
    // (well past any form's reach): a canopy cut at a border, or a reach
    // wider than the writer's pad, differs here.
    let land = land::plain(7, 256, &CompileOptions::default());
    const PAD: i32 = 16;
    let mut from_outside = 0;
    for (cx, cz) in (-8..8).map(|cx| (cx, 3)).chain((-8..8).map(|cz| (2, cz))) {
        let chunk = generate(&land, 256, cx, cz);
        let (x0, z0) = (chunk.min.0, chunk.min.2);
        let facts = land.chunk_facts(Vec2(cx, cz));
        let at = |x: i32, y: i32, z: i32| (((x - x0) * 256 + y) * 16 + (z - z0)) as usize;
        let mut want = vec![0u32; 16 * 256 * 16];
        for x in x0..x0 + 16 {
            for z in z0..z0 + 16 {
                let runs = land.paint_column(&facts, x, z);
                for y in 0..=runs.top() {
                    want[at(x, y, z)] = runs.at(y);
                }
                for l in &land.column(x, z, Tier::Full).water.layers {
                    for y in l.bottom..=l.level {
                        want[at(x, y, z)] = l.fluid;
                    }
                }
            }
        }
        for t in land.trees_in((x0 - PAD, z0 - PAD), (x0 + 16 + PAD, z0 + 16 + PAD)) {
            let outside = t.x < x0 || t.x >= x0 + 16 || t.z < z0 || t.z >= z0 + 16;
            land.stamp_tree(&t, &mut |x, y, z, b, soft| {
                if x < x0 || x >= x0 + 16 || z < z0 || z >= z0 + 16 || !(0..256).contains(&y) {
                    return;
                }
                let i = at(x, y, z);
                if soft && want[i] != 0 {
                    return;
                }
                want[i] = b;
                if outside {
                    from_outside += 1;
                }
            });
        }
        for x in x0..x0 + 16 {
            for z in z0..z0 + 16 {
                for y in 0..256 {
                    assert_eq!(
                        chunk.get_voxel(x, y, z),
                        want[at(x, y, z)],
                        "chunk ({cx}, {cz}) at ({x}, {y}, {z})"
                    );
                }
            }
        }
    }
    assert!(
        from_outside > 100,
        "only {from_outside} canopy voxels crossed a border in the sample"
    );
}

#[test]
fn trees_root_only_on_soil() {
    // Upland country with a rock line (seed 7): every trunk stands where
    // no fill shows in the top voxels, though bare rock is common here.
    let land = land::plain(7, 512, &CompileOptions::default());
    let fill = land.role_block("rock.base").unwrap();
    let (lo, hi) = ((1200, -400), (1700, 100));
    let trees = land.trees_in(lo, hi);
    assert!(trees.len() > 50, "only {} trees", trees.len());
    for t in &trees {
        let c = land.column(t.x, t.z, Tier::Full);
        let runs = land.paint_fact(&c);
        for d in 0..ROOT_DEPTH {
            assert_ne!(
                runs.at(c.top - d),
                fill,
                "a tree at ({}, {}) on rock",
                t.x,
                t.z
            );
        }
    }
    let mut bare = 0;
    for x in (lo.0..hi.0).step_by(5) {
        for z in (lo.1..hi.1).step_by(5) {
            let c = land.column(x, z, Tier::Full);
            if land.paint_fact(&c).at(c.top) == fill {
                bare += 1;
            }
        }
    }
    assert!(bare > 500, "only {bare} bare rock columns in the sample");
}
