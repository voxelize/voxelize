//! Offline renders of a landscape preset: hillshade, climate and biome
//! maps, any named field, node edges and claim weights, vertical cutaways
//! through the generated voxels, the planner DAG, instance lists, and
//! per-column provenance (`--explain`, the full composition fold).
//!
//! Every image is labelled "OFFLINE LANDSCAPE RENDER - not in-game": the
//! final proof of any terrain is always an in-engine capture.
//!
//! ```text
//! cargo run -p voxelize-gen --release --features unstable-landscape[,kit] --example landscape_render -- \
//!   [--preset plain|proving] [--seed 7] [--height 512] [--scale 1.0] [--disable <id,...>] \
//!   ( --map hillshade|edges|claims|surface|climate|biome|temperature|moisture|<field> [--center x,z] [--size 4096] [--stride 4] \
//!   | --cutaway x0,z0,x1,z1 [--ylo y] [--yhi y] [--px 4] \
//!   | --explain x,z [--json] | --dag [--dot] | --instances [--center x,z] [--size 4096] \
//!   | --quality [--center x,z] [--size 2048] [--stride 2] ) \
//!   [--out <dir>] [--name <file stem>]
//! ```
//!
//! `--disable` turns spec nodes off (a before and after pair of any render).
//! `--map surface` draws the top voxel of every column as the stage writes
//! it, chunk by chunk, coloured by role (chunk seams show there first).
//! `--center spawn` centres a map on the preset's spawn. The `proving`
//! preset (the plain preset with the kit's test landforms and the
//! sinkhole of `examples/sinkhole.rs`) needs the `kit` feature.

#[path = "common/font.rs"]
mod font;
#[path = "common/render.rs"]
mod render;
#[cfg(feature = "kit")]
#[path = "sinkhole.rs"]
mod sinkhole;

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;

use render::{label, lerp3, ramp, to_rgb, Canvas, Rgb, STRIP};
use voxelize::{Block, ChunkStage, Registry, VoxelAccess, WorldConfig};
use voxelize_gen::landscape::geometry::Aabb2;
use voxelize_gen::landscape::presets::{demo_blocks, plain_landscape, Knobs, RoleBinding};
use voxelize_gen::landscape::{
    compile, KindRegistry, Landscape, LandscapeSpec, LandscapeStage, Tier,
};

struct Options {
    preset: String,
    seed: u32,
    height: u32,
    scale: f64,
    disable: Vec<String>,
    map: Option<String>,
    explain: Option<(i32, i32)>,
    cutaway: Option<(i32, i32, i32, i32)>,
    ylo: Option<i32>,
    yhi: Option<i32>,
    px: usize,
    dag: bool,
    dot: bool,
    instances: bool,
    quality: bool,
    json: bool,
    center: Option<String>,
    size: Option<usize>,
    stride: Option<i32>,
    out: PathBuf,
    name: Option<String>,
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
        disable: Vec::new(),
        map: None,
        explain: None,
        cutaway: None,
        ylo: None,
        yhi: None,
        px: 4,
        dag: false,
        dot: false,
        instances: false,
        quality: false,
        json: false,
        center: None,
        size: None,
        stride: None,
        out: PathBuf::from("target/landscape-render"),
        name: None,
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
            "--disable" => {
                o.disable = next(&mut i)
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .collect()
            }
            "--map" => o.map = Some(next(&mut i)),
            "--explain" => o.explain = Some(parse_xz(&next(&mut i))),
            "--cutaway" => {
                let v: Vec<i32> = next(&mut i)
                    .split(',')
                    .map(|s| s.trim().parse().expect("x0,z0,x1,z1"))
                    .collect();
                assert_eq!(v.len(), 4, "--cutaway takes x0,z0,x1,z1");
                o.cutaway = Some((v[0], v[1], v[2], v[3]));
            }
            "--ylo" => o.ylo = Some(next(&mut i).parse().expect("ylo")),
            "--yhi" => o.yhi = Some(next(&mut i).parse().expect("yhi")),
            "--px" => o.px = next(&mut i).parse().expect("px"),
            "--dag" => o.dag = true,
            "--dot" => o.dot = true,
            "--instances" => o.instances = true,
            "--quality" => o.quality = true,
            "--json" => o.json = true,
            "--center" => o.center = Some(next(&mut i)),
            "--size" => o.size = Some(next(&mut i).parse().expect("size")),
            "--stride" => o.stride = Some(next(&mut i).parse().expect("stride")),
            "--out" => o.out = PathBuf::from(next(&mut i)),
            "--name" => o.name = Some(next(&mut i)),
            "--help" | "-h" => {
                println!(
                    "{}",
                    include_str!("landscape_render.rs")
                        .lines()
                        .take(24)
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

fn preset(o: &Options) -> (LandscapeSpec, KindRegistry) {
    let knobs = Knobs {
        height: o.height,
        scale: o.scale,
        ..Knobs::default()
    };
    match o.preset.as_str() {
        "plain" => (plain_landscape(&knobs), KindRegistry::with_builtins()),
        #[cfg(feature = "kit")]
        "proving" => {
            let mut kinds = voxelize_gen::landscape::kit::test_kinds();
            sinkhole::register(&mut kinds);
            (
                sinkhole::with_sinkholes(voxelize_gen::landscape::kit::proving_landscape(&knobs)),
                kinds,
            )
        }
        other => panic!("unknown preset {other} (plain; proving with --features kit)"),
    }
}

struct World {
    land: Arc<Landscape>,
    registry: Registry,
    config: WorldConfig,
}

fn world(o: &Options) -> World {
    let (mut spec, kinds) = preset(o);
    for id in &o.disable {
        spec.nodes
            .get_mut(id)
            .unwrap_or_else(|| panic!("--disable: no node {id:?}"))
            .enabled = false;
    }
    let binding = RoleBinding::demo();
    let mut registry = Registry::new();
    let blocks: Vec<Block> = demo_blocks(1, &binding);
    registry.register_blocks(&blocks);
    let config = WorldConfig::new()
        .seed(o.seed)
        .chunk_size(16)
        .max_height(o.height as usize)
        .build();
    let land = compile(&spec, &kinds, &binding, &registry, &config)
        .unwrap_or_else(|e| panic!("compile: {e}"));
    World {
        land,
        registry,
        config,
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

/// A flat colour per role for cutaways.
fn role_color(role: &str) -> [f64; 3] {
    match role {
        "soil.top" => [0.38, 0.62, 0.27],
        "soil.sub" => [0.47, 0.33, 0.20],
        "soil.dry" | "shore" => [0.86, 0.80, 0.55],
        "soil.wet" | "bed.lake" | "rock.layer.1" => [0.62, 0.50, 0.42],
        "rock.base" => [0.50, 0.50, 0.52],
        "rock.hard" => [0.38, 0.38, 0.43],
        "rock.soft" => [0.84, 0.82, 0.72],
        "rock.layer.0" => [0.86, 0.64, 0.38],
        "gravel" | "talus" | "bed.river" => [0.60, 0.58, 0.55],
        "snow" => [0.95, 0.95, 1.00],
        "ice" => [0.70, 0.85, 0.95],
        "fluid.water" => [0.25, 0.45, 0.85],
        r if r.ends_with(".leaf") => [0.22, 0.48, 0.20],
        r if r.ends_with(".log") => [0.45, 0.30, 0.15],
        _ => [0.70, 0.35, 0.70],
    }
}

/// The label's note of the nodes `--disable` turned off.
fn disabled_note(o: &Options) -> String {
    if o.disable.is_empty() {
        String::new()
    } else {
        format!(" OFF {}", o.disable.join(",").to_uppercase())
    }
}

/// The top voxel of every sampled column as the stage writes it, chunk by
/// chunk the way the engine generates them, coloured by role and shaded by
/// its height: what a player sees from above, chunk seams included.
/// Returns the canvas and the number of chunks generated.
fn surface(w: &World, x0: i32, z0: i32, n: usize, stride: i32) -> (Canvas, usize) {
    let land = &w.land;
    let s = land.chunk_size();
    let mut keys: Vec<(i32, i32)> = Vec::new();
    for j in 0..n as i32 {
        for i in 0..n as i32 {
            let key = (
                (x0 + i * stride).div_euclid(s),
                (z0 + j * stride).div_euclid(s),
            );
            if keys.last() != Some(&key) {
                keys.push(key);
            }
        }
    }
    keys.sort_unstable();
    keys.dedup();
    let stage = LandscapeStage::new(land.clone());
    let top_y = land.frame().height as i32 - 1;
    // (pixel, top y, block id) per sampled column.
    let next = std::sync::atomic::AtomicUsize::new(0);
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(8);
    let mut found: Vec<(usize, i32, u32)> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..threads)
            .map(|_| {
                scope.spawn(|| {
                    let mut out = Vec::new();
                    loop {
                        let k = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        let Some(&(cx, cz)) = keys.get(k) else { break };
                        let options = voxelize::ChunkOptions {
                            size: w.config.chunk_size,
                            max_height: w.config.max_height,
                            sub_chunks: w.config.sub_chunks,
                        };
                        let chunk = stage.process(
                            voxelize::Chunk::new("surface", cx, cz, &options),
                            voxelize::Resources {
                                registry: &w.registry,
                                config: &w.config,
                            },
                            None,
                        );
                        for lz in 0..s {
                            for lx in 0..s {
                                let (x, z) = (cx * s + lx, cz * s + lz);
                                let (dx, dz) = (x - x0, z - z0);
                                if dx < 0 || dz < 0 || dx % stride != 0 || dz % stride != 0 {
                                    continue;
                                }
                                let (i, j) = ((dx / stride) as usize, (dz / stride) as usize);
                                if i >= n || j >= n {
                                    continue;
                                }
                                let mut y = top_y;
                                while y > 0 && chunk.get_voxel(x, y, z) == 0 {
                                    y -= 1;
                                }
                                out.push((j * n + i, y, chunk.get_voxel(x, y, z)));
                            }
                        }
                    }
                    out
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|h| h.join().expect("a surface worker"))
            .collect()
    });
    found.sort_unstable_by_key(|f| f.0);
    let heights: Vec<f64> = found.iter().map(|f| f.1 as f64).collect();
    let sh = render::shade(&heights, n, n, stride as f64, 1.6);
    let mut c = Canvas::new(n, n + STRIP, [24, 24, 28]);
    for &(p, _, id) in &found {
        let role = land.block_role(id).unwrap_or("?");
        let rgb = role_color(role);
        let k = 0.55 + 0.45 * sh[p];
        c.set(
            p % n,
            STRIP + p / n,
            to_rgb([rgb[0] * k, rgb[1] * k, rgb[2] * k]),
        );
    }
    (c, keys.len())
}

fn cutaway(w: &World, o: &Options, line: (i32, i32, i32, i32)) {
    let land = &w.land;
    let (x0, z0, x1, z1) = line;
    let (dx, dz) = ((x1 - x0) as f64, (z1 - z0) as f64);
    let len = (dx * dx + dz * dz).sqrt();
    let n = Ord::max(len.round() as usize, 1);
    let samples: Vec<(i32, i32)> = (0..=n)
        .map(|k| {
            let t = k as f64 / n as f64;
            (
                (x0 as f64 + dx * t).floor() as i32,
                (z0 as f64 + dz * t).floor() as i32,
            )
        })
        .collect();
    let tops: Vec<i32> = samples
        .iter()
        .map(|&(x, z)| land.column(x, z, Tier::Full).top)
        .collect();
    let lo = o
        .ylo
        .unwrap_or_else(|| tops.iter().copied().min().unwrap() - 24)
        .max(0);
    let hi = o
        .yhi
        .unwrap_or_else(|| tops.iter().copied().max().unwrap() + 16)
        .min(land.frame().height as i32 - 1);
    let s = land.chunk_size();
    let stage = LandscapeStage::new(land.clone());
    let mut chunks: BTreeMap<(i32, i32), voxelize::Chunk> = BTreeMap::new();
    let px = o.px;
    let width = samples.len() * px;
    let height = (hi - lo + 1) as usize * px;
    let mut c = Canvas::new(width.max(900), height + STRIP + 30, [191, 216, 242]);
    for (k, &(x, z)) in samples.iter().enumerate() {
        let key = (x.div_euclid(s), z.div_euclid(s));
        let chunk = chunks.entry(key).or_insert_with(|| {
            let options = voxelize::ChunkOptions {
                size: w.config.chunk_size,
                max_height: w.config.max_height,
                sub_chunks: w.config.sub_chunks,
            };
            stage.process(
                voxelize::Chunk::new("cutaway", key.0, key.1, &options),
                voxelize::Resources {
                    registry: &w.registry,
                    config: &w.config,
                },
                None,
            )
        });
        for y in lo..=hi {
            let id = chunk.get_voxel(x, y, z);
            if id == 0 {
                continue;
            }
            let role = land.block_role(id).unwrap_or("?");
            let mut rgb = role_color(role);
            // Darken with depth below the top so the surface reads.
            let depth = (tops[k] - y).max(0) as f64;
            let k2 = 1.0 - 0.35 * (depth / 40.0).min(1.0);
            rgb = [rgb[0] * k2, rgb[1] * k2, rgb[2] * k2];
            let py = STRIP + ((hi - y) as usize) * px;
            c.rect(k * px, py, (k + 1) * px, py + px, to_rgb(rgb));
        }
    }
    // Height ticks every 16 blocks.
    let mut y = (lo / 16 + 1) * 16;
    while y <= hi {
        let py = STRIP + ((hi - y) as usize) * px;
        c.rect(0, py, 10, py + 1, [20, 20, 20]);
        c.text(14, py.saturating_sub(6), 1, &format!("Y{y}"), [20, 20, 20]);
        y += 16;
    }
    let line2 = format!(
        "{} SEED {}{} CUTAWAY ({x0},{z0}) TO ({x1},{z1}) Y {lo}..{hi} {} PX/BLOCK",
        land.identity().preset,
        o.seed,
        disabled_note(o),
        px
    );
    let bottom = c.h - 26;
    c.rect(0, bottom, c.w, c.h, [24, 24, 28]);
    c.text(
        c.w.saturating_sub(12 * 52 + 12),
        bottom + 6,
        2,
        "VOXELS AS GENERATED BY THE STAGE, COLOURED BY ROLE",
        [220, 220, 225],
    );
    let blocks_across = c.w / px;
    label(&mut c, &line2, blocks_across);
    let name = o
        .name
        .clone()
        .unwrap_or_else(|| format!("{}-seed{}-cutaway", o.preset, o.seed));
    c.save(&o.out.join(format!("{name}.png")));
}

fn main() {
    let o = options();
    let w = world(&o);
    let land = &w.land;
    let frame = *land.frame();
    eprintln!(
        "preset {} seed {} H {} sea {} spec_hash {:016x}",
        land.identity().preset,
        o.seed,
        frame.height,
        frame.sea,
        land.identity().spec_hash
    );
    for l in land.lints() {
        eprintln!("{l}");
    }

    if o.dag {
        if o.dot {
            print!("{}", land.dag().to_dot());
        } else if o.json {
            println!(
                "{}",
                serde_json::to_string_pretty(land.dag()).expect("serializes")
            );
        } else {
            print!("{}", land.dag().to_text());
        }
        return;
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

    if let Some(line) = o.cutaway {
        cutaway(&w, &o, line);
        return;
    }

    let center = match o.center.as_deref() {
        None | Some("spawn") => {
            let s = land.spawn();
            eprintln!("spawn ({}, {}) top {}", s.0, s.1, land.spawn_point().1 - 1);
            s
        }
        Some(xz) => parse_xz(xz),
    };

    if o.instances {
        let size = o.size.unwrap_or(4096) as f64;
        let area = Aabb2::around(center.0 as f64, center.1 as f64, 0.5 * size);
        for i in land.instances_in(area) {
            println!("{}", serde_json::to_string(&i).expect("serializes"));
        }
        return;
    }

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
    let name = o
        .name
        .clone()
        .unwrap_or_else(|| format!("{}-seed{}-{}", o.preset, o.seed, map.replace('.', "_")));
    let line2 = format!(
        "{}  SEED {}{}  H {}  {}  {} X {} BLOCKS  STRIDE {}  CENTER {},{}",
        land.identity().preset,
        o.seed,
        disabled_note(&o),
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

    let t = std::time::Instant::now();
    match map.as_str() {
        "hillshade" | "edges" | "claims" => {
            let (mut c, rows) =
                render::map_layer(land, &map, x0, z0, n, stride).unwrap_or_else(|e| panic!("{e}"));
            eprintln!("{map} {n}x{n} in {:.1} s", t.elapsed().as_secs_f64());
            mark_spawn(&mut c, 0);
            render::legend(&mut c, &rows);
            label(&mut c, &line2, size);
            c.save(&o.out.join(format!("{name}.png")));
        }
        "surface" => {
            let (c, chunks) = surface(&w, x0, z0, n, stride);
            eprintln!(
                "surface {n}x{n} ({chunks} chunks) in {:.1} s",
                t.elapsed().as_secs_f64()
            );
            let mut c = c;
            mark_spawn(&mut c, 0);
            label(&mut c, &line2, size);
            c.save(&o.out.join(format!("{name}.png")));
        }
        "biome" | "climate" | "temperature" | "moisture" => {
            let heights = land.ground_window(x0, z0, n, n, stride);
            let sh = render::shade(&heights, n, n, stride as f64, 1.6);
            let cols = land.columns_window(x0, z0, n, n, stride);
            eprintln!("facts {n}x{n} in {:.1} s", t.elapsed().as_secs_f64());
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
                let rows: Vec<(String, Rgb)> = keys
                    .iter()
                    .map(|k| (k.clone(), to_rgb(biome_color(k))))
                    .collect();
                render::legend(&mut c, &rows);
            }
            label(&mut c, &line2, size * panels);
            c.save(&o.out.join(format!("{name}.png")));
        }
        field => {
            let names: Vec<String> = land.spec().fields.keys().cloned().collect();
            let fi = names
                .iter()
                .position(|f| f == field)
                .unwrap_or_else(|| panic!("unknown map {field}: hillshade, edges, claims, surface, climate, biome, temperature, moisture or one of {names:?}"));
            let mut values = vec![0.0; n * n];
            let threads = std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(4);
            let band = n.div_ceil(threads).max(1);
            std::thread::scope(|s| {
                for (b, rows) in values.chunks_mut(band * n).enumerate() {
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
            eprintln!("field {n}x{n} in {:.1} s", t.elapsed().as_secs_f64());
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
                    c.set(x, STRIP + z, to_rgb(lerp3([0.0; 3], [1.0; 3], t)));
                }
            }
            label(&mut c, &format!("{line2}  RANGE {lo:.2}..{hi:.2}"), size);
            c.save(&o.out.join(format!("{name}.png")));
        }
    }
}
