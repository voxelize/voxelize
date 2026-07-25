---
id: "ItemRenderer"
title: "Class: ItemRenderer"
sidebar_label: "ItemRenderer"
sidebar_position: 0
custom_edit_url: null
---

## Hierarchy

- **`ItemRenderer`**

  ↳ [`ImageItemRenderer`](ImageItemRenderer.md)

## Constructors

### constructor

• **new ItemRenderer**(`itemDef`, `world`): [`ItemRenderer`](ItemRenderer.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `itemDef` | [`ItemDef`](../interfaces/ItemDef.md) |
| `world` | [`World`](World.md)\<`any`\> |

#### Returns

[`ItemRenderer`](ItemRenderer.md)

## Accessors

### id

• `get` **id**(): `number`

#### Returns

`number`

___

### name

• `get` **name**(): `string`

#### Returns

`string`

## Methods

### dispose

▸ **dispose**(): `void`

#### Returns

`void`

___

### getDropMesh

▸ **getDropMesh**(): `Object3D`\<`Object3DEventMap`\>

#### Returns

`Object3D`\<`Object3DEventMap`\>

___

### getHeldMesh

▸ **getHeldMesh**(`useAlt?`): `Object3D`\<`Object3DEventMap`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `useAlt?` | `boolean` |

#### Returns

`Object3D`\<`Object3DEventMap`\>

___

### getInventoryImage

▸ **getInventoryImage**(`useAlt?`): `HTMLImageElement`

#### Parameters

| Name | Type |
| :------ | :------ |
| `useAlt?` | `boolean` |

#### Returns

`HTMLImageElement`

___

### onEquip

▸ **onEquip**(): `void`

#### Returns

`void`

___

### onUnequip

▸ **onUnequip**(): `void`

#### Returns

`void`

___

### update

▸ **update**(): `void`

#### Returns

`void`
