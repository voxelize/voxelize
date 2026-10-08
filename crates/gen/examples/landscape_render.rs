//! Offline renders of a landscape preset: hillshade, climate and biome
//! maps, any named field, and per-column provenance (`--explain`).
//!
//! Every image is labelled "OFFLINE LANDSCAPE RENDER - not in-game": the
//! final proof of any terrain is always an in-engine capture.
//!
//! ```text
//! cargo run -p voxelize-gen --release --features unstable-landscape --example landscape_render -- \
//!   [--preset plain] [--seed 7] [--height 512] [--scale 1.0] \
//!   ( --map hillshade|climate|biome|temperature|moisture|<field> [--center x,z] [--size 4096] [--stride 4] \
//!   | --explain x,z [--json] | --quality [--center x,z] [--size 2048] [--stride 2] ) \
//!   [--out <dir>]
//! ```
//!
//! `--center spawn` centres a map on the preset's spawn.

#[path = "common/font.rs"]
mod font;

use std::path::PathBuf;
use std::sync::Arc;

use voxelize::{Block, Registry, WorldConfig};
use voxelize_gen::landscape::presets::{demo_blocks, plain_landscape, Knobs, RoleBinding};
use voxelize_gen::landscape::{compile, KindRegistry, Landscape, LandscapeSpec, Tier};

type Rgb = [u8; 3];

struct Canvas {
    w: usize,
    h: usize,
    px: Vec<u8>,
}

impl Canvas {
    fn new(w: usize, h: usize, bg: Rgb) -> Self {
        let mut px = Vec::with_capacity(w * h * 3);
        for _ in 0..w * h {
            px.extend_from_slice(&bg);
        }
        Self { w, h, px }
    }

    fn set(&mut self, x: usize, y: usize, c: Rgb) {
        if x < self.w && y < self.h {
            let i = (y * self.w + x) * 3;
            self.px[i..i + 3].copy_from_slice(&c);
        }
    }

    fn rect(&mut self, x0: usize, y0: usize, x1: usize, y1: usize, c: Rgb) {
        for y in y0..y1 {
            for x in x0..x1 {
                self.set(x, y, c);
            }
        }
    }

    fn text(&mut self, x: usize, y: usize, scale: usize, s: &str, c: Rgb) -> usize {
        let mut pen = x;
        for ch in s.chars() {
            let rows = font::glyph(ch.to_ascii_uppercase());
            for (r, row) in rows.iter().enumerate() {
                for (k, cell) in row.chars().enumerate() {
                    if cell == '#' {
                        self.rect(
                            pen + k * scale,
                            y + r * scale,
                            pen + (k + 1) * scale,
                            y + (r + 1) * scale,
                            c,
                        );
                    }
                }
            }
            pen += 6 * scale;
        }
        pen
    }

    fn save(&self, path: &PathBuf) {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).expect("create output folder");
        }
        let file = std::fs::File::create(path).expect("create png");
        let mut enc =
            png::Encoder::new(std::io::BufWriter::new(file), self.w as u32, self.h as u32);
        enc.set_color(png::ColorType::Rgb);
        enc.set_depth(png::BitDepth::Eight);
        enc.write_header()
            .expect("png header")
            .write_image_data(&self.px)
            .expect("png data");
        println!("wrote {}", path.display());
    }
}

struct Options {
    preset: String,
    seed: u32,
    height: u32,
    scale: f64,
    map: Option<String>,
    explain: Option<(i32, i32)>,
    quality: bool,
    json: bool,
    center: Option<String>,
    size: Option<usize>,
    stride: Option<i32>,
    out: PathBuf,
}

fn parse_xz(s: &str) -> (i32, i32) {
    let (a, b) = s.split_once(',').expect("x,z");
    (a.trim().parse().expect("x"), b.trim().parse().expect("z"))
}

fn options() -> Options {
    let mut o = Options {
        preset: "plain".into(),
        seed: 7,
        height: 512,
        scale: 1.0,
        map: None,
        explain: None,
        quality: false,
        json: false,
        center: None,
        size: None,
        stride: None,
        out: PathBuf::from("target/landscape-render"),
    };
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < args.len() {
        let next = |i: &mut usize| {
            *i += 1;
            args.get(*i)
                .cloned()
                .unwrap_or_else(|| panic!("{} needs a value", args[*i - 1]))
        };
        match args[i].as_str() {
            "--preset" => o.preset = next(&mut i),
            "--seed" => o.seed = next(&mut i).parse().expect("seed"),
            "--height" => o.height = next(&mut i).parse().expect("height"),
            "--scale" => o.scale = next(&mut i).parse().expect("scale"),
            "--map" => o.map = Some(next(&mut i)),
            "--explain" => o.explain = Some(parse_xz(&next(&mut i))),
            "--quality" => o.quality = true,
            "--json" => o.json = true,
            "--center" => o.center = Some(next(&mut i)),
            "--size" => o.size = Some(next(&mut i).parse().expect("size")),
            "--stride" => o.stride = Some(next(&mut i).parse().expect("stride")),
            "--out" => o.out = PathBuf::from(next(&mut i)),
            "--help" | "-h" => {
                println!(
                    "{}",
                    include_str!("landscape_render.rs")
                        .lines()
                        .take(16)
                        .collect::<Vec<_>>()
                        .join("\n")
                );
                std::process::exit(0);
            }
            other => panic!("unknown argument {other}"),
        }
        i += 1;
    }
    o
}

fn preset(o: &Options) -> LandscapeSpec {
    let knobs = Knobs {
        height: o.height,
        scale: o.scale,
        ..Knobs::default()
    };
    match o.preset.as_str() {
        "plain" => plain_landscape(&knobs),
        other => panic!("unknown preset {other} (this build has: plain)"),
    }
}

fn landscape(o: &Options) -> Arc<Landscape> {
    let spec = preset(o);
    let binding = RoleBinding::demo();
    let mut registry = Registry::new();
    let blocks: Vec<Block> = demo_blocks(1, &binding);
    registry.register_blocks(&blocks);
    let config = WorldConfig::new()
        .seed(o.seed)
        .chunk_size(16)
        .max_height(o.height as usize)
        .build();
    compile(
        &spec,
        &KindRegistry::with_builtins(),
        &binding,
        &registry,
        &config,
    )
    .unwrap_or_else(|e| panic!("compile: {e}"))
}

fn lerp3(a: [f64; 3], b: [f64; 3], t: f64) -> [f64; 3] {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ]
}

fn ramp(stops: &[(f64, [f64; 3])], t: f64) -> [f64; 3] {
    if t <= stops[0].0 {
        return stops[0].1;
    }
    for w in stops.windows(2) {
        if t <= w[1].0 {
            return lerp3(w[0].1, w[1].1, (t - w[0].0) / (w[1].0 - w[0].0));
        }
    }
    stops[stops.len() - 1].1
}

fn to_rgb(c: [f64; 3]) -> Rgb {
    [
        (c[0] * 255.0).round().clamp(0.0, 255.0) as u8,
        (c[1] * 255.0).round().clamp(0.0, 255.0) as u8,
        (c[2] * 255.0).round().clamp(0.0, 255.0) as u8,
    ]
}

/// Lambert shade of a heightmap from the north-west, 45 degrees up,
/// with the relief exaggerated `ex` times.
fn shade(h: &[f64], n: usize, stride: f64, ex: f64) -> Vec<f64> {
    let l = {
        let v = [-1.0f64, 1.4, -1.0];
        let m = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
        [v[0] / m, v[1] / m, v[2] / m]
    };
    let mut out = vec![1.0; n * n];
    for z in 0..n {
        for x in 0..n {
            let at = |x: usize, z: usize| h[z * n + x];
            let (x0, x1) = (x.saturating_sub(1), (x + 1).min(n - 1));
            let (z0, z1) = (z.saturating_sub(1), (z + 1).min(n - 1));
            let gx = ex * (at(x1, z) - at(x0, z)) / ((x1 - x0) as f64 * stride);
            let gz = ex * (at(x, z1) - at(x, z0)) / ((z1 - z0) as f64 * stride);
            let nrm = [-gx, 1.0, -gz];
            let m = (nrm[0] * nrm[0] + 1.0 + nrm[2] * nrm[2]).sqrt();
            let d = (nrm[0] * l[0] + nrm[1] * l[1] + nrm[2] * l[2]) / m;
            out[z * n + x] = 0.30 + 0.70 * d.max(0.0);
        }
    }
    out
}

const LABEL: &str = "OFFLINE LANDSCAPE RENDER - NOT IN-GAME";
const STRIP: usize = 64;

fn label(c: &mut Canvas, line2: &str, size_blocks: usize) {
    c.rect(0, 0, c.w, STRIP, [24, 24, 28]);
    c.text(12, 10, 3, LABEL, [255, 214, 92]);
    c.text(12, 40, 2, line2, [220, 220, 225]);
    // A scale bar in the bottom-left corner of the map.
    let px_per_block = c.w as f64 / size_blocks as f64;
    let blocks = if 1000.0 * px_per_block > c.w as f64 / 3.0 {
        100
    } else {
        1000
    };
    let bar = (blocks as f64 * px_per_block) as usize;
    if bar > 10 {
        let (x0, y1) = (16, c.h - 14);
        let label_w = 12 * format!("{blocks} BLOCKS").len();
        c.rect(
            x0 - 6,
            y1 - 30,
            x0 + bar.max(label_w) + 6,
            y1 + 8,
            [24, 24, 28],
        );
        c.rect(x0, y1 - 4, x0 + bar, y1 + 2, [240, 240, 240]);
        c.text(x0, y1 - 24, 2, &format!("{blocks} BLOCKS"), [240, 240, 240]);
    }
}

fn biome_color(key: &str) -> [f64; 3] {
    match key {
        "temperate.low" => [0.42, 0.66, 0.33],
        "temperate.high" => [0.30, 0.52, 0.30],
        "cold.alpine" => [0.55, 0.62, 0.58],
        "dry.low" => [0.86, 0.76, 0.48],
        "dry.high" => [0.72, 0.56, 0.36],
        "wet.low" => [0.25, 0.58, 0.47],
        "frozen" => [0.93, 0.95, 0.98],
        "shore" => [0.94, 0.87, 0.62],
        "seabed" => [0.20, 0.36, 0.58],
        _ => [0.6, 0.3, 0.6],
    }
}

fn main() {
    let o = options();
    let land = landscape(&o);
    let frame = *land.frame();
    let sea = frame.sea as f64;
    println!(
        "preset {} seed {} H {} sea {} spec_hash {:016x}",
        land.identity().preset,
        o.seed,
        frame.height,
        frame.sea,
        land.identity().spec_hash
    );
    for l in land.lints() {
        println!("{l}");
    }

    if let Some((x, z)) = o.explain {
        let e = land.explain(x, z);
        if o.json {
            println!("{}", serde_json::to_string_pretty(&e).expect("serializes"));
        } else {
            print!("{}", e.to_text());
        }
        return;
    }

    let center = match o.center.as_deref() {
        None | Some("spawn") => {
            let s = land.spawn();
            println!("spawn ({}, {}) top {}", s.0, s.1, land.spawn_point().1 - 1);
            s
        }
        Some(xz) => parse_xz(xz),
    };

    if o.quality {
        let size = o.size.unwrap_or(2048);
        let stride = o.stride.unwrap_or(2);
        let q = land.quality(
            center.0 - size as i32 / 2,
            center.1 - size as i32 / 2,
            size,
            stride,
        );
        println!("{}", serde_json::to_string_pretty(&q).expect("serializes"));
        return;
    }

    let map = o.map.clone().unwrap_or_else(|| "hillshade".into());
    let size = o.size.unwrap_or(4096);
    let stride = o.stride.unwrap_or(4);
    let n = size / stride as usize;
    let (x0, z0) = (center.0 - size as i32 / 2, center.1 - size as i32 / 2);
    let t = std::time::Instant::now();
    let heights = land.ground_window(x0, z0, n, n, stride);
    println!("ground {n}x{n} in {:.1} s", t.elapsed().as_secs_f64());
    let sh = shade(&heights, n, stride as f64, 1.6);
    let name = format!("{}-seed{}-{}", o.preset, o.seed, map.replace('.', "_"));
    let line2 = format!(
        "{}  SEED {}  H {}  {}  {} X {} BLOCKS  STRIDE {}  CENTER {},{}",
        land.identity().preset,
        o.seed,
        frame.height,
        map,
        size,
        size,
        stride,
        center.0,
        center.1
    );
    let mark_spawn = |c: &mut Canvas, ox: usize| {
        let s = land.spawn();
        let px = ((s.0 - x0) / stride) as i64;
        let pz = ((s.1 - z0) / stride) as i64;
        if px >= 0 && pz >= 0 && (px as usize) < n && (pz as usize) < n {
            for d in -6i64..=6 {
                for (dx, dz) in [(d, 0), (0, d)] {
                    let (x, y) = (px + dx, pz + dz);
                    if x >= 0 && y >= 0 {
                        c.set(ox + x as usize, STRIP + y as usize, [255, 40, 40]);
                    }
                }
            }
        }
    };

    match map.as_str() {
        "hillshade" => {
            let mut c = Canvas::new(n, n + STRIP, [0, 0, 0]);
            let relief = frame.relief;
            for z in 0..n {
                for x in 0..n {
                    let g = heights[z * n + x];
                    let base = if g < sea - 0.5 {
                        let d = ((sea - g) / 40.0).min(1.0);
                        lerp3([0.42, 0.66, 0.78], [0.10, 0.22, 0.42], d)
                    } else {
                        let s = (g - sea) / relief;
                        ramp(
                            &[
                                (0.0, [0.86, 0.82, 0.60]),
                                (0.015, [0.46, 0.64, 0.36]),
                                (0.12, [0.36, 0.55, 0.30]),
                                (0.22, [0.52, 0.52, 0.34]),
                                (0.32, [0.55, 0.47, 0.40]),
                                (0.42, [0.62, 0.60, 0.60]),
                                (0.55, [0.95, 0.95, 0.97]),
                            ],
                            s,
                        )
                    };
                    let k = if g < sea - 0.5 {
                        0.6 + 0.4 * sh[z * n + x]
                    } else {
                        sh[z * n + x]
                    };
                    c.set(
                        x,
                        STRIP + z,
                        to_rgb([base[0] * k, base[1] * k, base[2] * k]),
                    );
                }
            }
            mark_spawn(&mut c, 0);
            label(&mut c, &line2, size);
            c.save(&o.out.join(format!("{name}.png")));
        }
        "biome" | "climate" | "temperature" | "moisture" => {
            let t = std::time::Instant::now();
            let cols = land.columns_window(x0, z0, n, n, stride);
            println!("facts {n}x{n} in {:.1} s", t.elapsed().as_secs_f64());
            let keys = land.biome_keys().to_vec();
            let panels = if map == "climate" { 2 } else { 1 };
            let mut c = Canvas::new(n * panels + (panels - 1) * 8, n + STRIP, [24, 24, 28]);
            for p in 0..panels {
                let ox = p * (n + 8);
                for z in 0..n {
                    for x in 0..n {
                        let col = &cols[z * n + x];
                        let water = !col.water.is_dry();
                        let k = sh[z * n + x];
                        let which = if map == "climate" {
                            if p == 0 {
                                "temperature"
                            } else {
                                "moisture"
                            }
                        } else {
                            map.as_str()
                        };
                        let rgb = match which {
                            "biome" => {
                                let b = biome_color(&keys[col.biome.id.0 as usize]);
                                [b[0] * k, b[1] * k, b[2] * k]
                            }
                            "temperature" => {
                                let t = ramp(
                                    &[
                                        (-0.1, [0.15, 0.25, 0.70]),
                                        (0.2, [0.45, 0.70, 0.95]),
                                        (0.45, [0.95, 0.95, 0.90]),
                                        (0.7, [0.95, 0.60, 0.30]),
                                        (1.0, [0.75, 0.15, 0.10]),
                                    ],
                                    col.temperature,
                                );
                                let k = if water { 0.55 } else { 0.55 + 0.45 * k };
                                [t[0] * k, t[1] * k, t[2] * k]
                            }
                            _ => {
                                let m = ramp(
                                    &[
                                        (0.0, [0.70, 0.55, 0.30]),
                                        (0.35, [0.90, 0.85, 0.55]),
                                        (0.55, [0.55, 0.78, 0.45]),
                                        (0.8, [0.20, 0.55, 0.55]),
                                        (1.0, [0.10, 0.30, 0.55]),
                                    ],
                                    col.moisture,
                                );
                                let k = if water { 0.55 } else { 0.55 + 0.45 * k };
                                [m[0] * k, m[1] * k, m[2] * k]
                            }
                        };
                        c.set(ox + x, STRIP + z, to_rgb(rgb));
                    }
                }
                mark_spawn(&mut c, ox);
            }
            if map == "climate" {
                c.rect(4, STRIP + 4, 4 + 12 * 25 + 12, STRIP + 26, [24, 24, 28]);
                c.text(
                    10,
                    STRIP + 8,
                    2,
                    "TEMPERATURE (AFTER LAPSE)",
                    [235, 235, 235],
                );
                c.rect(
                    n + 12,
                    STRIP + 4,
                    n + 12 + 12 * 8 + 12,
                    STRIP + 26,
                    [24, 24, 28],
                );
                c.text(n + 18, STRIP + 8, 2, "MOISTURE", [235, 235, 235]);
            }
            if map == "biome" {
                // A legend on a dark card.
                let width = 32 + 12 * keys.iter().map(|k| k.len()).max().unwrap_or(0) + 10;
                c.rect(
                    4,
                    STRIP + 4,
                    4 + width,
                    STRIP + 10 + 20 * keys.len(),
                    [24, 24, 28],
                );
                let mut y = STRIP + 10;
                for key in &keys {
                    let b = to_rgb(biome_color(key));
                    c.rect(10, y, 26, y + 14, b);
                    c.text(32, y + 1, 2, key, [235, 235, 235]);
                    y += 20;
                }
            }
            label(&mut c, &line2, size * panels);
            c.save(&o.out.join(format!("{name}.png")));
        }
        field => {
            let names: Vec<String> = land.spec().fields.keys().cloned().collect();
            let fi = names
                .iter()
                .position(|f| f == field)
                .unwrap_or_else(|| panic!("unknown map {field}: hillshade, climate, biome, temperature, moisture or one of {names:?}"));
            let mut values = vec![0.0; n * n];
            let t = std::time::Instant::now();
            let threads = std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(4);
            let band = n.div_ceil(threads).max(1);
            std::thread::scope(|s| {
                for (b, rows) in values.chunks_mut(band * n).enumerate() {
                    let land = &land;
                    s.spawn(move || {
                        for (k, v) in rows.iter_mut().enumerate() {
                            let (i, j) = (k % n, b * band + k / n);
                            let x = x0 + i as i32 * stride;
                            let z = z0 + j as i32 * stride;
                            *v = land.field_values(x, z)[fi].1;
                        }
                    });
                }
            });
            println!("field {n}x{n} in {:.1} s", t.elapsed().as_secs_f64());
            let lo = values.iter().cloned().fold(f64::INFINITY, f64::min);
            let hi = values.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
            let mut c = Canvas::new(n, n + STRIP, [0, 0, 0]);
            for z in 0..n {
                for x in 0..n {
                    let t = if hi > lo {
                        (values[z * n + x] - lo) / (hi - lo)
                    } else {
                        0.5
                    };
                    let g = to_rgb([t, t, t]);
                    c.set(x, STRIP + z, g);
                }
            }
            label(&mut c, &format!("{line2}  RANGE {lo:.2}..{hi:.2}"), size);
            c.save(&o.out.join(format!("{name}.png")));
        }
    }
    let _ = Tier::Full;
}
