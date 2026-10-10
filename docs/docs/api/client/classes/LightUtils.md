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

## Properties

### BEER\_LAMBERT\_TRANSMITTANCE\_DEN

▪ `Static` `Readonly` **BEER\_LAMBERT\_TRANSMITTANCE\_DEN**: ``256``

___

### BEER\_LAMBERT\_TRANSMITTANCE\_NUM

▪ `Static` `Readonly` **BEER\_LAMBERT\_TRANSMITTANCE\_NUM**: ``222``

___

### LEVEL\_FROM\_NEIGHBORS

▪ `Static` `Readonly` **LEVEL\_FROM\_NEIGHBORS**: ``-1``

Marker level for a flood seed whose light is to be read where the flood
runs, not where the edit was analysed.

A cell opened out of an opaque block is lit by whatever stands around it,
and the analysis used to seed the flood from the neighbours' light as it
was on the main thread at that moment. Light lands a worker round-trip
later, so a neighbour opened by the previous packet could still read
zero: the cell then got no seed at all, and since nothing ever revisits
a lit-looking-enough cell, a pit cut into stone stayed black until a
reload. Seeded this way, the cell's neighbours are read from the flood's
own snapshot, which already holds every earlier batch's result.

## Methods

### beerLambertTransmit

▸ **beerLambertTransmit**(`level`, `opticalDensity`): `number`

Beer-Lambert transmission: I' = I * e^(-μd).
Each optical-density unit multiplies by 222/256 ≈ e^(-0.143).

#### Parameters

| Name | Type |
| :------ | :------ |
| `level` | `number` |
| `opticalDensity` | `number` |

#### Returns

`number`

___

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

### dedupeFillQueue

▸ **dedupeFillQueue**<`T`\>(`nodes`): `T`[]

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | extends `Object` |

#### Parameters

| Name | Type |
| :------ | :------ |
| `nodes` | `T`[] |

#### Returns

`T`[]

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

### floodLightNextLevel

▸ **floodLightNextLevel**(`isSunlight`, `lightAttenuation`, `oy`, `level`, `maxLightLevel`): `number`

Next light level when flooding into a neighbor voxel.

#### Parameters

| Name | Type |
| :------ | :------ |
| `isSunlight` | `boolean` |
| `lightAttenuation` | `number` |
| `oy` | `number` |
| `level` | `number` |
| `maxLightLevel` | `number` |

#### Returns

`number`

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

___

### resolveDeferredSeeds

▸ **resolveDeferredSeeds**<`TNode`\>(`volume`, `seeds`, `color`, `maxHeight`): \{ `level`: `number` ; `voxel`: [`Coords3`](../#coords3)  }[]

Replace every deferred seed ([LightUtils.LEVEL_FROM_NEIGHBORS](LightUtils.md#level_from_neighbors)) with
ordinary seeds at its lit neighbours, read from `volume` now; other
seeds pass through. Duplicates collapse, so a wall of opened cells does
not seed the same lit neighbour a dozen times.

#### Type parameters

| Name | Type |
| :------ | :------ |
| `TNode` | extends `Object` |

#### Parameters

| Name | Type |
| :------ | :------ |
| `volume` | `Object` |
| `volume.getSunlightAt` | (`vx`: `number`, `vy`: `number`, `vz`: `number`) => `number` |
| `volume.getTorchLightAt` | (`vx`: `number`, `vy`: `number`, `vz`: `number`, `color`: [`LightColor`](../#lightcolor)) => `number` |
| `seeds` | `TNode`[] |
| `color` | [`LightColor`](../#lightcolor) |
| `maxHeight` | `number` |

#### Returns

\{ `level`: `number` ; `voxel`: [`Coords3`](../#coords3)  }[]

___

### retainLiveFillNodes

▸ **retainLiveFillNodes**<`T`\>(`nodes`, `getLevelAt`): `T`[]

#### Type parameters

| Name | Type |
| :------ | :------ |
| `T` | extends `Object` |

#### Parameters

| Name | Type |
| :------ | :------ |
| `nodes` | `T`[] |
| `getLevelAt` | (`vx`: `number`, `vy`: `number`, `vz`: `number`) => `number` |

#### Returns

`T`[]
