---
id: "Clock"
title: "Class: Clock"
sidebar_label: "Clock"
sidebar_position: 0
custom_edit_url: null
---

A central control for the game clock, including handling intervals
and calculating the delta time of each game loop

## Properties

### params

• **params**: `ClockParams`

An object storing the parameters passed on `Clock construction

**`memberof`** Clock

___

### lastFrameTime

• **lastFrameTime**: `number`

Last time of update, gets updated each game loop

**`memberof`** Clock

___

### delta

• **delta**: `number`

Delta time elapsed each update

**`memberof`** Clock

___

### client

• **client**: [`Client`](Client.md)

## Constructors

### constructor

• **new Clock**(`client`, `params?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `client` | [`Client`](Client.md) |
| `params` | `Partial`<`ClockParams`\> |

## Methods

### update

▸ **update**(): `void`

Update for the camera of the game, does the following:
- Calculate the time elapsed since last update

**`memberof`** Camera

#### Returns

`void`

___

### registerInterval

▸ **registerInterval**(`name`, `func`, `interval`): `number`

Register an interval under the game clock

**`memberof`** Clock

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the interval to register |
| `func` | () => `void` | The action to be run each interval |
| `interval` | `number` | The time for each interval |

#### Returns

`number`

___

### clearInterval

▸ **clearInterval**(`name`): `boolean`

Clear an existing interval

**`memberof`** Clock

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the interval to clear |

#### Returns

`boolean`

___

### hasInterval

▸ **hasInterval**(`name`): `boolean`

Check if the clock holds a certain interval

**`memberof`** Clock

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of interval to check |

#### Returns

`boolean`
