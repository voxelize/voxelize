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

### canEnter

▸ **canEnter**(`source`, `target`, `dx`, `dy`, `dz`): `boolean`

Check to see if light can enter from one block to another.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `source` | `boolean`[] | The source block's transparency. |
| `target` | `boolean`[] | The target block's transparency. |
| `dx` | `number` | The change in x direction. |
| `dy` | `number` | The change in y direction. |
| `dz` | `number` | The change in z direction. |

#### Returns

`boolean`

Whether light can enter from the source block to the target block.

___

### canEnterInto

▸ **canEnterInto**(`target`, `dx`, `dy`, `dz`): `boolean`

Check to see if light can go "into" one block, disregarding the source.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `target` | `boolean`[] | The target block's transparency. |
| `dx` | `number` | The change in x direction. |
| `dy` | `number` | The change in y direction. |
| `dz` | `number` | The change in z direction. |

#### Returns

`boolean`

Whether light can enter into the target block.

___

### extractBlueLight

▸ **extractBlueLight**(`light`): `number`

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

▸ **extractGreenLight**(`light`): `number`

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

▸ **extractRedLight**(`light`): `number`

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

▸ **extractSunlight**(`light`): `number`

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

▸ **insertBlueLight**(`light`, `level`): `number`

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

▸ **insertGreenLight**(`light`, `level`): `number`

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

▸ **insertRedLight**(`light`, `level`): `number`

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

▸ **insertSunlight**(`light`, `level`): `number`

Insert a sunlight level into a number.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `light` | `number` | The light value to insert the level into. |
| `level` | `number` | The sunlight level to insert. |

#### Returns

`number`

The inserted light value.
