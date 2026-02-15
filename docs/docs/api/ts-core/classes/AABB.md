---
id: "AABB"
title: "Class: AABB"
sidebar_label: "AABB"
sidebar_position: 0
custom_edit_url: null
---

## Constructors

### constructor

• **new AABB**(`minX?`, `minY?`, `minZ?`, `maxX?`, `maxY?`, `maxZ?`): [`AABB`](AABB.md)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `minX` | `number` | `0` |
| `minY` | `number` | `0` |
| `minZ` | `number` | `0` |
| `maxX` | `number` | `0` |
| `maxY` | `number` | `0` |
| `maxZ` | `number` | `0` |

#### Returns

[`AABB`](AABB.md)

## Properties

### maxX

• **maxX**: `number` = `0`

___

### maxY

• **maxY**: `number` = `0`

___

### maxZ

• **maxZ**: `number` = `0`

___

### minX

• **minX**: `number` = `0`

___

### minY

• **minY**: `number` = `0`

___

### minZ

• **minZ**: `number` = `0`

## Methods

### clone

▸ **clone**(): [`AABB`](AABB.md)

#### Returns

[`AABB`](AABB.md)

___

### copy

▸ **copy**(`other`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `other` | [`AABB`](AABB.md) |

#### Returns

`void`

___

### create

▸ **create**(`minX`, `minY`, `minZ`, `maxX`, `maxY`, `maxZ`): [`AABB`](AABB.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `minX` | `number` |
| `minY` | `number` |
| `minZ` | `number` |
| `maxX` | `number` |
| `maxY` | `number` |
| `maxZ` | `number` |

#### Returns

[`AABB`](AABB.md)

___

### depth

▸ **depth**(): `number`

#### Returns

`number`

___

### empty

▸ **empty**(): [`AABB`](AABB.md)

#### Returns

[`AABB`](AABB.md)

___

### height

▸ **height**(): `number`

#### Returns

`number`

___

### intersection

▸ **intersection**(`other`): [`AABB`](AABB.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `other` | [`AABB`](AABB.md) |

#### Returns

[`AABB`](AABB.md)

___

### intersects

▸ **intersects**(`other`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `other` | [`AABB`](AABB.md) |

#### Returns

`boolean`

___

### mag

▸ **mag**(): `number`

#### Returns

`number`

___

### new

▸ **new**(): [`AABBBuilder`](AABBBuilder.md)

#### Returns

[`AABBBuilder`](AABBBuilder.md)

___

### setPosition

▸ **setPosition**(`px`, `py`, `pz`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `px` | `number` |
| `py` | `number` |
| `pz` | `number` |

#### Returns

`void`

___

### touches

▸ **touches**(`other`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `other` | [`AABB`](AABB.md) |

#### Returns

`boolean`

___

### translate

▸ **translate**(`dx`, `dy`, `dz`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `dx` | `number` |
| `dy` | `number` |
| `dz` | `number` |

#### Returns

`void`

___

### union

▸ **union**(`other`): [`AABB`](AABB.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `other` | [`AABB`](AABB.md) |

#### Returns

[`AABB`](AABB.md)

___

### unionAll

▸ **unionAll**(`all`): [`AABB`](AABB.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `all` | readonly [`AABB`](AABB.md)[] |

#### Returns

[`AABB`](AABB.md)

___

### width

▸ **width**(): `number`

#### Returns

`number`
