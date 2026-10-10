---
id: "InstancedEntityRoster"
title: "Class: InstancedEntityRoster"
sidebar_label: "InstancedEntityRoster"
sidebar_position: 0
custom_edit_url: null
---

Owns a game's instanced entity pools: adds them to the scene, advances
them every frame, bakes every variant during the load phase under a frame
budget, and disposes them together.

The warmup is the point. Baking a variant the first time an entity of it
appears converts one loading stall into a hitch every time something new
walks into view, so the join flow awaits [warm](InstancedEntityRoster.md#warm) and the player is
held out of the world until the whole roster is baked. Pools take part by
implementing [WarmablePool](../interfaces/WarmablePool.md); a pool that does not is never warmed
and should report its on-demand builds through `noteLazyBake`.

## Hierarchy

- `Group`

  ↳ **`InstancedEntityRoster`**

## Constructors

### constructor

• **new InstancedEntityRoster**(): [`InstancedEntityRoster`](InstancedEntityRoster.md)

Creates a new Group.

#### Returns

[`InstancedEntityRoster`](InstancedEntityRoster.md)

#### Inherited from

THREE.Group.constructor

## Accessors

### pools

• `get` **pools**(): readonly [`RosterPool`](../#rosterpool)[]

Registered pools, in registration order.

#### Returns

readonly [`RosterPool`](../#rosterpool)[]

## Methods

### dispose

▸ **dispose**(): `void`

#### Returns

`void`

___

### listShadowCasterPools

▸ **listShadowCasterPools**(): `Group`<`Object3DEventMap`\>[]

Every pool that is a group, for the shadow passes. Derived from the
scene graph rather than listed by hand: a hand list once left three
families out, so they only ever cast the bind-pose silhouette of the
generic depth material.

#### Returns

`Group`<`Object3DEventMap`\>[]

___

### readWarmupStats

▸ **readWarmupStats**(): [`RosterWarmupStats`](../interfaces/RosterWarmupStats.md)

#### Returns

[`RosterWarmupStats`](../interfaces/RosterWarmupStats.md)

___

### register

▸ **register**<`T`\>(`pool`): `T`

Adds a pool whose `update(deltaTime, renderer)` advances it.

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | extends [`UpdatingRosterPool`](../#updatingrosterpool) |

#### Parameters

| Name | Type |
| :------ | :------ |
| `pool` | `T` |

#### Returns

`T`

▸ **register**<`T`\>(`pool`, `update`): `T`

Adds a pool advanced by `update`, or not per frame at all when null.

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | extends [`RosterPool`](../#rosterpool) |

#### Parameters

| Name | Type |
| :------ | :------ |
| `pool` | `T` |
| `update` | [`RosterUpdate`](../#rosterupdate) |

#### Returns

`T`

___

### update

▸ **update**(`deltaTime`, `renderer`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `deltaTime` | `number` |
| `renderer` | `WebGLRenderer` |

#### Returns

`void`

___

### warm

▸ **warm**(`options`): `Promise`<`void`\>

Bakes every variant of every warmable pool, a slice per frame, and
resolves once the roster is complete. Calling it again returns the same
promise. Neither it nor its hooks' absence ever rejects on its own.

#### Parameters

| Name | Type |
| :------ | :------ |
| `options` | [`RosterWarmupOptions`](../interfaces/RosterWarmupOptions.md) |

#### Returns

`Promise`<`void`\>
