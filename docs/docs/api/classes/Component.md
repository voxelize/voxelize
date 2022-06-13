---
id: "Component"
title: "Class: Component<T>"
sidebar_label: "Component"
sidebar_position: 0
custom_edit_url: null
---

Representation of a component in ECS

## Type parameters

| Name |
| :------ |
| `T` |

## Methods

### register

▸ `Static` **register**<`P`\>(): [`ComponentClassType`](../modules.md#componentclasstype-508)<`P`\>

Register a new component class

#### Type parameters

| Name |
| :------ |
| `P` |

#### Returns

[`ComponentClassType`](../modules.md#componentclasstype-508)<`P`\>

## Properties

### type

• **type**: `number`

___

### data

• **data**: `T`

___

### attr

• **attr**: `Object` = `{}`

A component can have attributes. Attributes are secondary values used to save miscellaneous data required by some
specialized systems.

#### Index signature

▪ [key: `string`]: `any`

## Constructors

### constructor

• **new Component**<`T`\>(`type`, `data`)

#### Type parameters

| Name |
| :------ |
| `T` |

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `number` |
| `data` | `T` |
