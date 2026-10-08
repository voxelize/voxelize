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
//! The scanner is shared with the kit's `assert_no_libm!`, and this test
//! includes it as a file so it runs in every build, with or without the
//! landscape features.

#[path = "../src/landscape/kit/no_libm.rs"]
mod no_libm;

use std::path::{Path, PathBuf};

use no_libm::{find_calls, rust_files, scan_dir, scan_file, strip_non_code, LibmHit};

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
    "##;
    let calls: Vec<String> = find_calls(&strip_non_code(src))
        .into_iter()
        .map(|(_, c)| c)
        .collect();
    assert_eq!(calls, ["sin", "powf", "mul_add", "cbrt"]);
}
