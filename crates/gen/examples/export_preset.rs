//! Writes a preset's JSON twin through the canonical writer: every field
//! present, keys sorted, floats in their pinned spelling, laid out on lines
//! for reading and diffing. Reading the twin
//! back (`landscape::read_spec`) gives the same spec and the same identity
//! hash as the Rust builder (`tests/landscape_spec.rs` asserts it).
//!
//! ```text
//! cargo run -p voxelize-gen --features unstable-landscape --example export_preset -- \
//!   [--preset plain] [--out crates/gen/src/landscape/presets/plain.json] [--check]
//! ```
//!
//! `--check` exits non-zero when the file on disk differs from the export.

use std::path::PathBuf;

use voxelize_gen::landscape::presets::{plain_landscape, Knobs};

fn main() {
    let mut preset = "plain".to_string();
    let mut out: Option<PathBuf> = None;
    let mut check = false;
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--preset" => {
                i += 1;
                preset = args[i].clone();
            }
            "--out" => {
                i += 1;
                out = Some(PathBuf::from(&args[i]));
            }
            "--check" => check = true,
            other => panic!("unknown argument {other}"),
        }
        i += 1;
    }
    let spec = match preset.as_str() {
        "plain" => plain_landscape(&Knobs::default()),
        other => panic!("unknown preset {other} (this build has: plain)"),
    };
    let path = out.unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src/landscape/presets")
            .join(format!("{preset}.json"))
    });
    let mut text = spec.to_pretty_json();
    text.push('\n');
    if check {
        let on_disk = std::fs::read_to_string(&path).unwrap_or_default();
        if on_disk != text {
            eprintln!("{} is stale: re-run export_preset", path.display());
            std::process::exit(1);
        }
        println!("{} is current", path.display());
        return;
    }
    std::fs::write(&path, text).expect("write the preset twin");
    println!("wrote {}", path.display());
}
