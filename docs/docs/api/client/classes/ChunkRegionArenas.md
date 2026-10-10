---
id: "ChunkRegionArenas"
title: "Class: ChunkRegionArenas"
sidebar_label: "ChunkRegionArenas"
sidebar_position: 0
custom_edit_url: null
---

Region buffer arenas for the shared-opaque chunk bucket, adapted from
Sodium's region-arena renderer. Every opaque section inside an NxN block of
chunk columns lives as one slot of one `BatchedMesh`, so an entire region
renders as a single multi-draw call per pass instead of one draw per
(section x bucket) mesh, and a remesh rewrites a slot in place
(`setGeometryAt`) instead of disposing and recreating GPU buffers.

`BatchedMesh` culls and sorts per instance against whichever camera renders
it, so sections keep per-section frustum culling in the main pass while the
CSM depth passes — which render with the light's camera — still see every
caster they need. That per-pass behavior is what the whole-object
`chunkCullShadowSafeDistance` bypass exists to approximate for regular
meshes; arena sections need no such bypass.

## Constructors

### constructor

• **new ChunkRegionArenas**(`options`, `maxSectionsPerRegion`, `getMaterial`, `parent`, `positionUnitsPerBlock`): [`ChunkRegionArenas`](ChunkRegionArenas.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `options` | [`ChunkRegionArenasOptions`](../#chunkregionarenasoptions) |
| `maxSectionsPerRegion` | `number` |
| `getMaterial` | () => [`CustomChunkShaderMaterial`](../#customchunkshadermaterial) |
| `parent` | `Object3D`<`Object3DEventMap`\> |
| `positionUnitsPerBlock` | `number` |

#### Returns

[`ChunkRegionArenas`](ChunkRegionArenas.md)

## Accessors

### stats

• `get` **stats**(): `Object`

#### Returns

`Object`

| Name | Type |
| :------ | :------ |
| `regions` | `number` |
| `sections` | `number` |

## Methods

### clearChunk

▸ **clearChunk**(`cx`, `cz`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |

#### Returns

`void`

___

### clearSection

▸ **clearSection**(`cx`, `cz`, `level`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |
| `level` | `number` |

#### Returns

`void`

___

### dispose

▸ **dispose**(): `void`

#### Returns

`void`

___

### setSectionGeometry

▸ **setSectionGeometry**(`cx`, `cz`, `level`, `geometry`, `x`, `y`, `z`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |
| `level` | `number` |
| `geometry` | `BufferGeometry`<`NormalBufferAttributes`, `BufferGeometryEventMap`\> |
| `x` | `number` |
| `y` | `number` |
| `z` | `number` |

#### Returns

`void`

___

### setSectionReveal

▸ **setSectionReveal**(`cx`, `cz`, `level`, `reveal`): `boolean`

How much of a section shows through its own fog color, 0 (pure fog
tint) to 1 (drawn as itself). Rides the slot's batching color, so a
remesh that rewrites the slot in place keeps the value; a slot
allocated fresh starts at 1.

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |
| `level` | `number` |
| `reveal` | `number` |

#### Returns

`boolean`

___

### setSectionVisible

▸ **setSectionVisible**(`cx`, `cz`, `level`, `isVisible`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |
| `level` | `number` |
| `isVisible` | `boolean` |

#### Returns

`void`
