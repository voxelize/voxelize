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
# quiet mode (errors only)
pnpm run check:client -- --quiet
# json output (for CI integrations)
pnpm run check:client:json
# compact json output (single line)
pnpm run check:client:json:compact
# json output written to file
pnpm run check:client:json -- --output ./client-report.json
# verify without auto-building wasm artifacts
pnpm run check:client:verify
# verify + json output (for CI integrations)
pnpm run check:client:verify:json
# verify + compact json output (single line)
pnpm run check:client:verify:json:compact
# verify + json output written to file
pnpm run check:client:verify:json -- --output ./client-verify-report.json
```

Or from the client directory, run only wasm preflight checks:

```bash
cd examples/client
pnpm run check:wasm:json
# compact json output (single line)
pnpm run check:wasm:json:compact
# verify without auto-building wasm artifacts
pnpm run check:wasm:verify
# verify + json output (for CI integrations)
pnpm run check:wasm:verify:json
# verify + compact json output (single line)
pnpm run check:wasm:verify:json:compact
# verify + json output written to file
pnpm run check:wasm:verify:json -- --output ./wasm-verify-report.json
```

All JSON report commands include `schemaVersion: 1` for compatibility checks.
JSON preflight reports include `startedAt`, `endedAt`, and `durationMs`.
Client aggregate JSON reports include `totalSteps`, `passedStepCount`, `failedStepCount`, `skippedStepCount`, and `firstFailedStep`.
Skipped JSON steps are represented with `skipped: true` and `exitCode: null`.
If `--output` is provided without a value, JSON commands return a structured error report.
If `--output` is passed multiple times, the last value is used.
If report writing fails, JSON error reports include both `message` and `writeError`.
Add `--compact` to each JSON preflight command for single-line JSON output.

This runs client typechecking and wasm-artifact preflight in sequence.
