//! Landscape kernel costs: nanoseconds per operation for the bit-stable
//! math and the profiles, per fold for the strata, per node and per voxel
//! for lattices, the cull ratio of the flagship tunnel recipe, and the
//! floods. Criterion reports throughput in elements per second; ns/op is
//! 1e3 / (Melem/s).
//!
//! `cargo bench -p voxelize-gen --features unstable-landscape --bench landscape_kernel`

use std::hint::black_box;
use std::time::Duration;

use criterion::{criterion_group, criterion_main, Criterion, Throughput};
use voxelize_gen::landscape::channels::{ChannelNet, ChannelVertex};
use voxelize_gen::landscape::flood::{lake_flood, priority_flood, Divide, LakeLimits};
use voxelize_gen::landscape::geometry::{tile_gate_bound, Footprint};
use voxelize_gen::landscape::lattice::{Lattice, LatticeSpec, VoxelBox};
use voxelize_gen::landscape::math::*;
use voxelize_gen::landscape::profile::{
    Cone, DuneWave, Face, FaceSpec, Monotone, Profile, SWall, SlotLedge, SlotSection, SlotSpec,
    Wall,
};
use voxelize_gen::landscape::strata::{BandSpec, BandTable};
use voxelize_gen::{HashStream, Perlin};

const N: usize = 1024;

fn inputs(seed: u64, lo: f64, hi: f64) -> Vec<f64> {
    let mut s = HashStream::new(seed);
    (0..N).map(|_| s.range_f((lo, hi))).collect()
}

fn bench_math(c: &mut Criterion) {
    let mut g = c.benchmark_group("math");
    g.throughput(Throughput::Elements(N as u64));
    let unit = inputs(1, 0.0, 1.0);
    let wide = inputs(2, -50.0, 50.0);
    let ground = inputs(3, 0.0, 200.0);
    macro_rules! op {
        ($name:literal, $xs:expr, |$x:ident| $body:expr) => {
            g.bench_function($name, |b| {
                b.iter(|| {
                    let mut acc = 0.0;
                    for &v in $xs.iter() {
                        let $x = black_box(v);
                        acc += $body;
                    }
                    acc
                })
            });
        };
    }
    op!("smoothstep", unit, |x| smoothstep(0.2, 0.8, x));
    op!("smootherstep", unit, |x| smootherstep(0.2, 0.8, x));
    op!("soft_down", ground, |x| soft_down(x, 100.0, 6.0));
    op!("soft_up", ground, |x| soft_up(x, 100.0, 6.0));
    op!("smin", wide, |x| smin(x, 3.0, 4.0));
    op!("soft_ceiling", ground, |x| soft_ceiling(
        x * 3.0,
        450.0,
        498.0
    ));
    op!("pow_smooth", unit, |x| pow_smooth(x, 1.35));
    op!("pow_smooth_d", unit, |x| pow_smooth_d(x, 1.35));
    op!("bias", unit, |x| bias(x, 0.3));
    op!("psin", wide, |x| psin(x));
    op!("pcos", wide, |x| pcos(x));
    op!("pseudo_angle", wide, |x| pseudo_angle(x, 3.0 - x));
    op!("ring_noise", wide, |x| ring_noise(
        |a, b| a * 0.3 - b * 0.7,
        (1.0, 2.0),
        (x, 7.0),
        9.0
    ));
    op!("exp2_p", wide, |x| exp2_p(x));
    op!("log2_p", ground, |x| log2_p(x + 1.0));
    // Platform references, for scale only (not bit-stable).
    op!("ref_sin", wide, |x| x.sin());
    op!("ref_powf", unit, |x| x.powf(1.35));
    g.finish();
}

fn bench_profiles(c: &mut Criterion) {
    let mut g = c.benchmark_group("profile");
    g.throughput(Throughput::Elements(N as u64));
    let unit = inputs(4, 0.0, 1.0);
    let wall = Wall::new(1.35, 0.07).unwrap();
    let cone = Cone::new(1.875, 0.94).unwrap();
    let face = Face::new(FaceSpec {
        h: 60.0,
        ledge: 25.0,
        run1: 2.5,
        shelf: 3.0,
        run2: 3.5,
        rim: 5.0,
    })
    .unwrap();
    let swall = SWall::new(0.42, 0.1).unwrap();
    let slot = SlotSection::new(SlotSpec {
        depth: 20.0,
        half: 2.2,
        flat: 0.85,
        ledge: Some(SlotLedge {
            width: 3.0,
            depth_share: 0.35,
            run: 0.8,
        }),
        lip: 2.0,
        lip_reach: 3.0,
        bench: 2.0,
        bench_reach: 9.0,
    })
    .unwrap();
    let dune = DuneWave::new(0.72).unwrap();
    macro_rules! op {
        ($name:literal, |$u:ident| $body:expr) => {
            g.bench_function($name, |b| {
                b.iter(|| {
                    let mut acc = 0.0;
                    for &v in unit.iter() {
                        let $u = black_box(v);
                        acc += $body;
                    }
                    acc
                })
            });
        };
    }
    op!("wall_sample", |u| wall.sample(u).0);
    op!("wall_inverse", |u| wall.inverse(u));
    op!("cone_sample", |u| cone.sample(u).0);
    op!("cone_inverse", |u| cone.inverse(u));
    op!("face_sample", |u| face.sample(u * 14.0).0);
    op!("face_offset", |u| face.offset(u * 60.0));
    op!("swall_sample", |u| swall.sample(u).0);
    op!("slot_sample", |u| slot.sample(u * 18.0).0);
    op!("slot_inverse", |u| slot.inverse(-20.0 * u));
    op!("dune_sample", |u| dune.sample(u * 3.0).0);
    g.finish();
}

fn bench_strata(c: &mut Criterion) {
    let mut g = c.benchmark_group("strata");
    let table = BandTable::new(
        BandSpec {
            band: 27.0,
            jitter: 0.22,
            wander: 5.0,
            tilt: 0.011,
            dir: (0.6, 0.8),
            tread: 0.3,
            cliff: 0.135,
            talus_rise: 0.4,
            vary: 2.0,
            roll: 0.3,
        },
        7,
    )
    .unwrap();
    let heights = inputs(5, 0.0, 512.0);
    g.throughput(Throughput::Elements(N as u64));
    g.bench_function("fold", |b| {
        let column = table.column(120.0, -40.0, [0.3, -0.6]);
        b.iter(|| {
            heights
                .iter()
                .map(|&h| column.fold(black_box(h)).height)
                .sum::<f64>()
        })
    });
    g.throughput(Throughput::Elements(512));
    g.bench_function("cursor_column_512", |b| {
        b.iter(|| {
            let column = table.column(black_box(120.0), -40.0, [0.3, -0.6]);
            let mut cursor = column.cursor();
            (0..512).map(|y| cursor.part(y) as u32).sum::<u32>()
        })
    });
    g.finish();
}

/// Share of stride-6 cells the flagship tunnel recipe culls: two fields at
/// f 0.0085 with a 1.6 vertical squash, a cell skipped when either field's
/// corners all lie beyond the largest half width.
fn tunnel_cull_ratio(chunks: i32) -> (usize, usize) {
    let (pa, pb) = (Perlin::new(11), Perlin::new(12));
    let field = |p: &Perlin| {
        let p = p.clone();
        move |x: i32, y: i32, z: i32| {
            p.sample3(
                x as f64 * 0.0085,
                y as f64 * 0.0085 * 1.6,
                z as f64 * 0.0085,
            )
        }
    };
    let w_max = 0.057 * (0.88 + 0.30) * (1.0 + 0.35) * 1.2 * 1.4;
    let (mut cells, mut culled) = (0, 0);
    for cx in 0..chunks {
        for cz in 0..chunks {
            let region = VoxelBox::new([cx * 16, 0, cz * 16], [cx * 16 + 15, 255, cz * 16 + 15]);
            let a = Lattice::build(LatticeSpec::cubic(6), region, 1, field(&pa));
            let b = Lattice::build(LatticeSpec::cubic(6), region, 1, field(&pb));
            for cell in a.cells(region) {
                cells += 1;
                let (ba, bb) = (a.corners(cell.cell).bounds(), b.corners(cell.cell).bounds());
                if !(ba.meets_open(-w_max, w_max) && bb.meets_open(-w_max, w_max)) {
                    culled += 1;
                }
            }
        }
    }
    (culled, cells)
}

fn bench_lattice(c: &mut Criterion) {
    let (culled, cells) = tunnel_cull_ratio(8);
    println!(
        "lattice: tunnel recipe culls {culled}/{cells} stride-6 cells ({:.1}%) over 64 chunks, 256 tall",
        100.0 * culled as f64 / cells as f64
    );
    let mut g = c.benchmark_group("lattice");
    let region = VoxelBox::new([0, 0, 0], [15, 511, 15]);
    let perlin = Perlin::new(5);
    let nodes = Lattice::build(LatticeSpec::cubic(4), region, 1, |_, _, _| 0.0).node_count();
    println!("lattice: a 16x512x16 chunk at stride 4 has {nodes} nodes");
    g.throughput(Throughput::Elements(nodes as u64));
    g.bench_function("fill_perlin_node", |b| {
        b.iter(|| {
            Lattice::build(LatticeSpec::cubic(4), region, 1, |x, y, z| {
                perlin.sample3(x as f64 * 0.0085, y as f64 * 0.0136, z as f64 * 0.0085)
            })
        })
    });
    g.bench_function("fill_constant_node", |b| {
        b.iter(|| {
            Lattice::build(LatticeSpec::cubic(4), region, 1, |x, _, _| {
                black_box(x as f64)
            })
        })
    });
    let lattice = Lattice::build(LatticeSpec::cubic(4), region, 1, |x, y, z| {
        perlin.sample3(x as f64 * 0.0085, y as f64 * 0.0136, z as f64 * 0.0085)
    });
    g.throughput(Throughput::Elements(16 * 512 * 16));
    g.bench_function("sample_voxel_chunk", |b| {
        b.iter(|| {
            let mut acc = 0.0;
            for x in 0..16 {
                for y in 0..512 {
                    for z in 0..16 {
                        acc += lattice.sample(x, y, z);
                    }
                }
            }
            acc
        })
    });
    let tunnel = (Perlin::new(11), Perlin::new(12));
    let node = |p: &Perlin| {
        let p = p.clone();
        move |x: i32, y: i32, z: i32| {
            p.sample3(x as f64 * 0.0085, y as f64 * 0.0136, z as f64 * 0.0085)
        }
    };
    let region256 = VoxelBox::new([0, 0, 0], [15, 255, 15]);
    let a = Lattice::build(LatticeSpec::cubic(6), region256, 1, node(&tunnel.0));
    let bl = Lattice::build(LatticeSpec::cubic(6), region256, 1, node(&tunnel.1));
    let w = 0.057 * 1.18;
    g.throughput(Throughput::Elements(16 * 256 * 16));
    g.bench_function("thin_pair_unculled", |b| {
        b.iter(|| {
            let mut carved = 0u32;
            for x in 0..16 {
                for y in 0..256 {
                    for z in 0..16 {
                        carved +=
                            (a.sample(x, y, z).abs() < w && bl.sample(x, y, z).abs() < w) as u32;
                    }
                }
            }
            carved
        })
    });
    g.bench_function("thin_pair_culled", |b| {
        b.iter(|| {
            let mut carved = 0u32;
            for cell in a.cells(region256) {
                let (ba, bb) = (
                    a.corners(cell.cell).bounds(),
                    bl.corners(cell.cell).bounds(),
                );
                if !(ba.meets_open(-w, w) && bb.meets_open(-w, w)) {
                    continue;
                }
                let v = cell.voxels;
                for x in v.min[0]..=v.max[0] {
                    for y in v.min[1]..=v.max[1] {
                        for z in v.min[2]..=v.max[2] {
                            carved += (a.sample(x, y, z).abs() < w && bl.sample(x, y, z).abs() < w)
                                as u32;
                        }
                    }
                }
            }
            carved
        })
    });
    g.finish();
}

fn bench_floods_and_geometry(c: &mut Criterion) {
    let mut g = c.benchmark_group("flood");
    g.sample_size(20);
    let p = Perlin::new(42);
    let h = move |x: i32, z: i32| 40.0 * p.sample2(x as f64 * 0.07, z as f64 * 0.07);
    let (w, n) = (128usize, 128usize);
    let heights: Vec<f64> = (0..w * n)
        .map(|c| h((c % w) as i32, (c / w) as i32))
        .collect();
    g.throughput(Throughput::Elements((w * n) as u64));
    g.bench_function("priority_flood_128", |b| {
        b.iter(|| {
            priority_flood(
                w,
                n,
                &heights,
                |i, j| i == 0 || j == 0,
                Some(Divide {
                    rise: 96.0,
                    width: 4,
                }),
            )
        })
    });
    let mut seed = (0, 0);
    'search: for x in 0..64 {
        for z in 0..64 {
            let c = h(x, z);
            if [(-1, 0), (1, 0), (0, -1), (0, 1)]
                .iter()
                .all(|&(dx, dz)| h(x + dx, z + dz) > c)
            {
                seed = (x, z);
                break 'search;
            }
        }
    }
    let limits = LakeLimits {
        max_probes: 24_000,
        max_radius: 96,
        max_depth: 1e9,
    };
    let probes = lake_flood(&h, seed, &limits).map(|l| l.probes).unwrap_or(0);
    g.throughput(Throughput::Elements(probes.max(1) as u64));
    g.bench_function("lake_flood", |b| {
        b.iter(|| lake_flood(&h, black_box(seed), &limits))
    });
    g.finish();

    let mut g = c.benchmark_group("geometry");
    g.throughput(Throughput::Elements(N as u64));
    let pts = inputs(9, -200.0, 200.0);
    let capsules = Footprint::capsules(
        (0..9)
            .map(|i| (i as f64 * 40.0 - 160.0, 30.0 * psin(i as f64)))
            .collect(),
        (0..9).map(|i| 12.0 + i as f64).collect(),
    );
    g.bench_function("capsule_chain_sdf_8", |b| {
        b.iter(|| {
            pts.iter()
                .map(|&x| capsules.sdf_inside(black_box(x), x * 0.3))
                .sum::<f64>()
        })
    });
    let mut s = HashStream::new(3);
    let lines: Vec<Vec<ChannelVertex<f64>>> = (0..8)
        .map(|_| {
            let (mut x, mut z) = (s.range_f((-300.0, 300.0)), s.range_f((-300.0, 300.0)));
            (0..24)
                .map(|i| {
                    x += s.range_f((-40.0, 40.0));
                    z += s.range_f((-40.0, 40.0));
                    ChannelVertex::new(x, z, i as f64)
                })
                .collect()
        })
        .collect();
    let net = ChannelNet::new(&lines, 48.0);
    g.bench_function("channel_nearest", |b| {
        b.iter(|| {
            pts.iter()
                .filter_map(|&x| net.nearest(black_box(x), x * 0.7).map(|h| h.dist))
                .sum::<f64>()
        })
    });
    g.throughput(Throughput::Elements(1));
    g.bench_function("tile_gate_bound_256_s16", |b| {
        b.iter(|| {
            tile_gate_bound(
                |x, z| psin(x * 0.01) + pcos(z * 0.013),
                black_box(512.0),
                256.0,
                256.0,
                16.0,
                0.023,
            )
        })
    });
    g.finish();
}

criterion_group! {
    name = benches;
    config = Criterion::default()
        .warm_up_time(Duration::from_millis(500))
        .measurement_time(Duration::from_millis(1500))
        .sample_size(30);
    targets = bench_math, bench_profiles, bench_strata, bench_lattice, bench_floods_and_geometry
}
criterion_main!(benches);
