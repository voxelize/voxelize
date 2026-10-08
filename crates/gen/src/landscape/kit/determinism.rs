//! The determinism suite (feature `kit`), for this crate's presets and for
//! game crates alike.
//!
//! Given a way to compile a landscape (with any cache options), a block
//! registry, a world config and a list of chunks, it checks that output is
//! a pure function of the inputs:
//!
//! - **order and threads**: the chunks generated in order on one thread,
//!   shuffled on one thread, and shuffled on 4 and 8 threads give the same
//!   chunk and facts digests;
//! - **caches cost only**: a landscape with every cache at capacity one
//!   gives the same digests as one with default caches;
//! - **grid equals point**: every column of every chunk's facts equals the
//!   point query of that column, bit for bit;
//! - **two processes**: a fresh process (the test binary re-executed)
//!   gives the same digests (no per-process hash seeding leaks into
//!   output);
//! - **height map matches rescan**: after the stage, the engine's height
//!   map with the writer's watermark equals a full rescan, and no voxel
//!   lies above the watermark.
//!
//! [`determinism_suite!`](crate::landscape::kit::determinism_suite)
//! generates one `#[test]` per check.

use std::collections::BTreeMap;
use std::sync::Arc;

use voxelize::{
    Chunk, ChunkOptions, ChunkStage, Registry, Resources, Vec2, Vec3, VoxelAccess, WorldConfig,
};

use crate::landscape::facts::{ColumnFact, Tier};
use crate::landscape::stage::LandscapeStage;
use crate::landscape::water::{Flow, StampMode};
use crate::landscape::{CompileOptions, Landscape};
use crate::stream::HashStream;

/// Environment variable that turns a re-executed test into the child half
/// of the two-process check.
pub const CHILD_ENV: &str = "VOXELIZE_GEN_KIT_CHILD";

/// One determinism case.
pub struct Case<'a> {
    /// A name (printed in failures).
    pub name: &'a str,
    /// Compiles the landscape with the given options.
    pub build: &'a (dyn Fn(&CompileOptions) -> Arc<Landscape> + Sync),
    /// The block registry the landscape binds to.
    pub registry: &'a Registry,
    /// The world config.
    pub config: &'a WorldConfig,
    /// Chunks to generate.
    pub chunks: &'a [(i32, i32)],
}

/// Digests of one chunk: voxels (with the watermark) and facts.
pub type Digests = BTreeMap<(i32, i32), (u64, u64)>;

/// Generate one chunk through the landscape's stage, as a world would.
pub fn generate(
    land: &Arc<Landscape>,
    registry: &Registry,
    config: &WorldConfig,
    cx: i32,
    cz: i32,
) -> Chunk {
    let options = ChunkOptions {
        size: config.chunk_size,
        max_height: config.max_height,
        sub_chunks: config.sub_chunks,
    };
    let chunk = Chunk::new("kit", cx, cz, &options);
    LandscapeStage::new(Arc::clone(land)).process(chunk, Resources { registry, config }, None)
}

/// FNV digest of a chunk's voxels and watermark.
pub fn chunk_digest(chunk: &Chunk) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    let mut eat = |v: u64| {
        h ^= v;
        h = h.wrapping_mul(0x100000001b3);
    };
    for &v in chunk.voxels.data.iter() {
        eat(v as u64);
    }
    eat(chunk.top_filled_y.map_or(u64::MAX, |t| t as i64 as u64));
    h
}

/// Digests of `order` generated on `threads` threads (each chunk is
/// generated from scratch; caches are shared, as in a world).
pub fn digests(
    case: &Case<'_>,
    land: &Arc<Landscape>,
    order: &[(i32, i32)],
    threads: usize,
) -> Digests {
    let next = std::sync::atomic::AtomicUsize::new(0);
    let parts: Vec<Vec<((i32, i32), (u64, u64))>> = std::thread::scope(|s| {
        let handles: Vec<_> = (0..Ord::max(threads, 1))
            .map(|_| {
                s.spawn(|| {
                    let mut out = Vec::new();
                    loop {
                        let i = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        let Some(&(cx, cz)) = order.get(i) else { break };
                        let chunk = generate(land, case.registry, case.config, cx, cz);
                        let facts = land.chunk_facts(Vec2(cx, cz)).digest();
                        out.push(((cx, cz), (chunk_digest(&chunk), facts)));
                    }
                    out
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|h| h.join().expect("a kit worker"))
            .collect()
    });
    parts.into_iter().flatten().collect()
}

/// `chunks` in a fixed pseudo-random order.
pub fn shuffled(chunks: &[(i32, i32)], salt: u64) -> Vec<(i32, i32)> {
    let mut v = chunks.to_vec();
    let mut s = HashStream::new(0x5EED_0F00 ^ salt);
    for i in (1..v.len()).rev() {
        let j = (s.raw() % (i as u64 + 1)) as usize;
        v.swap(i, j);
    }
    v
}

fn assert_same(case: &Case<'_>, what: &str, a: &Digests, b: &Digests) {
    assert_eq!(
        a.len(),
        b.len(),
        "{}: {what}: chunk counts differ",
        case.name
    );
    for (k, va) in a {
        let vb = &b[k];
        assert_eq!(
            va, vb,
            "{}: {what}: chunk {k:?} differs (voxels {:016x} vs {:016x}, facts {:016x} vs {:016x})",
            case.name, va.0, vb.0, va.1, vb.1
        );
    }
}

/// Order and thread shuffles give the same digests.
pub fn assert_order_and_threads(case: &Case<'_>) {
    let reference = digests(
        case,
        &(case.build)(&CompileOptions::default()),
        case.chunks,
        1,
    );
    for (salt, threads) in [(1u64, 1usize), (2, 4), (3, 8)] {
        let land = (case.build)(&CompileOptions::default());
        let got = digests(case, &land, &shuffled(case.chunks, salt), threads);
        assert_same(
            case,
            &format!("shuffle {salt} on {threads} threads"),
            &reference,
            &got,
        );
    }
}

/// Every cache at capacity one gives the same digests.
pub fn assert_caches_cost_only(case: &Case<'_>) {
    let reference = digests(
        case,
        &(case.build)(&CompileOptions::default()),
        case.chunks,
        1,
    );
    let tiny = (case.build)(&CompileOptions::tiny_caches());
    let got = digests(case, &tiny, &shuffled(case.chunks, 9), 4);
    assert_same(case, "caches at capacity one", &reference, &got);
}

/// Every channel of a column as bits, so `-0.0` and `0.0` (equal as
/// floats) differ.
fn column_bits(c: &ColumnFact) -> Vec<u64> {
    let f = |v: f64| v.to_bits();
    let mut out = vec![
        c.x as i64 as u64,
        c.z as i64 as u64,
        c.top as i64 as u64,
        f(c.ground),
        f(c.slope),
        f(c.aspect[0]),
        f(c.aspect[1]),
        f(c.curvature),
        f(c.temperature),
        f(c.moisture),
        c.biome.id.0 as u64,
        c.biome.primary.0 as u64,
        c.biome.secondary.0 as u64,
        c.biome.edge as u64,
        c.zone.0 as u64,
    ];
    for l in &c.water.layers {
        out.push(l.body.0);
        out.push(l.kind.0 as u64);
        out.push(l.fluid as u64);
        out.push(l.level as i64 as u64);
        out.push(l.bottom as i64 as u64);
        match l.flow {
            Flow::Still => out.push(0),
            Flow::Downstream { dx, dz, speed } => out.extend([
                1,
                dx.to_bits() as u64,
                dz.to_bits() as u64,
                speed.to_bits() as u64,
            ]),
            Flow::Falling => out.push(2),
        }
        out.push(match l.stamp {
            StampMode::Sources => 0,
        });
    }
    out.extend(c.kept.iter().map(|k| k.to_bits() as u64));
    out
}

/// Every stored column of every chunk's facts equals its point query.
pub fn assert_grid_equals_point(case: &Case<'_>) {
    // A landscape with a one-entry facts cache, so point queries cannot be
    // answered from the very facts they are compared with.
    let land = (case.build)(&CompileOptions {
        facts_bytes: 1,
        columns: 1,
        ..CompileOptions::default()
    });
    let s = land.chunk_size();
    for &(cx, cz) in case.chunks {
        let facts = Arc::new(land.build_facts((cx * s, cz * s), s as usize, 2));
        let area = facts.area();
        for dz in 0..area.d {
            for dx in 0..area.w {
                let (x, z) = (area.x0 + dx as i32, area.z0 + dz as i32);
                let grid = facts.column(x, z, land.sea()).expect("stored");
                let point = land
                    .build_facts((x, z), 1, 0)
                    .column(x, z, land.sea())
                    .expect("built");
                assert!(
                    column_bits(&grid) == column_bits(&point),
                    "{}: column ({x}, {z}) of chunk ({cx}, {cz}): grid {grid:?} != point {point:?}",
                    case.name
                );
                let ground = land.column_ground(x, z, Tier::Full);
                assert_eq!(
                    ground.to_bits(),
                    grid.ground.to_bits(),
                    "{}: column_ground ({x}, {z})",
                    case.name
                );
            }
        }
    }
}

/// The digests of `case`, as the child process prints them.
pub fn child_lines(case: &Case<'_>) -> Vec<String> {
    let land = (case.build)(&CompileOptions::default());
    digests(case, &land, case.chunks, 1)
        .into_iter()
        .map(|((cx, cz), (v, f))| format!("KIT-DIGEST {cx} {cz} {v:016x} {f:016x}"))
        .collect()
}

/// When run as the child half, print the digests and return true.
pub fn run_child(case: &Case<'_>) -> bool {
    if std::env::var(CHILD_ENV).ok().as_deref() == Some(case.name) {
        for line in child_lines(case) {
            println!("{line}");
        }
        return true;
    }
    false
}

/// A fresh process gives the same digests. `test_path` is this test's
/// path inside its test binary (`plain::two_process_identical`).
pub fn assert_two_process(case: &Case<'_>, test_path: &str) {
    if run_child(case) {
        return;
    }
    let exe = std::env::current_exe().expect("the test binary");
    let out = std::process::Command::new(exe)
        .args([test_path, "--exact", "--nocapture", "--test-threads", "1"])
        .env(CHILD_ENV, case.name)
        .output()
        .expect("re-execute the test binary");
    let stdout = String::from_utf8_lossy(&out.stdout);
    // The test harness may print its own "test ... " prefix on the line
    // our first digest lands on.
    let theirs: Vec<String> = stdout
        .lines()
        .filter_map(|l| l.find("KIT-DIGEST ").map(|i| l[i..].to_string()))
        .collect();
    assert!(
        out.status.success() && !theirs.is_empty(),
        "{}: the child process failed or printed nothing:\n{stdout}\n{}",
        case.name,
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(
        child_lines(case),
        theirs,
        "{}: two processes disagree",
        case.name
    );
}

/// After the stage, the height map with the writer's watermark equals a
/// full rescan, and no voxel lies above the watermark.
pub fn assert_height_map_matches_rescan(case: &Case<'_>) {
    let land = (case.build)(&CompileOptions::default());
    for &(cx, cz) in case.chunks {
        let mut chunk = generate(&land, case.registry, case.config, cx, cz);
        let top = chunk.top_filled_y.expect("the writer sets the watermark");
        let Vec3(x0, _, z0) = chunk.min;
        let Vec3(x1, h, z1) = chunk.max;
        for x in x0..x1 {
            for z in z0..z1 {
                for y in (top + 1)..h {
                    assert_eq!(
                        chunk.get_voxel(x, y, z),
                        0,
                        "{}: voxel ({x}, {y}, {z}) lies above the watermark {top}",
                        case.name
                    );
                }
            }
        }
        chunk.calculate_max_height(case.registry);
        let with_watermark = chunk.height_map.data.clone();
        chunk.top_filled_y = None;
        chunk.calculate_max_height(case.registry);
        assert_eq!(
            with_watermark, chunk.height_map.data,
            "{}: chunk ({cx}, {cz}): the height map differs from a full rescan",
            case.name
        );
    }
}

/// Generate the determinism tests for one case:
///
/// ```ignore
/// voxelize_gen::landscape::kit::determinism_suite! {
///     plain,
///     build = |o| my_landscape(o),
///     registry = my_registry(),
///     config = my_config(),
///     chunks = vec![(0, 0), (1, 0), (-3, 7)],
/// }
/// ```
#[doc(hidden)]
#[macro_export]
macro_rules! __landscape_determinism_suite {
    ($name:ident, build = $build:expr, registry = $registry:expr, config = $config:expr, chunks = $chunks:expr $(,)?) => {
        mod $name {
            #[allow(unused_imports)]
            use super::*;
            use $crate::landscape::kit::determinism as kit;

            fn with_case(f: impl FnOnce(&kit::Case<'_>)) {
                let registry = $registry;
                let config = $config;
                let chunks: Vec<(i32, i32)> = $chunks;
                let build = $build;
                let build_ref: &(dyn Fn(
                    &$crate::landscape::CompileOptions,
                ) -> ::std::sync::Arc<$crate::landscape::Landscape>
                      + Sync) = &build;
                f(&kit::Case {
                    name: stringify!($name),
                    build: build_ref,
                    registry: &registry,
                    config: &config,
                    chunks: &chunks,
                });
            }

            #[test]
            fn order_and_threads() {
                with_case(kit::assert_order_and_threads);
            }

            #[test]
            fn caches_cost_only() {
                with_case(kit::assert_caches_cost_only);
            }

            #[test]
            fn grid_equals_point() {
                with_case(kit::assert_grid_equals_point);
            }

            #[test]
            fn height_map_matches_rescan() {
                with_case(kit::assert_height_map_matches_rescan);
            }

            #[test]
            fn two_process_identical() {
                let path = module_path!();
                let inner = path.split_once("::").map_or(path, |(_, rest)| rest);
                let test = format!("{inner}::two_process_identical");
                with_case(|case| kit::assert_two_process(case, &test));
            }
        }
    };
}

pub use crate::__landscape_determinism_suite as determinism_suite;
