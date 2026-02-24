# voxelize-mesher

The **single source of truth** for voxel meshing algorithms in Voxelize.

## Architecture

```
voxelize-mesher (this crate)
    |
    +-- voxelize-wasm-mesher (WASM wrapper for browser client)
    |
    +-- voxelize server (uses this crate directly via Cargo dependency)
```

Both the server and client now use **the same meshing algorithms** from this crate.

## Usage

### Client (via WASM)

The `voxelize-wasm-mesher` package wraps this crate for use in the browser via WebAssembly.
The client's mesh-worker imports and calls the WASM-compiled meshing functions.

### Server

The server depends on this crate directly via Cargo. The server's `Space` type implements
the `VoxelAccess` trait, allowing the shared meshing functions to work seamlessly.

## Development

When making changes to meshing algorithms:

1. Edit this crate (`crates/mesher/src/`).
2. Run mesher tests:
   - `cargo test --manifest-path crates/mesher/Cargo.toml`
3. Run snapshot regressions (greedy + non-greedy):
   - `cargo test --manifest-path crates/mesher/Cargo.toml --test greedy_snapshot_tests`
4. Update snapshots intentionally when behavior changes:
   - `VOXELIZE_UPDATE_SNAPSHOTS=1 cargo test --manifest-path crates/mesher/Cargo.toml --test greedy_snapshot_tests`
5. Run benchmarks:
   - `cargo bench --manifest-path crates/mesher/Cargo.toml --bench greedy_mesher_bench`
6. Rebuild WASM wrapper when needed:
   - `cd crates/wasm-mesher && wasm-pack build --target web`

## Structure

- `src/mesher.rs` - Meshing algorithms and data structures (greedy and non-greedy)
- `src/lib.rs` - Public exports
- `tests/greedy_snapshot_tests.rs` - Snapshot regressions across block-property fixtures
- `benches/greedy_mesher_bench.rs` - Criterion benchmarks for greedy/non-greedy performance
