//! v1 goldens: the frozen generator's output, pinned.
//!
//! `GeneratorSpec`, `compile`, `install` and `CompiledGenerator` are frozen
//! (crates/gen/docs/landscape.md, section 10.1): their API and their output
//! must not change, because worlds built on them persist chunks and compare
//! spec hashes on load. This file pins, for every v1 fixture
//! (`fixture_spec`, `geology_fixture_spec`, `walker_fixture_spec`) at three
//! world seeds:
//!
//! - the spec hash;
//! - a digest of 28 chunks generated through `install`'s own stage list: a
//!   walking path around the origin, four far chunks, up to four landmark
//!   chunks holding the nearest structure plans and up to four holding the
//!   nearest above-sea river channels (backup chunks fill empty slots);
//! - digests of the point queries a game calls at runtime
//!   (`surface_raw`, `steepness`, `ground_at`, `blend_at`, `axes_at`,
//!   `moisture_at`, `river_sample` with `river_column`, `lake_level`,
//!   `aquifer_level` with `sea_level`, `density_column`, and
//!   `plans_in_reach`) over a 64 x 64 lattice plus the far and channel
//!   chunks, hashing every float's bits, so a refactor that changes a
//!   query without flipping a pinned voxel still fails. The river family
//!   passes through the platform's `hypot` (crates/gen/src/channels.rs);
//!   its pins were reproduced on macOS aarch64 and Linux x86_64 alike, but
//!   that is observed, not promised (docs/landscape.md, D2 and D9).
//!
//! The same digests must come out at 1, 4 and 8 worker threads, in shuffled
//! order on a warm and on a cold generator, and in a second process. Two
//! guards keep the spec-hash pins independent of the lockfile: the
//! canonical JSON must have byte-sorted keys at every level (it would not if
//! serde_json's insertion-ordered map were unified into the build), and no
//! fixture float may reach 1e16 (serde_json releases disagree on how to
//! spell those).
//!
//! The two heavy tests run in release only (a debug build takes minutes per
//! pass); `cargo test -p voxelize-gen --release` is the command CI runs.
//! Regenerate with `UPDATE_GOLDENS=1 cargo test -p voxelize-gen --release
//! --test golden_v1`, which is only legitimate together with a deliberate
//! format or content version decision.

#[path = "fixtures/mod.rs"]
mod fixtures;

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::Command;

use fixtures::*;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use voxelize::Chunk;
use voxelize_gen::*;

/// World seeds every fixture is pinned at: the fixture's own seed, a small
/// one, and one with the top bit set.
const SEEDS: [u32; 3] = [SEED, 1, 3_141_592_653];

/// Chunks per (fixture, seed): 16 path, 4 far, 4 structure slots and 4
/// channel slots.
const CHUNKS: usize = 28;

/// Far chunks pinned for every (fixture, seed), well outside the path.
const FAR: [(i32, i32); 4] = [(37, -21), (-64, 45), (130, 96), (-211, -158)];

/// Fill-ins for landmark slots a world cannot fill.
const BACKUP: [(i32, i32); 8] = [
    (9, -13),
    (-17, 8),
    (25, 30),
    (-40, -33),
    (55, -60),
    (-70, 70),
    (90, 11),
    (-6, -95),
];

/// Structure plans are searched for in this square (blocks, around 0).
const LANDMARK_REACH: i32 = 1024;

/// Landmark slots per kind.
const STRUCTURE_LANDMARKS: usize = 4;
const CHANNEL_LANDMARKS: usize = 4;

/// Channel landmarks are searched for in this square (chunks, around 0).
/// Kept inside one geology tile cache's worth of tiles, so the search
/// never thrashes the cache it is measuring.
const CHANNEL_REACH_CHUNKS: i32 = 32;

/// Columns probed per candidate chunk in the channel search (local x and z).
const CHANNEL_PROBES: [i32; 4] = [2, 6, 10, 14];

/// Every river fixture x seed must pin at least this many chunks that hold
/// a channel column, so the river stage's output is never pinned by luck.
const MIN_CHANNEL_CHUNKS: usize = 4;

/// The point-query lattice: `QUERY_GRID` x `QUERY_GRID` columns at
/// `QUERY_STRIDE` blocks, centred on the origin (+/-416 blocks, which
/// keeps a shuffled walk over it inside the geology tile cache).
const QUERY_GRID: i32 = 64;
const QUERY_STRIDE: i32 = 13;

/// Query families, each digested separately so a failure names the query.
const FAMILIES: [&str; 10] = [
    "axes",
    "blend",
    "density",
    "ground",
    "hydro",
    "lake",
    "moisture",
    "river",
    "steepness",
    "surface",
];

const CHILD_ENV: &str = "VOXELIZE_GEN_GOLDEN_V1_CHILD_OUT";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct GoldenFile {
    about: String,
    digest: String,
    queries: String,
    fixtures: BTreeMap<String, FixtureGolden>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct FixtureGolden {
    format_version: u32,
    spec_hash: String,
    /// Seed (decimal) to what that world pins.
    seeds: BTreeMap<String, SeedGolden>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct SeedGolden {
    /// Chunk digests in pinned-list order.
    chunks: Vec<ChunkGolden>,
    /// Query family to digest (see `FAMILIES`, plus `plans`).
    queries: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct ChunkGolden {
    cx: i32,
    cz: i32,
    digest: String,
}

fn fixtures() -> Vec<(&'static str, GeneratorSpec)> {
    vec![
        ("fixture", fixture_spec()),
        ("geology_fixture", geology_fixture_spec()),
        ("walker_fixture", walker_fixture_spec()),
    ]
}

fn golden_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/golden/v1.json")
}

fn updating() -> bool {
    std::env::var("UPDATE_GOLDENS").as_deref() == Ok("1")
}

/// FNV-1a 64, fed field by field.
#[derive(Clone, Copy)]
struct Fnv(u64);

impl Fnv {
    fn new() -> Self {
        Self(0xcbf29ce484222325)
    }

    fn bytes(mut self, bytes: &[u8]) -> Self {
        for &b in bytes {
            self.0 ^= b as u64;
            self.0 = self.0.wrapping_mul(0x100000001b3);
        }
        self
    }

    fn u8(self, value: u8) -> Self {
        self.bytes(&[value])
    }

    fn u16(self, value: u16) -> Self {
        self.bytes(&value.to_le_bytes())
    }

    fn u32(self, value: u32) -> Self {
        self.bytes(&value.to_le_bytes())
    }

    fn i32(self, value: i32) -> Self {
        self.bytes(&value.to_le_bytes())
    }

    fn u64(self, value: u64) -> Self {
        self.bytes(&value.to_le_bytes())
    }

    fn f32(self, value: f32) -> Self {
        self.u32(value.to_bits())
    }

    fn f64(self, value: f64) -> Self {
        self.u64(value.to_bits())
    }

    fn len(self, value: usize) -> Self {
        self.u64(value as u64)
    }
}

/// FNV-1a 64 over everything a generated chunk carries out of the
/// generator: the raw voxel array (ids with rotation and stage bits) in
/// storage order, the height map the engine derives from it, the fill
/// watermark, the corner tints, generation-authored block entities (sorted)
/// and the extra changes (count, then each sorted write).
fn chunk_digest(harness: &Harness, mut chunk: Chunk) -> u64 {
    let mut hash = Fnv::new();
    for &voxel in &chunk.voxels.data {
        hash = hash.u32(voxel);
    }
    let watermark = chunk.top_filled_y;
    chunk.calculate_max_height(&harness.registry);
    for &height in &chunk.height_map.data {
        hash = hash.u32(height);
    }
    hash = match watermark {
        Some(top) => hash.u8(1).bytes(&top.to_le_bytes()),
        None => hash.u8(0),
    };
    hash = match chunk.biome_tints {
        Some(tints) => hash.u8(1).bytes(&tints),
        None => hash.u8(0),
    };
    let mut entities: Vec<(i32, i32, i32, u32, String)> = chunk
        .block_entity_seeds
        .iter()
        .map(|(position, (id, data))| (position.0, position.1, position.2, *id, data.clone()))
        .collect();
    entities.sort();
    hash = hash.len(entities.len());
    for (x, y, z, id, data) in entities {
        hash = hash
            .i32(x)
            .i32(y)
            .i32(z)
            .u32(id)
            .len(data.len())
            .bytes(data.as_bytes());
    }
    let mut extra: Vec<(i32, i32, i32, u32)> = chunk
        .extra_changes
        .iter()
        .map(|(position, value)| (position.0, position.1, position.2, *value))
        .collect();
    extra.sort();
    hash = hash.len(extra.len());
    for (x, y, z, value) in extra {
        hash = hash.i32(x).i32(y).i32(z).u32(value);
    }
    hash.0
}

/// The first `count` chunks of a square spiral walked out from (0, 0).
fn spiral(count: usize) -> Vec<(i32, i32)> {
    let mut out = Vec::with_capacity(count);
    let (mut x, mut z) = (0i32, 0i32);
    let (mut dx, mut dz) = (1i32, 0i32);
    let mut leg = 1;
    while out.len() < count {
        for _ in 0..2 {
            for _ in 0..leg {
                if out.len() == count {
                    return out;
                }
                out.push((x, z));
                x += dx;
                z += dz;
            }
            (dx, dz) = (-dz, dx);
        }
        leg += 1;
    }
    out
}

fn has_rivers(generator: &CompiledGenerator) -> bool {
    generator.geo().is_some() || generator.walker_rivers().is_some()
}

/// How a column relates to the rivers: 0 outside any channel, 1 inside a
/// channel, 2 inside one whose water stands at least two blocks over the
/// sea (so the river stage's water and banks show, not just a sea bed).
fn channel_class(generator: &CompiledGenerator, x: i32, z: i32) -> u8 {
    let Some(point) = generator.river_sample(x, z) else {
        return 0;
    };
    match generator.river_column(&point) {
        RiverColumn::Channel { water_y, .. } => {
            if generator.sea_level().map_or(true, |sea| water_y > sea + 1) {
                2
            } else {
                1
            }
        }
        _ => 0,
    }
}

/// The nearest chunks (by squared chunk distance, ties by coordinates)
/// whose probe columns meet a channel, above-sea channels first, skipping
/// chunks already pinned.
fn channel_landmarks(generator: &CompiledGenerator, taken: &[(i32, i32)]) -> Vec<(i32, i32)> {
    if !has_rivers(generator) {
        return Vec::new();
    }
    let reach = CHANNEL_REACH_CHUNKS;
    let mut candidates: Vec<(i64, i32, i32)> = (-reach..=reach)
        .flat_map(|cx| (-reach..=reach).map(move |cz| (cx, cz)))
        .map(|(cx, cz)| ((cx as i64).pow(2) + (cz as i64).pow(2), cx, cz))
        .collect();
    candidates.sort();
    let chunk = CHUNK as i32;
    let mut tiers: [Vec<(i32, i32)>; 2] = [Vec::new(), Vec::new()];
    for (_, cx, cz) in candidates {
        if tiers[1].len() == CHANNEL_LANDMARKS {
            break;
        }
        if taken.contains(&(cx, cz)) {
            continue;
        }
        let mut best = 0;
        for lx in CHANNEL_PROBES {
            for lz in CHANNEL_PROBES {
                best = best.max(channel_class(generator, cx * chunk + lx, cz * chunk + lz));
            }
        }
        if best > 0 {
            tiers[best as usize - 1].push((cx, cz));
        }
    }
    let [below, above] = tiers;
    above
        .into_iter()
        .chain(below)
        .take(CHANNEL_LANDMARKS)
        .collect()
}

/// The pinned chunks of one world.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ChunkPlan {
    /// All of them, in pinned order: 16 path chunks, the far chunks, the
    /// structure landmarks, the channel landmarks, then backups up to
    /// `CHUNKS`.
    list: Vec<(i32, i32)>,
    /// How many structure landmarks the world offered (up to
    /// `STRUCTURE_LANDMARKS`).
    structures: usize,
    /// The channel landmarks alone (their probe columns join the query set).
    channels: Vec<(i32, i32)>,
}

/// Plans the pinned chunk list: structure landmarks are the chunks holding
/// the nearest structure plans (by distance of the plan's box centre, ties
/// by coordinates); channel landmarks come from `channel_landmarks`.
fn chunk_plan(generator: &CompiledGenerator) -> ChunkPlan {
    let mut list = spiral(16);
    list.extend_from_slice(&FAR);

    let plans = generator.plans_in_reach(
        (-LANDMARK_REACH, -LANDMARK_REACH),
        (LANDMARK_REACH, LANDMARK_REACH),
    );
    let mut landmarks: Vec<(i64, i32, i32)> = plans
        .iter()
        .map(|plan| {
            let x = (plan.bbox_min.0 + plan.bbox_max.0).div_euclid(2);
            let z = (plan.bbox_min.2 + plan.bbox_max.2).div_euclid(2);
            let d = (x as i64) * (x as i64) + (z as i64) * (z as i64);
            (d, x.div_euclid(CHUNK as i32), z.div_euclid(CHUNK as i32))
        })
        .collect();
    landmarks.sort();
    let mut structures = 0;
    for (_, cx, cz) in landmarks {
        if structures == STRUCTURE_LANDMARKS {
            break;
        }
        if !list.contains(&(cx, cz)) {
            list.push((cx, cz));
            structures += 1;
        }
    }

    let channels = channel_landmarks(generator, &list);
    list.extend_from_slice(&channels);

    for chunk in BACKUP {
        if list.len() == CHUNKS {
            break;
        }
        if !list.contains(&chunk) {
            list.push(chunk);
        }
    }
    assert_eq!(list.len(), CHUNKS);
    ChunkPlan {
        list,
        structures,
        channels,
    }
}

/// Pinned chunks that hold at least one channel column (any of their 256).
fn channel_chunk_count(generator: &CompiledGenerator, list: &[(i32, i32)]) -> usize {
    let chunk = CHUNK as i32;
    list.iter()
        .filter(|&&(cx, cz)| {
            (0..chunk).any(|lx| {
                (0..chunk).any(|lz| channel_class(generator, cx * chunk + lx, cz * chunk + lz) > 0)
            })
        })
        .count()
}

/// The point-query columns: the lattice, the far chunks' centres, and the
/// channel landmarks' probe columns (so `river_column` meets real
/// channels and banks).
fn query_points(plan: &ChunkPlan) -> Vec<(i32, i32)> {
    let chunk = CHUNK as i32;
    let half = QUERY_GRID / 2;
    let mut points: Vec<(i32, i32)> = (0..QUERY_GRID)
        .flat_map(|i| (0..QUERY_GRID).map(move |j| (i, j)))
        .map(|(i, j)| ((i - half) * QUERY_STRIDE + 5, (j - half) * QUERY_STRIDE - 3))
        .collect();
    points.extend(FAR.iter().map(|&(cx, cz)| (cx * chunk + 8, cz * chunk + 8)));
    for &(cx, cz) in &plan.channels {
        for lx in CHANNEL_PROBES {
            for lz in CHANNEL_PROBES {
                points.push((cx * chunk + lx, cz * chunk + lz));
            }
        }
    }
    points
}

/// One column's answers, hashed per family (in `FAMILIES` order).
fn point_record(generator: &CompiledGenerator, x: i32, z: i32) -> [u64; FAMILIES.len()] {
    let start = || Fnv::new().i32(x).i32(z);
    let surface = generator.surface_raw(x, z);
    let steepness = generator.steepness(x, z);

    let mut axes = start();
    let values = generator.axes_at(x, z);
    axes = axes.len(values.len());
    for value in &values {
        axes = axes.f64(*value);
    }

    let blend = generator.blend_at(x, z, surface);
    let mut blend_hash = start().u16(blend.primary.0).len(blend.weights.len());
    for (id, weight) in &blend.weights {
        blend_hash = blend_hash.u16(id.0).f32(*weight);
    }
    blend_hash = blend_hash.f32(blend.margin);

    let column = generator.density_column(x, z, steepness);
    let density = start()
        .f64(column.shelf_gate)
        .f64(column.notch_gate)
        .f64(column.waterline);

    let river = match generator.river_sample(x, z) {
        None => start().u8(0),
        Some(point) => {
            let hash = start()
                .u8(1)
                .f64(point.dist)
                .f64(point.water_y)
                .f64(point.half_width)
                .f64(point.depth)
                .f64(point.bend);
            match generator.river_column(&point) {
                RiverColumn::Channel { bed, water_y } => hash.u8(1).i32(bed).i32(water_y),
                RiverColumn::Bank { raise_to, water_y } => hash.u8(2).i32(raise_to).i32(water_y),
                RiverColumn::Outside => hash.u8(0),
            }
        }
    };

    let lake = match generator.lake_level(x, z) {
        None => start().u8(0),
        Some(level) => start().u8(1).f64(level),
    };

    [
        axes.0,
        blend_hash.0,
        density.0,
        start().i32(generator.ground_at(x, z)).0,
        start().i32(generator.aquifer_level(x, z)).0,
        lake.0,
        start().f64(generator.moisture_at(x, z)).0,
        river.0,
        start().f64(steepness).0,
        start().i32(surface).0,
    ]
}

/// `plans_in_reach` over the landmark square, every field, in a sorted
/// order (the call's own order is not part of its contract).
fn plans_digest(generator: &CompiledGenerator) -> u64 {
    let plans = generator.plans_in_reach(
        (-LANDMARK_REACH, -LANDMARK_REACH),
        (LANDMARK_REACH, LANDMARK_REACH),
    );
    let mut records: Vec<Vec<u8>> = plans
        .iter()
        .map(|plan| {
            let mut out = Vec::new();
            let mut push = |bytes: &[u8]| out.extend_from_slice(bytes);
            for value in [plan.bbox_min, plan.bbox_max, plan.anchor] {
                for v in [value.0, value.1, value.2] {
                    push(&v.to_be_bytes());
                }
            }
            push(&plan.site.0.to_be_bytes());
            push(&plan.site.1.to_be_bytes());
            push(&(plan.set as u64).to_be_bytes());
            push(&(plan.member.len() as u64).to_be_bytes());
            push(plan.member.as_bytes());
            push(&(plan.pieces.len() as u64).to_be_bytes());
            for piece in &plan.pieces {
                push(&(piece.piece as u64).to_be_bytes());
                push(&[piece.rotation]);
                for v in [piece.min.0, piece.min.1, piece.min.2] {
                    push(&v.to_be_bytes());
                }
            }
            match &plan.ground_patch {
                None => push(&[0]),
                Some(patch) => {
                    push(&[1]);
                    for v in [
                        patch.min_x,
                        patch.min_z,
                        patch.max_x,
                        patch.max_z,
                        patch.target_y,
                    ] {
                        push(&v.to_be_bytes());
                    }
                    push(&[patch.falloff]);
                }
            }
            out
        })
        .collect();
    records.sort();
    let mut hash = Fnv::new().len(records.len());
    for record in &records {
        hash = hash.len(record.len()).bytes(record);
    }
    hash.0
}

/// Every query digest for one world. Points are evaluated in the given
/// order (on the current rayon pool when `parallel`) and folded in
/// canonical order, so the digest is independent of evaluation order.
fn query_digests(
    generator: &CompiledGenerator,
    points: &[(i32, i32)],
    order: &[usize],
    parallel: bool,
) -> BTreeMap<String, String> {
    let records: Vec<(usize, [u64; FAMILIES.len()])> = if parallel {
        order
            .par_iter()
            .map(|&index| {
                let (x, z) = points[index];
                (index, point_record(generator, x, z))
            })
            .collect()
    } else {
        order
            .iter()
            .map(|&index| {
                let (x, z) = points[index];
                (index, point_record(generator, x, z))
            })
            .collect()
    };
    let mut by_point = vec![[0u64; FAMILIES.len()]; points.len()];
    for (index, record) in records {
        by_point[index] = record;
    }
    let mut out = BTreeMap::new();
    for (family_index, family) in FAMILIES.iter().enumerate() {
        let mut hash = Fnv::new().len(points.len());
        if *family == "hydro" {
            // The sea level is one value per world; it rides with the
            // per-column aquifer answers.
            hash = match generator.sea_level() {
                Some(sea) => hash.u8(1).i32(sea),
                None => hash.u8(0),
            };
        }
        for record in &by_point {
            hash = hash.u64(record[family_index]);
        }
        out.insert(family.to_string(), format!("{:016x}", hash.0));
    }
    out.insert(
        "plans".to_string(),
        format!("{:016x}", plans_digest(generator)),
    );
    out
}

fn shuffled(len: usize, seed: u64) -> Vec<usize> {
    let mut order: Vec<usize> = (0..len).collect();
    let mut stream = HashStream::new(seed);
    for i in (1..order.len()).rev() {
        let j = (stream.raw() % (i as u64 + 1)) as usize;
        order.swap(i, j);
    }
    order
}

#[derive(Clone, Copy, Debug)]
enum Pass {
    /// Fresh generator, one thread: queries first (cold), then the chunks
    /// in path order.
    Serial,
    /// The serial pass's generator again (caches warm): chunks, then
    /// queries, both shuffled.
    ShuffledWarm,
    /// Fresh generator, one thread: chunks, then queries, both shuffled.
    ShuffledCold,
    /// Fresh generator on a pool of this many threads: chunks and queries
    /// at once, cold caches filled concurrently.
    Threads(usize),
}

/// Pins for one pass, keyed like the golden file.
type Pins = BTreeMap<String, FixtureGolden>;

/// What the planner found for one world (for the coverage checks).
#[derive(Debug)]
struct Coverage {
    fixture: String,
    seed: u32,
    rivers: bool,
    structures: usize,
    channels: usize,
    /// Pinned chunks holding at least one channel column.
    channel_chunks: usize,
}

fn seed_golden(
    list: &[(i32, i32)],
    digests: Vec<u64>,
    queries: BTreeMap<String, String>,
) -> SeedGolden {
    SeedGolden {
        chunks: list
            .iter()
            .zip(digests)
            .map(|(&(cx, cz), digest)| ChunkGolden {
                cx,
                cz,
                digest: format!("{digest:016x}"),
            })
            .collect(),
        queries,
    }
}

/// Generates every (fixture, seed) once per pass and returns the pins each
/// pass produced, plus what the planner found.
fn compute(passes: &[Pass]) -> (Vec<(Pass, Pins)>, Vec<Coverage>) {
    let mut results: Vec<(Pass, Pins)> =
        passes.iter().map(|&pass| (pass, BTreeMap::new())).collect();
    let mut coverage = Vec::new();
    for (name, spec) in fixtures() {
        for seed in SEEDS {
            // The landmark search runs on its own generator, so every pass
            // below starts with every cache cold.
            let planner = harness_for_seed(spec.clone(), seed);
            let plan = chunk_plan(&planner.generator);
            let list = &plan.list;
            let points = query_points(&plan);
            coverage.push(Coverage {
                fixture: name.to_string(),
                seed,
                rivers: has_rivers(&planner.generator),
                structures: plan.structures,
                channels: plan.channels.len(),
                channel_chunks: channel_chunk_count(&planner.generator, list),
            });
            let in_order: Vec<usize> = (0..list.len()).collect();
            let points_in_order: Vec<usize> = (0..points.len()).collect();
            let chunk_shuffle = shuffled(list.len(), seed as u64 ^ 0x5eed);
            let point_shuffle = shuffled(points.len(), seed as u64 ^ 0x9e37);

            let generate = |harness: &Harness, order: &[usize]| -> Vec<u64> {
                let mut digests = vec![0u64; list.len()];
                for &index in order {
                    let (cx, cz) = list[index];
                    digests[index] = chunk_digest(harness, harness.generate_chunk(cx, cz));
                }
                digests
            };

            let serial_harness = harness_for_seed(spec.clone(), seed);
            for (pass, out) in results.iter_mut() {
                let golden = match *pass {
                    Pass::Serial => {
                        let queries = query_digests(
                            &serial_harness.generator,
                            &points,
                            &points_in_order,
                            false,
                        );
                        seed_golden(list, generate(&serial_harness, &in_order), queries)
                    }
                    Pass::ShuffledWarm => {
                        let digests = generate(&serial_harness, &chunk_shuffle);
                        let queries = query_digests(
                            &serial_harness.generator,
                            &points,
                            &point_shuffle,
                            false,
                        );
                        seed_golden(list, digests, queries)
                    }
                    Pass::ShuffledCold => {
                        let harness = harness_for_seed(spec.clone(), seed);
                        let digests = generate(&harness, &chunk_shuffle);
                        let queries =
                            query_digests(&harness.generator, &points, &point_shuffle, false);
                        seed_golden(list, digests, queries)
                    }
                    Pass::Threads(threads) => {
                        let harness = harness_for_seed(spec.clone(), seed);
                        let pool = rayon::ThreadPoolBuilder::new()
                            .num_threads(threads)
                            .build()
                            .expect("thread pool");
                        let (digests, queries) = pool.install(|| {
                            rayon::join(
                                || {
                                    list.par_iter()
                                        .map(|&(cx, cz)| {
                                            chunk_digest(&harness, harness.generate_chunk(cx, cz))
                                        })
                                        .collect::<Vec<u64>>()
                                },
                                || query_digests(&harness.generator, &points, &point_shuffle, true),
                            )
                        });
                        seed_golden(list, digests, queries)
                    }
                };
                out.entry(name.to_string())
                    .or_insert_with(|| FixtureGolden {
                        format_version: planner.generator.identity.format_version,
                        spec_hash: format!("{:016x}", planner.generator.identity.spec_hash),
                        seeds: BTreeMap::new(),
                    })
                    .seeds
                    .insert(seed.to_string(), golden);
            }
        }
    }
    (results, coverage)
}

fn golden_file(fixtures: Pins) -> GoldenFile {
    GoldenFile {
        about: "v1 generator goldens: spec hashes, chunk digests and point-query digests for \
                every v1 fixture at three world seeds. Written by crates/gen/tests/golden_v1.rs \
                with UPDATE_GOLDENS=1; any change is a world-breaking change."
            .to_string(),
        digest: "fnv1a-64 over raw voxels (u32 LE, storage order), the derived height map, the \
                 fill watermark, corner tints, sorted block entities and sorted extra changes"
            .to_string(),
        queries: "fnv1a-64 per query family over a 64x64 lattice at stride 37 plus the far \
                  chunks' centres and the channel landmarks' probe columns, folded in lattice \
                  order; floats hashed by their bits; plans: every field of plans_in_reach over \
                  +/-1024 blocks, sorted"
            .to_string(),
        fixtures,
    }
}

fn read_golden() -> GoldenFile {
    let path = golden_path();
    let text = std::fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!(
            "{} is missing ({error}); run with UPDATE_GOLDENS=1 to create it",
            path.display()
        )
    });
    serde_json::from_str(&text).expect("golden file parses")
}

/// Writes the golden file through a temporary file and a rename, so a
/// concurrent reader never sees half of it.
fn write_golden(golden: &GoldenFile) {
    let path = golden_path();
    let dir = path.parent().expect("golden dir");
    std::fs::create_dir_all(dir).expect("golden dir");
    let text = serde_json::to_string_pretty(golden).expect("serializes");
    let temporary = dir.join(format!(".v1.json.{}.tmp", std::process::id()));
    std::fs::write(&temporary, format!("{text}\n")).expect("write golden");
    std::fs::rename(&temporary, &path).expect("replace golden");
    println!("wrote {}", path.display());
}

/// Lists every difference between two pin sets, so a failure names the
/// fixture, seed, chunk or query instead of dumping both files.
fn differences(label: &str, expected: &Pins, actual: &Pins) -> Vec<String> {
    let mut out = Vec::new();
    for (name, want) in expected {
        let Some(got) = actual.get(name) else {
            out.push(format!("{label}: fixture {name} missing"));
            continue;
        };
        if want.spec_hash != got.spec_hash {
            out.push(format!(
                "{label}: {name} spec_hash {} != pinned {}",
                got.spec_hash, want.spec_hash
            ));
        }
        if want.format_version != got.format_version {
            out.push(format!(
                "{label}: {name} format_version {} != pinned {}",
                got.format_version, want.format_version
            ));
        }
        for (seed, want_seed) in &want.seeds {
            let Some(got_seed) = got.seeds.get(seed) else {
                out.push(format!("{label}: {name} seed {seed} missing"));
                continue;
            };
            if want_seed.chunks.len() != got_seed.chunks.len() {
                out.push(format!("{label}: {name} seed {seed} chunk count differs"));
            }
            for (want_chunk, got_chunk) in want_seed.chunks.iter().zip(&got_seed.chunks) {
                if want_chunk != got_chunk {
                    out.push(format!(
                        "{label}: {name} seed {seed} chunk ({}, {}) digest {} != pinned ({}, {}) {}",
                        got_chunk.cx,
                        got_chunk.cz,
                        got_chunk.digest,
                        want_chunk.cx,
                        want_chunk.cz,
                        want_chunk.digest
                    ));
                }
            }
            for (family, want_digest) in &want_seed.queries {
                match got_seed.queries.get(family) {
                    Some(got_digest) if got_digest == want_digest => {}
                    Some(got_digest) => out.push(format!(
                        "{label}: {name} seed {seed} query {family} digest {got_digest} != pinned {want_digest}"
                    )),
                    None => out.push(format!("{label}: {name} seed {seed} query {family} missing")),
                }
            }
            for family in got_seed.queries.keys() {
                if !want_seed.queries.contains_key(family) {
                    out.push(format!(
                        "{label}: {name} seed {seed} query {family} is not pinned"
                    ));
                }
            }
        }
    }
    for name in actual.keys() {
        if !expected.contains_key(name) {
            out.push(format!("{label}: fixture {name} is not pinned"));
        }
    }
    out
}

#[test]
#[cfg_attr(
    debug_assertions,
    ignore = "release only: cargo test -p voxelize-gen --release --test golden_v1"
)]
fn v1_goldens_hold_at_1_4_8_threads_and_shuffled() {
    let passes = [
        Pass::Serial,
        Pass::ShuffledWarm,
        Pass::ShuffledCold,
        Pass::Threads(4),
        Pass::Threads(8),
    ];
    let (results, coverage) = compute(&passes);
    for world in &coverage {
        println!(
            "{} seed {}: {} structure landmarks, {} channel landmarks, {} pinned chunks hold a \
             channel",
            world.fixture, world.seed, world.structures, world.channels, world.channel_chunks
        );
    }

    if updating() {
        write_golden(&golden_file(results[0].1.clone()));
    }

    let golden = read_golden();
    assert_eq!(
        golden,
        golden_file(golden.fixtures.clone()),
        "golden header drifted"
    );
    let mut problems = Vec::new();
    for (pass, pins) in &results {
        problems.extend(differences(&format!("{pass:?}"), &golden.fixtures, pins));
    }
    assert!(
        problems.is_empty(),
        "v1 output drifted from tests/golden/v1.json:\n  {}",
        problems.join("\n  ")
    );

    // Coverage the pins must keep.
    let fixture_count = fixtures().len();
    let chunk_count: usize = golden
        .fixtures
        .values()
        .flat_map(|fixture| fixture.seeds.values())
        .map(|seed| seed.chunks.len())
        .sum();
    assert_eq!(
        chunk_count,
        fixture_count * SEEDS.len() * CHUNKS,
        "golden chunk coverage shrank"
    );
    for fixture in golden.fixtures.values() {
        for seed in fixture.seeds.values() {
            assert_eq!(
                seed.queries.len(),
                FAMILIES.len() + 1,
                "golden query coverage shrank"
            );
        }
    }
    for world in coverage.iter().filter(|world| world.rivers) {
        assert!(
            world.channel_chunks >= MIN_CHANNEL_CHUNKS,
            "{} seed {}: only {} pinned chunks hold a river channel (need {MIN_CHANNEL_CHUNKS})",
            world.fixture,
            world.seed,
            world.channel_chunks
        );
    }
}

/// The child half of the two-process run. A no-op unless the parent sets
/// the output path.
#[test]
fn v1_goldens_child_process() {
    let Ok(out) = std::env::var(CHILD_ENV) else {
        return;
    };
    let (results, _) = compute(&[Pass::Serial]);
    let text = serde_json::to_string(&results[0].1).expect("serializes");
    std::fs::write(out, text).expect("child writes digests");
}

#[test]
#[cfg_attr(
    debug_assertions,
    ignore = "release only: cargo test -p voxelize-gen --release --test golden_v1"
)]
fn v1_goldens_hold_in_a_second_process() {
    let out = std::env::temp_dir().join(format!(
        "voxelize-gen-golden-v1-{}-{}.json",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    let status = Command::new(std::env::current_exe().expect("test binary"))
        .args([
            "v1_goldens_child_process",
            "--exact",
            "--test-threads",
            "1",
            "--nocapture",
        ])
        .env(CHILD_ENV, &out)
        .env_remove("UPDATE_GOLDENS")
        .status()
        .expect("child process runs");
    assert!(status.success(), "child process failed: {status}");
    let text = std::fs::read_to_string(&out).expect("child wrote digests");
    let _ = std::fs::remove_file(&out);
    let child: Pins = serde_json::from_str(&text).expect("child digests parse");

    let here = compute(&[Pass::Serial]).0.remove(0).1;
    let problems = differences("second process vs this process", &here, &child);
    assert!(problems.is_empty(), "{}", problems.join("\n"));
    // While the goldens are being rewritten by the test above, the file on
    // disk may still hold the old pins; the process comparison is the
    // point of this test, and the writer checks the new pins itself.
    if !updating() {
        let problems = differences("second process vs golden", &read_golden().fixtures, &child);
        assert!(problems.is_empty(), "{}", problems.join("\n"));
    }
}

/// A minimal scanner over canonical JSON text: checks that every object's
/// keys are strictly increasing in byte order and collects every float
/// literal (one with a fraction or an exponent).
struct CanonScan<'a> {
    text: &'a [u8],
    at: usize,
    floats: Vec<(String, String)>,
    objects: usize,
}

impl<'a> CanonScan<'a> {
    fn new(text: &'a str) -> Self {
        Self {
            text: text.as_bytes(),
            at: 0,
            floats: Vec::new(),
            objects: 0,
        }
    }

    fn peek(&self) -> Option<u8> {
        self.text.get(self.at).copied()
    }

    fn expect(&mut self, byte: u8, path: &str) -> Result<(), String> {
        if self.peek() == Some(byte) {
            self.at += 1;
            Ok(())
        } else {
            Err(format!(
                "expected '{}' at byte {} ({path})",
                byte as char, self.at
            ))
        }
    }

    fn string(&mut self, path: &str) -> Result<String, String> {
        self.expect(b'"', path)?;
        let mut out = String::new();
        loop {
            let Some(byte) = self.peek() else {
                return Err(format!("unterminated string ({path})"));
            };
            self.at += 1;
            match byte {
                b'"' => return Ok(out),
                b'\\' => {
                    let escape = self.peek().ok_or("dangling escape")?;
                    self.at += 1;
                    match escape {
                        b'"' => out.push('"'),
                        b'\\' => out.push('\\'),
                        b'/' => out.push('/'),
                        b'b' => out.push('\u{8}'),
                        b'f' => out.push('\u{c}'),
                        b'n' => out.push('\n'),
                        b'r' => out.push('\r'),
                        b't' => out.push('\t'),
                        b'u' => {
                            let hex = std::str::from_utf8(&self.text[self.at..self.at + 4])
                                .map_err(|e| e.to_string())?;
                            let code = u32::from_str_radix(hex, 16).map_err(|e| e.to_string())?;
                            self.at += 4;
                            out.push(char::from_u32(code).unwrap_or('\u{fffd}'));
                        }
                        other => return Err(format!("bad escape \\{} ({path})", other as char)),
                    }
                }
                _ => {
                    let start = self.at - 1;
                    let mut end = self.at;
                    while end < self.text.len() && self.text[end] != b'"' && self.text[end] != b'\\'
                    {
                        end += 1;
                    }
                    out.push_str(
                        std::str::from_utf8(&self.text[start..end]).map_err(|e| e.to_string())?,
                    );
                    self.at = end;
                }
            }
        }
    }

    fn value(&mut self, path: &str) -> Result<(), String> {
        match self
            .peek()
            .ok_or_else(|| format!("unexpected end ({path})"))?
        {
            b'{' => {
                self.at += 1;
                self.objects += 1;
                let mut previous: Option<String> = None;
                if self.peek() == Some(b'}') {
                    self.at += 1;
                    return Ok(());
                }
                loop {
                    let key = self.string(path)?;
                    if let Some(previous) = &previous {
                        if previous.as_bytes() >= key.as_bytes() {
                            return Err(format!(
                                "object keys out of byte order at {path}: {previous:?} then {key:?}"
                            ));
                        }
                    }
                    self.expect(b':', path)?;
                    self.value(&format!("{path}.{key}"))?;
                    previous = Some(key);
                    match self.peek() {
                        Some(b',') => self.at += 1,
                        Some(b'}') => {
                            self.at += 1;
                            return Ok(());
                        }
                        _ => return Err(format!("expected ',' or '}}' at byte {}", self.at)),
                    }
                }
            }
            b'[' => {
                self.at += 1;
                if self.peek() == Some(b']') {
                    self.at += 1;
                    return Ok(());
                }
                let mut index = 0;
                loop {
                    self.value(&format!("{path}.{index}"))?;
                    index += 1;
                    match self.peek() {
                        Some(b',') => self.at += 1,
                        Some(b']') => {
                            self.at += 1;
                            return Ok(());
                        }
                        _ => return Err(format!("expected ',' or ']' at byte {}", self.at)),
                    }
                }
            }
            b'"' => self.string(path).map(|_| ()),
            b't' | b'f' | b'n' => {
                for literal in [&b"true"[..], b"false", b"null"] {
                    if self.text[self.at..].starts_with(literal) {
                        self.at += literal.len();
                        return Ok(());
                    }
                }
                Err(format!("bad literal at byte {}", self.at))
            }
            _ => {
                let start = self.at;
                while let Some(byte) = self.peek() {
                    if byte.is_ascii_digit() || matches!(byte, b'-' | b'+' | b'.' | b'e' | b'E') {
                        self.at += 1;
                    } else {
                        break;
                    }
                }
                if start == self.at {
                    return Err(format!("unexpected byte at {start} ({path})"));
                }
                let literal = std::str::from_utf8(&self.text[start..self.at])
                    .map_err(|e| e.to_string())?
                    .to_string();
                if literal.contains(['.', 'e', 'E']) {
                    self.floats.push((path.to_string(), literal));
                }
                Ok(())
            }
        }
    }
}

#[test]
fn v1_spec_json_is_canonical_and_lockfile_independent() {
    // The canonical form relies on serde_json's default map sorting its
    // keys. If any crate in a build unified in serde_json's insertion-order
    // map, every v1 spec hash would silently change; fail loudly instead.
    let mut map = serde_json::Map::new();
    map.insert("b".to_string(), serde_json::Value::from(1));
    map.insert("a".to_string(), serde_json::Value::from(2));
    assert_eq!(
        serde_json::to_string(&serde_json::Value::Object(map)).expect("serializes"),
        r#"{"a":2,"b":1}"#,
        "serde_json's map no longer sorts keys; v1 spec hashes would change"
    );

    let registry = fixture_registry();
    for (name, spec) in fixtures() {
        let generator = compile(&spec, &registry, &fixture_config()).expect("fixture compiles");
        let json = generator.spec_json();
        assert_eq!(
            fnv1a_64(json.as_bytes()),
            generator.identity.spec_hash,
            "{name}: spec_hash is no longer FNV-1a over the canonical JSON"
        );
        let mut scan = CanonScan::new(json);
        scan.value("$")
            .unwrap_or_else(|error| panic!("{name}: canonical JSON is not canonical: {error}"));
        assert_eq!(scan.at, json.len(), "{name}: trailing bytes after the spec");
        assert!(scan.objects > 10, "{name}: scanned too few objects");
        assert!(!scan.floats.is_empty(), "{name}: scanned no floats");
        // serde_json releases spell floats at or above 1e16 differently
        // ("1e16" vs "1e+16"); below that they agree, so the pinned hashes
        // hold under any lockfile.
        for (path, literal) in &scan.floats {
            let value: f64 = literal
                .parse()
                .unwrap_or_else(|_| panic!("{name}: unparseable float {literal} at {path}"));
            assert!(
                value.abs() < 1e16,
                "{name}: float {literal} at {path} is at or above 1e16; its spelling depends on \
                 the serde_json release, so the v1 spec_hash pin would depend on the lockfile"
            );
            assert!(
                !literal.contains('+'),
                "{name}: float {literal} at {path} uses a formatter-specific exponent sign"
            );
        }
    }
}

#[test]
fn spec_hash_is_seed_independent() {
    // Seeds enter the identity separately; the pins above store one spec
    // hash per fixture and rely on this.
    let registry = fixture_registry();
    for (name, spec) in fixtures() {
        let hashes: Vec<u64> = SEEDS
            .iter()
            .map(|&seed| {
                compile(&spec, &registry, &fixture_config_seeded(seed))
                    .expect("fixture compiles")
                    .identity
                    .spec_hash
            })
            .collect();
        assert!(
            hashes.windows(2).all(|pair| pair[0] == pair[1]),
            "{name}: spec_hash depends on the world seed"
        );
    }
}
