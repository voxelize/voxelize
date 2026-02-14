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
# direct cli alias also works: node ../../check-client.mjs --verify
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
# direct cli alias also works: node ./scripts/check-wasm-mesher.mjs --verify
```

All JSON report commands include `schemaVersion: 1` for compatibility checks.
JSON preflight reports include `startedAt`, `endedAt`, and `durationMs`.
Client aggregate JSON reports include `availableSteps`, `availableStepCount`, `availableStepScripts`, `availableStepScriptCount`, `availableStepScriptMap`, `availableStepScriptMapCount`, `availableStepCheckCommandMap`, `availableStepCheckCommandMapCount`, `availableStepCheckArgsMap`, `availableStepCheckArgsMapCount`, `availableStepCheckArgCountMap`, `availableStepCheckArgCountMapCount`, `availableStepSupportsNoBuildMap`, `availableStepSupportsNoBuildMapCount`, `availableStepIndices`, `availableStepIndexCount`, `availableStepIndexMap`, `availableStepIndexMapCount`, `availableStepMetadata`, `availableStepMetadataCount`, `totalSteps`, `passedStepCount`, `failedStepCount`, `skippedStepCount`, `firstFailedStep`, `passedSteps`, `failedSteps`, `skippedSteps`, `passedStepScripts`, `passedStepScriptCount`, `passedStepScriptMap`, `passedStepScriptMapCount`, `passedStepCheckCommandMap`, `passedStepCheckCommandMapCount`, `passedStepCheckArgsMap`, `passedStepCheckArgsMapCount`, `passedStepCheckArgCountMap`, `passedStepCheckArgCountMapCount`, `failedStepScripts`, `failedStepScriptCount`, `failedStepScriptMap`, `failedStepScriptMapCount`, `failedStepCheckCommandMap`, `failedStepCheckCommandMapCount`, `failedStepCheckArgsMap`, `failedStepCheckArgsMapCount`, `failedStepCheckArgCountMap`, `failedStepCheckArgCountMapCount`, `skippedStepScripts`, `skippedStepScriptCount`, `skippedStepScriptMap`, `skippedStepScriptMapCount`, `skippedStepCheckCommandMap`, `skippedStepCheckCommandMapCount`, `skippedStepCheckArgsMap`, `skippedStepCheckArgsMapCount`, `skippedStepCheckArgCountMap`, `skippedStepCheckArgCountMapCount`, `passedStepIndices`, `passedStepIndexCount`, `passedStepIndexMap`, `passedStepIndexMapCount`, `failedStepIndices`, `failedStepIndexCount`, `failedStepIndexMap`, `failedStepIndexMapCount`, `skippedStepIndices`, `skippedStepIndexCount`, `skippedStepIndexMap`, `skippedStepIndexMapCount`, `stepCheckCommandMap`, `stepCheckCommandMapCount`, `stepCheckArgsMap`, `stepCheckArgsMapCount`, `stepCheckArgCountMap`, `stepCheckArgCountMapCount`, `failureSummaries`, `failureSummaryCount`, `stepStatusMap`, `stepStatusMapCount`, `stepStatusCountMap`, `stepStatusCountMapCount`, `passedStepMetadata`, `passedStepMetadataCount`, `failedStepMetadata`, `failedStepMetadataCount`, `skippedStepMetadata`, and `skippedStepMetadataCount`.
Client aggregate JSON reports also include top-level wasm preflight summary fields `wasmPackCheckStatus`, `wasmPackCheckCommand`, `wasmPackCheckArgs`, `wasmPackCheckArgCount`, `wasmPackCheckExitCode`, and `wasmPackCheckOutputLine`.
WASM-pack JSON reports include check inventory and execution partitions such as `availableChecks`, `availableCheckCount`, `availableCheckIndices`, `availableCheckIndexCount`, `availableCheckCommandMap`, `availableCheckArgsMap`, `availableCheckArgCountMap`, `availableCheckIndexMap`, `availableCheckMetadata`, `checkLabels`, `checkIndices`, `checkIndexMap`, `checkCommandMap`, `checkArgsMap`, `checkArgCountMap`, `checkMetadata`, `checkStatusMap`, `checkStatusCountMap`, `checkVersionMap`, `checkExitCodeMap`, `checkOutputLineMap`, `passedChecks`, `passedCheckIndices`, `passedCheckIndexMap`, `passedCheckCommandMap`, `passedCheckArgsMap`, `passedCheckArgCountMap`, `passedCheckMetadata`, `failedChecks`, `failedCheckIndices`, `failedCheckIndexMap`, `failedCheckCommandMap`, `failedCheckArgsMap`, `failedCheckArgCountMap`, `failedCheckMetadata`, `failureSummaries`, and associated `*Count` fields.
WASM-pack metadata entries in `availableCheckMetadata`, `checkMetadata`, `passedCheckMetadata`, and `failedCheckMetadata` include `checkIndex`, `command`, `args`, `argCount`, `checkCommand`, `checkArgs`, and `checkArgCount`.
WASM-pack `failureSummaries[]` entries include `checkIndex`, `command`, `args`, `argCount`, `checkCommand`, `checkArgs`, and `checkArgCount` for deterministic command diagnostics.
Client wasm preflight JSON reports include `wasmPackCheckCommand`, `wasmPackCheckArgs`, `wasmPackCheckArgCount`, `wasmPackCheckExitCode`, `wasmPackCheckStatus`, and `wasmPackCheckOutputLine` to trace nested wasm-pack check execution.
Each `steps[]` entry also includes `scriptName`, `supportsNoBuild`, `checkCommand`, `checkArgs`, `checkArgCount`, and `stepIndex` for stable script-level correlation in CI logs.
Each client `failureSummaries[]` entry includes `checkCommand`, `checkArgs`, and `checkArgCount` for deterministic failed-step command diagnostics.
Skipped JSON steps are represented with `skipped: true` and `exitCode: null`.
If `--output` is provided without a value, commands fail fast. JSON commands return a structured error report; non-JSON commands print a plain error message.
When `--output` is valid, JSON validation-error reports are also written to that output path.
If `--output` is passed multiple times, the last value is used, even when recognized strict tokens appear between repeated output flags.
Empty or whitespace-only split/inline output values (for example `--output ""`, `--output "   "`, `--output=`, or `--output=   `) are treated as missing values.
If a split output value position is followed by a recognized option token (for example `--output --json`), that token is treated as an option and the output value is considered missing.
For client/onboarding/wasm preflight commands, `--output --verify` and `--output --no-build` both fail output validation and still activate no-build behavior.
Unsupported CLI flags return structured errors and include `unknownOptions`, `unknownOptionCount`, `supportedCliOptions`, `supportedCliOptionCount`, and `validationErrorCode`.
Inline unsupported-option forms are normalized in diagnostics (for example `--mystery=alpha` is reported as `--mystery`) and deduplicated by option token.
Inline misuse of supported non-value flags is redacted without exposing raw values (for example `--json=secret` is reported as `--json=<value>`).
Alias misuse uses canonical redacted forms (for example `--verify=secret` is reported as `--no-build=<value>`).
Malformed inline option names are redacted and deduplicated (for example `--=secret` and `--=` are reported as `--=<value>`, while `-=secret` and `-=` are reported as `-=<value>`).
Literal placeholder tokens are deduplicated with redacted inline misuse forms (for example `--json=<value>` and `--json=secret` are reported once as `--json=<value>`).
JSON preflight reports also include `activeCliOptions`, `activeCliOptionTokens`, `activeCliOptionResolutions`, and `activeCliOptionOccurrences` for option-usage diagnostics.
Misused inline option forms (for example `--json=secret` or `--verify=secret`) are excluded from `activeCliOption*` metadata and are instead reported via redacted `unknownOptions`.
Recognized options in the same invocation are still preserved in `activeCliOption*` metadata even when misused inline options are also present.
JSON preflight reports include `availableCliOptionAliases` and `availableCliOptionCanonicalMap` to expose alias-to-canonical option mappings.
If report writing fails, JSON error reports include both `message` and `writeError`.
Add `--compact` to each JSON preflight command for single-line JSON output.

This runs client typechecking and wasm-artifact preflight in sequence.
