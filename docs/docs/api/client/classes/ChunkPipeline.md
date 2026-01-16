---
id: "ChunkPipeline"
title: "Class: ChunkPipeline"
sidebar_label: "ChunkPipeline"
sidebar_position: 0
custom_edit_url: null
---

## Constructors

### constructor

• **new ChunkPipeline**(): [`ChunkPipeline`](ChunkPipeline.md)

#### Returns

[`ChunkPipeline`](ChunkPipeline.md)

## Accessors

### loadedCount

• `get` **loadedCount**(): `number`

#### Returns

`number`

___

### processingCount

• `get` **processingCount**(): `number`

#### Returns

`number`

___

### requestedCount

• `get` **requestedCount**(): `number`

#### Returns

`number`

___

### totalCount

• `get` **totalCount**(): `number`

#### Returns

`number`

## Methods

### forEach

▸ **forEach**(`stage`, `callback`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `stage` | ``"requested"`` \| ``"processing"`` \| ``"loaded"`` |
| `callback` | (`name`: `string`) => `void` |

#### Returns

`void`

___

### forEachLoaded

▸ **forEachLoaded**(`callback`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `callback` | (`chunk`: [`Chunk`](Chunk.md), `name`: `string`) => `void` |

#### Returns

`void`

___

### getInStage

▸ **getInStage**(`stage`): `Set`\<`string`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `stage` | ``"requested"`` \| ``"processing"`` \| ``"loaded"`` |

#### Returns

`Set`\<`string`\>

___

### getLoadedChunk

▸ **getLoadedChunk**(`name`): [`Chunk`](Chunk.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

[`Chunk`](Chunk.md)

___

### getProcessingData

▸ **getProcessingData**(`name`): `Object`

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`Object`

| Name | Type |
| :------ | :------ |
| `data` | `ChunkProtocol` |
| `source` | ``"load"`` \| ``"update"`` |

___

### getRetryCount

▸ **getRetryCount**(`name`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`number`

___

### getStage

▸ **getStage**(`name`): ``"requested"`` \| ``"processing"`` \| ``"loaded"``

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

``"requested"`` \| ``"processing"`` \| ``"loaded"``

___

### incrementRetry

▸ **incrementRetry**(`name`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`number`

___

### isInStage

▸ **isInStage**(`name`, `stage`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |
| `stage` | ``"requested"`` \| ``"processing"`` \| ``"loaded"`` |

#### Returns

`boolean`

___

### markLoaded

▸ **markLoaded**(`coords`, `chunk`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `coords` | [`Coords2`](../modules.md#coords2) |
| `chunk` | [`Chunk`](Chunk.md) |

#### Returns

`void`

___

### markProcessing

▸ **markProcessing**(`coords`, `source`, `data`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `coords` | [`Coords2`](../modules.md#coords2) |
| `source` | ``"load"`` \| ``"update"`` |
| `data` | `ChunkProtocol` |

#### Returns

`void`

___

### markRequested

▸ **markRequested**(`coords`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `coords` | [`Coords2`](../modules.md#coords2) |

#### Returns

`void`

___

### remove

▸ **remove**(`name`): [`Chunk`](Chunk.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

[`Chunk`](Chunk.md)

___

### resetRetry

▸ **resetRetry**(`name`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`void`
