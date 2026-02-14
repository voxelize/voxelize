# @voxelize/ts-core

TypeScript core primitives for Voxelize.

`@voxelize/ts-core` is a lightweight Rust-free package for voxel bit packing, light packing, block rotations, AABB math, and block rule evaluation. It mirrors the behavior of `voxelize-core` in Rust while providing an idiomatic TypeScript surface.

## Install

```bash
pnpm add @voxelize/ts-core
```

## Quick start

```ts
import {
  BlockRotation,
  Light,
  Voxel,
  BlockRuleEvaluator,
  BlockRuleLogic,
  type VoxelAccess,
} from "@voxelize/ts-core";

const rotation = BlockRotation.encode(0, 4);
const voxel = Voxel.pack({ id: 42, rotation, stage: 7 });
const light = Light.pack({ sunlight: 15, red: 10, green: 5, blue: 3 });

const unpackedVoxel = Voxel.unpack(voxel);
const unpackedLight = Light.unpack(light);
```

You can also use axis-friendly constructors:

```ts
const facingUp = BlockRotation.PY(0);
const facingPositiveX = BlockRotation.PX(Math.PI / 2);
```

`Voxel.pack` and `BlockUtils.insertRotation` also accept rotation-like objects:

```ts
const voxel = Voxel.pack({
  id: 7,
  rotation: { value: 0, yRotation: Math.PI / 2 },
  stage: 1,
});
```

## Core API

- `Voxel` and `BlockUtils`
  - pack and unpack voxel id, rotation, and stage
- `Light` and `LightUtils`
  - pack and unpack sunlight + RGB torch channels
- `BlockRotation`
  - encode/decode major axis + y-rotation segments
  - encoded y-rotation segments wrap modulo 16 (including negative inputs)
  - rotate nodes, AABBs, and transparency masks
  - full-turn y-rotations (`±2π` multiples) normalize to identity transforms
  - non-finite y-rotation inputs are safely normalized to identity transforms
  - `decode` normalizes finite y-rotation values modulo full turns before
    segment quantization for stable large-angle behavior
  - `rotateAABB` mirrors Rust core behavior, including axis-specific `yRotate`
    handling for Y-facing rotations
- `AABB`
  - union/intersection/translate/touches/intersects utilities
  - `intersects` uses strict overlap semantics (face-touching boxes return
    `false`; use `touches` for face-contact checks)
- `BlockRuleEvaluator`
  - evaluate `BlockRule` trees against a voxel access implementation
  - combination rule edge cases mirror core semantics (`NOT []` / `AND []`
    evaluate to `true`, `OR []` evaluates to `false`)
  - y-rotated rule offsets use rounded integer voxel positions after rotation
  - rule-offset y-rotation also normalizes full turns/non-finite values to
    identity before offset checks and snaps large-angle precision drift near
    segment boundaries (with bounded snap tolerance to avoid over-rotation)
- `createBlockConditionalPart`
  - defensively clones rule, face, AABB, and transparency-array inputs to
    avoid external mutation side effects after construction
- `createBlockDynamicPattern`
  - defensively clones dynamic-pattern part inputs using
    `createBlockConditionalPart`
- `VoxelAccess`
  - interface contract for meshing/generation-style data access

## Dynamic pattern helper

```ts
import {
  BlockRuleLogic,
  createBlockConditionalPart,
  createBlockDynamicPattern,
} from "@voxelize/ts-core";

const pattern = createBlockDynamicPattern({
  parts: [
    createBlockConditionalPart({
      rule: {
        type: "combination",
        logic: BlockRuleLogic.And,
        rules: [{ type: "simple", offset: [0, 0, 0], id: 42 }],
      },
      worldSpace: false,
    }),
  ],
});
```

## Bit layout

Voxel value (`u32` style in JS):

- id: lower 16 bits
- rotation axis: bits 16..19
- y-rotation segment: bits 20..23
- stage: bits 24..27

Light value:

- sunlight: bits 12..15
- red: bits 8..11
- green: bits 4..7
- blue: bits 0..3

## End-to-end example

Run the included end-to-end demo:

```bash
pnpm --filter @voxelize/ts-core example:end-to-end
```

If artifacts are already built and you only want to rerun the example payload:

```bash
pnpm --filter @voxelize/ts-core example:end-to-end:no-build
```

It executes the complete flow:

1. Pack voxel + light values
2. Store/retrieve through an in-memory space
3. Apply AABB rotation
4. Evaluate block rules
5. Serialize and validate roundtrip data

## Development

```bash
pnpm --filter @voxelize/ts-core test
pnpm --filter @voxelize/ts-core build
```

## Workspace artifact checks

From the repository root you can validate generated artifacts:

```bash
# ts-core artifact report (auto-builds if needed)
pnpm run check:ts-core:json

# verify-only ts-core report (no auto-build)
pnpm run check:ts-core:verify:json

# full ts-core release workflow
pnpm run check:ts-core:release

# aggregate preflight release workflow for ts-core
pnpm run check:preflight:ts-core:release
```

The ts-core JSON report includes package/artifact diagnostics such as
`checkedPackage`, `checkedPackagePath`, `presentPackages`, `missingPackages`,
`requiredArtifacts`, `presentArtifacts`, `missingArtifacts`,
`requiredArtifactCount`, `presentArtifactCount`, `missingArtifactCount`, and
`missingArtifactSummary`. It also includes end-to-end example verification
metadata: `exampleCommand`, `exampleArgs`, `exampleArgCount`,
`exampleAttempted`, `exampleStatus`, `exampleRuleMatched`,
`examplePayloadValid`, `examplePayloadIssues`, `examplePayloadIssueCount`,
`exampleExitCode`, `exampleDurationMs`, and `exampleOutputLine`.
`examplePayloadValid` is `true` only when the example emits the full payload
shape (`voxel.id`, `voxel.stage`, `voxel.rotation.value`,
`voxel.rotation.yRotation`, `light`, `rotatedAabb`) with valid value domains
(`voxel.id` in `0..65535`, `voxel.stage`/light channels in `0..15`, rotation
axis in `0..5`) and ordered AABB bounds (`min <= max` per axis).
Object-shaped JSON output is required for payload validation; array/primitive
JSON outputs are treated as invalid example output, and empty output is also
treated as invalid.
`examplePayloadIssues` lists each invalid payload path whenever
`examplePayloadValid` is `false` and is normalized (trimmed + deduplicated).

When failures occur, `failureSummaries[]` entries include `kind`:

- `kind: "artifacts"` for missing artifact failures
- `kind: "example"` for end-to-end example execution/output failures
  (`exitCode`, `ruleMatched`, `payloadValid`, `payloadIssues`,
  `payloadIssueCount`, and `outputLine`)

If an example reports both `ruleMatched=false` and payload validation issues,
the failure message includes both conditions for clearer diagnostics. If payload
fields are valid, the message remains a pure `ruleMatched=false` diagnostic.
If `ruleMatched` is missing/invalid and payload validation also fails, the
diagnostic includes the payload issue paths alongside the invalid-output signal.
A non-zero example `exitCode` always takes precedence and is reported as an
execution failure, even if the payload itself is otherwise valid.
If the example exits successfully but no parseable JSON object payload is
produced, ts-core reports a dedicated "produced no parseable JSON output"
diagnostic.
When non-JSON output fallback is used, `exampleOutputLine` is normalized to a
clean printable line (ANSI/control escapes are stripped).
Example JSON parsing is also resilient to UTF-8 BOM-prefixed output lines.

Example `kind: "example"` failure payload (truncated):

```json
{
  "kind": "example",
  "ruleMatched": false,
  "payloadValid": false,
  "payloadIssues": ["light.red"],
  "payloadIssueCount": 1,
  "outputLine": "ruleMatched=false"
}
```
