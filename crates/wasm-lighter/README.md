# voxelize-wasm-lighter

`voxelize-wasm-lighter` exposes `voxelize-lighter` to browser workers through `wasm-bindgen`.

## Exports

- `init()`
- `set_registry(registry)`
- `process_light_batch_fast(...)`

`process_light_batch_fast` is designed for chunk-grid batch operations used by the core light worker.

## Build

From this crate directory:

```bash
wasm-pack build --target web
```
