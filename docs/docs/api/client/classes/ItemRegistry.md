---
id: "ItemRegistry"
title: "Class: ItemRegistry"
sidebar_label: "ItemRegistry"
sidebar_position: 0
custom_edit_url: null
---

## Constructors

### constructor

• **new ItemRegistry**(): [`ItemRegistry`](ItemRegistry.md)

#### Returns

[`ItemRegistry`](ItemRegistry.md)

## Methods

### canStack

▸ **canStack**(`a`, `b`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `a` | [`SlotContent`](../modules.md#slotcontent) |
| `b` | [`SlotContent`](../modules.md#slotcontent) |

#### Returns

`boolean`

___

### disposeRenderers

▸ **disposeRenderers**(): `void`

#### Returns

`void`

___

### getAll

▸ **getAll**(): [`ItemDef`](../interfaces/ItemDef.md)[]

#### Returns

[`ItemDef`](../interfaces/ItemDef.md)[]

___

### getById

▸ **getById**(`id`): [`ItemDef`](../interfaces/ItemDef.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `number` |

#### Returns

[`ItemDef`](../interfaces/ItemDef.md)

___

### getByName

▸ **getByName**(`name`): [`ItemDef`](../interfaces/ItemDef.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

[`ItemDef`](../interfaces/ItemDef.md)

___

### getMaxDurability

▸ **getMaxDurability**(`itemId`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `itemId` | `number` |

#### Returns

`number`

___

### getMaxStack

▸ **getMaxStack**(`slot`): `number`

#### Parameters

| Name | Type |
| :------ | :------ |
| `slot` | [`SlotContent`](../modules.md#slotcontent) |

#### Returns

`number`

___

### getRenderer

▸ **getRenderer**(`itemId`): [`ItemRenderer`](ItemRenderer.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `itemId` | `number` |

#### Returns

[`ItemRenderer`](ItemRenderer.md)

___

### getResolvedImageComp

▸ **getResolvedImageComp**(`itemDef`): [`ImageComp`](../interfaces/ImageComp.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `itemDef` | [`ItemDef`](../interfaces/ItemDef.md) |

#### Returns

[`ImageComp`](../interfaces/ImageComp.md)

___

### initialize

▸ **initialize**(`items`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `items` | [`ItemDef`](../interfaces/ItemDef.md)[] |

#### Returns

`void`

___

### resolveImage

▸ **resolveImage**(`name`): `string`

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`string`

___

### setImageResolver

▸ **setImageResolver**(`resolver`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `resolver` | [`ImageResolver`](../modules.md#imageresolver) |

#### Returns

`void`

___

### setRenderer

▸ **setRenderer**(`name`, `factory`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |
| `factory` | [`ItemRendererFactory`](../modules.md#itemrendererfactory) |

#### Returns

`void`

___

### setWorld

▸ **setWorld**(`world`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `world` | [`World`](World.md)\<`any`\> |

#### Returns

`void`

___

### slotsEqual

▸ **slotsEqual**(`a`, `b`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `a` | [`SlotContent`](../modules.md#slotcontent) |
| `b` | [`SlotContent`](../modules.md#slotcontent) |

#### Returns

`boolean`

___

### waitForRenderers

▸ **waitForRenderers**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>
