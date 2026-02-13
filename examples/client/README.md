# Client Example

This example runs the browser client against the demo server.

## Prerequisites

- `pnpm install` at the repository root
- `wasm-pack` installed

## Run

From the repository root:

```bash
pnpm run demo
```

Or run only the client:

```bash
cd examples/client
pnpm run demo
```

To typecheck the example without requiring wasm artifacts:

```bash
cd examples/client
pnpm run typecheck
```

The client scripts run a wasm preflight check before `demo` and `build`:

- if `crates/wasm-mesher/pkg/voxelize_wasm_mesher.js` already exists, they continue immediately
- if it is missing and `wasm-pack` is available, they attempt `pnpm --dir ../.. build:wasm:dev`
- if it is missing and `wasm-pack` is unavailable, they fail with a clear setup message
