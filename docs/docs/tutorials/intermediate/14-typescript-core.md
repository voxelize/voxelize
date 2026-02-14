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
`presentPackages`, `missingPackages`, `presentPackagePaths`,
`missingPackagePaths`, `requiredPackageCount`, `presentPackageCount`,
`missingPackageCount`, `requiredArtifacts`, `presentArtifacts`,
`missingArtifacts`, `requiredArtifactCount`, `presentArtifactCount`,
`missingArtifactCount`, `missingArtifactSummary`, `buildCommand`, `buildArgs`, `buildExitCode`,
`buildDurationMs`, `attemptedBuild`, `buildSkipped`, and
`buildSkippedReason`.

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
`checkedPackageCount`, `checkedPackagePathCount`, `packageReports`,
`presentPackages`, `missingPackages`, `requiredPackageCount`,
`presentPackageCount`, `packageReportCount`, `requiredArtifactCount`,
`presentArtifactCount`, `missingPackageCount`,
`missingArtifactCount`, `missingArtifactSummary`,
`buildCommand`, `buildArgs`, `buildExitCode`, `buildDurationMs`,
`attemptedBuild`, `buildSkipped`, and `buildSkippedReason`.
Each `packageReports` entry includes `requiredArtifacts`, `presentArtifacts`,
and `missingArtifacts` for package-level artifact diagnostics.

## Aggregate preflight report metadata

For release automation and CI routing, aggregate preflight JSON reports include:

- check-selection diagnostics: `selectionMode`, `requestedChecks`,
  `requestedCheckResolutions`, `requestedCheckResolutionCounts`,
  `requestedCheckResolvedChecks`, `requestedCheckResolvedScripts`,
  `requestedCheckResolvedIndices`, `requestedCheckResolvedIndexMap`,
  `requestedCheckResolvedMetadata`,
  `selectedChecks`, `skippedChecks`
- script/index projections: `selectedCheckScripts`,
  `skippedCheckScripts`, `passedCheckScripts`, `failedCheckScripts`,
  `selectedCheckIndices`, `skippedCheckIndices`, `passedCheckIndices`,
  `failedCheckIndices`
- execution partitions: `passedChecks`, `failedChecks`,
  `failureSummaries`, `failureSummaryCount`
- executable inventory: `availableChecks`, `availableCheckScripts`,
  `availableCheckIndices`, `availableCheckIndexMap`,
  `availableCheckMetadata`, `availableCheckAliases`

Each aggregate `checks[]` entry also includes `scriptName`,
`supportsNoBuild`, and `checkIndex`.

Each aggregate `failureSummaries[]` entry includes `name`, `scriptName`,
`supportsNoBuild`, `checkIndex`, `exitCode`, and `message`.

Client/onboarding aggregate JSON reports additionally include step-level
partitions such as `availableSteps`, `passedSteps`, `failedSteps`,
`skippedSteps`, `availableStepScripts`, `availableStepIndices`,
`availableStepIndexMap`,
`passedStepScripts`, `failedStepScripts`,
`skippedStepScripts`, `passedStepIndices`, `failedStepIndices`,
`skippedStepIndices`, `failureSummaries`, and `failureSummaryCount`.
Each step entry in `steps[]` includes `scriptName`, `supportsNoBuild`, and
`stepIndex`.

## API reference

Typed API docs are generated under:

- `API` → `TS Core API`
