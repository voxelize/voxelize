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
  - evaluation options accept `BlockRotation` instances or plain
    `{ yRotation }` objects, with nullable boolean flags for
    `yRotatable`/`worldSpace`
  - combination rule edge cases mirror core semantics (`NOT []` / `AND []`
    evaluate to `true`, `OR []` evaluates to `false`)
  - y-rotated rule offsets use rounded integer voxel positions after rotation
  - rule-offset y-rotation also normalizes full turns/non-finite values to
    identity before offset checks and snaps large-angle precision drift near
    segment boundaries (with bounded snap tolerance to avoid over-rotation)
  - option payload normalization is computed once per evaluation and reused
    through nested combination traversal
  - malformed option payloads (including proxy/getter traps) sanitize to
    deterministic defaults (`rotation.yRotation=0`, `yRotatable=false`,
    `worldSpace=false`)
  - malformed access reads/comparisons (including throwing `getVoxel*` calls
    and rotation equality traps) return deterministic non-matches instead of
    throwing
  - non-finite resolved coordinates with active constraints (`id`/`rotation`/
    `stage`) are treated as deterministic non-matches
  - cyclic combination-rule edges are guarded during evaluation to avoid
    recursion overflows and follow deterministic `none`-edge semantics
  - malformed combination-rule child collections sanitize to empty-list logic
    semantics (`AND` => `true`, `OR` => `false`, `NOT` => `true`)
  - iterator-trapped combination-rule child collections can still recover
    readable indexed entries via bounded length fallback (up to 1024 entries)
  - when `length` access also traps, combination-rule child recovery can fall
    back to bounded numeric-key scans for deterministic salvage
  - key-based recovery keeps the smallest bounded numeric index set in
    ascending order to avoid full-list sorting overhead under sparse trap
    inputs
  - when bounded length recovery already fills the scan window, key-scan
    enumeration is skipped to avoid redundant fallback overhead
  - length-fallback recovery skips sparse-hole placeholders and inherited
    numeric prototype entries before logical evaluation
  - if bounded length recovery yields only `none` entries, bounded key-scan
    recovery can still supplement readable high-index rules before evaluation
  - when bounded length recovery preserves some readable prefix rules but does
    not fill the scan window, key-scan recovery can still supplement readable
    high-index rules
  - throwing bounded direct reads are skipped during fallback scans so key
    recovery can still salvage readable high-index rules
  - throwing key-fallback reads are skipped so malformed low-index entries do
    not force placeholder `none` rules during recovered combination evaluation
- `createBlockConditionalPart`
  - defensively clones rule, face, AABB, and transparency-array inputs to
    avoid external mutation side effects after construction
  - accepts omitted/`null` input and applies deterministic defaults for
    malformed non-plain input (plain frozen objects are supported)
  - accepts either `BlockFace` instances or plain/null-prototype `BlockFaceInit`
    objects in `faces`
  - accepts either `AABB` instances or plain/readonly `AABB` init objects in
    `aabbs`
  - accepts readonly input arrays/tuples for `faces`, `aabbs`, and
    `isTransparent`, including nullable entry values
  - ignores invalid/non-plain `faces`/`aabbs` entries (including malformed
    `BlockFace`/`AABB` instances and malformed/non-finite AABB init values)
    instead of throwing
  - iterator-trapped `faces`/`aabbs` collections can still recover readable
    indexed entries via bounded length/key fallback scans (up to 1024 indexed
    reads); irrecoverable trap combinations sanitize to deterministic empty
    collections
  - when bounded length recovery already fills the scan window, helper
    key-enumeration fallback is skipped to avoid redundant overhead
  - when bounded prefixes only contain malformed/noisy entries, key-fallback
    scans can still supplement readable high-index face/AABB entries
  - throwing bounded direct reads are skipped during helper fallback scans so
    key recovery can still salvage readable high-index entries
  - fallback scans ignore inherited numeric prototype entries while recovering
    readable indexed face/AABB values
  - malformed optional face fields (such as invalid `dir`/`corners`/`range`)
    fall back to default face values
  - malformed rule inputs fall back to `BLOCK_RULE_NONE`, and malformed
    transparency inputs (including `null`/non-array values) fall back to
    `false` defaults
  - malformed `worldSpace` values fall back to `false`
  - prototype/getter-trap failures in malformed helper inputs sanitize to
    deterministic defaults instead of throwing
- `createBlockRule`
  - clones and sanitizes rule definitions with deterministic `none` fallbacks
  - only plain-object rule nodes are interpreted; non-plain objects normalize
    to `none`
  - breaks cyclic rule graphs safely by replacing cycle edges with `none`
  - iterator-trapped combination-rule collections recover readable indexed
    entries via bounded fallback scans; irrecoverable trap combinations
    sanitize to deterministic `none`
  - bounded key-fallback scans can supplement readable high-index rules when
    bounded prefixes contain malformed/noisy entries
  - bounded key-enumeration fallback is skipped when bounded length recovery
    already fills the scan window
  - inherited numeric prototype entries are ignored during bounded fallback
    scans
  - bounded direct-read traps are skipped during fallback scans so key
    recovery can still salvage readable high-index rules
  - throwing key-fallback reads are skipped so malformed low-index entries do
    not force placeholder `none` rules in recovered rule lists
  - accepts readonly/frozen rule-tree arrays/tuples for ergonomic literal input
  - normalizes nullable combination sub-rules to deterministic `none` entries
  - keeps optional `id`/`stage` only when values match voxel ranges
    (`id`: 0..65535, `stage`: 0..15)
  - keeps plain rotation-like values only when `value` is an encoded
    non-negative nibble (`0..15`) and `yRotation` is finite
  - applies the same nibble/finiteness constraints to `BlockRotation` instances
  - accepts readonly rotation-like literals in helper input objects
  - normalizes `null` optional simple-rule fields (`id`/`rotation`/`stage`) to
    omitted constraints
- `createBlockDynamicPattern`
  - defensively clones dynamic-pattern part inputs using
    `createBlockConditionalPart`
  - accepts omitted or `null` input and applies deterministic defaults
  - accepts readonly `parts` input arrays, including nullable entries
  - accepts plain frozen part/pattern input objects
  - skips malformed part entries (including non-plain objects) instead of
    materializing default placeholders
  - iterator-trapped `parts` collections can recover readable indexed entries
    via bounded fallback scans (up to 1024 indexed reads); irrecoverable trap
    combinations sanitize to deterministic empty collections
  - when bounded length recovery already fills the scan window, helper
    key-enumeration fallback is skipped to avoid redundant overhead
  - when bounded prefixes only contain malformed/noisy entries, key-fallback
    scans can still supplement readable high-index part entries
  - throwing bounded direct reads are skipped during helper fallback scans so
    key recovery can still salvage readable high-index part entries
  - fallback scans ignore inherited numeric prototype entries while recovering
    readable indexed part entries
- `createBlockFace`
  - ergonomic constructor helper for `BlockFaceInit`
    (plain/null-prototype/readonly/frozen object) or `BlockFace` input
  - malformed inputs (including malformed `BlockFace` instances) fall back to a
    deterministic default face (`name: "Face"`)
  - malformed optional `dir`/`corners` collection access falls back to default
    face-field values while preserving other valid fields
- `createAABB`
  - ergonomic constructor helper for `AABB` or plain/readonly/frozen `AABB`
    init input
  - malformed inputs (including non-finite `AABB` instances) fall back to an
    empty AABB
- `createBlockRotation`
  - ergonomic constructor helper for `BlockRotation` or
    plain/readonly/frozen rotation literals (`value`/`yRotation`)
  - `BlockRotation` instances are revalidated to encoded nibble/finiteness
    constraints before cloning
  - malformed inputs (including getter/proxy-trap rotation values) fall back to
    identity `BlockRotation.py(0)`
- `createFaceTransparency`
  - builds normalized 6-face transparency tuples from
    optional/null/partial/readonly/frozen boolean arrays
  - malformed index accessors sanitize to `false` defaults instead of throwing
  - ignores extra entries beyond the six face slots
- `VoxelAccess`
  - interface contract for meshing/generation-style data access

## Dynamic pattern helper

```ts
import {
  BlockRuleLogic,
  createAABB,
  createBlockRule,
  createBlockDynamicPattern,
  createFaceTransparency,
} from "@voxelize/ts-core";

const pattern = createBlockDynamicPattern({
  parts: [
    {
      rule: createBlockRule({
        type: "combination",
        logic: BlockRuleLogic.And,
        rules: [{ type: "simple", offset: [0, 0, 0], id: 42 }],
      }),
      faces: [{ name: "Top", dir: [0, 1, 0] }],
      aabbs: [createAABB({ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 })],
      isTransparent: createFaceTransparency([true]),
      worldSpace: false,
    },
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
5. Build/evaluate a cloned dynamic pattern
6. Serialize and validate roundtrip data

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
If `patternMatched` is included, it must be `true`.
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
