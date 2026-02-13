# voxelize-lighter

`voxelize-lighter` contains shared light propagation logic for Voxelize.

It extracts lighting from server-only modules into a reusable crate with no server dependency.

## Features

- sunlight propagation and removal
- RGB torch light propagation and removal
- batch removal support
- dynamic light pattern evaluation
- direction-aware transparency checks
- packed `u32` light channel operations via `voxelize-core::LightUtils`

## Public API

- `propagate`
- `flood_light`
- `remove_light`
- `remove_lights`
- `can_enter`
- `can_enter_into`

Core types are exported from `types`:

- `LightVoxelAccess`
- `LightBlock`
- `LightRegistry`
- `LightConfig`
- `LightBounds`
- `LightNode`

## Benchmarks

Criterion benchmarks are under:

- `benches/lights_bench.rs`

Run from this crate directory:

```bash
cargo bench --bench lights_bench
```
