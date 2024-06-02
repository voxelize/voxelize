---
id: "Hud"
title: "Class: Hud"
sidebar_label: "Hud"
sidebar_position: 0
custom_edit_url: null
---

## Hierarchy

- `Group`

  ↳ **`Hud`**

## Constructors

### constructor

• **new Hud**(`options?`): [`Hud`](Hud.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `options` | `Partial`\<[`HudOptions`](../modules.md#hudoptions)\> |

#### Returns

[`Hud`](Hud.md)

#### Overrides

THREE.Group.constructor

## Properties

### options

• **options**: [`HudOptions`](../modules.md#hudoptions)

## Methods

### connect

▸ **connect**(`inputs`, `namespace?`): () => `void`

Connect the HUD to the given input manager. This will allow the HUD to listen to left
and right clicks to play HUD animations. This function returns a function that when called
unbinds the HUD's keyboard inputs.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `inputs` | [`Inputs`](Inputs.md)\<`any`\> | `undefined` | The [Inputs](Inputs.md) instance to bind the HUD's keyboard inputs to. |
| `namespace` | `string` | `"*"` | The namespace to bind the HUD's keyboard inputs to. |

#### Returns

`fn`

▸ (): `void`

##### Returns

`void`

___

### setMesh

▸ **setMesh**(`mesh`, `animate`): `void`

Set a new mesh for the HUD. If `animate` is true, the transition will be animated.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `mesh` | `Object3D`\<`Object3DEventMap`\> | New mesh for the HUD |
| `animate` | `boolean` | Whether to animate the transition |

#### Returns

`void`

___

### update

▸ **update**(`delta`): `void`

Update the arm's animation. Note that when a hud is attached to a control,
`update` is called automatically within the control's update loop.

#### Parameters

| Name | Type |
| :------ | :------ |
| `delta` | `number` |

#### Returns

`void`
