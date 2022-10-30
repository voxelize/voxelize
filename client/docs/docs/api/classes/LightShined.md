---
id: "LightShined"
title: "Class: LightShined"
sidebar_label: "LightShined"
sidebar_position: 0
custom_edit_url: null
---

## Properties

### params

• **params**: [`LightShinedParams`](../modules.md#lightshinedparams-184)

___

### list

• **list**: `Set`<`Object3D`<`Event`\>\>

___

### ignored

• **ignored**: `Set`<`any`\>

___

### world

• **world**: [`World`](World.md)

## Constructors

### constructor

• **new LightShined**(`world`, `params?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `world` | [`World`](World.md) |
| `params` | `Partial`<[`LightShinedParams`](../modules.md#lightshinedparams-184)\> |

## Methods

### add

▸ **add**(`obj`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `obj` | `Object3D`<`Event`\> |

#### Returns

`void`

___

### remove

▸ **remove**(`obj`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `obj` | `Object3D`<`Event`\> |

#### Returns

`void`

___

### update

▸ **update**(): `void`

#### Returns

`void`

___

### ignore

▸ **ignore**(...`types`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `...types` | `any`[] |

#### Returns

`void`
