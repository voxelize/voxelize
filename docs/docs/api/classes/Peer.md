---
id: "Peer"
title: "Class: Peer"
sidebar_label: "Peer"
sidebar_position: 0
custom_edit_url: null
---

## Properties

### head

• **head**: [`Head`](Head.md)

___

### connected

• **connected**: `boolean` = `false`

___

### name

• **name**: `string` = `"testtesttest"`

___

### newPosition

• **newPosition**: `Vector3`

___

### newQuaternion

• **newQuaternion**: `Quaternion`

___

### nameMesh

• **nameMesh**: [`NameTag`](NameTag.md)

___

### id

• **id**: `string`

___

### params

• **params**: [`PeerParams`](../modules.md#peerparams-18)

## Constructors

### constructor

• **new Peer**(`id`, `params`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `string` |
| `params` | [`PeerParams`](../modules.md#peerparams-18) |

## Methods

### set

▸ **set**(`name`, `position`, `quaternion`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |
| `position` | `Vector3` |
| `quaternion` | `Quaternion` |

#### Returns

`void`

___

### update

▸ **update**(`camPos?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `camPos?` | `Vector3` |

#### Returns

`void`

## Accessors

### mesh

• `get` **mesh**(): `Group`

#### Returns

`Group`
