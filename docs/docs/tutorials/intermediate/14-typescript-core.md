---
sidebar_position: 14
---

# TypeScript Core (Rust-free voxel primitives)

`@voxelize/ts-core` provides the core voxel data model from Voxelize as a standalone TypeScript library.

Use it when you want to:

- build tools in Node.js without Rust
- author voxel/light data in services or pipelines
- share deterministic packing rules across server-side TS code

## Install

```bash
pnpm add @voxelize/ts-core
```

## What it includes

```mermaid
flowchart LR
    V[Voxel pack/unpack] --> R[BlockRotation]
    V --> B[BlockRuleEvaluator]
    L[Light pack/unpack] --> B
    A[AABB math] --> B
```

- `Voxel` / `BlockUtils`: voxel id + rotation + stage bit encoding
- `Light` / `LightUtils`: sunlight + RGB torch channels
- `BlockRotation`: axis/y-rotation encoding and transforms
- `AABB`: geometry math helpers
- `BlockRuleEvaluator`: dynamic rule matching
- `VoxelAccess`: shared access contract

## Basic usage

```ts title="Packing voxel and light data"
import { BlockRotation, Light, Voxel } from "@voxelize/ts-core";

const rotation = BlockRotation.encode(0, 4);

const voxel = Voxel.pack({
  id: 42,
  rotation,
  stage: 7,
});

const light = Light.pack({
  sunlight: 15,
  red: 10,
  green: 5,
  blue: 3,
});

const unpackedVoxel = Voxel.unpack(voxel);
const unpackedLight = Light.unpack(light);
```

`BlockRotation` supports both `encode` and axis constructors:

```ts title="Axis constructors"
import { BlockRotation } from "@voxelize/ts-core";

const up = BlockRotation.PY(0);
const side = BlockRotation.PX(Math.PI / 2);
```

You can also pass plain rotation-like objects when packing voxels:

```ts title="Rotation-like input"
const voxel = Voxel.pack({
  id: 7,
  rotation: { value: 0, yRotation: Math.PI / 2 },
  stage: 1,
});
```

## Evaluating rules with your own data source

```ts title="Rule evaluation"
import {
  BlockRotation,
  BlockRuleEvaluator,
  BlockRuleLogic,
  Voxel,
} from "@voxelize/ts-core";

const stored = Voxel.pack({
  id: 12,
  rotation: BlockRotation.py(0),
  stage: 3,
});

const access = {
  getVoxel: () => Voxel.id(stored),
  getVoxelRotation: () => Voxel.rotation(stored),
  getVoxelStage: () => Voxel.stage(stored),
};

const rule = {
  type: "combination",
  logic: BlockRuleLogic.And,
  rules: [
    { type: "simple", offset: [0, 0, 0], id: 12 },
    { type: "simple", offset: [0, 0, 0], stage: 3 },
  ],
} as const;

const matched = BlockRuleEvaluator.evaluate(rule, [0, 0, 0], access);
```

## End-to-end runnable example

The package includes a full end-to-end script that:

1. Packs voxel and light values
2. Stores and reads values from an in-memory space
3. Rotates an AABB
4. Evaluates block rules
5. Verifies JSON serialization roundtrip

Run it with:

```bash
pnpm --filter @voxelize/ts-core example:end-to-end
```

## Build artifact preflight (root workspace)

From the repository root you can validate `@voxelize/ts-core` artifacts with:

```bash
# auto-builds missing artifacts when needed
pnpm run check:ts-core:json

# verify-only mode (no auto-build)
pnpm run check:ts-core:verify:json

# full ts-core release readiness workflow
pnpm run check:ts-core:release

# aggregate ts-core release readiness workflow
pnpm run check:preflight:ts-core:release
```

The checker validates:

- `packages/ts-core/dist/index.js`
- `packages/ts-core/dist/index.mjs`
- `packages/ts-core/dist/index.d.ts`

Use `--output <path>` for machine-readable report files in CI.
The JSON report includes artifact/build diagnostics such as `checkedPackage`,
`checkedPackageCount`, `checkedPackagePath`, `checkedPackagePathCount`,
`availablePackages`, `availablePackageCount`, `availablePackagePaths`,
`availablePackagePathCount`, `availablePackageIndices`,
`availablePackageIndexCount`, `availablePackageIndexMap`,
`availablePackageIndexMapCount`, `availablePackagePathMap`,
`availablePackagePathMapCount`, `availablePackageCheckCommandMap`,
`availablePackageCheckCommandMapCount`, `availablePackageCheckArgsMap`,
`availablePackageCheckArgsMapCount`, `availablePackageCheckArgCountMap`,
`availablePackageCheckArgCountMapCount`, `availablePackageMetadata`,
`availablePackageMetadataCount`,
`checkedPackageIndices`, `checkedPackageIndexCount`,
`checkedPackageIndexMap`, `checkedPackageIndexMapCount`,
`checkedPackagePathMap`, `checkedPackagePathMapCount`,
`presentPackages`, `missingPackages`, `presentPackageIndices`,
`missingPackageIndices`, `presentPackageIndexMap`,
`presentPackageIndexMapCount`, `presentPackageCheckCommandMap`,
`presentPackageCheckCommandMapCount`, `presentPackageCheckArgsMap`,
`presentPackageCheckArgsMapCount`, `presentPackageCheckArgCountMap`,
`presentPackageCheckArgCountMapCount`, `presentPackageMetadata`,
`presentPackageMetadataCount`, `missingPackageIndexMap`,
`missingPackageIndexMapCount`, `missingPackageCheckCommandMap`,
`missingPackageCheckCommandMapCount`, `missingPackageCheckArgsMap`,
`missingPackageCheckArgsMapCount`, `missingPackageCheckArgCountMap`,
`missingPackageCheckArgCountMapCount`, `missingPackageMetadata`,
`missingPackageMetadataCount`, `presentPackagePaths`,
`missingPackagePaths`, `presentPackagePathMap`,
`presentPackagePathMapCount`, `missingPackagePathMap`,
`missingPackagePathMapCount`, `requiredPackageCount`, `presentPackageCount`,
`missingPackageCount`, `presentPackageIndexCount`,
`missingPackageIndexCount`, `presentPackagePathCount`,
`missingPackagePathCount`, `packageReport`, `packageReportCount`,
`packageReportMap`, `packageReportMapCount`, `packageCheckCommandMap`,
`packageCheckCommandMapCount`, `packageCheckArgsMap`,
`packageCheckArgsMapCount`, `packageCheckArgCountMap`,
`packageCheckArgCountMapCount`, `packageStatusMap`,
`packageStatusMapCount`, `packageStatusCountMap`,
`packageStatusCountMapCount`, `requiredArtifacts`,
`requiredArtifactsByPackage`, `requiredArtifactsByPackageCount`,
`requiredArtifactCountByPackage`, `requiredArtifactCountByPackageCount`,
`artifactsPresentByPackage`, `artifactsPresentByPackageCount`,
`presentArtifactsByPackage`, `presentArtifactsByPackageCount`,
`presentArtifacts`, `presentArtifactCountByPackage`,
`presentArtifactCountByPackageCount`,
`presentPackageArtifactsByPackage`,
`presentPackageArtifactsByPackageCount`,
`presentPackageArtifactCountByPackage`,
`presentPackageArtifactCountByPackageCount`,
`missingArtifacts`, `requiredArtifactCount`, `presentArtifactCount`,
`missingArtifactsByPackage`, `missingArtifactsByPackageCount`,
`missingArtifactCountByPackage`, `missingArtifactCountByPackageCount`,
`missingPackageArtifactsByPackage`,
`missingPackageArtifactsByPackageCount`,
`missingPackageArtifactCountByPackage`,
`missingPackageArtifactCountByPackageCount`,
`missingArtifactCount`, `failureSummaries`, `failureSummaryCount`,
`missingArtifactSummary`, `buildCommand`, `buildArgs`, `buildExitCode`,
`buildDurationMs`, `attemptedBuild`, `buildSkipped`, and
`buildSkippedReason`, `exampleCommand`, `exampleArgs`, `exampleArgCount`,
`exampleAttempted`, `exampleStatus`, `exampleExitCode`,
`exampleDurationMs`, and `exampleOutputLine`.
Each ts-core `failureSummaries` entry includes `kind`, `packageIndex`,
`checkCommand`, `checkArgs`, and `checkArgCount` for deterministic
failure-to-check correlation. ts-core uses `kind: "artifacts"` for missing
artifact failures and `kind: "example"` for end-to-end example failures
(including `exitCode` and `outputLine`).

If your project also depends on runtime utility packages (`@voxelize/aabb`,
`@voxelize/raycast`, and `@voxelize/physics-engine`), you can validate all of
their artifacts together from the root workspace:

```bash
# validate all runtime utility artifacts
pnpm run check:runtime-libraries:json

# verify-only mode (no auto-build)
pnpm run check:runtime-libraries:verify:json

# full runtime-library release readiness workflow
pnpm run check:runtime-libraries:release

# aggregate runtime-library release readiness workflow
pnpm run check:preflight:runtime-libraries:release

# combined library release readiness workflow
pnpm run check:libraries:release
pnpm run check:preflight:libraries:release
```

Runtime-library JSON reports include package/build diagnostics such as
`packagesPresent`, `checkedPackages`, `checkedPackagePaths`,
`checkedPackageIndices`, `checkedPackageIndexMap`, `checkedPackagePathMap`,
`checkedPackageCount`, `checkedPackagePathCount`, `checkedPackageIndexCount`,
`checkedPackageIndexMapCount`, `checkedPackagePathMapCount`,
`availablePackages`, `availablePackageCount`, `availablePackagePaths`,
`availablePackagePathCount`, `availablePackageIndices`,
`availablePackageIndexCount`, `availablePackageIndexMap`,
`availablePackageIndexMapCount`, `availablePackagePathMap`,
`availablePackagePathMapCount`, `availablePackageCheckCommandMap`,
`availablePackageCheckCommandMapCount`, `availablePackageCheckArgsMap`,
`availablePackageCheckArgsMapCount`, `availablePackageCheckArgCountMap`,
`availablePackageCheckArgCountMapCount`, `availablePackageMetadata`,
`availablePackageMetadataCount`, `packageReports`,
`presentPackages`, `presentPackagePaths`, `presentPackagePathMap`,
`presentPackageIndices`, `presentPackageIndexMap`,
`presentPackageIndexMapCount`, `presentPackageCheckCommandMap`,
`presentPackageCheckCommandMapCount`, `presentPackageCheckArgsMap`,
`presentPackageCheckArgsMapCount`, `presentPackageCheckArgCountMap`,
`presentPackageCheckArgCountMapCount`, `presentPackageMetadata`,
`presentPackageMetadataCount`,
`missingPackages`, `missingPackagePaths`, `missingPackagePathMap`,
`missingPackageIndices`, `missingPackageIndexMap`,
`missingPackageIndexMapCount`, `missingPackageCheckCommandMap`,
`missingPackageCheckCommandMapCount`, `missingPackageCheckArgsMap`,
`missingPackageCheckArgsMapCount`, `missingPackageCheckArgCountMap`,
`missingPackageCheckArgCountMapCount`, `missingPackageMetadata`,
`missingPackageMetadataCount`,
`requiredPackageCount`, `presentPackageCount`,
`presentPackagePathCount`, `presentPackagePathMapCount`,
`presentPackageIndexCount`, `packageReportCount`,
`packageReportMap`, `packageReportMapCount`, `packageCheckCommandMap`,
`packageCheckCommandMapCount`, `packageCheckArgsMap`,
`packageCheckArgsMapCount`, `packageCheckArgCountMap`,
`packageCheckArgCountMapCount`, `packageStatusMap`,
`packageStatusMapCount`, `packageStatusCountMap`,
`packageStatusCountMapCount`,
`requiredArtifactsByPackage`, `requiredArtifacts`,
`requiredArtifactsByPackageCount`,
`requiredArtifactCountByPackage`, `requiredArtifactCount`,
`requiredArtifactCountByPackageCount`, `presentArtifactsByPackage`,
`artifactsPresentByPackage`, `artifactsPresentByPackageCount`,
`presentArtifacts`,
`presentArtifactCountByPackage`, `presentArtifactCount`,
`presentArtifactsByPackageCount`,
`presentArtifactCountByPackageCount`,
`presentPackageArtifactsByPackage`,
`presentPackageArtifactsByPackageCount`,
`presentPackageArtifactCountByPackage`,
`presentPackageArtifactCountByPackageCount`, `missingPackageCount`,
`missingPackagePathCount`, `missingPackagePathMapCount`,
`missingPackageIndexCount`,
`missingArtifactsByPackage`, `missingArtifacts`,
`missingArtifactCountByPackage`, `missingArtifactCount`,
`missingArtifactsByPackageCount`,
`missingArtifactCountByPackageCount`,
`missingPackageArtifactsByPackage`,
`missingPackageArtifactsByPackageCount`,
`missingPackageArtifactCountByPackage`,
`missingPackageArtifactCountByPackageCount`, `failureSummaries`,
`failureSummaryCount`, `missingArtifactSummary`,
`buildCommand`, `buildArgs`, `buildExitCode`, `buildDurationMs`,
`attemptedBuild`, `buildSkipped`, `buildSkippedReason`,
`exampleCommand`, `exampleArgs`, `exampleArgCount`, `exampleAttempted`,
`exampleStatus`, `exampleExitCode`, `exampleDurationMs`, and
`exampleOutputLine`.
Each `packageReports` entry includes `packageIndex`, `checkCommand`,
`checkArgs`, `checkArgCount`, `requiredArtifacts`, `presentArtifacts`, and
`missingArtifacts` for package-level artifact diagnostics.
Each runtime-library `failureSummaries` entry includes `packageIndex`,
`checkCommand`, `checkArgs`, and `checkArgCount` for deterministic
failure-to-check correlation.

## Aggregate preflight report metadata

For release automation and CI routing, aggregate preflight JSON reports include:

- check-selection diagnostics: `selectionMode`, `requestedChecks`,
  `requestedCheckResolutions`, `requestedCheckResolutionCount`,
  `requestedCheckResolutionCounts`,
  `requestedCheckResolutionKinds`, `requestedCheckResolutionKindCount`,
  `requestedCheckResolvedChecks`, `requestedCheckResolvedScripts`,
  `requestedCheckResolvedScriptMap`,
  `requestedCheckResolvedSupportsNoBuildMap`,
  `requestedCheckResolvedScriptMapCount`,
  `requestedCheckResolvedSupportsNoBuildMapCount`,
  `requestedCheckResolvedIndices`,
  `requestedCheckResolvedIndexMap`,
  `requestedCheckResolvedIndexMapCount`,
  `requestedCheckResolvedCommandMap`,
  `requestedCheckResolvedCommandMapCount`,
  `requestedCheckResolvedArgsMap`,
  `requestedCheckResolvedArgsMapCount`,
  `requestedCheckResolvedArgCountMap`,
  `requestedCheckResolvedArgCountMapCount`,
  `requestedCheckResolvedMetadata`,
  `requestedCheckResolvedMetadataCount`,
  `selectedChecks`, `skippedChecks`
- script/index projections: `selectedCheckMetadata`,
  `selectedCheckMetadataCount`, `selectedCheckScripts`,
  `selectedCheckScriptMap`, `selectedCheckScriptMapCount`,
  `selectedCheckCommandMap`, `selectedCheckCommandMapCount`,
  `selectedCheckArgsMap`, `selectedCheckArgsMapCount`,
  `selectedCheckArgCountMap`, `selectedCheckArgCountMapCount`,
  `skippedCheckMetadata`, `skippedCheckMetadataCount`,
  `skippedCheckScripts`, `skippedCheckScriptMap`,
  `skippedCheckScriptMapCount`, `skippedCheckCommandMap`,
  `skippedCheckCommandMapCount`, `skippedCheckArgsMap`,
  `skippedCheckArgsMapCount`, `skippedCheckArgCountMap`,
  `skippedCheckArgCountMapCount`, `passedCheckMetadata`,
  `passedCheckMetadataCount`, `passedCheckScripts`,
  `passedCheckScriptMap`, `passedCheckScriptMapCount`,
  `passedCheckCommandMap`, `passedCheckCommandMapCount`,
  `passedCheckArgsMap`, `passedCheckArgsMapCount`,
  `passedCheckArgCountMap`, `passedCheckArgCountMapCount`,
  `failedCheckMetadata`, `failedCheckMetadataCount`,
  `failedCheckScripts`, `failedCheckScriptMap`,
  `failedCheckScriptMapCount`, `failedCheckCommandMap`,
  `failedCheckCommandMapCount`, `failedCheckArgsMap`,
  `failedCheckArgsMapCount`, `failedCheckArgCountMap`,
  `failedCheckArgCountMapCount`, `selectedCheckIndices`,
  `selectedCheckIndexMap`, `selectedCheckIndexMapCount`,
  `skippedCheckIndices`, `skippedCheckIndexMap`,
  `skippedCheckIndexMapCount`, `passedCheckIndices`,
  `passedCheckIndexMap`, `passedCheckIndexMapCount`,
  `failedCheckIndices`, `failedCheckIndexMap`,
  `failedCheckIndexMapCount`
- execution partitions: `passedChecks`, `failedChecks`,
  `checkStatusMap`, `checkStatusCountMap`,
  `checkCommandMap`, `checkCommandMapCount`,
  `checkArgsMap`, `checkArgsMapCount`,
  `checkArgCountMap`, `checkArgCountMapCount`,
  `failureSummaries`, `failureSummaryCount`
- nested ts-core example summary fields:
  `tsCoreExampleCommand`, `tsCoreExampleArgs`,
  `tsCoreExampleArgCount`, `tsCoreExampleAttempted`,
  `tsCoreExampleStatus`, `tsCoreExampleExitCode`,
  `tsCoreExampleDurationMs`, `tsCoreExampleOutputLine`
- nested client wasm summary fields:
  `clientWasmPackCheckStatus`, `clientWasmPackCheckCommand`,
  `clientWasmPackCheckArgs`, `clientWasmPackCheckArgCount`,
  `clientWasmPackCheckExitCode`, `clientWasmPackCheckOutputLine`
- executable inventory: `availableChecks`, `availableCheckScripts`,
  `availableCheckScriptMap`, `availableCheckCommandMap`,
  `availableCheckArgsMap`, `availableCheckArgCountMap`,
  `availableCheckSupportsNoBuildMap`,
  `availableCheckScriptMapCount`, `availableCheckCommandMapCount`,
  `availableCheckArgsMapCount`, `availableCheckArgCountMapCount`,
  `availableCheckSupportsNoBuildMapCount`,
  `availableCheckIndices`,
  `availableCheckIndexMap`, `availableCheckIndexMapCount`,
  `availableCheckMetadata`, `availableCheckMetadataCount`,
  `availableCheckAliases`, `availableCheckAliasCountMap`,
  `availableCheckAliasGroupCount`, `availableCheckAliasCountMapCount`,
  `availableCheckAliasTokenCount`, `availableSpecialCheckSelectors`,
  `availableSpecialCheckSelectorCount`, `availableSpecialCheckAliases`,
  `availableSpecialCheckAliasCountMap`,
  `availableSpecialCheckAliasGroupCount`,
  `availableSpecialCheckAliasCountMapCount`,
  `availableSpecialCheckAliasTokenCount`,
  `availableSpecialSelectorResolvedChecks`,
  `availableSpecialSelectorResolvedChecksCount`,
  `availableSpecialSelectorResolvedCheckCountMap`,
  `availableSpecialSelectorResolvedCheckCountMapCount`

Each aggregate `checks[]` entry also includes `scriptName`,
`supportsNoBuild`, `checkIndex`, `checkCommand`, `checkArgs`, and
`checkArgCount`.

Each aggregate `failureSummaries[]` entry includes `name`, `scriptName`,
`supportsNoBuild`, `checkIndex`, `checkCommand`, `checkArgs`,
`checkArgCount`, `exitCode`, and `message`.

Client/onboarding aggregate JSON reports additionally include step-level
partitions such as `availableSteps`, `passedSteps`, `failedSteps`,
`skippedSteps`, `availableStepScripts`, `availableStepScriptMap`,
`availableStepCheckCommandMap`, `availableStepCheckArgsMap`,
`availableStepCheckArgCountMap`,
`availableStepSupportsNoBuildMap`,
`availableStepIndices`,
`availableStepIndexMap`,
`availableStepScriptMapCount`, `availableStepCheckCommandMapCount`,
`availableStepCheckArgsMapCount`, `availableStepCheckArgCountMapCount`,
`availableStepSupportsNoBuildMapCount`, `availableStepIndexMapCount`,
`availableStepMetadata`, `availableStepMetadataCount`,
`passedStepScripts`, `passedStepScriptMap`,
`passedStepScriptMapCount`, `passedStepCheckCommandMap`,
`passedStepCheckArgsMap`, `passedStepCheckArgCountMap`,
`passedStepCheckCommandMapCount`, `passedStepCheckArgsMapCount`,
`passedStepCheckArgCountMapCount`, `failedStepScripts`,
`failedStepScriptMap`, `failedStepScriptMapCount`,
`failedStepCheckCommandMap`, `failedStepCheckArgsMap`,
`failedStepCheckArgCountMap`, `failedStepCheckCommandMapCount`,
`failedStepCheckArgsMapCount`, `failedStepCheckArgCountMapCount`,
`skippedStepScripts`, `skippedStepScriptMap`,
`skippedStepScriptMapCount`, `skippedStepCheckCommandMap`,
`skippedStepCheckArgsMap`, `skippedStepCheckArgCountMap`,
`skippedStepCheckCommandMapCount`, `skippedStepCheckArgsMapCount`,
`skippedStepCheckArgCountMapCount`, `passedStepIndices`, `passedStepIndexMap`,
`passedStepIndexMapCount`, `failedStepIndices`, `failedStepIndexMap`,
`failedStepIndexMapCount`,
`skippedStepIndices`, `skippedStepIndexMap`, `skippedStepIndexMapCount`,
`stepCheckCommandMap`, `stepCheckArgsMap`, `stepCheckArgCountMap`,
`stepCheckCommandMapCount`, `stepCheckArgsMapCount`,
`stepCheckArgCountMapCount`,
`stepStatusMap`, `stepStatusMapCount`,
`stepStatusCountMap`, `stepStatusCountMapCount`,
`passedStepMetadata`, `passedStepMetadataCount`,
`failedStepMetadata`, `failedStepMetadataCount`,
`skippedStepMetadata`, `skippedStepMetadataCount`,
`failureSummaries`, and `failureSummaryCount`.
Each step entry in `steps[]` includes `scriptName`, `supportsNoBuild`,
`checkCommand`, `checkArgs`, `checkArgCount`, and `stepIndex`.
Each step failure summary in `failureSummaries[]` includes `checkCommand`,
`checkArgs`, and `checkArgCount` for deterministic command diagnostics.
Client JSON reports additionally expose top-level wasm preflight summary
fields `wasmPackCheckStatus`, `wasmPackCheckCommand`,
`wasmPackCheckArgs`, `wasmPackCheckArgCount`, `wasmPackCheckExitCode`,
and `wasmPackCheckOutputLine`.
Onboarding JSON reports additionally expose ts-core example summary
fields `tsCoreExampleCommand`, `tsCoreExampleArgs`,
`tsCoreExampleArgCount`, `tsCoreExampleAttempted`,
`tsCoreExampleStatus`, `tsCoreExampleExitCode`,
`tsCoreExampleDurationMs`, `tsCoreExampleOutputLine`, plus
client-step wasm preflight summary fields `clientWasmPackCheckStatus`,
`clientWasmPackCheckCommand`, `clientWasmPackCheckArgs`,
`clientWasmPackCheckArgCount`, `clientWasmPackCheckExitCode`, and
`clientWasmPackCheckOutputLine`.
Nested client wasm artifact reports include `wasmPackCheckCommand`,
`wasmPackCheckArgs`, `wasmPackCheckArgCount`, `wasmPackCheckExitCode`,
`wasmPackCheckStatus`, and `wasmPackCheckOutputLine` for deterministic
wasm-pack invocation tracing.
Developer-environment JSON reports include check inventory and partition
metadata such as `availableChecks`, `availableCheckIndexMap`,
`availableCheckCommandMap`, `availableCheckArgsMap`,
`availableCheckArgCountMap`, `availableCheckRequiredMap`,
`availableCheckHintMap`,
`availableCheckMinimumVersionMap`, `checkLabels`, `checkIndices`,
`checkIndexMap`, `checkCommandMap`, `checkArgsMap`,
`checkArgCountMap`, `checkStatusMap`, `checkStatusCountMap`, `passedChecks`,
`passedCheckIndices`, `passedCheckIndexMap`, `passedCheckCommandMap`,
`passedCheckArgsMap`, `passedCheckArgCountMap`, `failedChecks`,
`failedCheckIndices`, `failedCheckIndexMap`, `failedCheckCommandMap`,
`failedCheckArgsMap`, `failedCheckArgCountMap`, `requiredCheckLabels`,
`requiredCheckIndices`, `requiredCheckIndexMap`, `requiredCheckCommandMap`,
`requiredCheckArgsMap`, `requiredCheckArgCountMap`, `optionalCheckLabels`,
`optionalCheckIndices`, `optionalCheckIndexMap`, `optionalCheckCommandMap`,
`optionalCheckArgsMap`, `optionalCheckArgCountMap`, `requiredFailureLabels`,
`requiredFailureIndices`, `requiredFailureIndexMap`,
`requiredFailureCommandMap`, `requiredFailureArgsMap`,
`requiredFailureArgCountMap`, `optionalFailureLabels`,
`optionalFailureIndices`, `optionalFailureIndexMap`,
`optionalFailureCommandMap`, `optionalFailureArgsMap`,
`optionalFailureArgCountMap`, `failureSummaries`, and associated `*Count`
fields.
Developer-environment `checks[]` and `failureSummaries[]` entries include
`checkIndex`, `checkCommand`, `checkArgs`, and `checkArgCount` for stable
correlation with `availableChecks` and deterministic command diagnostics.
WASM-pack JSON reports similarly expose single-check inventory and execution
metadata such as `availableCheckCommandMap`, `availableCheckArgsMap`,
`availableCheckArgCountMap`, `availableCheckIndices`,
`availableCheckIndexCount`, `availableCheckMetadata`, `checkIndices`,
`checkIndexMap`, `checkCommandMap`, `checkArgsMap`, `checkArgCountMap`,
`checkMetadata`,
`checkStatusMap`, `checkStatusCountMap`, `checkVersionMap`,
`checkExitCodeMap`, `checkOutputLineMap`, `passedChecks`,
`passedCheckIndices`, `passedCheckIndexMap`, `passedCheckCommandMap`,
`passedCheckArgsMap`, `passedCheckArgCountMap`, `passedCheckMetadata`,
`failedChecks`,
`failedCheckIndices`, `failedCheckIndexMap`, `failedCheckCommandMap`,
`failedCheckArgsMap`, `failedCheckArgCountMap`, `failedCheckMetadata`,
`failureSummaries`, and companion `*Count` fields.
WASM-pack metadata entries in `availableCheckMetadata`, `checkMetadata`,
`passedCheckMetadata`, and `failedCheckMetadata` include `checkIndex`,
`command`, `args`, `argCount`, `checkCommand`, `checkArgs`, and
`checkArgCount`.
WASM-pack `failureSummaries[]` entries include `checkIndex`, `command`,
`args`, `argCount`, `checkCommand`, `checkArgs`, and `checkArgCount`
for stable correlation with `availableChecks`.

## API reference

Typed API docs are generated under:

- `API` → `TS Core API`
