---
id: "Entities"
title: "Class: Entities"
sidebar_label: "Entities"
sidebar_position: 0
custom_edit_url: null
---

## Hierarchy

- `Map`<`string`, [`BaseEntity`](BaseEntity.md)\>

  ↳ **`Entities`**

## Properties

### params

• **params**: [`EntitiesParams`](../modules.md#entitiesparams-36)

___

### knownTypes

• **knownTypes**: `Map`<`string`, [`NewEntity`](../modules.md#newentity-36)\>

___

### client

• **client**: [`Client`](Client.md)

## Constructors

### constructor

• **new Entities**(`client`, `params?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `client` | [`Client`](Client.md) |
| `params` | `Partial`<[`EntitiesParams`](../modules.md#entitiesparams-36)\> |

#### Overrides

Map&lt;string, BaseEntity\&gt;.constructor

## Methods

### onEvent

▸ **onEvent**(`__namedParameters`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `__namedParameters` | `any` |

#### Returns

`void`

___

### registerEntity

▸ **registerEntity**(`type`, `protocol`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `string` |
| `protocol` | [`NewEntity`](../modules.md#newentity-36) |

#### Returns

`void`

___

### reset

▸ **reset**(): `void`

#### Returns

`void`

___

### update

▸ **update**(): `void`

#### Returns

`void`
