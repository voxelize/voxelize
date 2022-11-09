---
id: "LightUtils"
title: "Class: LightUtils"
sidebar_label: "LightUtils"
sidebar_position: 0
custom_edit_url: null
---

A utility class for extracting and inserting light data from and into numbers.

The light data is stored in the following format:
- Sunlight: `0xff000000`
- Red light: `0x00ff0000`
- Green light: `0x0000ff00`
- Blue light: `0x000000ff`

TODO-DOCS
For more information about lighting data, see [here](/)

# Example
```ts
// Insert a level 13 sunlight into zero.
const number = LightUtils.insertSunlight(0, 13);
```

## Methods

### extractBlueLight

▸ `Static` **extractBlueLight**(`light`): `number`

Extract the blue light level from a number.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `light` | `number` | The light value to extract from. |

#### Returns

`number`

The extracted blue light value.

___

### extractGreenLight

▸ `Static` **extractGreenLight**(`light`): `number`

Extract the green light level from a number.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `light` | `number` | The light value to extract from. |

#### Returns

`number`

The extracted green light value.

___

### extractRedLight

▸ `Static` **extractRedLight**(`light`): `number`

Extract the red light level from a number.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `light` | `number` | The light value to extract from. |

#### Returns

`number`

The extracted red light value.

___

### extractSunlight

▸ `Static` **extractSunlight**(`light`): `number`

Extract the sunlight level from a number.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `light` | `number` | The light value to extract from. |

#### Returns

`number`

The extracted sunlight value.

___

### insertBlueLight

▸ `Static` **insertBlueLight**(`light`, `level`): `number`

Insert a blue light level into a number.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `light` | `number` | The light value to insert the level into. |
| `level` | `number` | The blue light level to insert. |

#### Returns

`number`

The inserted light value.

___

### insertGreenLight

▸ `Static` **insertGreenLight**(`light`, `level`): `number`

Insert a green light level into a number.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `light` | `number` | The light value to insert the level into. |
| `level` | `number` | The green light level to insert. |

#### Returns

`number`

The inserted light value.

___

### insertRedLight

▸ `Static` **insertRedLight**(`light`, `level`): `number`

Insert a red light level into a number.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `light` | `number` | The light value to insert the level into. |
| `level` | `number` | The red light level to insert. |

#### Returns

`number`

The inserted light value.

___

### insertSunlight

▸ `Static` **insertSunlight**(`light`, `level`): `number`

Insert a sunlight level into a number.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `light` | `number` | The light value to insert the level into. |
| `level` | `number` | The sunlight level to insert. |

#### Returns

`number`

The inserted light value.
