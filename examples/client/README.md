# Client Example

This example runs the browser client against the demo server.

## Prerequisites

- Node.js 18+
- pnpm 10+
- `wasm-pack` installed
- `pnpm install` at the repository root

Before running client commands, you can verify toolchain availability and minimum versions from the repository root:

```bash
pnpm run check:dev-env
```

## Run

From the repository root:

```bash
pnpm run demo
```

`pnpm run demo` runs the wasm precheck and dev wasm build first, then starts both server and client demos.

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

From the repository root you can also run:

```bash
pnpm run check:client
```

This runs client typechecking and wasm-artifact preflight in sequence.
