---
id: "BlockAnimations"
title: "Class: BlockAnimations"
sidebar_label: "BlockAnimations"
sidebar_position: 0
custom_edit_url: null
---

## Constructors

### constructor

• **new BlockAnimations**(`host`): [`BlockAnimations`](BlockAnimations.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `host` | [`BlockAnimationHost`](../interfaces/BlockAnimationHost.md) |

#### Returns

[`BlockAnimations`](BlockAnimations.md)

## Accessors

### activeCount

• `get` **activeCount**(): `number`

Voxels currently moving; a diagnostic for tests and the agent.

#### Returns

`number`

___

### trackedCount

• `get` **trackedCount**(): `number`

Voxels with a tracked mesh, moving or at rest.

#### Returns

`number`

## Methods

### clear

▸ **clear**(): `void`

#### Returns

`void`

___

### get

▸ **get**(`block`): [`BlockAnimation`](../#blockanimation)

#### Parameters

| Name | Type |
| :------ | :------ |
| `block` | [`Block`](../#block) |

#### Returns

[`BlockAnimation`](../#blockanimation)

___

### handleSectionMeshed

▸ **handleSectionMeshed**(`cx`, `cz`, `level`, `meshes`, `nowMs`): `void`

The meshes of one chunk section just landed. Every animated voxel among
them is compared with the mesh it replaces: same state and the pose
carries over (a neighbour's edit remeshed the section mid-swing); a new
state and the leaf starts moving from where it visibly was.

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |
| `level` | `number` |
| `meshes` | `Mesh`<`BufferGeometry`<`NormalBufferAttributes`, `BufferGeometryEventMap`\>, `Material` \| `Material`[], `Object3DEventMap`\>[] |
| `nowMs` | `number` |

#### Returns

`void`

___

### handleSectionUnloaded

▸ **handleSectionUnloaded**(`cx`, `cz`, `level`): `void`

The section's meshes are gone (chunk unloaded): forget its voxels.

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |
| `level` | `number` |

#### Returns

`void`

___

### nudge

▸ **nudge**(`voxel`, `angle`, `durationMs`, `nowMs`): `boolean`

Knock a tracked voxel `angle` radians off the pose it shows, about its
hinge, and let it ease back over `durationMs` with no change of state:
a leaf rattled by a blow from the other side. Its coupled parts (the
other leaf of a two-voxel unit) are knocked with it, so the pair moves
as one. Purely cosmetic, like every motion here. Returns whether a
voxel is tracked there.

#### Parameters

| Name | Type |
| :------ | :------ |
| `voxel` | [`Coords3`](../#coords3) |
| `angle` | `number` |
| `durationMs` | `number` |
| `nowMs` | `number` |

#### Returns

`boolean`

___

### register

▸ **register**(`names`, `animation`): () => `void`

Declare how the named blocks move between their states. Names are
matched case-insensitively, as the registry keys them. Returns a
disposer that forgets the declaration again.

#### Parameters

| Name | Type |
| :------ | :------ |
| `names` | `string` \| `string`[] |
| `animation` | [`BlockAnimation`](../#blockanimation) |

#### Returns

`fn`

▸ (): `void`

##### Returns

`void`

___

### snapshot

▸ **snapshot**(`nowMs`): [`BlockAnimationsSnapshot`](../#blockanimationssnapshot)

What the animations know right now, for the agent harness: the block
names with a declared motion, and every tracked voxel with the pose it
is showing. `angle` is radians about the hinge from the stage-0 pose;
`progress` is 1 at rest.

#### Parameters

| Name | Type |
| :------ | :------ |
| `nowMs` | `number` |

#### Returns

[`BlockAnimationsSnapshot`](../#blockanimationssnapshot)

___

### update

▸ **update**(`nowMs`): `void`

Advance every moving voxel to `nowMs`. Called once per frame.

#### Parameters

| Name | Type |
| :------ | :------ |
| `nowMs` | `number` |

#### Returns

`void`
