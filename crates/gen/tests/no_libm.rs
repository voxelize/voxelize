//! The bit-stability scope, checked as text.
//!
//! The cross-platform claim covers (1) everything under `src/landscape/`,
//! which may call no platform maths library function at all, and (2) the
//! v1 files `landscape` calls on its output paths: stream hashing, the noise
//! kernels, the field compiler's spline math, climate partitions, and flora
//! and ecology placement. Those are audited: each may contain exactly the
//! calls listed in `AUDITED_ALLOWLIST`, so a new call in a reachable v1 file
//! fails here.
//!
//! Outside the claim, and not scanned: v1 geology (variable-exponent
//! `powi`, the `geology_prior` solver's own per-platform goldens) and v1
//! channel curvature (`hypot`), which `landscape` never calls.
//!
//! `landscape` also writes no `f64::max`/`f64::min` (they may return either
//! zero for ±0.0; `landscape::math::MinMax` decides by comparison), checked
//! by the scanner's companion `find_minmax`, and the audited v1 files hold
//! exactly the `max`/`min` calls in `AUDITED_MINMAX`.
//!
//! The scanner is shared with the kit's `assert_no_libm!`, and this test
//! includes it as a file so it runs in every build, with or without the
//! landscape features.

#[path = "../src/landscape/kit/no_libm.rs"]
mod no_libm;

use std::path::{Path, PathBuf};

use no_libm::{
    find_calls, find_minmax, rust_files, scan_dir, scan_dir_minmax, scan_file, strip_non_code,
    LibmHit,
};

fn crate_path(rel: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(rel)
}

/// The v1 files on landscape's output paths.
const AUDITED_V1: &[&str] = &[
    "src/stream.rs",
    "src/noise.rs",
    "src/field.rs",
    "src/climate.rs",
    "src/flora.rs",
    "src/ecology.rs",
];

/// Every platform-maths call the audited files may hold: (file, method,
/// trimmed source line), once per call.
///
/// - `ecology.rs`: a squared distance by `powi(2)`, which equals `x·x` bit
///   for bit however the compiler lowers it.
/// - `field.rs`: the v1 field program's `PowI` op, outside the claim;
///   `landscape` never builds a `PowI` node.
const AUDITED_ALLOWLIST: &[(&str, &str, &str)] = &[
    (
        "src/ecology.rs",
        "powi",
        "let d = ((sx - fx).powi(2) + (sz - fz).powi(2)).sqrt();",
    ),
    (
        "src/ecology.rs",
        "powi",
        "let d = ((sx - fx).powi(2) + (sz - fz).powi(2)).sqrt();",
    ),
    (
        "src/field.rs",
        "powi",
        "Op::PowI { input, exponent } => regs[*input as usize].powi(*exponent),",
    ),
];

#[test]
fn landscape_calls_no_platform_maths() {
    let dir = crate_path("src/landscape");
    let files = rust_files(&dir);
    assert!(
        files.len() >= 10,
        "found only {} landscape files",
        files.len()
    );
    let hits = scan_dir(&dir);
    assert!(hits.is_empty(), "{}", no_libm::report(&hits));
}

#[test]
fn landscape_uses_no_platform_min_or_max() {
    let hits = scan_dir_minmax(&crate_path("src/landscape"));
    assert!(
        hits.is_empty(),
        "{}use `MinMax::fmax`/`fmin`/`fclamp` for floats and `Ord::max(a, b)` for integers",
        no_libm::report(&hits)
    );
}

#[test]
fn audited_v1_files_hold_exactly_their_allowlist() {
    let mut found: Vec<(String, String, String)> = Vec::new();
    for rel in AUDITED_V1 {
        for LibmHit { call, text, .. } in scan_file(&crate_path(rel)) {
            found.push((rel.to_string(), call, text));
        }
    }
    let mut allowed: Vec<(String, String, String)> = AUDITED_ALLOWLIST
        .iter()
        .map(|(f, c, t)| (f.to_string(), c.to_string(), t.to_string()))
        .collect();
    found.sort();
    allowed.sort();
    assert_eq!(
        found, allowed,
        "the audited v1 files' platform-maths calls changed; a new call breaks the bit-stability claim, \
         and a removed one must leave the allowlist"
    );
}

/// Every `max`/`min` the audited files may hold, as the text scan sees
/// them: (file, method, trimmed source line), once per call. A float
/// `max`/`min` may return either zero for a `+0.0`/`-0.0` pair, so each was
/// audited for one reaching `landscape`'s output:
///
/// - against a nonzero constant (`1e-9`, `1.0`, `2.0`), or between two
///   `abs()` values, or `a - b` against `0.0` (an exact difference is
///   `+0.0`): no such pair;
/// - integers the text scan cannot tell from floats (`crown_step`,
///   `octaves`, `range`): no zeros of two signs;
/// - outside `landscape`'s paths: v1 field-program `Op::Max`/`Op::Min`
///   (like `PowI` above), the zoned partition's `transition` (landscape
///   partitions are single or climate-matched), v1 flora's `reach` (a
///   ceiling), and `noise.rs` test code.
///
/// A new call must be audited and listed, or written with `MinMax`.
const AUDITED_MINMAX: &[(&str, &str, &str)] = &[
    (
        "src/climate.rs",
        "max",
        "let margin = (second.0 - best.0).max(0.0);",
    ),
    (
        "src/climate.rs",
        "max",
        "let margin = (second.0 - best.0).max(0.0);",
    ),
    (
        "src/climate.rs",
        "max",
        "region_cell: region_cell.max(1.0),",
    ),
    ("src/climate.rs", "max", "transition: transition.max(0.0),"),
    ("src/climate.rs", "max", "transition: transition.max(1e-9),"),
    (
        "src/ecology.rs",
        "max",
        "let ecotone = (ecotone * cell).max(1e-9);",
    ),
    (
        "src/field.rs",
        "max",
        "Op::Max(a, b) => regs[*a as usize].max(regs[*b as usize]),",
    ),
    (
        "src/field.rs",
        "min",
        "Op::Min(a, b) => regs[*a as usize].min(regs[*b as usize]),",
    ),
    (
        "src/field.rs",
        "min",
        "let bound = 2.0 * d0.abs().min(d1.abs());",
    ),
    (
        "src/field.rs",
        "min",
        "let lat = (fz.abs() / half_world_z).min(1.0);",
    ),
    (
        "src/field.rs",
        "min",
        "let magnitude = parabola.abs().min(bound);",
    ),
    ("src/flora.rs", "max", ".fold(0.0f64, f64::max);"),
    ("src/flora.rs", "max", "let disc = (3 + crown_step).max(2);"),
    (
        "src/flora.rs",
        "max",
        "let mut radius: i32 = (2 + crown_step).max(1);",
    ),
    (
        "src/flora.rs",
        "max",
        "let norm = (px * px + pz * pz).sqrt().max(1e-9);",
    ),
    (
        "src/flora.rs",
        "max",
        "let radius: i32 = ([2, 2, 1][layer as usize] + crown_step).max(1);",
    ),
    (
        "src/flora.rs",
        "max",
        "let scaled = |base: i32| -> i32 { ((base as f64) * size).round().max(2.0) as i32 };",
    ),
    ("src/flora.rs", "max", "let wide = (3 + crown_step).max(2);"),
    (
        "src/noise.rs",
        "max",
        "let octaves: Vec<Perlin> = (0..octaves.max(1))",
    ),
    ("src/noise.rs", "max", "max = max.max(v);"),
    ("src/noise.rs", "min", "let damped = weight.min(1.0);"),
    ("src/noise.rs", "min", "min = min.min(v);"),
    (
        "src/stream.rs",
        "max",
        "let span = (range.1 - range.0).max(0) as f64 + 1.0;",
    ),
];

#[test]
fn audited_v1_files_hold_exactly_their_minmax_allowlist() {
    let mut found: Vec<(String, String, String)> = Vec::new();
    for rel in AUDITED_V1 {
        for LibmHit { call, text, .. } in no_libm::scan_file_with(&crate_path(rel), find_minmax) {
            found.push((rel.to_string(), call, text));
        }
    }
    let mut allowed: Vec<(String, String, String)> = AUDITED_MINMAX
        .iter()
        .map(|(f, c, t)| (f.to_string(), c.to_string(), t.to_string()))
        .collect();
    found.sort();
    allowed.sort();
    assert_eq!(
        found, allowed,
        "the audited v1 files' float max/min calls changed; audit a new call for a +0.0/-0.0 pair \
         reaching output and list it, and a removed one must leave the allowlist"
    );
}

#[test]
fn scanner_reads_only_code() {
    let src = r##"
        // x.sin() in a comment
        /* nested /* x.powf(2.0) */ still a comment: y.cos() */
        let s = "a string with .hypot( inside";
        let r = r#"raw .exp( text"#;
        let c = '\'';
        fn f<'a>(x: &'a f64) -> f64 { x.sqrt() + x.abs() }
        let bad = x.sin();
        let worse = f64::powf(x, 2.0);
        let fused = a.mul_add(b, c);
        let spaced = x . cbrt ();
        let field = obj.exp;
        let name = sin(x);
        let mapped = xs.iter().map(|x| x.abs()).map(f64::sin);
        let handle = f64::powf;
        use libm::cos;
        let fine = core::f64::consts::LN_2 + x.exp2_p() + x.sinh_like();
    "##;
    let calls: Vec<String> = find_calls(&strip_non_code(src))
        .into_iter()
        .map(|(_, c)| c)
        .collect();
    assert_eq!(
        calls,
        ["sin", "powf", "mul_add", "cbrt", "sin", "powf", "libm", "cos"]
    );
}

#[test]
fn minmax_scan_finds_float_extrema_only() {
    let src = r##"
        let a = x.max(0.0);
        let b = y . min ( z );
        let c = values.iter().fold(0.0, f64::max);
        let d = <f32>::min(p, q);
        let e = f32::min;
        let ok1 = Ord::max(i, j) + std::cmp::min(i, j);
        let ok2 = corners.max() + list.iter().copied().min();
        let ok3 = x.fmax(0.0).fclamp(0.0, 1.0) + self.max[a] + b.max_x;
        // y.max(1.0) in a comment
        let ok4 = "z.min(2.0)";
    "##;
    let found: Vec<(usize, String)> = find_minmax(&strip_non_code(src));
    let names: Vec<&str> = found.iter().map(|(_, n)| n.as_str()).collect();
    assert_eq!(names, ["max", "min", "max", "min", "min"]);
    let lines: Vec<usize> = found.iter().map(|(l, _)| *l).collect();
    assert_eq!(lines, [2, 3, 4, 5, 6]);
}
