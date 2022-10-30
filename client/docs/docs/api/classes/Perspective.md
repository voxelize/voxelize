---
id: "Perspective"
title: "Class: Perspective"
sidebar_label: "Perspective"
sidebar_position: 0
custom_edit_url: null
---

## Properties

### params

• **params**: [`PerspectiveParams`](../modules.md#perspectiveparams-184)

___

### controls

• **controls**: [`RigidControls`](RigidControls.md)

___

### world

• **world**: [`World`](World.md)

___

### inputs

• `Optional` **inputs**: [`Inputs`](Inputs.md)<`any`\>

___

### INPUT\_IDENTIFIER

▪ `Static` `Readonly` **INPUT\_IDENTIFIER**: ``"voxelize-perspective"``

___

### onChangeState

• **onChangeState**: (`state`: ``"first"`` \| ``"second"`` \| ``"third"``) => `void`

#### Type declaration

▸ (`state`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `state` | ``"first"`` \| ``"second"`` \| ``"third"`` |

##### Returns

`void`

## Constructors

### constructor

• **new Perspective**(`controls`, `world`, `params?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `controls` | [`RigidControls`](RigidControls.md) |
| `world` | [`World`](World.md) |
| `params` | `Partial`<[`PerspectiveParams`](../modules.md#perspectiveparams-184)\> |

## Methods

### connect

▸ **connect**(`inputs`, `namespace?`): `void`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `inputs` | [`Inputs`](Inputs.md)<`any`\> | `undefined` |
| `namespace` | `string` | `"*"` |

#### Returns

`void`

___

### toggle

▸ **toggle**(): `void`

#### Returns

`void`

___

### update

▸ **update**(): `void`

#### Returns

`void`

## Accessors

### state

• `get` **state**(): ``"first"`` \| ``"second"`` \| ``"third"``

#### Returns

``"first"`` \| ``"second"`` \| ``"third"``

• `set` **state**(`state`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `state` | ``"first"`` \| ``"second"`` \| ``"third"`` |

#### Returns

`void`
