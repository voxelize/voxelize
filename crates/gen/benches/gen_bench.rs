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

    let voxelize_gen::TopologySpec::Heightfield(lane) = fixture_spec().topology else {
        unreachable!("the fixture runs the heightfield lane");
    };
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

    let density = harness_for(density_fixture_spec());
    group.bench_function("full_pipeline_density", |b| {
        b.iter_batched(
            || {
                slot += 1;
                (slot % 64, slot / 64 % 64)
            },
            |(cx, cz)| std::hint::black_box(density.generate_chunk(cx, cz)),
            BatchSize::SmallInput,
        )
    });

    let walker = harness_for(walker_fixture_spec());
    group.bench_function("full_pipeline_rivers_flora", |b| {
        b.iter_batched(
            || {
                slot += 1;
                (slot % 64, slot / 64 % 64)
            },
            |(cx, cz)| std::hint::black_box(walker.generate_chunk(cx, cz)),
            BatchSize::SmallInput,
        )
    });

    // Steady-state geology chunks: solves cached, sampling fused tiles.
    let geology = harness_for(geology_fixture_spec());
    for cx in 0..2 {
        for cz in 0..2 {
            std::hint::black_box(geology.generate_chunk(cx, cz));
        }
    }
    group.bench_function("full_pipeline_geology_steady", |b| {
        b.iter_batched(
            || {
                slot += 1;
                (slot % 32, slot / 32 % 32)
            },
            |(cx, cz)| std::hint::black_box(geology.generate_chunk(cx, cz)),
            BatchSize::SmallInput,
        )
    });

    group.finish();
}

fn bench_geology_solve(c: &mut Criterion) {
    let mut group = c.benchmark_group("geology");
    group.sample_size(10);
    let harness = harness_for(geology_fixture_spec());
    let mut tile = 100i64;
    group.bench_function("tile_solve_cold", |b| {
        b.iter_batched(
            || {
                tile += 7;
                tile
            },
            |t| std::hint::black_box(harness.generator.geology_tile_digest(t, -t)),
            BatchSize::SmallInput,
        )
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
    bench_geology_solve,
    bench_structures
);
criterion_main!(benches);
