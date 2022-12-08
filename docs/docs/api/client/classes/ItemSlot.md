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
| `styles` | `Partial`<`CSSStyleDeclaration`\> |

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
| `styles` | `Partial`<`CSSStyleDeclaration`\> |

#### Returns

`void`

___

### getContent

▸ **getContent**(): `T`

#### Returns

`T`

___

### getObject

▸ **getObject**(): `Object3D`<`Event`\>

#### Returns

`Object3D`<`Event`\>

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
| `object` | `Object3D`<`Event`\> |

#### Returns

`void`

___

### setPerspective

▸ **setPerspective**(`perspective`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `perspective` | [`CameraPerspective`](../modules.md#cameraperspective-96) |

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

### setzoom

▸ **setzoom**(`zoom`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `zoom` | `number` |

#### Returns

`void`

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

### light

• **light**: `DirectionalLight`

___

### lightRotationOffset

• **lightRotationOffset**: `number`

___

### object

• **object**: `Object3D`<`Event`\>

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

## Constructors

### constructor

• **new ItemSlot**<`T`\>(`row`, `col`)

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | `number` |

#### Parameters

| Name | Type |
| :------ | :------ |
| `row` | `number` |
| `col` | `number` |
