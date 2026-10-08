//! The determinism suite on the `plain` preset: order and thread
//! shuffles, caches at capacity one, grid equals point, two processes, and
//! the run writer's height-map contract, at two heights and seeds.
//!
//! Also pins golden digests (identity, chunk voxels and facts) for three
//! seeds at H = 256 and two at H = 512, compared on every platform CI runs:
//! the same file passes on Linux x86_64 and macOS arm64, or the
//! bit-stability claim is broken. `UPDATE_GOLDENS=1` rewrites the file
//! (with a content-version or `ENGINE_ALGO` bump and a changelog line in
//! the design's as-built section).

#[path = "fixtures/landscape.rs"]
mod land;

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use voxelize_gen::landscape::kit::determinism::{chunk_digest, generate};
use voxelize_gen::landscape::CompileOptions;

voxelize_gen::landscape::kit::determinism_suite! {
    plain_256,
    build = |o: &voxelize_gen::landscape::CompileOptions| crate::land::plain(7, 256, o),
    registry = crate::land::demo_registry(),
    config = crate::land::config(7, 256),
    chunks = crate::land::walk_chunks(),
}

voxelize_gen::landscape::kit::determinism_suite! {
    plain_512,
    build = |o: &voxelize_gen::landscape::CompileOptions| crate::land::plain(1, 512, o),
    registry = crate::land::demo_registry(),
    config = crate::land::config(1, 512),
    chunks = crate::land::walk_chunks()[..6].to_vec(),
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
struct Golden {
    about: String,
    /// By world height, then by seed.
    heights: BTreeMap<String, BTreeMap<String, SeedGolden>>,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
struct SeedGolden {
    spec_hash: String,
    roles_digest: String,
    spawn: (i32, i32),
    chunks: BTreeMap<String, (String, String)>,
}

/// The pinned (height, seeds): three seeds at H = 256, and two at the
/// H = 512 the showcase, the bench and the budgets run, where the
/// frame-relative arithmetic differs.
const PINNED: &[(u32, &[u32])] = &[(256, &[1, 7, 123123123]), (512, &[1, 7])];

fn measure() -> Golden {
    let mut heights = BTreeMap::new();
    for &(height, seeds) in PINNED {
        let mut by_seed = BTreeMap::new();
        for &seed in seeds {
            let land = land::plain(seed, height, &CompileOptions::default());
            let registry = land::demo_registry();
            let config = land::config(seed, height as usize);
            let mut chunks = BTreeMap::new();
            for (cx, cz) in land::walk_chunks() {
                let chunk = generate(&land, &registry, &config, cx, cz);
                let facts = land.chunk_facts(voxelize::Vec2(cx, cz));
                chunks.insert(
                    format!("{cx},{cz}"),
                    (
                        format!("{:016x}", chunk_digest(&chunk)),
                        format!("{:016x}", facts.digest()),
                    ),
                );
            }
            let id = land.identity();
            by_seed.insert(
                seed.to_string(),
                SeedGolden {
                    spec_hash: format!("{:016x}", id.spec_hash),
                    roles_digest: format!("{:016x}", id.roles_digest),
                    spawn: land.spawn(),
                    chunks,
                },
            );
        }
        heights.insert(height.to_string(), by_seed);
    }
    Golden {
        about: "Golden digests of the plain preset: identity hashes, spawn, and per-chunk voxel and facts digests, for three seeds at H = 256 and two at H = 512. Every platform must reproduce these bits; UPDATE_GOLDENS=1 rewrites (with a content-version or ENGINE_ALGO bump and a line in the design's as-built changelog).".into(),
        heights,
    }
}

#[test]
fn plain_goldens_match() {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden/landscape/plain.json");
    let got = measure();
    if std::env::var("UPDATE_GOLDENS").is_ok() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut text = serde_json::to_string_pretty(&got).unwrap();
        text.push('\n');
        std::fs::write(&path, text).unwrap();
        return;
    }
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|_| panic!("{} is missing; run with UPDATE_GOLDENS=1", path.display()));
    let want: Golden = serde_json::from_str(&text).unwrap();
    assert_eq!(
        want.heights.keys().collect::<Vec<_>>(),
        got.heights.keys().collect::<Vec<_>>()
    );
    for (height, seeds) in &want.heights {
        for (seed, w) in seeds {
            let g = &got.heights[height][seed];
            let at = format!("H {height} seed {seed}");
            assert_eq!(w.spec_hash, g.spec_hash, "{at}: spec_hash");
            assert_eq!(w.roles_digest, g.roles_digest, "{at}: roles_digest");
            assert_eq!(w.spawn, g.spawn, "{at}: spawn");
            assert_eq!(w.chunks.len(), g.chunks.len(), "{at}: chunk count");
            for (k, v) in &w.chunks {
                assert_eq!(Some(v), g.chunks.get(k), "{at}: chunk {k} (voxels, facts)");
            }
        }
    }
}
