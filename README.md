<div align="center">

<a href="https://shaoruu.io">
  <img src="examples/client/src/assets/logo-circle.png" width="100px" height="100px" />
</a>

<h1><a href="https://shaoruu.io">Voxelize</a></h1>

<p>A multiplayer, <i>super fast</i>, voxel engine in your browser!</p>

<a href="https://discord.gg/9483RZtWVU">
  <img alt="Discord Server" src="https://img.shields.io/discord/1229328337713762355?label=Discord&logo=Discord&style=for-the-badge">
</a>
<img src="https://img.shields.io/npm/v/@voxelize/core?logo=npm&style=for-the-badge">
<img src="https://img.shields.io/crates/v/voxelize?style=for-the-badge"/>

<a href="https://shaoruu.io">LIVE DEMO</a>

</div>

![](/assets/Screenshot%202024-02-19%20at%201.37.53 AM.png)
![](/assets/Screen%20Shot%202022-07-13%20at%201.01.08%20AM.png)
![](/assets/minejs.png)
![](/assets/Screen%20Shot%202022-07-19%20at%209.54.24%20PM.png)
![](/assets/Screen%20Shot%202022-07-31%20at%2011.58.11%20PM.png)
![](</assets/Screen%20Shot%202022-07-22%20at%208.01.48%20PM%20(2).png>)

## Disclaimer

This is purely a passionate project. The v0 of this engine, [mc.js](https://github.com/shaoruu/mc.js), was <i>brutally</i> taken down by Microsoft by a DMCA strike with some false claims (claimed that I was collecting actual MC user information even though mc.js wasn't deployed anywhere), so although inspired, I have to clarify that this voxel engine is NOT affiliated with Minecraft, nor does it have any intention collecting existing Minecraft user information (or from any licensed voxel engines). This engine is simply made out of passion, and the textures and assets used in the game are all either licensed for free use or hand-drawn by me. I am a big fan of Minecraft, so Mojang/Microsoft, if you see this, let's work together instead of taking me down :) (Minecraft web demo?)

[@shaoruu](https://github.com/shaoruu)

## Features

- Define custom blocks with custom static or dynamic mesh
  - Great support for flexible combinational rendering logic
- Easy-to-decouple server structure to refine the server-side logic
- Isolated modules that just work
- Realtime built-in multiplayer support
- Fast voxel chunk mesh generation on both client and server side (multithreaded)
- Multi-stage chunk generation with chunk overflow support
  - No need to worry if a tree overflows to neighboring chunk, that is handled automatically
- Fully configurable chat system with commands registry
- Rust-free core voxel primitives available via `@voxelize/ts-core`
- AABB Physics engine that works with any static or dynamic blocks
  - Auto-stepping, raycasting, all included
- Entity-to-entity collision detection and resolution system
- Periodic world data persistence
- Robust event system for custom game events
- For-dev debug panels that look nice

## Documentation

Checkout the Voxelize documentations here:

- [Backend](https://docs.rs/voxelize/0.8.11/voxelize/index.html)
- [Frontend](https://docs.voxelize.io/tutorials/intro/what-is-voxelize)
- [TypeScript Core](https://docs.voxelize.io/tutorials/intermediate/typescript-core)

## Development

Before starting, make sure to install the following:

- [rust](https://www.rust-lang.org/tools/install)
- [node.js (>=18)](https://nodejs.org/en/download/)
- [pnpm (>=10)](https://pnpm.io/installation)
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)
- [cargo-watch](https://crates.io/crates/cargo-watch)
- [protoc](https://grpc.io/docs/protoc-installation/)

```bash
# clone the repository
git clone https://github.com/shaoruu/voxelize.git
cd voxelize

# download dependencies
pnpm install

# verify local tooling and minimum versions
pnpm run check:dev-env
# quiet mode (errors only)
pnpm run check:dev-env -- --quiet
# json output (for CI integrations)
pnpm run check:dev-env:json
# compact json output (single line)
pnpm run check:dev-env:json:compact
# json output written to file
pnpm run check:dev-env:json -- --output ./dev-env-report.json

# verify wasm-pack setup
pnpm run check:wasm-pack
# json output (for CI integrations)
pnpm run check:wasm-pack:json
# compact json output (single line)
pnpm run check:wasm-pack:json:compact
# json output written to file
pnpm run check:wasm-pack:json -- --output ./wasm-pack-report.json

# generate protocol buffers
pnpm run proto

# build wasm mesher package for client demo/build
pnpm run build:wasm:dev
# client scripts also run a preflight check and attempt this automatically when wasm-pack is available

# fresh build
pnpm run build

# in a separate terminal, start both frontend/backend demo
pnpm run demo

# typecheck the client example only
pnpm run typecheck:client

# check whether client wasm artifacts are ready
pnpm run check:client:wasm

# run both client checks in sequence
pnpm run check:client
# quiet mode (errors only)
pnpm run check:client -- --quiet
# json output (for CI integrations)
pnpm run check:client:json
# compact json output (single line)
pnpm run check:client:json:compact
# json output written to file
pnpm run check:client:json -- --output ./client-report.json
# verify client checks without auto-building wasm artifacts
pnpm run check:client:verify
# verify + json output (for CI integrations)
pnpm run check:client:verify:json
# verify + compact json output (single line)
pnpm run check:client:verify:json:compact
# verify + json output written to file
pnpm run check:client:verify:json -- --output ./client-verify-report.json
# direct cli alias also works: node ./check-client.mjs --verify

# run full onboarding checks (tooling + ts-core + runtime libraries + client)
# onboarding execution order: developer environment preflight -> TypeScript core checks -> runtime library checks -> client checks
pnpm run check:onboarding
# quiet mode (errors only)
pnpm run check:onboarding -- --quiet
# json output (for CI integrations)
pnpm run check:onboarding:json
# compact json output (single line)
pnpm run check:onboarding:json:compact
# json output written to file
pnpm run check:onboarding:json -- --output ./onboarding-report.json
# verify onboarding checks without automatic ts-core/runtime/client artifact builds
pnpm run check:onboarding:verify
# verify + json output (for CI integrations)
pnpm run check:onboarding:verify:json
# verify + compact json output (single line)
pnpm run check:onboarding:verify:json:compact
# verify + json output written to file
pnpm run check:onboarding:verify:json -- --output ./onboarding-verify-report.json
# direct cli alias also works: node ./check-onboarding.mjs --verify

# check @voxelize/ts-core build artifacts + end-to-end example
pnpm run check:ts-core
# quiet mode (errors only)
pnpm run check:ts-core -- --quiet
# json output (for CI integrations)
pnpm run check:ts-core:json
# compact json output (single line)
pnpm run check:ts-core:json:compact
# json output written to file
pnpm run check:ts-core:json -- --output ./ts-core-report.json
# verify ts-core artifacts/example without triggering an automatic build
pnpm run check:ts-core:verify
# verify + json output (for CI integrations)
pnpm run check:ts-core:verify:json
# verify + compact json output (single line)
pnpm run check:ts-core:verify:json:compact
# verify + json output written to file
pnpm run check:ts-core:verify:json -- --output ./ts-core-verify-report.json
# full release-readiness workflow (build + tests + e2e example + verify report)
pnpm run check:ts-core:release
# rerun the ts-core e2e example without rebuilding artifacts
pnpm --filter @voxelize/ts-core run example:end-to-end:no-build
# ts-core release workflow aliases
pnpm run check:ts:release
pnpm run check:typescript:release
# ts-core aggregate preflight release workflow
pnpm run check:preflight:ts-core:release
# ts-core aggregate preflight release workflow aliases
pnpm run check:preflight:ts:release
pnpm run check:preflight:typescript:release
# direct cli alias also works: node ./check-ts-core.mjs --verify
# ts-core checks verify these artifact paths:
# - packages/ts-core/dist/index.js
# - packages/ts-core/dist/index.mjs
# - packages/ts-core/dist/index.d.ts
# ts-core checks also run:
# - packages/ts-core/examples/end-to-end.mjs
# default mode auto-builds missing artifacts before running the example
# verify/no-build mode fails without building and still runs the example when artifacts exist

# check runtime library build artifacts (@voxelize/aabb, @voxelize/raycast, @voxelize/physics-engine)
pnpm run check:runtime-libraries
# json output (for CI integrations)
pnpm run check:runtime-libraries:json
# compact json output (single line)
pnpm run check:runtime-libraries:json:compact
# verify mode skips build attempts
pnpm run check:runtime-libraries:verify
# verify + json output (for CI integrations)
pnpm run check:runtime-libraries:verify:json
# verify + compact json output (single line)
pnpm run check:runtime-libraries:verify:json:compact
# full release-readiness workflow (build each runtime package + verify report)
pnpm run check:runtime-libraries:release
# runtime-library release workflow alias
pnpm run check:runtime:release
# runtime-library aggregate preflight release workflow
pnpm run check:preflight:runtime-libraries:release
# runtime-library aggregate preflight release workflow alias
pnpm run check:preflight:runtime:release
# combined library release workflow (ts-core + runtime libraries)
pnpm run check:libraries:release
# combined library release workflow aliases
pnpm run check:library:release
pnpm run check:libs:release
pnpm run check:lib:release
# combined aggregate preflight release workflow (library release workflows + aggregate libraries preflight verify report)
pnpm run check:preflight:libraries:release
# combined aggregate preflight release workflow aliases
pnpm run check:preflight:library:release
pnpm run check:preflight:libs:release
pnpm run check:preflight:lib:release
# direct cli alias also works: node ./check-runtime-libraries.mjs --verify
# runtime library checks verify these artifact paths:
# - packages/aabb/dist/index.js
# - packages/aabb/dist/index.mjs
# - packages/aabb/dist/index.d.ts
# - packages/raycast/dist/index.js
# - packages/raycast/dist/index.mjs
# - packages/raycast/dist/index.d.ts
# - packages/physics-engine/dist/index.cjs
# - packages/physics-engine/dist/index.js
# - packages/physics-engine/dist/index.d.ts

# run an aggregated preflight report in json mode
pnpm run check:preflight:json
# default aggregate execution order: devEnvironment, wasmPack, tsCore, runtimeLibraries, client
# compact aggregate preflight report
pnpm run check:preflight:json:compact
# list available aggregate checks without executing them
pnpm run check:preflight:list:json
# direct cli aliases also work: node ./check-preflight.mjs --list (or -l)
# compact check-list report
pnpm run check:preflight:list:json:compact
# write list report to disk
pnpm run check:preflight:list:json -- --output ./preflight-check-list.json
# aggregated preflight report without auto-building wasm artifacts
pnpm run check:preflight:verify:json
# compact aggregated verify report
pnpm run check:preflight:verify:json:compact
# direct cli alias also works: node ./check-preflight.mjs --verify
# list available checks in verify-mode context
pnpm run check:preflight:list:verify:json
# compact verify-mode check-list report
pnpm run check:preflight:list:verify:json:compact
# list-mode aliases for single checks
pnpm run check:preflight:list:dev:json
pnpm run check:preflight:list:wasm:json
pnpm run check:preflight:list:ts-core:json
pnpm run check:preflight:list:ts-core:verify:json
pnpm run check:preflight:list:runtime-libraries:json
pnpm run check:preflight:list:runtime-libraries:verify:json
pnpm run check:preflight:list:runtime:json
pnpm run check:preflight:list:runtime:verify:json
pnpm run check:preflight:list:libraries:json
pnpm run check:preflight:list:libraries:verify:json
pnpm run check:preflight:list:library:json
pnpm run check:preflight:list:libs:json
pnpm run check:preflight:list:lib:json
pnpm run check:preflight:list:ts:json
pnpm run check:preflight:list:ts:verify:json
pnpm run check:preflight:list:typescript:json
pnpm run check:preflight:list:typescript:verify:json
pnpm run check:preflight:list:client:json
# list-mode aliases for all checks
pnpm run check:preflight:list:all:json
pnpm run check:preflight:list:all:verify:json
# list-mode separator aliases for all checks
pnpm run check:preflight:list:all-checks:json
pnpm run check:preflight:list:all-checks:verify:json
# compact list-mode aliases for single checks
pnpm run check:preflight:list:dev:json:compact
pnpm run check:preflight:list:wasm:json:compact
pnpm run check:preflight:list:ts-core:json:compact
pnpm run check:preflight:list:ts-core:verify:json:compact
pnpm run check:preflight:list:runtime-libraries:json:compact
pnpm run check:preflight:list:runtime-libraries:verify:json:compact
pnpm run check:preflight:list:runtime:json:compact
pnpm run check:preflight:list:runtime:verify:json:compact
pnpm run check:preflight:list:libraries:json:compact
pnpm run check:preflight:list:libraries:verify:json:compact
pnpm run check:preflight:list:ts:json:compact
pnpm run check:preflight:list:ts:verify:json:compact
pnpm run check:preflight:list:typescript:json:compact
pnpm run check:preflight:list:typescript:verify:json:compact
pnpm run check:preflight:list:client:json:compact
# compact list-mode aliases for all checks
pnpm run check:preflight:list:all:json:compact
pnpm run check:preflight:list:all:verify:json:compact
# compact list-mode separator aliases for all checks
pnpm run check:preflight:list:all-checks:json:compact
pnpm run check:preflight:list:all-checks:verify:json:compact
# explicit all-check aliases (equivalent to default aggregate selection)
pnpm run check:preflight:all:json
pnpm run check:preflight:all:verify:json
# explicit separator variant aliases for all-check selection
pnpm run check:preflight:all-checks:json
pnpm run check:preflight:all-checks:verify:json
# run only specific checks (available: devEnvironment, wasmPack, tsCore, runtimeLibraries, client)
pnpm run check:preflight:json -- --only devEnvironment,client
# aliases and case-insensitive names are supported (for example: dev/dev-env/dev_env, wasm/wasm-pack/wasm_pack, ts/ts-core/ts_core/tscore/typescript/typescript-core/typescript_core/typescriptcore, runtime/runtime-libraries/runtime_libraries/runtimelibraries, libraries/library/libs/lib, CLIENT, all/all-checks/all_checks/allchecks)
# selected checks are normalized to the standard aggregate order
# run pre-defined targeted aggregate reports
pnpm run check:preflight:dev-env:json
pnpm run check:preflight:wasm-pack:json
pnpm run check:preflight:ts-core:json
pnpm run check:preflight:ts-core:verify:json
pnpm run check:preflight:runtime-libraries:json
pnpm run check:preflight:runtime-libraries:verify:json
pnpm run check:preflight:runtime:json
pnpm run check:preflight:runtime:verify:json
pnpm run check:preflight:libraries:json
pnpm run check:preflight:libraries:verify:json
pnpm run check:preflight:library:json
pnpm run check:preflight:libs:json
pnpm run check:preflight:lib:json
pnpm run check:preflight:client:json
# shorthand aliases for targeted aggregate reports
pnpm run check:preflight:dev:json
pnpm run check:preflight:wasm:json
pnpm run check:preflight:ts:json
pnpm run check:preflight:ts:verify:json
pnpm run check:preflight:typescript:json
pnpm run check:preflight:typescript:verify:json
# single client check without auto-build
pnpm run check:preflight:client:verify:json
# compact targeted aggregate reports
pnpm run check:preflight:dev-env:json:compact
pnpm run check:preflight:wasm-pack:json:compact
pnpm run check:preflight:ts-core:json:compact
pnpm run check:preflight:ts-core:verify:json:compact
pnpm run check:preflight:runtime-libraries:json:compact
pnpm run check:preflight:runtime-libraries:verify:json:compact
pnpm run check:preflight:runtime:json:compact
pnpm run check:preflight:runtime:verify:json:compact
pnpm run check:preflight:libraries:json:compact
pnpm run check:preflight:libraries:verify:json:compact
pnpm run check:preflight:client:json:compact
pnpm run check:preflight:client:verify:json:compact
# shorthand compact aliases
pnpm run check:preflight:dev:json:compact
pnpm run check:preflight:wasm:json:compact
pnpm run check:preflight:ts:json:compact
pnpm run check:preflight:ts:verify:json:compact
pnpm run check:preflight:typescript:json:compact
pnpm run check:preflight:typescript:verify:json:compact
# compact all-check aliases
pnpm run check:preflight:all:json:compact
pnpm run check:preflight:all:verify:json:compact
# compact separator variant aliases for all-check selection
pnpm run check:preflight:all-checks:json:compact
pnpm run check:preflight:all-checks:verify:json:compact
# includes per-check and total duration metadata
# includes startedAt/endedAt plus totalChecks/passedCheckCount/failedCheckCount
# all json report commands include schemaVersion: 1
# includes passedChecks/failedChecks and runtime metadata (platform/nodeVersion)
# includes firstFailedCheck for quick failure triage
# includes failureSummaries for quick CI diagnostics
# includes failureSummaryCount for stable failure partition sizing
# failureSummaries are derived from nested step/check report messages when available
# failureSummaries also include scriptName, supportsNoBuild, checkIndex, checkCommand, checkArgs, and checkArgCount for deterministic CI routing
# checkArgs/exampleArgs/wasmPackCheckArgs are normalized to string arrays; malformed/trap values salvage readable indexed entries when possible and otherwise fall back to deterministic null/empty defaults
# CLI option token/arg arrays also salvage readable indexed entries when iterator access traps
# iterator-trapped step/check collections and ts-core payload-issue arrays also salvage readable indexed entries for deterministic diagnostics
# if key enumeration traps, fallback index scans salvage a bounded prefix of present entries to avoid pathological loops
# bounded fallback salvage remains active even when proxy has-check traps throw
# when length reads trap, fallback key scans still salvage readable entries
# if bounded prefix scans find no entries, bounded key scans can still recover sparse high-index entries
# key-scan fallback keeps the lowest bounded index set in ascending order for deterministic output
# malformed requiredFailures counters are sanitized before deriving fallback failure messages
# requiredFailures fallback messages are emitted only for positive integer counts
# sparse trap fallbacks can recover high-index entries even when bounded prefixes contain only undefined values
# report count/index metadata accepts only non-negative safe integers before fallback coercion
# wasm status extraction accepts only known status values (ok/missing/unavailable/skipped) before fallback derivation
# string-array extraction can fall through to bounded key scans when trapped bounded prefixes contain only non-string noise
# ts-core example status extraction accepts only known status values (ok/failed/skipped) before fallback derivation
# status token extraction trims surrounding whitespace before known-status validation
# canonical alias keys and alias token lists are whitespace-normalized before cli catalog/diagnostic resolution
# optionally write the same report to disk
pnpm run check:preflight:verify:json -- --output ./preflight-report.json

# run script-focused integration tests
pnpm run test:scripts
```

In JSON mode, skipped steps are represented with `skipped: true` and `exitCode: null`.
JSON preflight commands include `startedAt`, `endedAt`, and `durationMs`.
Client and onboarding JSON reports also include `availableSteps`, `availableStepCount`, `availableStepScripts`, `availableStepScriptCount`, `availableStepScriptMap`, `availableStepScriptMapCount`, `availableStepCheckCommandMap`, `availableStepCheckCommandMapCount`, `availableStepCheckArgsMap`, `availableStepCheckArgsMapCount`, `availableStepCheckArgCountMap`, `availableStepCheckArgCountMapCount`, `availableStepSupportsNoBuildMap`, `availableStepSupportsNoBuildMapCount`, `availableStepIndices`, `availableStepIndexCount`, `availableStepIndexMap`, `availableStepIndexMapCount`, `availableStepMetadata`, `availableStepMetadataCount`, `totalSteps`, `passedStepCount`, `failedStepCount`, `skippedStepCount`, `firstFailedStep`, `passedSteps`, `failedSteps`, `skippedSteps`, `passedStepScripts`, `passedStepScriptCount`, `passedStepScriptMap`, `passedStepScriptMapCount`, `passedStepCheckCommandMap`, `passedStepCheckCommandMapCount`, `passedStepCheckArgsMap`, `passedStepCheckArgsMapCount`, `passedStepCheckArgCountMap`, `passedStepCheckArgCountMapCount`, `failedStepScripts`, `failedStepScriptCount`, `failedStepScriptMap`, `failedStepScriptMapCount`, `failedStepCheckCommandMap`, `failedStepCheckCommandMapCount`, `failedStepCheckArgsMap`, `failedStepCheckArgsMapCount`, `failedStepCheckArgCountMap`, `failedStepCheckArgCountMapCount`, `skippedStepScripts`, `skippedStepScriptCount`, `skippedStepScriptMap`, `skippedStepScriptMapCount`, `skippedStepCheckCommandMap`, `skippedStepCheckCommandMapCount`, `skippedStepCheckArgsMap`, `skippedStepCheckArgsMapCount`, `skippedStepCheckArgCountMap`, `skippedStepCheckArgCountMapCount`, `passedStepIndices`, `passedStepIndexCount`, `passedStepIndexMap`, `passedStepIndexMapCount`, `failedStepIndices`, `failedStepIndexCount`, `failedStepIndexMap`, `failedStepIndexMapCount`, `skippedStepIndices`, `skippedStepIndexCount`, `skippedStepIndexMap`, `skippedStepIndexMapCount`, `stepCheckCommandMap`, `stepCheckCommandMapCount`, `stepCheckArgsMap`, `stepCheckArgsMapCount`, `stepCheckArgCountMap`, `stepCheckArgCountMapCount`, `failureSummaries`, `failureSummaryCount`, `stepStatusMap`, `stepStatusMapCount`, `stepStatusCountMap`, `stepStatusCountMapCount`, `passedStepMetadata`, `passedStepMetadataCount`, `failedStepMetadata`, `failedStepMetadataCount`, `skippedStepMetadata`, and `skippedStepMetadataCount`.
Client JSON reports additionally expose top-level wasm preflight summary fields `wasmPackCheckStatus`, `wasmPackCheckCommand`, `wasmPackCheckArgs`, `wasmPackCheckArgCount`, `wasmPackCheckExitCode`, and `wasmPackCheckOutputLine`.
Onboarding JSON reports additionally expose ts-core example summary fields `tsCoreExampleCommand`, `tsCoreExampleArgs`, `tsCoreExampleArgCount`, `tsCoreExampleAttempted`, `tsCoreExampleStatus`, `tsCoreExampleRuleMatched`, `tsCoreExamplePayloadValid`, `tsCoreExamplePayloadIssues`, `tsCoreExamplePayloadIssueCount`, `tsCoreExampleExitCode`, `tsCoreExampleDurationMs`, and `tsCoreExampleOutputLine`, plus client-step wasm preflight summary fields `clientWasmPackCheckStatus`, `clientWasmPackCheckCommand`, `clientWasmPackCheckArgs`, `clientWasmPackCheckArgCount`, `clientWasmPackCheckExitCode`, and `clientWasmPackCheckOutputLine`.
Developer environment JSON reports include check inventory and partition metadata such as `availableChecks`, `availableCheckCount`, `availableCheckIndexMap`, `availableCheckCommandMap`, `availableCheckArgsMap`, `availableCheckArgCountMap`, `availableCheckRequiredMap`, `availableCheckHintMap`, `availableCheckMinimumVersionMap`, `checkLabels`, `checkIndices`, `checkIndexMap`, `checkCommandMap`, `checkArgsMap`, `checkArgCountMap`, `checkStatusMap`, `checkStatusCountMap`, `passedChecks`, `passedCheckIndices`, `passedCheckIndexMap`, `passedCheckCommandMap`, `passedCheckArgsMap`, `passedCheckArgCountMap`, `failedChecks`, `failedCheckIndices`, `failedCheckIndexMap`, `failedCheckCommandMap`, `failedCheckArgsMap`, `failedCheckArgCountMap`, `requiredCheckLabels`, `requiredCheckIndices`, `requiredCheckIndexMap`, `requiredCheckCommandMap`, `requiredCheckArgsMap`, `requiredCheckArgCountMap`, `optionalCheckLabels`, `optionalCheckIndices`, `optionalCheckIndexMap`, `optionalCheckCommandMap`, `optionalCheckArgsMap`, `optionalCheckArgCountMap`, `requiredFailureLabels`, `requiredFailureIndices`, `requiredFailureIndexMap`, `requiredFailureCommandMap`, `requiredFailureArgsMap`, `requiredFailureArgCountMap`, `optionalFailureLabels`, `optionalFailureIndices`, `optionalFailureIndexMap`, `optionalFailureCommandMap`, `optionalFailureArgsMap`, `optionalFailureArgCountMap`, `failureSummaries`, and all corresponding `*Count` fields.
WASM-pack JSON reports include single-check inventory and execution partitions such as `availableChecks`, `availableCheckCount`, `availableCheckIndices`, `availableCheckIndexCount`, `availableCheckCommandMap`, `availableCheckArgsMap`, `availableCheckArgCountMap`, `availableCheckIndexMap`, `availableCheckMetadata`, `checkLabels`, `checkIndices`, `checkIndexMap`, `checkCommandMap`, `checkArgsMap`, `checkArgCountMap`, `checkMetadata`, `checkStatusMap`, `checkStatusCountMap`, `checkVersionMap`, `checkExitCodeMap`, `checkOutputLineMap`, `passedChecks`, `passedCheckIndices`, `passedCheckIndexMap`, `passedCheckCommandMap`, `passedCheckArgsMap`, `passedCheckArgCountMap`, `passedCheckMetadata`, `failedChecks`, `failedCheckIndices`, `failedCheckIndexMap`, `failedCheckCommandMap`, `failedCheckArgsMap`, `failedCheckArgCountMap`, `failedCheckMetadata`, `failureSummaries`, and corresponding `*Count` fields.
WASM-pack metadata entries in `availableCheckMetadata`, `checkMetadata`, `passedCheckMetadata`, and `failedCheckMetadata` include `checkIndex`, `command`, `args`, `argCount`, `checkCommand`, `checkArgs`, and `checkArgCount`.
Developer-environment `checks[]` and `failureSummaries[]` entries include `checkIndex`, `checkCommand`, `checkArgs`, and `checkArgCount` for stable index and command correlation with `availableChecks`.
WASM-pack `failureSummaries[]` entries include `checkIndex`, `command`, `args`, `argCount`, `checkCommand`, `checkArgs`, and `checkArgCount` for stable index correlation and deterministic command diagnostics.
Each `steps[]` entry in client/onboarding JSON mode includes `scriptName`, `supportsNoBuild`, `checkCommand`, `checkArgs`, `checkArgCount`, and `stepIndex` so downstream tooling can map step outcomes to stable script identifiers and executed commands.
Each client/onboarding `failureSummaries[]` entry includes `checkCommand`, `checkArgs`, and `checkArgCount` for deterministic failed-step command diagnostics.
Nested client wasm artifact reports include `wasmPackCheckCommand`, `wasmPackCheckArgs`, `wasmPackCheckArgCount`, `wasmPackCheckExitCode`, `wasmPackCheckStatus`, and `wasmPackCheckOutputLine` for deterministic tracing of wasm-pack preflight invocation.
If `--output` is provided without a value, commands fail fast. JSON commands return a structured error report; non-JSON commands print a plain error message.
When `--output` is valid, JSON validation-error reports are also written to that output path.
If `--output` or `--only` is passed multiple times, the last value is used, even when recognized strict tokens appear between repeated flags.
`--output` and `--only` also support inline assignment forms such as `--output=./report.json` and `--only=client`.
Empty or whitespace-only split/inline output and selection values (for example `--output ""`, `--output "   "`, `--output=`, `--output=   `, `--only ""`, `--only "   "`, `--only=`, or `--only=   `) are treated as missing values.
Invalid `--only` errors include available canonical check names and special selector aliases (for example `all`, `all-checks`, `all_checks`, `allchecks`, `libraries`, `library`, `libs`, `lib`) for quick correction.
Invalid `--only` errors also include `invalidChecks` for machine-readable diagnostics.
Unsupported CLI flags return structured errors and include `unknownOptions` for machine-readable diagnostics.
Inline unsupported-option forms are normalized in diagnostics (for example `--mystery=alpha` is reported as `--mystery`) and deduplicated by option token.
Inline misuse of supported non-value flags is redacted without exposing raw values (for example `--json=secret` is reported as `--json=<value>`).
Alias misuse uses canonical redacted forms (for example `--verify=secret` is reported as `--no-build=<value>`).
Malformed inline option names are redacted and deduplicated (for example `--=secret` and `--=` are reported as `--=<value>`, while `-=secret` and `-=` are reported as `-=<value>`).
Literal placeholder tokens are deduplicated with redacted inline misuse forms (for example `--json=<value>` and `--json=secret` are reported once as `--json=<value>`).
Root/client/onboarding/wasm/ts-core/runtime-library JSON preflight reports include `supportedCliOptions`, `supportedCliOptionCount`, `unknownOptionCount`, and `validationErrorCode` for structured option-validation diagnostics.
Root/client/onboarding/wasm/ts-core/runtime-library JSON preflight reports include `activeCliOptions`, `activeCliOptionTokens`, `activeCliOptionResolutions`, and `activeCliOptionOccurrences` to describe recognized option usage.
ts-core JSON preflight reports additionally include `checkedPackage`, `checkedPackageCount`, `checkedPackagePath`, `checkedPackagePathCount`, `availablePackages`, `availablePackageCount`, `availablePackagePaths`, `availablePackagePathCount`, `availablePackageIndices`, `availablePackageIndexCount`, `availablePackageIndexMap`, `availablePackageIndexMapCount`, `availablePackagePathMap`, `availablePackagePathMapCount`, `availablePackageCheckCommandMap`, `availablePackageCheckCommandMapCount`, `availablePackageCheckArgsMap`, `availablePackageCheckArgsMapCount`, `availablePackageCheckArgCountMap`, `availablePackageCheckArgCountMapCount`, `availablePackageMetadata`, `availablePackageMetadataCount`, `checkedPackageIndices`, `checkedPackageIndexCount`, `checkedPackageIndexMap`, `checkedPackageIndexMapCount`, `checkedPackagePathMap`, `checkedPackagePathMapCount`, `presentPackages`, `missingPackages`, `presentPackageIndices`, `missingPackageIndices`, `presentPackageIndexMap`, `presentPackageIndexMapCount`, `presentPackageCheckCommandMap`, `presentPackageCheckCommandMapCount`, `presentPackageCheckArgsMap`, `presentPackageCheckArgsMapCount`, `presentPackageCheckArgCountMap`, `presentPackageCheckArgCountMapCount`, `presentPackageMetadata`, `presentPackageMetadataCount`, `missingPackageIndexMap`, `missingPackageIndexMapCount`, `missingPackageCheckCommandMap`, `missingPackageCheckCommandMapCount`, `missingPackageCheckArgsMap`, `missingPackageCheckArgsMapCount`, `missingPackageCheckArgCountMap`, `missingPackageCheckArgCountMapCount`, `missingPackageMetadata`, `missingPackageMetadataCount`, `presentPackagePaths`, `missingPackagePaths`, `presentPackagePathMap`, `presentPackagePathMapCount`, `missingPackagePathMap`, `missingPackagePathMapCount`, `requiredPackageCount`, `presentPackageCount`, `missingPackageCount`, `presentPackageIndexCount`, `missingPackageIndexCount`, `presentPackagePathCount`, `missingPackagePathCount`, `packageReport`, `packageReportCount`, `packageReportMap`, `packageReportMapCount`, `packageCheckCommandMap`, `packageCheckCommandMapCount`, `packageCheckArgsMap`, `packageCheckArgsMapCount`, `packageCheckArgCountMap`, `packageCheckArgCountMapCount`, `packageStatusMap`, `packageStatusMapCount`, `packageStatusCountMap`, `packageStatusCountMapCount`, `artifactsPresent`, `requiredArtifacts`, `requiredArtifactsByPackage`, `requiredArtifactsByPackageCount`, `requiredArtifactCountByPackage`, `requiredArtifactCountByPackageCount`, `artifactsPresentByPackage`, `artifactsPresentByPackageCount`, `presentArtifacts`, `presentArtifactsByPackage`, `presentArtifactsByPackageCount`, `presentArtifactCountByPackage`, `presentArtifactCount`, `presentArtifactCountByPackageCount`, `presentPackageArtifactsByPackage`, `presentPackageArtifactsByPackageCount`, `presentPackageArtifactCountByPackage`, `presentPackageArtifactCountByPackageCount`, `missingArtifacts`, `missingArtifactsByPackage`, `missingArtifactsByPackageCount`, `missingArtifactCountByPackage`, `missingArtifactCount`, `missingArtifactCountByPackageCount`, `missingPackageArtifactsByPackage`, `missingPackageArtifactsByPackageCount`, `missingPackageArtifactCountByPackage`, `missingPackageArtifactCountByPackageCount`, `failureSummaries`, `failureSummaryCount`, `missingArtifactSummary`, `buildCommand`, `buildArgs`, `buildExitCode`, `buildDurationMs`, `attemptedBuild`, `buildSkipped`, `buildSkippedReason`, `exampleCommand`, `exampleArgs`, `exampleArgCount`, `exampleAttempted`, `exampleStatus`, `exampleRuleMatched`, `examplePayloadValid`, `examplePayloadIssues`, `examplePayloadIssueCount`, `exampleExitCode`, `exampleDurationMs`, and `exampleOutputLine` to classify artifact readiness, auto-build behavior, and end-to-end example verification state.
runtime-library JSON preflight reports additionally include `packagesPresent`, `checkedPackages`, `checkedPackagePaths`, `checkedPackageIndices`, `checkedPackageIndexMap`, `checkedPackagePathMap`, `checkedPackageCount`, `checkedPackagePathCount`, `checkedPackageIndexCount`, `checkedPackageIndexMapCount`, `checkedPackagePathMapCount`, `availablePackages`, `availablePackageCount`, `availablePackagePaths`, `availablePackagePathCount`, `availablePackageIndices`, `availablePackageIndexCount`, `availablePackageIndexMap`, `availablePackageIndexMapCount`, `availablePackagePathMap`, `availablePackagePathMapCount`, `availablePackageCheckCommandMap`, `availablePackageCheckCommandMapCount`, `availablePackageCheckArgsMap`, `availablePackageCheckArgsMapCount`, `availablePackageCheckArgCountMap`, `availablePackageCheckArgCountMapCount`, `availablePackageMetadata`, `availablePackageMetadataCount`, `presentPackages`, `presentPackagePaths`, `presentPackagePathMap`, `presentPackageIndices`, `presentPackageIndexMap`, `presentPackageIndexMapCount`, `presentPackageCheckCommandMap`, `presentPackageCheckCommandMapCount`, `presentPackageCheckArgsMap`, `presentPackageCheckArgsMapCount`, `presentPackageCheckArgCountMap`, `presentPackageCheckArgCountMapCount`, `presentPackageMetadata`, `presentPackageMetadataCount`, `missingPackages`, `missingPackagePaths`, `missingPackagePathMap`, `missingPackageIndices`, `missingPackageIndexMap`, `missingPackageIndexMapCount`, `missingPackageCheckCommandMap`, `missingPackageCheckCommandMapCount`, `missingPackageCheckArgsMap`, `missingPackageCheckArgsMapCount`, `missingPackageCheckArgCountMap`, `missingPackageCheckArgCountMapCount`, `missingPackageMetadata`, `missingPackageMetadataCount`, `packageReports`, `requiredPackageCount`, `presentPackageCount`, `presentPackagePathCount`, `presentPackagePathMapCount`, `presentPackageIndexCount`, `packageReportCount`, `packageReportMap`, `packageReportMapCount`, `packageCheckCommandMap`, `packageCheckCommandMapCount`, `packageCheckArgsMap`, `packageCheckArgsMapCount`, `packageCheckArgCountMap`, `packageCheckArgCountMapCount`, `packageStatusMap`, `packageStatusMapCount`, `packageStatusCountMap`, `packageStatusCountMapCount`, `requiredArtifactsByPackage`, `requiredArtifacts`, `requiredArtifactsByPackageCount`, `requiredArtifactCountByPackage`, `requiredArtifactCount`, `requiredArtifactCountByPackageCount`, `artifactsPresentByPackage`, `artifactsPresentByPackageCount`, `presentArtifactsByPackage`, `presentArtifacts`, `presentArtifactCountByPackage`, `presentArtifactCount`, `presentArtifactsByPackageCount`, `presentArtifactCountByPackageCount`, `presentPackageArtifactsByPackage`, `presentPackageArtifactsByPackageCount`, `presentPackageArtifactCountByPackage`, `presentPackageArtifactCountByPackageCount`, `missingPackageCount`, `missingPackagePathCount`, `missingPackagePathMapCount`, `missingPackageIndexCount`, `missingArtifactsByPackage`, `missingArtifacts`, `missingArtifactCountByPackage`, `missingArtifactCount`, `missingArtifactsByPackageCount`, `missingArtifactCountByPackageCount`, `missingPackageArtifactsByPackage`, `missingPackageArtifactsByPackageCount`, `missingPackageArtifactCountByPackage`, `missingPackageArtifactCountByPackageCount`, `failureSummaries`, `failureSummaryCount`, `missingArtifactSummary`, `buildCommand`, `buildArgs`, `buildExitCode`, `buildDurationMs`, `attemptedBuild`, `buildSkipped`, and `buildSkippedReason` to classify multi-package artifact readiness and auto-build behavior. Each `packageReports` entry includes `packageIndex`, `checkCommand`, `checkArgs`, `checkArgCount`, `requiredArtifacts`, `presentArtifacts`, and `missingArtifacts` for package-level artifact diagnostics.
For ts-core/runtime-library checks, each `failureSummaries` entry includes `kind`, `packageIndex`, `checkCommand`, `checkArgs`, and `checkArgCount` so failed diagnostics can be traced to deterministic package/example check metadata. ts-core reports use `kind: "artifacts"` for missing artifact failures and `kind: "example"` for end-to-end example failures (including `exitCode`, `ruleMatched`, `payloadValid`, `payloadIssues`, `payloadIssueCount`, and `outputLine`).
For ts-core reports, `examplePayloadValid` (and aggregate aliases like `tsCoreExamplePayloadValid`) is `true` only when the example output includes a complete object-shaped payload (`voxel.id`, `voxel.stage`, `voxel.rotation.value`, `voxel.rotation.yRotation`, `light`, and `rotatedAabb`) with valid value domains (`voxel.id` in `0..65535`, `voxel.stage`/light channels in `0..15`, rotation axis in `0..5`) and ordered bounds (`min <= max` per axis). If `patternMatched` is present, it must be `true`. Array/primitive JSON outputs are treated as invalid example output.
When payload validation fails, ts-core reports also include `examplePayloadIssues` and `examplePayloadIssueCount` (plus aggregate aliases `tsCoreExamplePayloadIssues` and `tsCoreExamplePayloadIssueCount`) to identify specific failing paths such as `voxel.rotation`, `light.red`, or `rotatedAabb.bounds`; these issue paths are normalized (trimmed + deduplicated) before emission.
When `ruleMatched=false` is reported together with payload invalidity, ts-core failure messages include both signals (rule mismatch + payload issue paths) for faster triage. When payload fields are otherwise valid, the message remains a pure `ruleMatched=false` diagnostic.
When `ruleMatched` is missing/invalid and payload validation fails, ts-core failure messages include payload issue paths alongside the invalid-output signal.
If the example exits successfully but emits no parseable JSON object payload, ts-core reports a dedicated "produced no parseable JSON output" diagnostic.
When fallback non-JSON output is reported, `exampleOutputLine` is normalized to a readable line by stripping ANSI/control escape sequences.
Example JSON parsing also tolerates UTF-8 BOM-prefixed output lines.
Misused inline option forms (for example `--json=secret` or `--verify=secret`) are excluded from `activeCliOption*` metadata and are instead reported via redacted `unknownOptions`.
Recognized options in the same invocation are still preserved in `activeCliOption*` metadata even when misused inline options are also present.
Root/client/onboarding/wasm/ts-core/runtime-library JSON preflight reports include `availableCliOptionAliases` and `availableCliOptionCanonicalMap` so automation can resolve option aliases to canonical names.
Argument values passed to `--output` and `--only` are excluded from unrecognized-option detection, even when they start with `-`.
If a split `--output` or `--only` value position is followed by a recognized option token (for example `--output -l` or `--only -l`) or recognized inline option misuse (for example `--output -l=1` or `--only -l=1`), that token is treated as an option and the value is considered missing.
For commands that support no-build aliases, `--output --verify` and `--output --no-build` both fail output validation and still mark no-build as active.
Arguments after `--` are treated as positional arguments and are excluded from preflight script option parsing and unsupported-option detection.
JSON preflight reports include `optionTerminatorUsed`, `positionalArgs`, and `positionalArgCount` to describe positional tokens provided after `--`.
Unrecognized flags are still listed in `unknownOptions` even when a higher-priority validation error is reported.
Aggregate preflight reports include `invalidCheckCount` and `unknownOptionCount` for quick numeric filtering in CI/log pipelines.
Aggregate preflight validation errors include `validationErrorCode` for machine-readable error classification.
Aggregate preflight reports include `supportedCliOptions` and `supportedCliOptionCount` to enumerate accepted CLI flags for this command.
Aggregate preflight reports include `activeCliOptions` with canonical option names detected from the current invocation.
Aggregate preflight reports include `activeCliOptionCount` for quick cardinality checks on active canonical options.
Aggregate preflight reports include `activeCliOptionTokens` to preserve the original recognized option forms from the current invocation.
Aggregate preflight reports include `activeCliOptionResolutions` to map each recognized option token to its canonical option.
Aggregate preflight reports include `activeCliOptionResolutionCount` for quick cardinality checks on `activeCliOptionResolutions`.
Aggregate preflight reports include `activeCliOptionOccurrences` to preserve each recognized CLI option occurrence in argument order (including duplicates and aliases).
Aggregate preflight reports include `activeCliOptionOccurrenceCount` for quick cardinality checks on `activeCliOptionOccurrences`.
Aggregate preflight reports include `availableCliOptionAliases` to map canonical options (such as `--list-checks`) to accepted aliases (`--list`, `-l`).
Aggregate preflight reports include `availableCliOptionCanonicalMap` so automation can resolve each supported option token to its canonical option.
Aggregate preflight reports include `optionTerminatorUsed`, `positionalArgs`, and `positionalArgCount` to describe positional arguments supplied after `--`.
Aggregate preflight reports include `availableCheckAliases`, `availableCheckAliasCountMap`, `availableCheckAliasGroupCount`, `availableCheckAliasCountMapCount`, and `availableCheckAliasTokenCount` so automation can map user-facing aliases to canonical check names and quickly validate alias inventory cardinality.
Aggregate preflight reports include `availableCheckMetadata`/`availableCheckMetadataCount` with script mapping, no-build support, and deterministic check command metadata per canonical check.
Aggregate preflight reports include `availableCheckScripts`/`availableCheckScriptCount`, `availableCheckScriptMap`/`availableCheckScriptMapCount`, `availableCheckCommandMap`/`availableCheckCommandMapCount`, `availableCheckArgsMap`/`availableCheckArgsMapCount`, `availableCheckArgCountMap`/`availableCheckArgCountMapCount`, `availableCheckSupportsNoBuildMap`/`availableCheckSupportsNoBuildMapCount`, `availableCheckIndices`/`availableCheckIndexCount`, and `availableCheckIndexMap`/`availableCheckIndexMapCount` for direct canonical check-to-script/index lookup.
Aggregate preflight reports include `availableSpecialCheckSelectors` and `availableSpecialCheckSelectorCount` for quick checks against supported special selector names.
Aggregate preflight reports include `availableSpecialCheckAliases`, `availableSpecialCheckAliasCountMap`, `availableSpecialCheckAliasGroupCount`, `availableSpecialCheckAliasCountMapCount`, and `availableSpecialCheckAliasTokenCount` for non-check selectors such as `all`.
Aggregate preflight reports include `availableSpecialSelectorResolvedChecks` and `availableSpecialSelectorResolvedChecksCount` so automation can inspect how each special selector expands to canonical checks.
Aggregate preflight reports include `availableSpecialSelectorResolvedCheckCountMap` and `availableSpecialSelectorResolvedCheckCountMapCount` for direct selector-to-check-count lookup.
Aggregate preflight reports include `requestedChecks` so CI logs can capture the exact `--only` inputs after tokenization.
Aggregate preflight reports include `selectionMode` (`default` or `only`) to show whether selection came from defaults or an explicit `--only` filter.
Aggregate preflight reports include `specialSelectorsUsed` to show which special selector names (for example `all`) were used in `--only`.
Aggregate preflight reports include `selectedCheckCount`, `requestedCheckCount`, and `skippedCheckCount` for quick summary metrics.
Aggregate preflight reports include `selectedCheckIndices`/`selectedCheckIndexCount`, `selectedCheckIndexMap`/`selectedCheckIndexMapCount`, `skippedCheckIndices`/`skippedCheckIndexCount`, and `skippedCheckIndexMap`/`skippedCheckIndexMapCount` to map selected/skipped checks back to canonical aggregate ordering.
Aggregate preflight reports include `selectedCheckMetadata`, `selectedCheckMetadataCount`, `selectedCheckScripts`, `selectedCheckScriptCount`, `selectedCheckScriptMap`, `selectedCheckScriptMapCount`, `selectedCheckCommandMap`, `selectedCheckCommandMapCount`, `selectedCheckArgsMap`, `selectedCheckArgsMapCount`, `selectedCheckArgCountMap`, and `selectedCheckArgCountMapCount` as well as `skippedCheckMetadata`, `skippedCheckMetadataCount`, `skippedCheckScripts`, `skippedCheckScriptCount`, `skippedCheckScriptMap`, `skippedCheckScriptMapCount`, `skippedCheckCommandMap`, `skippedCheckCommandMapCount`, `skippedCheckArgsMap`, `skippedCheckArgsMapCount`, `skippedCheckArgCountMap`, and `skippedCheckArgCountMapCount` so automation can map selected/skipped checks directly to executable scripts and resolved command invocations.
Aggregate preflight reports include `passedCheckScripts`, `passedCheckScriptCount`, `passedCheckScriptMap`, `passedCheckScriptMapCount`, `passedCheckCommandMap`, `passedCheckCommandMapCount`, `passedCheckArgsMap`, `passedCheckArgsMapCount`, `passedCheckArgCountMap`, `passedCheckArgCountMapCount`, `failedCheckScripts`, `failedCheckScriptCount`, `failedCheckScriptMap`, `failedCheckScriptMapCount`, `failedCheckCommandMap`, `failedCheckCommandMapCount`, `failedCheckArgsMap`, `failedCheckArgsMapCount`, and `failedCheckArgCountMap`, `failedCheckArgCountMapCount` plus `passedCheckMetadata`, `passedCheckMetadataCount`, `failedCheckMetadata`, `failedCheckMetadataCount`, `passedCheckIndices`/`passedCheckIndexCount`, `passedCheckIndexMap`/`passedCheckIndexMapCount`, `failedCheckIndices`/`failedCheckIndexCount`, `failedCheckIndexMap`/`failedCheckIndexMapCount`, `checkStatusMap`/`checkStatusMapCount`, `checkStatusCountMap`/`checkStatusCountMapCount`, `checkCommandMap`/`checkCommandMapCount`, `checkArgsMap`/`checkArgsMapCount`, and `checkArgCountMap`/`checkArgCountMapCount` so CI systems can map pass/fail/skip status directly to executed or filtered checks.
Aggregate preflight reports additionally expose ts-core nested example summary fields `tsCoreExampleCommand`, `tsCoreExampleArgs`, `tsCoreExampleArgCount`, `tsCoreExampleAttempted`, `tsCoreExampleStatus`, `tsCoreExampleRuleMatched`, `tsCoreExamplePayloadValid`, `tsCoreExamplePayloadIssues`, `tsCoreExamplePayloadIssueCount`, `tsCoreExampleExitCode`, `tsCoreExampleDurationMs`, and `tsCoreExampleOutputLine`, plus client nested wasm summary fields `clientWasmPackCheckStatus`, `clientWasmPackCheckCommand`, `clientWasmPackCheckArgs`, `clientWasmPackCheckArgCount`, `clientWasmPackCheckExitCode`, and `clientWasmPackCheckOutputLine`.
Aggregate preflight reports include `failureSummaries` and `failureSummaryCount` for deterministic failed-check diagnostics without parsing nested report trees.
Each `checks[]` entry in aggregate preflight reports includes `scriptName`, `supportsNoBuild`, `checkIndex`, `checkCommand`, `checkArgs`, and `checkArgCount` so execution records can be correlated with canonical check metadata and resolved command invocations.
Aggregate preflight reports include `requestedCheckResolutions` and `requestedCheckResolutionCount` to map each `--only` token to its resolved check, special selector, or invalid status.
Aggregate preflight reports include `requestedCheckResolvedChecks`/`requestedCheckResolvedCheckCount`, `requestedCheckResolvedScripts`/`requestedCheckResolvedScriptCount`, `requestedCheckResolvedScriptMap`/`requestedCheckResolvedScriptMapCount`, `requestedCheckResolvedSupportsNoBuildMap`/`requestedCheckResolvedSupportsNoBuildMapCount`, `requestedCheckResolvedIndices`/`requestedCheckResolvedIndexCount`, `requestedCheckResolvedIndexMap`/`requestedCheckResolvedIndexMapCount`, `requestedCheckResolvedCommandMap`/`requestedCheckResolvedCommandMapCount`, `requestedCheckResolvedArgsMap`/`requestedCheckResolvedArgsMapCount`, `requestedCheckResolvedArgCountMap`/`requestedCheckResolvedArgCountMapCount`, and `requestedCheckResolvedMetadata`/`requestedCheckResolvedMetadataCount` to summarize canonical checks resolved from `--only` tokens.
Aggregate preflight reports include `requestedCheckResolutionKinds` and `requestedCheckResolutionKindCount` to enumerate supported resolution kinds for `requestedCheckResolutions`.
Aggregate preflight reports include `listChecksOnly` to indicate metadata-only check listing mode (`--list-checks`) where no checks are executed.
When `--only` is omitted, `requestedChecks` is an empty array and `selectedChecks` contains the default aggregate checks.
When `--output` validation fails, `requestedChecks` still reflects parsed `--only` tokens for easier debugging.
If report writing fails, JSON error reports include both `message` and `writeError`.
Add `--compact` to each JSON preflight command for single-line JSON output.

visit http://localhost:3000

For client-only setup details, see [`examples/client/README.md`](examples/client/README.md).

## Supporting

If you like our work, please consider supporting us on Patreon, BuyMeACoffee, or PayPal. Thanks a lot!

<p align="center">
  <a href="https://www.patreon.com/voxelize"><img src="https://c5.patreon.com/external/logo/become_a_patron_button.png" alt="Patreon donate button" /> </a>
  <a href="https://paypal.me/iantheboss"><img src="https://werwolv.net/assets/paypal_banner.png" alt="PayPal donate button" /> </a>
  <a href="https://www.buymeacoffee.com/shaoruu"><img src="https://i.imgur.com/xPDiGKQ.png" alt="Buy Me A Coffee" style="height: 50px"/> </a>
</p>

<p align="center">
  <img src="https://api.star-history.com/svg?repos=voxelize/voxelize&type=Date" />
</p>

## Assets Used

- [Connection Serif Font (SIL Open Font)](https://fonts2u.com/connection-serif.font)
- [Pixel Perfection by XSSheep (CC BY-SA 4.0)](https://www.planetminecraft.com/texture-pack/131pixel-perfection/)
