---
id: "BaseEntity"
title: "Class: BaseEntity"
sidebar_label: "BaseEntity"
sidebar_position: 0
custom_edit_url: null
---

## Hierarchy

- [`Entity`](Entity.md)

  ↳ **`BaseEntity`**

## Properties

### LERP\_FACTOR

▪ `Static` **LERP\_FACTOR**: `number` = `1`

___

### id

• **id**: `string`

___

### type

• **type**: `string`

___

### onCreation

• `Optional` **onCreation**: (`client`: [`Client`](Client.md)) => `void`

#### Type declaration

▸ (`client`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `client` | [`Client`](Client.md) |

##### Returns

`void`

___

### onDeletion

• `Optional` **onDeletion**: (`client`: [`Client`](Client.md)) => `void`

#### Type declaration

▸ (`client`): `void`

##### Parameters

| Name | Type |
| :------ | :------ |
| `client` | [`Client`](Client.md) |

##### Returns

`void`

___

### entId

• **entId**: `number`

#### Inherited from

[Entity](Entity.md).[entId](Entity.md#entid-14)

___

### active

• **active**: `boolean` = `true`

Informs if the entity is active

#### Inherited from

[Entity](Entity.md).[active](Entity.md#active-14)

## Constructors

### constructor

• **new BaseEntity**()

#### Overrides

[Entity](Entity.md).[constructor](Entity.md#constructor-14)

## Accessors

### metadata

• `get` **metadata**(): `Object`

#### Returns

`Object`

• `set` **metadata**(`m`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `m` | `Object` |

#### Returns

`void`

___

### position

• `get` **position**(): `Vector3`

#### Returns

`Vector3`

• `set` **position**(`p`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `p` | `Vector3` |

#### Returns

`void`

___

### target

• `get` **target**(): `Vector3`

#### Returns

`Vector3`

• `set` **target**(`t`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `t` | `Vector3` |

#### Returns

`void`

___

### heading

• `get` **heading**(): `Vector3`

#### Returns

`Vector3`

• `set` **heading**(`h`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `h` | `Vector3` |

#### Returns

`void`

___

### mesh

• `get` **mesh**(): `Object3D`<`Event`\>

#### Returns

`Object3D`<`Event`\>

• `set` **mesh**(`mesh`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `mesh` | `Object3D`<`Event`\> |

#### Returns

`void`

## Methods

### subscribe

▸ **subscribe**(`handler`): () => [`Entity`](Entity.md)

Allows interested parties to receive information when this entity's component list is updated

#### Parameters

| Name | Type |
| :------ | :------ |
| `handler` | [`Susbcription`](../modules.md#susbcription-14) |

#### Returns

`fn`

▸ (): [`Entity`](Entity.md)

Allows interested parties to receive information when this entity's component list is updated

##### Returns

[`Entity`](Entity.md)

#### Inherited from

[Entity](Entity.md).[subscribe](Entity.md#subscribe-14)

___

### add

▸ **add**(`component`): `void`

Add a component to this entity

#### Parameters

| Name | Type |
| :------ | :------ |
| `component` | [`Component`](Component.md)<`any`\> |

#### Returns

`void`

#### Inherited from

[Entity](Entity.md).[add](Entity.md#add-14)

___

### remove

▸ **remove**(`component`): `void`

Removes a component's reference from this entity

#### Parameters

| Name | Type |
| :------ | :------ |
| `component` | [`Component`](Component.md)<`any`\> |

#### Returns

`void`

#### Inherited from

[Entity](Entity.md).[remove](Entity.md#remove-14)
