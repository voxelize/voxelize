# Mesher Optimization Report

Date: 2026-05-18

## Summary

The mesher work focused on the greedy meshing path used by both native server meshing and the client WASM worker. Runtime logs from the `terrain` world showed that empty and sparse subchunks were wasting time in full-volume scans, while dense terrain chunks were paying repeated allocation and lookup costs in the inner greedy loop.

The final implementation keeps the greedy mesher as the only shipped path, removes the non-greedy runtime option, and applies several greedy-specific optimizations with tests and terrain-world runtime evidence.

## Changes

### Greedy-only meshing

The runtime `greedyMeshing` / `greedy_meshing` option was removed. Server meshing, WASM meshing, and the client worker now always call the greedy mesher. Tests and benchmarks were updated so they no longer exercise a non-greedy mode.

Why this helps:

- Removes a second behavior surface from client, server, and WASM.
- Shrinks the worker bundle.
- Lets future optimization focus entirely on the greedy representation.

### Sparse subchunk fast paths

The greedy mesher now checks whether the center chunk has any non-empty voxels in the requested mesh range before doing the full greedy pass. If the range is empty, the mesher returns immediately.

The greedy scan also computes sparse bounds for low-occupancy ranges, then falls back to the full range once the range is dense enough that bounds scanning would not pay off.

Why this helps:

- Empty subchunks avoid a full six-direction greedy scan.
- Sparse subchunks only scan the occupied region.
- Dense terrain avoids the sparse-bounds overhead.

### Allocation-free AO/light accumulation

The AO/light hot path no longer allocates small vectors to average corner light samples. It uses stack counters and sums instead.

Why this helps:

- Removes repeated tiny allocations inside per-face work.
- Keeps packed AO/light output identical.

### Direct face path for simple greedy blocks

Full-cube, non-rotated, non-fluid, non-dynamic blocks now select the active face for the current direction directly. They no longer clone the full face list and filter it for every voxel/direction pair.

Why this helps:

- Avoids per-voxel face-vector creation in the common terrain path.
- Leaves complex fallback blocks on the existing safe path.

### Dense registry cache

The mesher registry cache now uses a dense `Vec<usize>` id-to-index table instead of a hash map. Block ids are numeric, so direct indexing is cheaper than hashing in the mesher hot path.

Why this helps:

- Reduces repeated registry lookup overhead in dense terrain.
- Shrinks the WASM worker bundle.

## Runtime Evidence

Measurements were collected on the `terrain` world using a fixed route:

1. `0 96 0`
2. `96 96 0`
3. `96 96 96`
4. `-96 96 96`

The worker logged chunk preparation, WASM meshing, geometry packing, and center occupancy during the optimization passes.

Observed improvements:

- Empty/sparse subchunks improved from roughly `3.2-4.4ms` to roughly `0.3-0.9ms`.
- Dense terrain examples improved from roughly `15.7ms / 24.5ms / 33.1ms` to roughly `8.8ms / 14.2ms / 25.6ms`.
- Another terrain route improved from roughly `17.8ms / 23.4ms / 49.9ms` to roughly `5.0ms / 10.3ms / 13.8ms`.
- After direct-face and registry-cache work, representative dense jobs continued improving, including examples around `25.5ms -> 15.5ms`, `20.7ms -> 14.2ms`, and `35.0ms -> 25.5ms`.

Worker bundle size also dropped:

- Before greedy cleanup: about `420.9 kB`
- After greedy-only and sparse work: about `406.0 kB`
- After direct-face optimization: about `400.4 kB`
- After dense registry cache: about `373.6 kB`

## Memory Impact

The implementation reduces memory and allocation pressure in several ways:

- Removes the shipped non-greedy code path from the worker bundle.
- Avoids per-face temporary vectors for AO/light averaging.
- Avoids cloned face-list construction for common full-cube greedy blocks.
- Replaces hash-map registry lookup storage with a dense id table.
- Keeps sparse-bounds scratch local to the mesher call.

The largest remaining memory opportunity is output transfer: the current WASM path still expands greedy quads into triangle attribute arrays before sending them back to the worker.

## Regression Proof

Validation performed:

- `cargo check`
- `cargo test --test mesher_tests`
- `pnpm format:file` on touched TypeScript files
- `pnpm lint:file` on touched TypeScript files
- `pnpm build:wasm:release`
- `pnpm --filter @voxelize/core build`
- Terrain-world route screenshot after optimization

Regression coverage added:

- Sparse bounds preserve the original chunk-relative coordinate origin.
- Greedy layer and geometry validity tests now exercise the always-greedy path.
- The diagonal-face fallback remains covered so non-cardinal face geometry still emits through the fallback path.

## Follow-up Opportunities

The council review identified several larger next steps:

- Replace the slice mask hash map with a dense vector mask.
- Bake neighbor opacity into `NeighborCache`.
- Cache neighbor data per voxel across the six axis sweeps.
- Add subchunk occupancy metadata so the client can skip empty jobs before entering WASM.
- Reduce WASM output serialization by returning typed arrays or compact quad records instead of JS number arrays.
- Consider a greedy quad atlas representation for full-cube terrain faces, keeping complex blocks on the legacy triangle path.

These should be implemented behind equivalence tests that compare optimized output against a full-bounds greedy reference.
