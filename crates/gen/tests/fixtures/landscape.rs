//! Shared landscape fixtures: the demo block registry, world configs, and
//! the `plain` preset compiled for a seed and height.

#![allow(dead_code)]

use std::sync::Arc;

use voxelize::{Registry, WorldConfig};
use voxelize_gen::landscape::presets::{demo_blocks, plain_landscape, Knobs, RoleBinding};
use voxelize_gen::landscape::{
    compile_with, CompileOptions, KindRegistry, Landscape, LandscapeSpec,
};

pub fn demo_registry() -> Registry {
    let mut registry = Registry::new();
    registry.register_blocks(&demo_blocks(1, &RoleBinding::demo()));
    registry
}

pub fn config(seed: u32, height: usize) -> WorldConfig {
    WorldConfig::new()
        .seed(seed)
        .chunk_size(16)
        .max_height(height)
        .sub_chunks(8)
        .build()
}

pub fn plain_spec(height: u32) -> LandscapeSpec {
    plain_landscape(&Knobs {
        height,
        ..Knobs::default()
    })
}

pub fn compile_spec(spec: &LandscapeSpec, seed: u32, options: &CompileOptions) -> Arc<Landscape> {
    compile_with(
        spec,
        &KindRegistry::with_builtins(),
        &RoleBinding::demo(),
        &demo_registry(),
        &config(seed, spec.frame.height as usize),
        options,
    )
    .unwrap_or_else(|e| panic!("the spec compiles: {e}"))
}

pub fn plain(seed: u32, height: u32, options: &CompileOptions) -> Arc<Landscape> {
    compile_spec(&plain_spec(height), seed, options)
}

/// A walking path out of the origin, two far chunks and a chunk far out
/// at sea for most seeds.
pub fn walk_chunks() -> Vec<(i32, i32)> {
    vec![
        (0, 0),
        (1, 0),
        (1, 1),
        (0, 1),
        (-1, 1),
        (-1, 0),
        (-1, -1),
        (0, -1),
        (40, -3),
        (-25, 60),
        (300, 300),
        (-640, 128),
    ]
}

/// The seed the walk bench and the work budget use.
pub const BENCH_SEED: u32 = 7;
