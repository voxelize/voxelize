---
id: "ItemSlot"
title: "Class: ItemSlot<T>"
sidebar_label: "ItemSlot"
sidebar_position: 0
custom_edit_url: null
---

## Type parameters

| Name | Type |
| :------ | :------ |
| `T` | `number` |

## Constructors

### constructor

• **new ItemSlot**\<`T`\>(`itemSlots`, `row`, `col`): [`ItemSlot`](ItemSlot.md)\<`T`\>

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | `number` |

#### Parameters

| Name | Type |
| :------ | :------ |
| `itemSlots` | [`ItemSlots`](ItemSlots.md)\<`T`\> |
| `row` | `number` |
| `col` | `number` |

#### Returns

[`ItemSlot`](ItemSlot.md)\<`T`\>

## Properties

### camera

• **camera**: `OrthographicCamera`

___

### col

• **col**: `number`

___

### content

• **content**: `T`

___

### element

• **element**: `HTMLDivElement`

___

### itemSlots

• **itemSlots**: [`ItemSlots`](ItemSlots.md)\<`T`\>

___

### light

• **light**: `DirectionalLight`

___

### lightRotationOffset

• **lightRotationOffset**: `number`

___

### object

• **object**: `Object3D`\<`Object3DEventMap`\>

___

### offset

• **offset**: `Vector3`

___

### row

• **row**: `number`

___

### scene

• **scene**: `Scene`

___

### subscript

• **subscript**: `string`

___

### subscriptElement

• **subscriptElement**: `HTMLDivElement`

___

### zoom

• **zoom**: `number` = `1`

## Methods

### applyClass

▸ **applyClass**(`className`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `className` | `string` |

#### Returns

`void`

___

### applyStyles

▸ **applyStyles**(`styles`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `styles` | `Partial`\<`CSSStyleDeclaration`\> |

#### Returns

`void`

___

### applySubscriptClass

▸ **applySubscriptClass**(`className`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `className` | `string` |

#### Returns

`void`

___

### applySubscriptStyles

▸ **applySubscriptStyles**(`styles`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `styles` | `Partial`\<`CSSStyleDeclaration`\> |

#### Returns

`void`

___

### getContent

▸ **getContent**(): `T`

#### Returns

`T`

___

### getObject

▸ **getObject**(): `Object3D`\<`Object3DEventMap`\>

#### Returns

`Object3D`\<`Object3DEventMap`\>

___

### getSubscript

▸ **getSubscript**(): `string`

#### Returns

`string`

___

### removeClass

▸ **removeClass**(`className`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `className` | `string` |

#### Returns

`void`

___

### removeSubscriptClass

▸ **removeSubscriptClass**(`className`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `className` | `string` |

#### Returns

`void`

___

### setContent

▸ **setContent**(`content`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `content` | `T` |

#### Returns

`void`

___

### setObject

▸ **setObject**(`object`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `object` | `Object3D`\<`Object3DEventMap`\> \| `HTMLImageElement` |

#### Returns

`void`

___

### setPerspective

▸ **setPerspective**(`perspective`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `perspective` | [`CameraPerspective`](../modules.md#cameraperspective) |

#### Returns

`void`

___

### setSubscript

▸ **setSubscript**(`subscript`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `subscript` | `string` |

#### Returns

`void`

___

### setZoom

▸ **setZoom**(`zoom`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `zoom` | `number` |

#### Returns

`void`

___

### triggerChange

▸ **triggerChange**(): `void`

#### Returns

`void`
