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

# run full onboarding checks (tooling + client)
pnpm run check:onboarding
# quiet mode (errors only)
pnpm run check:onboarding -- --quiet
# json output (for CI integrations)
pnpm run check:onboarding:json
# compact json output (single line)
pnpm run check:onboarding:json:compact
# json output written to file
pnpm run check:onboarding:json -- --output ./onboarding-report.json
# verify onboarding checks without auto-building wasm artifacts
pnpm run check:onboarding:verify
# verify + json output (for CI integrations)
pnpm run check:onboarding:verify:json
# verify + compact json output (single line)
pnpm run check:onboarding:verify:json:compact
# verify + json output written to file
pnpm run check:onboarding:verify:json -- --output ./onboarding-verify-report.json

# run an aggregated preflight report in json mode
pnpm run check:preflight:json
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
# run only specific checks (available: devEnvironment, wasmPack, client)
pnpm run check:preflight:json -- --only devEnvironment,client
# aliases and case-insensitive names are supported (for example: dev/dev-env/dev_env, wasm/wasm-pack/wasm_pack, CLIENT, all/all-checks/all_checks/allchecks)
# selected checks are normalized to the standard aggregate order
# run pre-defined single-check aggregate reports
pnpm run check:preflight:dev-env:json
pnpm run check:preflight:wasm-pack:json
pnpm run check:preflight:client:json
# shorthand aliases for single-check aggregate reports
pnpm run check:preflight:dev:json
pnpm run check:preflight:wasm:json
# single client check without auto-build
pnpm run check:preflight:client:verify:json
# compact single-check aggregate reports
pnpm run check:preflight:dev-env:json:compact
pnpm run check:preflight:wasm-pack:json:compact
pnpm run check:preflight:client:json:compact
pnpm run check:preflight:client:verify:json:compact
# shorthand compact aliases
pnpm run check:preflight:dev:json:compact
pnpm run check:preflight:wasm:json:compact
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
# failureSummaries are derived from nested step/check report messages when available
# optionally write the same report to disk
pnpm run check:preflight:verify:json -- --output ./preflight-report.json

# run script-focused integration tests
pnpm run test:scripts
```

In JSON mode, skipped steps are represented with `skipped: true` and `exitCode: null`.
JSON preflight commands include `startedAt`, `endedAt`, and `durationMs`.
Client and onboarding JSON reports also include `totalSteps`, `passedStepCount`, `failedStepCount`, `skippedStepCount`, and `firstFailedStep`.
If `--output` is provided without a value, JSON commands return a structured error report.
If `--output` or `--only` is passed multiple times, the last value is used.
Invalid `--only` errors include available canonical check names and special selector aliases (for example `all`, `all-checks`, `all_checks`, `allchecks`) for quick correction.
Invalid `--only` errors also include `invalidChecks` for machine-readable diagnostics.
Unsupported CLI flags return structured errors and include `unknownOptions` for machine-readable diagnostics.
Argument values passed to `--output` and `--only` are excluded from unrecognized-option detection, even when they start with `-`.
Unrecognized flags are still listed in `unknownOptions` even when a higher-priority validation error is reported.
Aggregate preflight reports include `invalidCheckCount` and `unknownOptionCount` for quick numeric filtering in CI/log pipelines.
Aggregate preflight validation errors include `validationErrorCode` for machine-readable error classification.
Aggregate preflight reports include `supportedCliOptions` to enumerate accepted CLI flags for this command.
Aggregate preflight reports include `activeCliOptions` with canonical option names detected from the current invocation.
Aggregate preflight reports include `activeCliOptionCount` for quick cardinality checks on active canonical options.
Aggregate preflight reports include `activeCliOptionTokens` to preserve the original recognized option forms from the current invocation.
Aggregate preflight reports include `activeCliOptionResolutions` to map each recognized option token to its canonical option.
Aggregate preflight reports include `activeCliOptionResolutionCount` for quick cardinality checks on `activeCliOptionResolutions`.
Aggregate preflight reports include `activeCliOptionOccurrences` to preserve each recognized CLI option occurrence in argument order (including duplicates and aliases).
Aggregate preflight reports include `activeCliOptionOccurrenceCount` for quick cardinality checks on `activeCliOptionOccurrences`.
Aggregate preflight reports include `availableCliOptionAliases` to map canonical options (such as `--list-checks`) to accepted aliases (`--list`, `-l`).
Aggregate preflight reports include `availableCheckAliases` so automation can map user-facing aliases to canonical check names.
Aggregate preflight reports include `availableCheckMetadata` with script mapping and no-build support per canonical check.
Aggregate preflight reports include `availableSpecialCheckSelectors` for quick checks against supported special selector names.
Aggregate preflight reports include `availableSpecialCheckAliases` for non-check selectors such as `all`.
Aggregate preflight reports include `requestedChecks` so CI logs can capture the exact `--only` inputs after tokenization.
Aggregate preflight reports include `selectionMode` (`default` or `only`) to show whether selection came from defaults or an explicit `--only` filter.
Aggregate preflight reports include `specialSelectorsUsed` to show which special selector names (for example `all`) were used in `--only`.
Aggregate preflight reports include `selectedCheckCount`, `requestedCheckCount`, and `skippedCheckCount` for quick summary metrics.
Aggregate preflight reports include `requestedCheckResolutions` to map each `--only` token to its resolved check, special selector, or invalid status.
Aggregate preflight reports include `requestedCheckResolutionKinds` to enumerate supported resolution kinds for `requestedCheckResolutions`.
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
