---
id: "ItemSlots"
title: "Class: ItemSlots<T>"
sidebar_label: "ItemSlots"
sidebar_position: 0
custom_edit_url: null
---

## Type parameters

| Name | Type |
| :------ | :------ |
| `T` | `number` |

## Methods

### activate

▸ **activate**(): `void`

#### Returns

`void`

___

### connect

▸ **connect**(`inputs`, `namespace?`): () => `void`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `inputs` | [`Inputs`](Inputs.md)<`any`\> | `undefined` |
| `namespace` | `string` | `"*"` |

#### Returns

`fn`

▸ (): `void`

##### Returns

`void`

___

### deactivate

▸ **deactivate**(): `void`

#### Returns

`void`

___

### getContent

▸ **getContent**(`row`, `col`): `T`

#### Parameters

| Name | Type |
| :------ | :------ |
| `row` | `number` |
| `col` | `number` |

#### Returns

`T`

___

### getFocused

▸ **getFocused**(): [`ItemSlot`](ItemSlot.md)<`T`\>

#### Returns

[`ItemSlot`](ItemSlot.md)<`T`\>

___

### getObject

▸ **getObject**(`row`, `col`): `Object3D`<`Event`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `row` | `number` |
| `col` | `number` |

#### Returns

`Object3D`<`Event`\>

___

### getRowColFromEvent

▸ **getRowColFromEvent**(`event`): `Object`

#### Parameters

| Name | Type |
| :------ | :------ |
| `event` | `MouseEvent` |

#### Returns

`Object`

| Name | Type |
| :------ | :------ |
| `col` | `number` |
| `row` | `number` |

___

### getSlot

▸ **getSlot**(`row`, `col`): [`ItemSlot`](ItemSlot.md)<`T`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `row` | `number` |
| `col` | `number` |

#### Returns

[`ItemSlot`](ItemSlot.md)<`T`\>

___

### getSubscript

▸ **getSubscript**(`row`, `col`): `string`

#### Parameters

| Name | Type |
| :------ | :------ |
| `row` | `number` |
| `col` | `number` |

#### Returns

`string`

___

### render

▸ **render**(): `void`

#### Returns

`void`

___

### setContent

▸ **setContent**(`row`, `col`, `content`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `row` | `number` |
| `col` | `number` |
| `content` | `T` |

#### Returns

`void`

___

### setFocused

▸ **setFocused**(`row`, `col`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `row` | `number` |
| `col` | `number` |

#### Returns

`void`

___

### setObject

▸ **setObject**(`row`, `col`, `object`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `row` | `number` |
| `col` | `number` |
| `object` | `Object3D`<`Event`\> |

#### Returns

`void`

___

### setSubscript

▸ **setSubscript**(`row`, `col`, `subscript`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `row` | `number` |
| `col` | `number` |
| `subscript` | `string` |

#### Returns

`void`

## Properties

### activated

• **activated**: `boolean` = `false`

___

### canvas

• **canvas**: `HTMLCanvasElement`

___

### focusedCol

• **focusedCol**: `number` = `-1`

___

### focusedRow

• **focusedRow**: `number` = `-1`

___

### onFocusChange

• **onFocusChange**: (`prevSlot`: [`ItemSlot`](ItemSlot.md)<`T`\>, `nextSlot`: [`ItemSlot`](ItemSlot.md)<`T`\>) => `void` = `noop`

#### Type declaration

▸ (`prevSlot`, `nextSlot`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `prevSlot` | [`ItemSlot`](ItemSlot.md)<`T`\> |
| `nextSlot` | [`ItemSlot`](ItemSlot.md)<`T`\> |

##### Returns

`void`

___

### onSlotClick

• **onSlotClick**: (`slot`: [`ItemSlot`](ItemSlot.md)<`T`\>) => `void` = `noop`

#### Type declaration

▸ (`slot`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `slot` | [`ItemSlot`](ItemSlot.md)<`T`\> |

##### Returns

`void`

___

### onSlotUpdate

• **onSlotUpdate**: (`slot`: [`ItemSlot`](ItemSlot.md)<`T`\>) => `void` = `noop`

#### Type declaration

▸ (`slot`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `slot` | [`ItemSlot`](ItemSlot.md)<`T`\> |

##### Returns

`void`

___

### options

• **options**: [`ItemSlotsOptions`](../modules.md#itemslotsoptions-120)

___

### renderer

• **renderer**: `WebGLRenderer`

___

### slotHeight

• **slotHeight**: `number`

___

### slotMargin

• **slotMargin**: `number`

___

### slotPadding

• **slotPadding**: `number`

___

### slotTotalHeight

• **slotTotalHeight**: `number`

___

### slotTotalWidth

• **slotTotalWidth**: `number`

___

### slotWidth

• **slotWidth**: `number`

___

### wrapper

• **wrapper**: `HTMLDivElement`

## Constructors

### constructor

• **new ItemSlots**<`T`\>(`options?`)

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | `number` |

#### Parameters

| Name | Type |
| :------ | :------ |
| `options` | `Partial`<[`ItemSlotsOptions`](../modules.md#itemslotsoptions-120)\> |

## Accessors

### element

• `get` **element**(): `HTMLDivElement`

#### Returns

`HTMLDivElement`
