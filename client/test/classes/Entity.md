[@voxelize/client](../README.md) / [Exports](../modules.md) / Entity

# Class: Entity

## Table of contents

### Constructors

- [constructor](Entity.md#constructor)

### Properties

- [active](Entity.md#active)
- [components](Entity.md#components)
- [entId](Entity.md#entid)
- [subscriptions](Entity.md#subscriptions)

### Methods

- [add](Entity.md#add)
- [remove](Entity.md#remove)
- [subscribe](Entity.md#subscribe)

## Constructors

### constructor

• **new Entity**()

#### Defined in

[client/src/libs/ecs.ts:168](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L168)

## Properties

### active

• **active**: `boolean` = `true`

#### Defined in

[client/src/libs/ecs.ts:166](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L166)

___

### components

• `Private` **components**: `Object` = `{}`

#### Index signature

▪ [key: `number`]: [`Component`](Component.md)<`any`\>[]

#### Defined in

[client/src/libs/ecs.ts:157](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L157)

___

### entId

• **entId**: `number`

#### Defined in

[client/src/libs/ecs.ts:161](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L161)

___

### subscriptions

• `Private` **subscriptions**: [`Susbcription`](../modules.md#susbcription)[] = `[]`

#### Defined in

[client/src/libs/ecs.ts:152](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L152)

## Methods

### add

▸ **add**(`component`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `component` | [`Component`](Component.md)<`any`\> |  |

#### Returns

`void`

#### Defined in

[client/src/libs/ecs.ts:194](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L194)

___

### remove

▸ **remove**(`component`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `component` | [`Component`](Component.md)<`any`\> |  |

#### Returns

`void`

#### Defined in

[client/src/libs/ecs.ts:215](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L215)

___

### subscribe

▸ **subscribe**(`handler`): () => [`Entity`](Entity.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `handler` | [`Susbcription`](../modules.md#susbcription) |  |

#### Returns

`fn`

▸ (): [`Entity`](Entity.md)

##### Returns

[`Entity`](Entity.md)

#### Defined in

[client/src/libs/ecs.ts:177](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L177)
