//! Renders diagnostic maps of the layered reference stack next to the
//! plain single-ridged construction it replaces, plus a biome map of the
//! integration fixture, and prints the measured diagnostics for both
//! stacks. Usage: `cargo run -p voxelize-gen --release --example
//! render_reference [output_dir]`.

#[path = "../tests/fixtures/mod.rs"]
mod fixtures;

use std::path::Path;

use fixtures::{fixture_config, fixture_registry, fixture_spec, reference_stack};
use voxelize_gen::*;

const SIZE: usize = 768;
const STEP: i32 = 6;
const SEA: f64 = 64.0;

fn compile_graph(graph: &FieldGraph) -> FieldProgram {
    let mut salts = hashbrown::HashSet::new();
    FieldProgram::compile(graph, "render", 7, "reference_dim", &mut salts).expect("compiles")
}

fn plain_ridged_stack() -> FieldGraph {
    let mut b = FieldGraphBuilder::new();
    let continents = b.fbm("plain.continents", 1.0 / 1400.0, 3, 0.5, 2.0);
    let base = b.spline(continents, &[(-0.28, 22.0), (0.0, 62.0), (0.32, 96.0)]);
    let ridged = b.ridged("plain.chains", 1.0 / 420.0, 4, 0.5, 2.0);
    let lift = b.spline(ridged, &[(0.35, 0.0), (0.55, 30.0), (0.95, 110.0)]);
    b.add(base, lift);
    b.build()
}

fn write_png(path: &Path, size: usize, pixels: &[u8]) {
    let file = std::fs::File::create(path).expect("create png");
    let mut encoder = png::Encoder::new(std::io::BufWriter::new(file), size as u32, size as u32);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    encoder
        .write_header()
        .expect("png header")
        .write_image_data(pixels)
        .expect("png data");
    println!("wrote {}", path.display());
}

fn hypsometric(height: f64) -> [u8; 3] {
    if height <= SEA {
        let depth = ((SEA - height) / 60.0).clamp(0.0, 1.0);
        let v = (1.0 - depth) * 150.0;
        [(v * 0.25) as u8, (v * 0.55) as u8, (110.0 + v * 0.7) as u8]
    } else {
        let t = ((height - SEA) / 130.0).clamp(0.0, 1.0);
        if t < 0.22 {
            let s = t / 0.22;
            [(96.0 + s * 60.0) as u8, (150.0 + s * 30.0) as u8, (70.0 + s * 20.0) as u8]
        } else if t < 0.6 {
            let s = (t - 0.22) / 0.38;
            [(156.0 - s * 40.0) as u8, (180.0 - s * 80.0) as u8, (90.0 - s * 30.0) as u8]
        } else {
            let s = ((t - 0.6) / 0.4).min(1.0);
            let v = 120.0 + s * 135.0;
            [v as u8, v as u8, v as u8]
        }
    }
}

fn render_height_map(program: &FieldProgram, path: &Path) -> FieldGrid {
    let grid = FieldGrid::sample((-(SIZE as i32) * STEP / 2, -(SIZE as i32) * STEP / 2), SIZE, STEP, |x, z| {
        program.sample2(x, z)
    });
    let mut pixels = Vec::with_capacity(SIZE * SIZE * 3);
    for iz in 0..SIZE {
        for ix in 0..SIZE {
            // Cheap hillshade from the west so relief morphology reads.
            let here = grid.value(ix, iz);
            let west = grid.value(ix.saturating_sub(1), iz);
            let shade = ((here - west) * 0.35).clamp(-0.35, 0.35);
            let [r, g, b] = hypsometric(here);
            let lit = |c: u8| ((c as f64) * (1.0 + shade)).clamp(0.0, 255.0) as u8;
            pixels.extend_from_slice(&[lit(r), lit(g), lit(b)]);
        }
    }
    write_png(path, SIZE, &pixels);
    grid
}

fn report(label: &str, grid: &FieldGrid) {
    let stats = FieldStats::measure(grid.values());
    let shares = band_shares(grid, 6);
    let repetition = repetition_score(grid, 0.3);
    println!(
        "{label}: p01={:.1} p50={:.1} p99={:.1} span={:.1} repetition={:.3}",
        stats.p01,
        stats.p50,
        stats.p99,
        stats.p99 - stats.p01,
        repetition
    );
    println!(
        "{label} band shares (fine->coarse): {}",
        shares
            .iter()
            .map(|s| format!("{:.2}", s))
            .collect::<Vec<_>>()
            .join(" ")
    );
}

fn main() {
    let out_dir = std::env::args().nth(1).unwrap_or_else(|| ".".to_string());
    let out = Path::new(&out_dir);
    std::fs::create_dir_all(out).expect("output dir");

    let reference = compile_graph(&reference_stack());
    let plain = compile_graph(&plain_ridged_stack());

    let reference_grid = render_height_map(&reference, &out.join("terrain_reference_stack.png"));
    let plain_grid = render_height_map(&plain, &out.join("terrain_plain_ridged.png"));
    report("reference stack", &reference_grid);
    report("plain ridged", &plain_grid);

    let registry = fixture_registry();
    let config = fixture_config();
    let generator = compile(&fixture_spec(), &registry, &config).expect("fixture compiles");
    let debug = GenDebug::new(&generator);
    for (layer, name) in [
        (MapLayer::Biome, "fixture_biome_map.png"),
        (MapLayer::Steepness, "fixture_steepness_map.png"),
    ] {
        let png = debug.render_map(&MapRequest {
            layer,
            center_x: 0,
            center_z: 0,
            radius: 768,
            stride: 3,
        });
        std::fs::write(out.join(name), png).expect("write map");
        println!("wrote {}", out.join(name).display());
    }
    println!(
        "terrain stats tap: {}",
        serde_json::to_string_pretty(&debug.terrain_stats(0, 0, 1024, 8)).expect("stats json")
    );
}
