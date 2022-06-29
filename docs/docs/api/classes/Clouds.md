---
id: "Clouds"
title: "Class: Clouds"
sidebar_label: "Clouds"
sidebar_position: 0
custom_edit_url: null
---

## Properties

### array

• **array**: `NdArray`<`number`[] \| `TypedArray` \| `GenericArray`<`number`\>\>

___

### material

• **material**: `ShaderMaterial`

___

### initialized

• **initialized**: `boolean` = `false`

___

### meshes

• **meshes**: `Mesh`<`BufferGeometry`, `Material` \| `Material`[]\>[][] = `[]`

___

### params

• **params**: [`CloudsParams`](../modules.md#cloudsparams-12)

## Constructors

### constructor

• **new Clouds**(`params`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `params` | [`CloudsParams`](../modules.md#cloudsparams-12) |

## Methods

### initialize

▸ **initialize**(): `Promise`<`void`\>

#### Returns

`Promise`<`void`\>

___

### reset

▸ **reset**(): `Promise`<`void`\>

#### Returns

`Promise`<`void`\>

___

### move

▸ **move**(`delta`, `position`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `delta` | `number` |
| `position` | `Vector3` |

#### Returns

`void`

## Accessors

### mesh

• `get` **mesh**(): `Group`

#### Returns

`Group`
