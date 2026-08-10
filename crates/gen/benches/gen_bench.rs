//! Generation cost benchmarks: field program sampling (simple and layered
//! reference stacks), the four-stage chunk pipeline, and structure
//! planning. Chunk budgets in review conversations come from here.

#[path = "../tests/fixtures/mod.rs"]
mod fixtures;

use criterion::{criterion_group, criterion_main, BatchSize, Criterion};
use fixtures::*;
use voxelize_gen::{FieldProgram, TerrainView};

fn compile_graph(graph: &voxelize_gen::FieldGraph) -> FieldProgram {
    let mut salts = hashbrown::HashSet::new();
    FieldProgram::compile(graph, "bench", 7, "bench_dim", &mut salts).expect("compiles")
}

fn bench_field_programs(c: &mut Criterion) {
    let mut group = c.benchmark_group("field_sample");

    let voxelize_gen::TopologySpec::Heightfield(lane) = fixture_spec().topology;
    let simple = compile_graph(&lane.base_height);
    let mut cursor = 0i32;
    group.bench_function("fixture_base", |b| {
        b.iter(|| {
            cursor = cursor.wrapping_add(37);
            std::hint::black_box(simple.sample2(cursor % 4096, (cursor * 7) % 4096))
        })
    });

    let reference = compile_graph(&reference_stack());
    group.bench_function("reference_stack", |b| {
        b.iter(|| {
            cursor = cursor.wrapping_add(37);
            std::hint::black_box(reference.sample2(cursor % 4096, (cursor * 7) % 4096))
        })
    });

    group.finish();
}

fn bench_chunk_pipeline(c: &mut Criterion) {
    let mut group = c.benchmark_group("chunk");
    group.sample_size(20);

    let fixture = harness();
    let mut slot = 0i32;
    group.bench_function("full_pipeline_fixture", |b| {
        b.iter_batched(
            || {
                slot += 1;
                (slot % 64, slot / 64 % 64)
            },
            |(cx, cz)| std::hint::black_box(fixture.generate_chunk(cx, cz)),
            BatchSize::SmallInput,
        )
    });

    let mut layered_spec = fixture_spec();
    layered_spec.topology = voxelize_gen::TopologySpec::Heightfield(voxelize_gen::HeightfieldLane {
        base_height: reference_stack(),
        relief: vec![],
        slope_probe: 2,
    });
    let layered = harness_for(layered_spec);
    group.bench_function("full_pipeline_reference_stack", |b| {
        b.iter_batched(
            || {
                slot += 1;
                (slot % 64, slot / 64 % 64)
            },
            |(cx, cz)| std::hint::black_box(layered.generate_chunk(cx, cz)),
            BatchSize::SmallInput,
        )
    });

    group.finish();
}

fn bench_density(c: &mut Criterion) {
    let mut group = c.benchmark_group("density");
    let spec = voxelize_gen::DensitySpec {
        salt: voxelize_gen::SaltPath("bench.density"),
        band: 14.0,
        amp: 6.0,
        shelf: Some(voxelize_gen::ShelfSpec {
            spacing: 9.0,
            resistant_share: 0.55,
            warp_amp: 4.0,
            warp_scale: 60.0,
            lens_scale: 40.0,
            lens_squash: 3.0,
            slope: (0.8, 8.0),
            relief: 4.5,
        }),
        notch: Some(voxelize_gen::NotchSpec {
            depth: 3.5,
            height: 5.0,
            slope: (0.7, 8.0),
            scale: 48.0,
            river_reach: 24.0,
        }),
    };
    let density =
        voxelize_gen::density::CompiledDensity::compile(&spec, 7, "bench_dim").expect("compiles");
    let column = density.column(1.8, f64::NEG_INFINITY);

    // One engaged cliff column, full band: the worst-case per-column
    // cost the shape stage pays.
    let mut x = 0i32;
    group.bench_function("engaged_column_band", |b| {
        b.iter(|| {
            x = x.wrapping_add(13);
            let surface = 90;
            let mut solids = 0u32;
            for y in (surface - 14)..(surface + 14) {
                if density.solid(x % 4096, y, (x * 7) % 4096, surface, &column) {
                    solids += 1;
                }
            }
            std::hint::black_box(solids)
        })
    });

    group.finish();
}

fn bench_structures(c: &mut Criterion) {
    let fixture = harness();
    let generator = &fixture.generator;
    let structures = generator.structures();
    let mut site = 0i64;
    c.bench_function("structures/plan_for_site", |b| {
        b.iter(|| {
            site += 1;
            std::hint::black_box(structures.plan_for_site(
                0,
                (site % 512, site / 512),
                generator.as_ref() as &dyn TerrainView,
            ))
        })
    });
}

criterion_group!(
    benches,
    bench_field_programs,
    bench_chunk_pipeline,
    bench_density,
    bench_structures
);
criterion_main!(benches);
