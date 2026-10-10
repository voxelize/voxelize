---
id: "FarTerrain"
title: "Class: FarTerrain"
sidebar_label: "FarTerrain"
sidebar_position: 0
custom_edit_url: null
---

Coarse terrain past the loaded chunks: a quadtree of stepped-column tiles
the server samples from its generator, finer near the viewer and on tall
relief, painted from the textures of the blocks each surface is made of
and lit and fogged as the chunks are, hidden wherever a chunk draws real
terrain, with a flat water plane at sea level. Tiles are meshed off the
main thread and dissolve in and out as the detail changes. The `World`
owns one, feeds it the server's descriptor from the INIT options, drives
`update` once a frame, hands it method replies and sends the requests it
queues.

## Hierarchy

- `Group`

  ↳ **`FarTerrain`**

## Constructors

### constructor

• **new FarTerrain**(`shared`, `options?`): [`FarTerrain`](FarTerrain.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `shared` | [`FarTerrainSharedUniforms`](../#farterrainshareduniforms) |
| `options` | `Partial`<[`FarTerrainOptions`](../#farterrainoptions)\> |

#### Returns

[`FarTerrain`](FarTerrain.md)

#### Overrides

Group.constructor

## Properties

### descriptor

• **descriptor**: [`FarTerrainDescriptor`](../#farterraindescriptor) = `null`

___

### options

• **options**: [`FarTerrainOptions`](../#farterrainoptions)

___

### stats

• **stats**: [`FarTerrainStats`](../#farterrainstats)

## Accessors

### distance

• `get` **distance**(): `number`

The reach in blocks; 0 switches the layer off and frees its tiles.

#### Returns

`number`

• `set` **distance**(`distance`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `distance` | `number` |

#### Returns

`void`

___

### isActive

• `get` **isActive**(): `boolean`

#### Returns

`boolean`

___

### reach

• `get` **reach**(): `number`

The far reach when the layer is drawing, else 0 (for the fog range).

#### Returns

`number`

## Methods

### clearTiles

▸ **clearTiles**(): `void`

Drop every tile and forget what was asked for.

#### Returns

`void`

___

### configure

▸ **configure**(`descriptor`): `void`

The server's description of its far terrain, or null for none.

#### Parameters

| Name | Type |
| :------ | :------ |
| `descriptor` | [`FarTerrainDescriptor`](../#farterraindescriptor) |

#### Returns

`void`

___

### dispose

▸ **dispose**(): `void`

#### Returns

`void`

___

### drawsColumn

▸ **drawsColumn**(`cx`, `cz`): `boolean`

Whether the layer draws the whole of a chunk column, as it does over a
column still on its way outside the guard radius. A chunk landing
there replaces terrain already on screen, so a host can land it as
itself rather than reveal it out of the fog, which would flash over
that terrain.

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |

#### Returns

`boolean`

___

### onMethodReply

▸ **onMethodReply**(`name`, `payload`): `void`

A method reply to hand over; ignored unless it is a far-terrain tile.

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |
| `payload` | `unknown` |

#### Returns

`void`

___

### resetPeaks

▸ **resetPeaks**(): `void`

Reset the peak and the running mean so a measurement window starts clean.

#### Returns

`void`

___

### setPalette

▸ **setPalette**(`palette`): `void`

Replaces the colour of every class (linear RGB, flattened) for a server
whose descriptor names no materials; tiles built from here on use it. A
source whose classes are discovered as tiles arrive (block ids, say)
grows its palette before handing each tile in.

#### Parameters

| Name | Type |
| :------ | :------ |
| `palette` | `ArrayLike`<`number`\> |

#### Returns

`void`

___

### takePackets

▸ **takePackets**(): `MessageProtocol`[]

Requests queued since the last call, for the world to send.

#### Returns

`MessageProtocol`[]

___

### update

▸ **update**(`position`, `world`): `void`

One frame: plan which tiles to draw, ask for the missing ones, ease the
detail changes, drop what is no longer wanted, refresh the chunk-coverage
mask when chunks changed, and hand new tiles to the mesher.

`isChunkPending` says whether a chunk column inside the render radius
still owes its terrain (not loaded, or loaded with its mesh still being
built at some level; a loaded, meshed chunk with nothing to draw is not
pending): the mask covers those within `pendingGuardRadius` of the
viewer, so a coarse tile never shows through the walls around it.
Further out, a drawn tile over such a column keeps drawing until the
chunk lands instead of opening a hole of sky.

#### Parameters

| Name | Type |
| :------ | :------ |
| `position` | `Vector3` |
| `world` | `Object` |
| `world.chunkSize` | `number` |
| `world.forEachMeshedChunk` | (`callback`: (`cx`: `number`, `cz`: `number`) => `void`) => `void` |
| `world.isChunkPending` | (`cx`: `number`, `cz`: `number`) => `boolean` |
| `world.loadedGeneration` | `number` |
| `world.renderRadius` | `number` |

#### Returns

`void`

___

### warmLooks

▸ **warmLooks**(): `Promise`<`void`\>

Read every face the descriptor's materials name now, a slice at a time,
for a load phase to await once the block textures are painted: each
atlas read waits on the GPU, a stall that belongs behind a loading
screen, not in the frame a player switches the layer on. Settles once
the materials are ready (a face that never becomes readable is greyed
after `faceLookTimeoutMs`), at once for a world without materials.

#### Returns

`Promise`<`void`\>
