---
id: "LocalShadowAtlas"
title: "Class: LocalShadowAtlas"
sidebar_label: "LocalShadowAtlas"
sidebar_position: 0
custom_edit_url: null
---

The single shared depth atlas every shadowed local light renders into and
every chunk material samples from. Fixed geometry: `maxSlots` shadow slots
of CELLS_PER_SHADOW_SLOT square cells each, laid out row-major in
cell units. Allocated lazily on the first shadowed light, so worlds that
never grant a shadow never pay its memory.

## Constructors

### constructor

• **new LocalShadowAtlas**(`atlasSize`, `slotSize`): [`LocalShadowAtlas`](LocalShadowAtlas.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `atlasSize` | `number` |
| `slotSize` | `number` |

#### Returns

[`LocalShadowAtlas`](LocalShadowAtlas.md)

## Accessors

### capacityCells

• `get` **capacityCells**(): `number`

#### Returns

`number`

___

### capacitySlots

• `get` **capacitySlots**(): `number`

Slots the current geometry can hold (each slot is 12 cells).

#### Returns

`number`

___

### cellSize

• `get` **cellSize**(): `number`

#### Returns

`number`

___

### cellsPerRow

• `get` **cellsPerRow**(): `number`

#### Returns

`number`

___

### depthTexture

• `get` **depthTexture**(): `DepthTexture`

#### Returns

`DepthTexture`

___

### estimatedBytes

• `get` **estimatedBytes**(): `number`

Bytes of GPU memory the atlas holds once allocated (color + depth).

#### Returns

`number`

___

### isAllocated

• `get` **isAllocated**(): `boolean`

#### Returns

`boolean`

___

### size

• `get` **size**(): `number`

#### Returns

`number`

## Methods

### cellIndex

▸ **cellIndex**(`slot`, `face`, `isDynamic`): `number`

Cell index for a slot's face. Static faces occupy the first six cells of
the slot's region, the dynamic overlay the next six.

#### Parameters

| Name | Type |
| :------ | :------ |
| `slot` | `number` |
| `face` | `number` |
| `isDynamic` | `boolean` |

#### Returns

`number`

___

### cellViewport

▸ **cellViewport**(`cell`, `out`): `void`

Pixel-space viewport `[x, y, size]` of a cell.

#### Parameters

| Name | Type |
| :------ | :------ |
| `cell` | `number` |
| `out` | [`number`, `number`, `number`] |

#### Returns

`void`

___

### dispose

▸ **dispose**(): `void`

#### Returns

`void`

___

### ensureAllocated

▸ **ensureAllocated**(): `WebGLRenderTarget`<`Texture`<`unknown`\>\>

#### Returns

`WebGLRenderTarget`<`Texture`<`unknown`\>\>

___

### resize

▸ **resize**(`atlasSize`, `slotSize`): `void`

Resize for a quality-tier change. GPU memory is dropped immediately and
reallocated lazily; the caller invalidates every slot.

#### Parameters

| Name | Type |
| :------ | :------ |
| `atlasSize` | `number` |
| `slotSize` | `number` |

#### Returns

`void`
