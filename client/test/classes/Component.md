[@voxelize/client](../README.md) / [Exports](../modules.md) / Component

# Class: Component<T\>

## Type parameters

| Name |
| :------ |
| `T` |

## Table of contents

### Constructors

- [constructor](Component.md#constructor)

### Properties

- [attr](Component.md#attr)
- [data](Component.md#data)
- [type](Component.md#type)

### Methods

- [register](Component.md#register)

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

#### Defined in

[client/src/libs/ecs.ts:309](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L309)

## Properties

### attr

• **attr**: `Object` = `{}`

#### Index signature

▪ [key: `string`]: `any`

#### Defined in

[client/src/libs/ecs.ts:305](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L305)

___

### data

• **data**: `T`

#### Defined in

[client/src/libs/ecs.ts:299](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L299)

___

### type

• **type**: `number`

#### Defined in

[client/src/libs/ecs.ts:297](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L297)

## Methods

### register

▸ `Static` **register**<`P`\>(): [`ComponentClassType`](../modules.md#componentclasstype)<`P`\>

#### Type parameters

| Name |
| :------ |
| `P` |

#### Returns

[`ComponentClassType`](../modules.md#componentclasstype)<`P`\>

#### Defined in

[client/src/libs/ecs.ts:266](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L266)
