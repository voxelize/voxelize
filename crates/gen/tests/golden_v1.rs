//! v1 goldens: the frozen generator's output, pinned.
//!
//! `GeneratorSpec`, `compile`, `install` and `CompiledGenerator` are frozen
//! (crates/gen/docs/landscape.md, section 10.1): their API and their output
//! must not change, because worlds built on them persist chunks and compare
//! spec hashes on load. This file pins, for every v1 fixture
//! (`fixture_spec`, `geology_fixture_spec`, `walker_fixture_spec`) at three
//! world seeds, the spec hash and a digest of 24 generated chunks: a walking
//! path around the origin, four far chunks, and up to four landmark chunks
//! holding the nearest structure plans.
//!
//! The same digests must come out at 1, 4 and 8 worker threads, in shuffled
//! order on a warm generator, and in a second process. Two guards keep the
//! spec-hash pins independent of the lockfile: the canonical JSON must have
//! byte-sorted keys at every level (it would not if serde_json's
//! insertion-ordered map were unified into the build), and no fixture float
//! may reach 1e16 (serde_json releases disagree on how to spell those).
//!
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

/// Chunks per (fixture, seed).
const CHUNKS: usize = 24;

/// Far chunks pinned for every (fixture, seed), well outside the path.
const FAR: [(i32, i32); 4] = [(37, -21), (-64, 45), (130, 96), (-211, -158)];

/// Fill-ins when a world has fewer than four structure plans in reach.
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

const CHILD_ENV: &str = "VOXELIZE_GEN_GOLDEN_V1_CHILD_OUT";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct GoldenFile {
    about: String,
    digest: String,
    fixtures: BTreeMap<String, FixtureGolden>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct FixtureGolden {
    format_version: u32,
    spec_hash: String,
    /// Seed (decimal) to its chunk list, in generation-path order.
    seeds: BTreeMap<String, Vec<ChunkGolden>>,
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

fn fnv_bytes(mut hash: u64, bytes: &[u8]) -> u64 {
    for &b in bytes {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

/// FNV-1a 64 over everything a generated chunk carries out of the
/// generator: the raw voxel array (ids with rotation and stage bits) in
/// storage order, the height map the engine derives from it, the fill
/// watermark, the corner tints, generation-authored block entities (sorted)
/// and the extra-change count.
fn chunk_digest(harness: &Harness, mut chunk: Chunk) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for &voxel in &chunk.voxels.data {
        hash = fnv_bytes(hash, &voxel.to_le_bytes());
    }
    let watermark = chunk.top_filled_y;
    chunk.calculate_max_height(&harness.registry);
    for &height in &chunk.height_map.data {
        hash = fnv_bytes(hash, &height.to_le_bytes());
    }
    match watermark {
        Some(top) => hash = fnv_bytes(fnv_bytes(hash, &[1]), &top.to_le_bytes()),
        None => hash = fnv_bytes(hash, &[0]),
    }
    match chunk.biome_tints {
        Some(tints) => hash = fnv_bytes(fnv_bytes(hash, &[1]), &tints),
        None => hash = fnv_bytes(hash, &[0]),
    }
    let mut entities: Vec<(i32, i32, i32, u32, String)> = chunk
        .block_entity_seeds
        .iter()
        .map(|(position, (id, data))| (position.0, position.1, position.2, *id, data.clone()))
        .collect();
    entities.sort();
    hash = fnv_bytes(hash, &(entities.len() as u64).to_le_bytes());
    for (x, y, z, id, data) in entities {
        for value in [x, y, z] {
            hash = fnv_bytes(hash, &value.to_le_bytes());
        }
        hash = fnv_bytes(hash, &id.to_le_bytes());
        hash = fnv_bytes(hash, &(data.len() as u64).to_le_bytes());
        hash = fnv_bytes(hash, data.as_bytes());
    }
    fnv_bytes(hash, &(chunk.extra_changes.len() as u64).to_le_bytes())
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

/// The pinned chunk list for one generator: 16 path chunks, the far
/// chunks, then the chunks holding the nearest structure plans (by
/// distance of the plan's box centre, ties by coordinates), filled up to
/// `CHUNKS` from `BACKUP`.
fn chunk_list(harness: &Harness) -> Vec<(i32, i32)> {
    let mut list = spiral(16);
    list.extend_from_slice(&FAR);

    let plans = harness.generator.plans_in_reach(
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
    for (_, cx, cz) in landmarks {
        if list.len() == CHUNKS {
            break;
        }
        if !list.contains(&(cx, cz)) {
            list.push((cx, cz));
        }
    }
    for chunk in BACKUP {
        if list.len() == CHUNKS {
            break;
        }
        if !list.contains(&chunk) {
            list.push(chunk);
        }
    }
    assert_eq!(list.len(), CHUNKS);
    list
}

#[derive(Clone, Copy, Debug)]
enum Pass {
    /// Fresh generator, one thread, path order: the 1-thread run.
    Serial,
    /// The serial pass's generator again (caches warm), shuffled order.
    ShuffledWarm,
    /// Fresh generator on a pool of this many threads, cold caches filled
    /// concurrently.
    Threads(usize),
}

/// Generates every (fixture, seed) once per pass and returns the golden
/// structure each pass produced.
fn compute(passes: &[Pass]) -> Vec<(Pass, BTreeMap<String, FixtureGolden>)> {
    let mut results: Vec<(Pass, BTreeMap<String, FixtureGolden>)> =
        passes.iter().map(|&pass| (pass, BTreeMap::new())).collect();
    for (name, spec) in fixtures() {
        for seed in SEEDS {
            // The landmark search runs on its own generator, so the serial
            // and threaded passes start with every cache cold.
            let planner = harness_for_seed(spec.clone(), seed);
            let list = chunk_list(&planner);
            let serial_harness = harness_for_seed(spec.clone(), seed);
            for (pass, out) in results.iter_mut() {
                let digests: Vec<u64> = match *pass {
                    Pass::Serial => list
                        .iter()
                        .map(|&(cx, cz)| {
                            chunk_digest(&serial_harness, serial_harness.generate_chunk(cx, cz))
                        })
                        .collect(),
                    Pass::ShuffledWarm => {
                        let mut order: Vec<usize> = (0..list.len()).collect();
                        let mut stream = HashStream::new(seed as u64 ^ 0x5eed);
                        for i in (1..order.len()).rev() {
                            let j = (stream.raw() % (i as u64 + 1)) as usize;
                            order.swap(i, j);
                        }
                        let mut digests = vec![0u64; list.len()];
                        for index in order {
                            let (cx, cz) = list[index];
                            digests[index] = chunk_digest(
                                &serial_harness,
                                serial_harness.generate_chunk(cx, cz),
                            );
                        }
                        digests
                    }
                    Pass::Threads(threads) => {
                        let harness = harness_for_seed(spec.clone(), seed);
                        let pool = rayon::ThreadPoolBuilder::new()
                            .num_threads(threads)
                            .build()
                            .expect("thread pool");
                        let digests = pool.install(|| {
                            list.par_iter()
                                .map(|&(cx, cz)| {
                                    chunk_digest(&harness, harness.generate_chunk(cx, cz))
                                })
                                .collect()
                        });
                        assert_eq!(chunk_list(&harness), list, "landmark search diverged");
                        digests
                    }
                };
                let entry = out
                    .entry(name.to_string())
                    .or_insert_with(|| FixtureGolden {
                        format_version: planner.generator.identity.format_version,
                        spec_hash: format!("{:016x}", planner.generator.identity.spec_hash),
                        seeds: BTreeMap::new(),
                    });
                entry.seeds.insert(
                    seed.to_string(),
                    list.iter()
                        .zip(digests)
                        .map(|(&(cx, cz), digest)| ChunkGolden {
                            cx,
                            cz,
                            digest: format!("{digest:016x}"),
                        })
                        .collect(),
                );
            }
        }
    }
    results
}

fn golden_file(fixtures: BTreeMap<String, FixtureGolden>) -> GoldenFile {
    GoldenFile {
        about: "v1 generator goldens: spec hashes and chunk digests for every v1 fixture at three \
                world seeds. Written by crates/gen/tests/golden_v1.rs with UPDATE_GOLDENS=1; \
                any change is a world-breaking change."
            .to_string(),
        digest: "fnv1a-64 over raw voxels (u32 LE, storage order), the derived height map, the \
                 fill watermark, corner tints, sorted block entities and the extra-change count"
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

/// Lists every difference between two golden structures, so a failure
/// names the fixture, seed and chunk instead of dumping both files.
fn differences(
    label: &str,
    expected: &BTreeMap<String, FixtureGolden>,
    actual: &BTreeMap<String, FixtureGolden>,
) -> Vec<String> {
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
        for (seed, chunks) in &want.seeds {
            let Some(got_chunks) = got.seeds.get(seed) else {
                out.push(format!("{label}: {name} seed {seed} missing"));
                continue;
            };
            if chunks.len() != got_chunks.len() {
                out.push(format!("{label}: {name} seed {seed} chunk count differs"));
            }
            for (want_chunk, got_chunk) in chunks.iter().zip(got_chunks) {
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
fn v1_goldens_hold_at_1_4_8_threads_and_shuffled() {
    let passes = [
        Pass::Serial,
        Pass::ShuffledWarm,
        Pass::Threads(4),
        Pass::Threads(8),
    ];
    let results = compute(&passes);
    let serial = results[0].1.clone();

    if std::env::var("UPDATE_GOLDENS").as_deref() == Ok("1") {
        let path = golden_path();
        std::fs::create_dir_all(path.parent().expect("golden dir")).expect("golden dir");
        let text = serde_json::to_string_pretty(&golden_file(serial.clone())).expect("serializes");
        std::fs::write(&path, format!("{text}\n")).expect("write golden");
        println!("wrote {}", path.display());
    }

    let golden = read_golden();
    assert_eq!(
        golden,
        golden_file(golden.fixtures.clone()),
        "golden header drifted"
    );
    let mut problems = Vec::new();
    for (pass, fixtures) in &results {
        problems.extend(differences(
            &format!("{pass:?}"),
            &golden.fixtures,
            fixtures,
        ));
    }
    let chunk_count: usize = golden
        .fixtures
        .values()
        .map(|fixture| fixture.seeds.values().map(Vec::len).sum::<usize>())
        .sum();
    assert_eq!(
        chunk_count,
        3 * SEEDS.len() * CHUNKS,
        "golden coverage shrank"
    );
    assert!(
        problems.is_empty(),
        "v1 output drifted from tests/golden/v1.json:\n  {}",
        problems.join("\n  ")
    );
}

/// The child half of the two-process run. A no-op unless the parent sets
/// the output path.
#[test]
fn v1_goldens_child_process() {
    let Ok(out) = std::env::var(CHILD_ENV) else {
        return;
    };
    let results = compute(&[Pass::Serial]);
    let text = serde_json::to_string(&results[0].1).expect("serializes");
    std::fs::write(out, text).expect("child writes digests");
}

#[test]
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
    let child: BTreeMap<String, FixtureGolden> =
        serde_json::from_str(&text).expect("child digests parse");

    let here = compute(&[Pass::Serial]).remove(0).1;
    let problems = differences("second process vs this process", &here, &child);
    assert!(problems.is_empty(), "{}", problems.join("\n"));
    let problems = differences("second process vs golden", &read_golden().fixtures, &child);
    assert!(problems.is_empty(), "{}", problems.join("\n"));
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
