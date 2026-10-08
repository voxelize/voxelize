//! Walk benchmark: replays chunk-request walks against a generator and
//! reports what each chunk costs, cold (fresh generator, empty caches) and
//! warm (the same walk again, caches primed by the first pass), at several
//! worker counts.
//!
//! Workloads:
//! - `spiral`: a square spiral out from the origin, the shape of a player
//!   joining and standing still;
//! - `teleport`: small spirals at far-apart sites, the shape of a player
//!   teleporting, which keeps hitting cold plan and tile caches;
//! - `trace:<file>`: a recorded request order, one chunk per line as
//!   `cx cz` or `cx,cz` (blank lines and `#` comments are skipped).
//!
//! The v1 fixtures (`fixture`, `geology`, `walker`) come from
//! `tests/fixtures`. A calibration kernel (1M 2D noise octaves plus 1M
//! trilinear lattice samples) runs first, and every p50 is also reported in
//! calibration units, so budgets survive a slower or busier machine.
//!
//! ```text
//! cargo run -p voxelize-gen --release --example walk_bench -- [options]
//!   --fixtures fixture,geology,walker  fixtures to walk (default: fixture)
//!   --workloads spiral,teleport        workloads (default: spiral,teleport)
//!   --workers 1,4,8                    worker counts (default: 1,4,8)
//!   --quick                            short routes (a smoke run)
//!   --repeat N                         measure N times, report per-row medians (default 1)
//!   --json FILE                        write the report as JSON
//!   --note TEXT                        stamp the report (for example the commit it measured)
//!   --pin FILE                         write the measured rows as a budget file
//!   --gate FILE                        compare against a budget file; fails only when
//!                                      GEN_BUDGET_GATE=1 (locally it prints and passes)
//!   --ab BEFORE AFTER [--rounds N]     alternate two walk_bench binaries (ABBA order) with
//!                                      the other options, and report each one's median p50
//!                                      and the delta; records both binaries' sha256
//! ```

#[path = "../tests/fixtures/mod.rs"]
mod fixtures;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use voxelize::VoxelAccess;
use voxelize_gen::{GeneratorSpec, Perlin};

use fixtures::{fixture_spec, geology_fixture_spec, harness_for, walker_fixture_spec, Harness};

/// Default share a p50 may grow past its pinned value before the gate fails.
const DEFAULT_MAX_P50_REGRESSION: f64 = 0.03;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Report {
    tool: String,
    format: u32,
    generator: String,
    note: Option<String>,
    binary: BinaryStamp,
    host: Host,
    quick: bool,
    repeat: usize,
    calibration_ms: f64,
    rows: Vec<Row>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BinaryStamp {
    path: String,
    sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Host {
    os: String,
    arch: String,
    cpus: usize,
    load_average: Option<String>,
    unix_time: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Row {
    fixture: String,
    workload: String,
    workers: usize,
    /// `cold` (fresh generator) or `warm` (the same walk again).
    pass: String,
    chunks: usize,
    /// Spec compile time, on cold rows only.
    compile_ms: Option<f64>,
    wall_ms: f64,
    p50_ms: f64,
    p95_ms: f64,
    max_ms: f64,
    mean_ms: f64,
    /// p50 divided by the calibration kernel's time.
    p50_cal: f64,
}

impl Row {
    fn key(&self) -> String {
        format!(
            "{}/{}/w{}/{}",
            self.fixture, self.workload, self.workers, self.pass
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Budget {
    about: String,
    generator: String,
    /// Share a p50 (in calibration units) may grow before the gate fails.
    max_p50_regression: f64,
    /// Worker counts whose rows gate; other rows are reported only, since
    /// multi-worker timings track the machine's load more than the code.
    gate_workers: Vec<usize>,
    measured: Measured,
    rows: Vec<BudgetRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Measured {
    note: Option<String>,
    binary_sha256: String,
    host: Host,
    repeat: usize,
    quick: bool,
    calibration_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BudgetRow {
    key: String,
    chunks: usize,
    p50_ms: f64,
    p95_ms: f64,
    max_ms: f64,
    p50_cal: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AbReport {
    tool: String,
    format: u32,
    rounds: usize,
    order: String,
    args: Vec<String>,
    before: BinaryStamp,
    after: BinaryStamp,
    rows: Vec<AbRow>,
    max_p50_regression: f64,
    gate_workers: Vec<usize>,
    /// Every gating row's after-p50 is within `max_p50_regression` of
    /// before (medians over rounds).
    within_budget: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AbRow {
    key: String,
    before_p50_ms: Vec<f64>,
    after_p50_ms: Vec<f64>,
    before_median_p50_ms: f64,
    after_median_p50_ms: f64,
    delta: f64,
    gates: bool,
}

struct Options {
    fixtures: Vec<String>,
    workloads: Vec<String>,
    workers: Vec<usize>,
    quick: bool,
    repeat: usize,
    json: Option<PathBuf>,
    note: Option<String>,
    pin: Option<PathBuf>,
    gate: Option<PathBuf>,
    ab: Option<(PathBuf, PathBuf)>,
    rounds: usize,
    /// Arguments forwarded to both binaries in `--ab` mode.
    forwarded: Vec<String>,
}

fn parse_options() -> Options {
    let mut options = Options {
        fixtures: vec!["fixture".into()],
        workloads: vec!["spiral".into(), "teleport".into()],
        workers: vec![1, 4, 8],
        quick: false,
        repeat: 1,
        json: None,
        note: None,
        pin: None,
        gate: None,
        ab: None,
        rounds: 4,
        forwarded: Vec::new(),
    };
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut index = 0;
    let value = |index: &mut usize, flag: &str| -> String {
        *index += 1;
        args.get(*index)
            .unwrap_or_else(|| panic!("{flag} needs a value"))
            .clone()
    };
    let list = |text: String| -> Vec<String> {
        text.split(',')
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect()
    };
    while index < args.len() {
        let flag = args[index].clone();
        let mut forward = true;
        match flag.as_str() {
            "--fixtures" => {
                let v = value(&mut index, &flag);
                options.forwarded.push(flag.clone());
                options.forwarded.push(v.clone());
                options.fixtures = list(v);
                forward = false;
            }
            "--workloads" => {
                let v = value(&mut index, &flag);
                options.forwarded.push(flag.clone());
                options.forwarded.push(v.clone());
                options.workloads = list(v);
                forward = false;
            }
            "--workers" => {
                let v = value(&mut index, &flag);
                options.forwarded.push(flag.clone());
                options.forwarded.push(v.clone());
                options.workers = list(v)
                    .iter()
                    .map(|w| w.parse().expect("worker count"))
                    .collect();
                forward = false;
            }
            "--repeat" => {
                let v = value(&mut index, &flag);
                options.forwarded.push(flag.clone());
                options.forwarded.push(v.clone());
                options.repeat = v.parse::<usize>().expect("repeat count").max(1);
                forward = false;
            }
            "--quick" => options.quick = true,
            "--json" => {
                options.json = Some(value(&mut index, &flag).into());
                forward = false;
            }
            "--note" => {
                options.note = Some(value(&mut index, &flag));
                forward = false;
            }
            "--pin" => {
                options.pin = Some(value(&mut index, &flag).into());
                forward = false;
            }
            "--gate" => {
                options.gate = Some(value(&mut index, &flag).into());
                forward = false;
            }
            "--ab" => {
                let before = value(&mut index, &flag);
                let after = value(&mut index, &flag);
                options.ab = Some((before.into(), after.into()));
                forward = false;
            }
            "--rounds" => {
                options.rounds = value(&mut index, &flag)
                    .parse::<usize>()
                    .expect("round count")
                    .max(1);
                forward = false;
            }
            "--bench" => forward = false,
            other => panic!("unknown option {other}"),
        }
        if forward {
            options.forwarded.push(flag.clone());
        }
        index += 1;
    }
    options
}

fn fixture(name: &str) -> GeneratorSpec {
    match name {
        "fixture" => fixture_spec(),
        "geology" => geology_fixture_spec(),
        "walker" => walker_fixture_spec(),
        other => panic!("unknown fixture {other} (fixture, geology, walker)"),
    }
}

/// The first `count` chunks of a square spiral walked out from `origin`.
fn spiral_from(origin: (i32, i32), count: usize) -> Vec<(i32, i32)> {
    let mut out = Vec::with_capacity(count);
    let (mut x, mut z) = origin;
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

/// Far-apart teleport sites, in chunks (thousands of blocks apart).
const TELEPORT_SITES: [(i32, i32); 8] = [
    (256, 0),
    (-256, 64),
    (0, -320),
    (400, 400),
    (-500, -180),
    (120, -700),
    (-640, 512),
    (900, -60),
];

fn route(workload: &str, quick: bool) -> Vec<(i32, i32)> {
    match workload {
        "spiral" => spiral_from((0, 0), if quick { 64 } else { 256 }),
        "teleport" => {
            let (sites, per_site) = if quick { (4, 9) } else { (8, 25) };
            TELEPORT_SITES[..sites]
                .iter()
                .flat_map(|&site| spiral_from(site, per_site))
                .collect()
        }
        other => match other.strip_prefix("trace:") {
            Some(path) => read_trace(Path::new(path)),
            None => panic!("unknown workload {other} (spiral, teleport, trace:<file>)"),
        },
    }
}

/// Reads a recorded walk: one chunk per line, `cx cz` or `cx,cz`; blank
/// lines and `#` comments are skipped. Order is kept, repeats included.
fn read_trace(path: &Path) -> Vec<(i32, i32)> {
    let text = std::fs::read_to_string(path)
        .unwrap_or_else(|error| panic!("cannot read trace {}: {error}", path.display()));
    let mut out = Vec::new();
    for (line_number, line) in text.lines().enumerate() {
        let line = line.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line
            .split(|c: char| c == ',' || c.is_whitespace())
            .filter(|s| !s.is_empty());
        let mut next = || -> i32 {
            parts
                .next()
                .and_then(|s| s.parse().ok())
                .unwrap_or_else(|| {
                    panic!("{}:{}: expected `cx cz`", path.display(), line_number + 1)
                })
        };
        out.push((next(), next()));
    }
    assert!(!out.is_empty(), "trace {} holds no chunks", path.display());
    out
}

fn percentile(sorted: &[f64], q: f64) -> f64 {
    let index = ((sorted.len() as f64 * q) as usize).min(sorted.len() - 1);
    sorted[index]
}

fn median(values: &[f64]) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let n = sorted.len();
    if n % 2 == 1 {
        sorted[n / 2]
    } else {
        (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0
    }
}

/// Walks the route on `workers` threads, which take chunks in route order
/// from a shared cursor (the engine's pool does the same with its queue).
/// Returns the wall time and every chunk's time, both in ms.
fn walk(harness: &Harness, route: &[(i32, i32)], workers: usize) -> (f64, Vec<f64>) {
    let cursor = AtomicUsize::new(0);
    let started = Instant::now();
    let mut times: Vec<f64> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..workers.max(1))
            .map(|_| {
                scope.spawn(|| {
                    let mut local = Vec::new();
                    loop {
                        let index = cursor.fetch_add(1, Ordering::Relaxed);
                        let Some(&(cx, cz)) = route.get(index) else {
                            break;
                        };
                        let chunk_started = Instant::now();
                        let chunk = harness.generate_chunk(cx, cz);
                        local.push(chunk_started.elapsed().as_secs_f64() * 1e3);
                        std::hint::black_box(chunk.get_voxel(cx * 16, 40, cz * 16));
                    }
                    local
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|handle| handle.join().expect("worker"))
            .collect()
    });
    let wall = started.elapsed().as_secs_f64() * 1e3;
    times.sort_by(f64::total_cmp);
    (wall, times)
}

fn row(
    fixture: &str,
    workload: &str,
    workers: usize,
    pass: &str,
    compile_ms: Option<f64>,
    wall_ms: f64,
    times: &[f64],
    calibration_ms: f64,
) -> Row {
    let p50 = percentile(times, 0.5);
    Row {
        fixture: fixture.to_string(),
        workload: workload.to_string(),
        workers,
        pass: pass.to_string(),
        chunks: times.len(),
        compile_ms,
        wall_ms,
        p50_ms: p50,
        p95_ms: percentile(times, 0.95),
        max_ms: *times.last().expect("times"),
        mean_ms: times.iter().sum::<f64>() / times.len() as f64,
        p50_cal: p50 / calibration_ms,
    }
}

/// 1M 2D noise octaves plus 1M trilinear samples of a 17^3 lattice, in ms
/// (the fastest of three runs, which is the least disturbed by load).
fn calibrate() -> f64 {
    let noise = Perlin::new(0x0ca1_1b8a7e);
    let lattice: Vec<f64> = {
        let mut state = 0x9e37_79b9_7f4a_7c15u64;
        (0..17 * 17 * 17)
            .map(|_| {
                state = voxelize_gen::mix64(state.wrapping_add(0x9e37_79b9_7f4a_7c15));
                voxelize_gen::hash_unit(state)
            })
            .collect()
    };
    let at = |x: usize, y: usize, z: usize| lattice[(x * 17 + y) * 17 + z];
    let mut best = f64::INFINITY;
    for _ in 0..3 {
        let started = Instant::now();
        let mut sum = 0.0;
        for i in 0..1_000_000u32 {
            let x = (i % 1000) as f64 * 0.731 + 0.13;
            let z = (i / 1000) as f64 * 0.517 + 0.71;
            sum += noise.sample2(x, z);
        }
        for i in 0..1_000_000u32 {
            let fx = (i % 997) as f64 * (15.999 / 997.0);
            let fy = (i % 991) as f64 * (15.999 / 991.0);
            let fz = (i % 983) as f64 * (15.999 / 983.0);
            let (x0, y0, z0) = (fx as usize, fy as usize, fz as usize);
            let (tx, ty, tz) = (fx - x0 as f64, fy - y0 as f64, fz - z0 as f64);
            let lerp = |a: f64, b: f64, t: f64| a + (b - a) * t;
            let c00 = lerp(at(x0, y0, z0), at(x0 + 1, y0, z0), tx);
            let c10 = lerp(at(x0, y0 + 1, z0), at(x0 + 1, y0 + 1, z0), tx);
            let c01 = lerp(at(x0, y0, z0 + 1), at(x0 + 1, y0, z0 + 1), tx);
            let c11 = lerp(at(x0, y0 + 1, z0 + 1), at(x0 + 1, y0 + 1, z0 + 1), tx);
            sum += lerp(lerp(c00, c10, ty), lerp(c01, c11, ty), tz);
        }
        std::hint::black_box(sum);
        best = best.min(started.elapsed().as_secs_f64() * 1e3);
    }
    best
}

fn measure(options: &Options, calibration_ms: f64) -> Vec<Row> {
    let mut rows = Vec::new();
    for fixture_name in &options.fixtures {
        let spec = fixture(fixture_name);
        for workload in &options.workloads {
            let walk_route = route(workload, options.quick);
            // Rows name a trace by its file name, not its full path.
            let label = match workload.strip_prefix("trace:") {
                Some(path) => format!(
                    "trace:{}",
                    Path::new(path)
                        .file_name()
                        .map(|name| name.to_string_lossy().into_owned())
                        .unwrap_or_else(|| path.to_string())
                ),
                None => workload.clone(),
            };
            for &workers in &options.workers {
                let compile_started = Instant::now();
                let harness = harness_for(spec.clone());
                let compile_ms = compile_started.elapsed().as_secs_f64() * 1e3;
                let (cold_wall, cold) = walk(&harness, &walk_route, workers);
                let (warm_wall, warm) = walk(&harness, &walk_route, workers);
                rows.push(row(
                    fixture_name,
                    &label,
                    workers,
                    "cold",
                    Some(compile_ms),
                    cold_wall,
                    &cold,
                    calibration_ms,
                ));
                rows.push(row(
                    fixture_name,
                    &label,
                    workers,
                    "warm",
                    None,
                    warm_wall,
                    &warm,
                    calibration_ms,
                ));
            }
        }
    }
    rows
}

/// Per-row medians over repeated measurements (every field independently).
fn median_rows(runs: &[Vec<Row>]) -> Vec<Row> {
    let mut out = runs[0].clone();
    for (index, row) in out.iter_mut().enumerate() {
        let pick = |f: &dyn Fn(&Row) -> f64| -> f64 {
            median(&runs.iter().map(|run| f(&run[index])).collect::<Vec<_>>())
        };
        row.compile_ms = row
            .compile_ms
            .map(|_| pick(&|r| r.compile_ms.unwrap_or(0.0)));
        row.wall_ms = pick(&|r| r.wall_ms);
        row.p50_ms = pick(&|r| r.p50_ms);
        row.p95_ms = pick(&|r| r.p95_ms);
        row.max_ms = pick(&|r| r.max_ms);
        row.mean_ms = pick(&|r| r.mean_ms);
        row.p50_cal = pick(&|r| r.p50_cal);
    }
    out
}

fn print_rows(rows: &[Row], calibration_ms: f64) {
    println!("calibration kernel: {calibration_ms:.2} ms");
    println!(
        "{:<34} {:>6} {:>9} {:>9} {:>9} {:>9} {:>9} {:>9}",
        "fixture/workload/workers/pass",
        "chunks",
        "wall ms",
        "p50 ms",
        "p95 ms",
        "max ms",
        "mean ms",
        "p50 cal"
    );
    for row in rows {
        println!(
            "{:<34} {:>6} {:>9.1} {:>9.3} {:>9.3} {:>9.3} {:>9.3} {:>9.5}",
            row.key(),
            row.chunks,
            row.wall_ms,
            row.p50_ms,
            row.p95_ms,
            row.max_ms,
            row.mean_ms,
            row.p50_cal
        );
    }
}

/// SHA-256 (FIPS 180-4), so reports can name the exact binary measured
/// without a dependency.
fn sha256(bytes: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    let mut message = bytes.to_vec();
    let bit_length = (bytes.len() as u64).wrapping_mul(8);
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&bit_length.to_be_bytes());
    for block in message.chunks_exact(64) {
        let mut w = [0u32; 64];
        for (i, word) in block.chunks_exact(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ (!e & g);
            let t1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        for (slot, value) in h.iter_mut().zip([a, b, c, d, e, f, g, hh]) {
            *slot = slot.wrapping_add(value);
        }
    }
    h.iter().map(|word| format!("{word:08x}")).collect()
}

fn stamp(path: &Path) -> BinaryStamp {
    let bytes = std::fs::read(path)
        .unwrap_or_else(|error| panic!("cannot read binary {}: {error}", path.display()));
    BinaryStamp {
        path: path.display().to_string(),
        sha256: sha256(&bytes),
    }
}

fn host() -> Host {
    let load_average = std::fs::read_to_string("/proc/loadavg")
        .ok()
        .map(|text| {
            text.split_whitespace()
                .take(3)
                .collect::<Vec<_>>()
                .join(" ")
        })
        .or_else(|| {
            Command::new("sysctl")
                .args(["-n", "vm.loadavg"])
                .output()
                .ok()
                .filter(|output| output.status.success())
                .map(|output| {
                    String::from_utf8_lossy(&output.stdout)
                        .trim_matches(|c: char| c == '{' || c == '}' || c.is_whitespace())
                        .to_string()
                })
        });
    Host {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        cpus: std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1),
        load_average,
        unix_time: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    }
}

fn write_json<T: Serialize>(path: &Path, value: &T) {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).expect("report directory");
        }
    }
    let text = serde_json::to_string_pretty(value).expect("report serializes");
    std::fs::write(path, format!("{text}\n"))
        .unwrap_or_else(|error| panic!("cannot write {}: {error}", path.display()));
    println!("wrote {}", path.display());
}

fn gate_enabled() -> bool {
    std::env::var("GEN_BUDGET_GATE").as_deref() == Ok("1")
}

/// Compares measured rows with a pinned budget, in calibration units.
/// Returns whether every gating row is within budget.
fn gate(report: &Report, budget_path: &Path) -> bool {
    let text = std::fs::read_to_string(budget_path)
        .unwrap_or_else(|error| panic!("cannot read {}: {error}", budget_path.display()));
    let budget: Budget = serde_json::from_str(&text).expect("budget parses");
    let pinned: BTreeMap<&str, &BudgetRow> = budget
        .rows
        .iter()
        .map(|row| (row.key.as_str(), row))
        .collect();
    println!(
        "budget {} (p50 may grow {:.0}% in calibration units; gating workers {:?})",
        budget_path.display(),
        budget.max_p50_regression * 100.0,
        budget.gate_workers
    );
    println!(
        "{:<34} {:>10} {:>10} {:>8}  verdict",
        "row", "pinned cal", "now cal", "delta"
    );
    let mut ok = true;
    let mut compared = 0;
    for row in &report.rows {
        let key = row.key();
        let Some(pin) = pinned.get(key.as_str()) else {
            continue;
        };
        compared += 1;
        let delta = row.p50_cal / pin.p50_cal - 1.0;
        let gates = budget.gate_workers.contains(&row.workers);
        let within = delta <= budget.max_p50_regression;
        if gates && !within {
            ok = false;
        }
        println!(
            "{:<34} {:>10.5} {:>10.5} {:>+7.1}%  {}",
            key,
            pin.p50_cal,
            row.p50_cal,
            delta * 100.0,
            match (gates, within) {
                (true, true) => "ok",
                (true, false) => "OVER",
                (false, _) => "info",
            }
        );
    }
    if compared == 0 {
        println!("no measured row matches the budget");
        ok = false;
    }
    ok
}

fn run_ab(options: &Options, before: &Path, after: &Path) -> bool {
    let before_stamp = stamp(before);
    let after_stamp = stamp(after);
    let scratch = std::env::temp_dir().join(format!("walk_bench_ab_{}", std::process::id()));
    std::fs::create_dir_all(&scratch).expect("scratch directory");
    let mut samples: BTreeMap<String, (Vec<f64>, Vec<f64>)> = BTreeMap::new();
    let mut order = String::new();
    for round in 0..options.rounds {
        // ABBA: alternate which binary runs first, so drift in the
        // machine's load lands on both sides equally.
        let sequence: [(bool, &Path); 2] = if round % 2 == 0 {
            [(false, before), (true, after)]
        } else {
            [(true, after), (false, before)]
        };
        for (is_after, binary) in sequence {
            order.push(if is_after { 'B' } else { 'A' });
            let out = scratch.join(format!("round{round}_{}.json", u8::from(is_after)));
            let status = Command::new(binary)
                .args(&options.forwarded)
                .arg("--json")
                .arg(&out)
                .status()
                .unwrap_or_else(|error| panic!("cannot run {}: {error}", binary.display()));
            assert!(status.success(), "{} failed: {status}", binary.display());
            let report: Report =
                serde_json::from_str(&std::fs::read_to_string(&out).expect("round report"))
                    .expect("round report parses");
            for row in report.rows {
                let entry = samples.entry(row.key()).or_default();
                if is_after {
                    entry.1.push(row.p50_ms);
                } else {
                    entry.0.push(row.p50_ms);
                }
            }
        }
    }
    let _ = std::fs::remove_dir_all(&scratch);
    let gate_workers = vec![1];
    let mut rows = Vec::new();
    let mut within_budget = true;
    println!(
        "A = {} ({})\nB = {} ({})\norder {order}",
        before_stamp.path, before_stamp.sha256, after_stamp.path, after_stamp.sha256
    );
    println!(
        "{:<34} {:>12} {:>12} {:>8}  verdict",
        "row", "A median p50", "B median p50", "delta"
    );
    for (key, (a, b)) in samples {
        let before_median = median(&a);
        let after_median = median(&b);
        let delta = after_median / before_median - 1.0;
        let gates = gate_workers
            .iter()
            .any(|w| key.contains(&format!("/w{w}/")));
        let within = delta <= DEFAULT_MAX_P50_REGRESSION;
        if gates && !within {
            within_budget = false;
        }
        println!(
            "{:<34} {:>12.4} {:>12.4} {:>+7.2}%  {}",
            key,
            before_median,
            after_median,
            delta * 100.0,
            match (gates, within) {
                (true, true) => "ok",
                (true, false) => "OVER",
                (false, _) => "info",
            }
        );
        rows.push(AbRow {
            key,
            before_p50_ms: a,
            after_p50_ms: b,
            before_median_p50_ms: before_median,
            after_median_p50_ms: after_median,
            delta,
            gates,
        });
    }
    let report = AbReport {
        tool: "walk_bench --ab".into(),
        format: 1,
        rounds: options.rounds,
        order,
        args: options.forwarded.clone(),
        before: before_stamp,
        after: after_stamp,
        rows,
        max_p50_regression: DEFAULT_MAX_P50_REGRESSION,
        gate_workers,
        within_budget,
    };
    if let Some(path) = &options.json {
        write_json(path, &report);
    }
    within_budget
}

fn main() {
    let options = parse_options();

    if let Some((before, after)) = &options.ab {
        let within = run_ab(&options, before, after);
        println!(
            "A/B: {}",
            if within {
                "every gating p50 within budget"
            } else {
                "a gating p50 regressed past budget"
            }
        );
        if !within && gate_enabled() {
            std::process::exit(1);
        }
        return;
    }

    let calibration_ms = calibrate();
    let runs: Vec<Vec<Row>> = (0..options.repeat)
        .map(|_| measure(&options, calibration_ms))
        .collect();
    let rows = median_rows(&runs);
    print_rows(&rows, calibration_ms);

    let binary = stamp(&std::env::current_exe().expect("own binary"));
    let report = Report {
        tool: "walk_bench".into(),
        format: 1,
        generator: "v1".into(),
        note: options.note.clone(),
        binary,
        host: host(),
        quick: options.quick,
        repeat: options.repeat,
        calibration_ms,
        rows,
    };
    if let Some(path) = &options.json {
        write_json(path, &report);
    }
    if let Some(path) = &options.pin {
        let budget = Budget {
            about: "Walk budgets for the v1 fixtures, written by `walk_bench --pin`. The gate \
                    compares p50 in calibration units (p50 divided by the calibration kernel's \
                    time) and fails only when GEN_BUDGET_GATE=1."
                .into(),
            generator: "v1".into(),
            max_p50_regression: DEFAULT_MAX_P50_REGRESSION,
            gate_workers: vec![1],
            measured: Measured {
                note: report.note.clone(),
                binary_sha256: report.binary.sha256.clone(),
                host: report.host.clone(),
                repeat: report.repeat,
                quick: report.quick,
                calibration_ms,
            },
            rows: report
                .rows
                .iter()
                .map(|row| BudgetRow {
                    key: row.key(),
                    chunks: row.chunks,
                    p50_ms: row.p50_ms,
                    p95_ms: row.p95_ms,
                    max_ms: row.max_ms,
                    p50_cal: row.p50_cal,
                })
                .collect(),
        };
        write_json(path, &budget);
    }
    if let Some(path) = &options.gate {
        let ok = gate(&report, path);
        println!(
            "budget gate: {}{}",
            if ok { "within budget" } else { "OVER budget" },
            if gate_enabled() {
                ""
            } else {
                " (GEN_BUDGET_GATE unset: reporting only)"
            }
        );
        if !ok && gate_enabled() {
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_matches_known_digests() {
        assert_eq!(
            sha256(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
