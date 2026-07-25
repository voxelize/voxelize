---
id: "ImageItemRenderer"
title: "Class: ImageItemRenderer"
sidebar_label: "ImageItemRenderer"
sidebar_position: 0
custom_edit_url: null
---

## Hierarchy

- [`ItemRenderer`](ItemRenderer.md)

  ↳ **`ImageItemRenderer`**

## Constructors

### constructor

• **new ImageItemRenderer**(`itemDef`, `world`): [`ImageItemRenderer`](ImageItemRenderer.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `itemDef` | [`ItemDef`](../interfaces/ItemDef.md) |
| `world` | [`World`](World.md)\<`any`\> |

#### Returns

[`ImageItemRenderer`](ImageItemRenderer.md)

#### Overrides

[ItemRenderer](ItemRenderer.md).[constructor](ItemRenderer.md#constructor)

## Accessors

### id

• `get` **id**(): `number`

#### Returns

`number`

#### Inherited from

ItemRenderer.id

___

### name

• `get` **name**(): `string`

#### Returns

`string`

#### Inherited from

ItemRenderer.name

## Methods

### dispose

▸ **dispose**(): `void`

#### Returns

`void`

#### Overrides

[ItemRenderer](ItemRenderer.md).[dispose](ItemRenderer.md#dispose)

___

### getDropMesh

▸ **getDropMesh**(): `Object3D`\<`Object3DEventMap`\>

#### Returns

`Object3D`\<`Object3DEventMap`\>

#### Overrides

[ItemRenderer](ItemRenderer.md).[getDropMesh](ItemRenderer.md#getdropmesh)

___

### getHeldMesh

▸ **getHeldMesh**(`useAlt?`): `Object3D`\<`Object3DEventMap`\>

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `useAlt` | `boolean` | `false` |

#### Returns

`Object3D`\<`Object3DEventMap`\>

#### Overrides

[ItemRenderer](ItemRenderer.md).[getHeldMesh](ItemRenderer.md#getheldmesh)

___

### getInventoryImage

▸ **getInventoryImage**(`useAlt?`): `HTMLImageElement`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `useAlt` | `boolean` | `false` |

#### Returns

`HTMLImageElement`

#### Overrides

[ItemRenderer](ItemRenderer.md).[getInventoryImage](ItemRenderer.md#getinventoryimage)

___

### isLoaded

▸ **isLoaded**(): `boolean`

#### Returns

`boolean`

___

### onEquip

▸ **onEquip**(): `void`

#### Returns

`void`

#### Inherited from

[ItemRenderer](ItemRenderer.md).[onEquip](ItemRenderer.md#onequip)

___

### onUnequip

▸ **onUnequip**(): `void`

#### Returns

`void`

#### Inherited from

[ItemRenderer](ItemRenderer.md).[onUnequip](ItemRenderer.md#onunequip)

___

### update

▸ **update**(): `void`

#### Returns

`void`

#### Inherited from

[ItemRenderer](ItemRenderer.md).[update](ItemRenderer.md#update)

___

### waitForLoad

▸ **waitForLoad**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>
