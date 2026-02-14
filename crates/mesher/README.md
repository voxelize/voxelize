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
6. Compare benchmark medians between two runs:
   - `python3 crates/mesher/scripts/compare_bench_medians.py --baseline <baseline_output.txt> --candidate <candidate_output.txt>`
7. Gate benchmark regressions by median delta threshold:
   - `python3 crates/mesher/scripts/bench_regression_gate.py --baseline <baseline_output.txt> --candidate <candidate_output.txt> --max-regression-pct 1.0`
   - optional lane selection: `--include '^greedy_mesher/' --exclude '/legacy/'`
8. Aggregate lane medians over repeated runs:
   - `python3 crates/mesher/scripts/aggregate_bench_medians.py --input <run1.txt> --input <run2.txt> --include '^greedy_mesher/'`
9. Compare baseline/candidate run sets with per-lane spread:
   - `python3 crates/mesher/scripts/compare_bench_sets.py --baseline <baseline_run1.txt> --baseline <baseline_run2.txt> --candidate <candidate_run1.txt> --candidate <candidate_run2.txt> --include '^greedy_mesher/'`
   - optional regression gate: `--max-regression-pct 1.0`
10. Gate run-set stability by lane variance:
   - `python3 crates/mesher/scripts/bench_stability_gate.py --input <run1.txt> --input <run2.txt> --input <run3.txt> --include '^greedy_mesher/optimized/' --max-cv-pct 1.5`
11. Summarize grouped speedups between two runs:
   - `python3 crates/mesher/scripts/bench_speedup_summary.py --baseline <baseline_output.txt> --candidate <candidate_output.txt>`
12. Summarize lane outcomes (improved/regressed/neutral):
   - `python3 crates/mesher/scripts/bench_outcome_summary.py --baseline <baseline_output.txt> --candidate <candidate_output.txt> --neutral-band-pct 1.0`
13. Rebuild WASM wrapper when needed:
   - `cd crates/wasm-mesher && wasm-pack build --target web`

## Structure

- `src/mesher.rs` - Meshing algorithms and data structures (greedy and non-greedy)
- `src/lib.rs` - Public exports
- `tests/greedy_snapshot_tests.rs` - Snapshot regressions across block-property fixtures
- `benches/greedy_mesher_bench.rs` - Criterion benchmarks for greedy/non-greedy performance
- `scripts/compare_bench_medians.py` - Median-only benchmark output comparison tool
- `scripts/bench_regression_gate.py` - Threshold-based benchmark regression gate
- `scripts/aggregate_bench_medians.py` - Multi-run benchmark median aggregation tool
- `scripts/compare_bench_sets.py` - Multi-run baseline/candidate comparison with spread and optional gate
- `scripts/bench_stability_gate.py` - Run-set coefficient-of-variation stability gate
- `scripts/bench_speedup_summary.py` - Grouped geomean/mean speedup summary tool
- `scripts/bench_outcome_summary.py` - Per-lane improved/regressed/neutral outcome summary tool
