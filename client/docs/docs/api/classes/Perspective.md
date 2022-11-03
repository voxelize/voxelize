---
id: "Perspective"
title: "Class: Perspective"
sidebar_label: "Perspective"
sidebar_position: 0
custom_edit_url: null
---

## Properties

### INPUT\_IDENTIFIER

▪ `Static` `Readonly` **INPUT\_IDENTIFIER**: ``"voxelize-perspective"``

___

### controls

• **controls**: [`RigidControls`](RigidControls.md)

___

### inputs

• `Optional` **inputs**: [`Inputs`](Inputs.md)<`any`\>

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

___

### params

• **params**: [`PerspectiveParams`](../modules.md#perspectiveparams-14)

___

### world

• **world**: [`World`](World.md)

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

## Constructors

### constructor

• **new Perspective**(`controls`, `world`, `params?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `controls` | [`RigidControls`](RigidControls.md) |
| `world` | [`World`](World.md) |
| `params` | `Partial`<[`PerspectiveParams`](../modules.md#perspectiveparams-14)\> |

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
