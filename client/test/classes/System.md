[@voxelize/client](../README.md) / [Exports](../modules.md) / System

# Class: System

## Table of contents

### Constructors

- [constructor](System.md#constructor)

### Properties

- [callbacks](System.md#callbacks)
- [componentTypes](System.md#componenttypes)
- [frequence](System.md#frequence)
- [sysId](System.md#sysid)
- [trigger](System.md#trigger)
- [world](System.md#world)

### Methods

- [afterUpdateAll](System.md#afterupdateall)
- [beforeUpdateAll](System.md#beforeupdateall)
- [change](System.md#change)
- [enter](System.md#enter)
- [exit](System.md#exit)
- [listenTo](System.md#listento)
- [query](System.md#query)
- [update](System.md#update)

## Constructors

### constructor

• **new System**(`componentTypes`, `frequence?`)

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `componentTypes` | `number`[] | `undefined` |  |
| `frequence` | `number` | `0` |  |

#### Defined in

[client/src/libs/ecs.ts:425](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L425)

## Properties

### callbacks

• `Private` `Readonly` **callbacks**: `Object` = `{}`

#### Index signature

▪ [key: `string`]: [`EventCallback`](../modules.md#eventcallback)[]

#### Defined in

[client/src/libs/ecs.ts:331](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L331)

___

### componentTypes

• `Private` `Readonly` **componentTypes**: `number`[] = `[]`

#### Defined in

[client/src/libs/ecs.ts:329](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L329)

___

### frequence

• **frequence**: `number`

#### Defined in

[client/src/libs/ecs.ts:341](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L341)

___

### sysId

• `Readonly` **sysId**: `number`

#### Defined in

[client/src/libs/ecs.ts:336](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L336)

___

### trigger

• `Protected` **trigger**: (`event`: `string`, `data`: `any`) => `void`

#### Type declaration

▸ (`event`, `data`): `void`

##### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `event` | `string` |  |
| `data` | `any` |  |

##### Returns

`void`

#### Defined in

[client/src/libs/ecs.ts:356](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L356)

___

### world

• `Protected` **world**: [`ECS`](ECS.md)

#### Defined in

[client/src/libs/ecs.ts:346](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L346)

## Methods

### afterUpdateAll

▸ `Optional` **afterUpdateAll**(`time`, `entities`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `time` | `number` |  |
| `entities` | [`Entity`](Entity.md)[] | - |

#### Returns

`void`

#### Defined in

[client/src/libs/ecs.ts:381](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L381)

___

### beforeUpdateAll

▸ `Optional` **beforeUpdateAll**(`time`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `time` | `number` |  |

#### Returns

`void`

#### Defined in

[client/src/libs/ecs.ts:364](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L364)

___

### change

▸ `Optional` **change**(`entity`, `added?`, `removed?`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `entity` | [`Entity`](Entity.md) |  |
| `added?` | [`Component`](Component.md)<`any`\> |  |
| `removed?` | [`Component`](Component.md)<`any`\> |  |

#### Returns

`void`

#### Defined in

[client/src/libs/ecs.ts:390](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L390)

___

### enter

▸ `Optional` **enter**(`entity`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `entity` | [`Entity`](Entity.md) |  |

#### Returns

`void`

#### Defined in

[client/src/libs/ecs.ts:406](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L406)

___

### exit

▸ `Optional` **exit**(`entity`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `entity` | [`Entity`](Entity.md) |  |

#### Returns

`void`

#### Defined in

[client/src/libs/ecs.ts:418](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L418)

___

### listenTo

▸ `Protected` **listenTo**(`event`, `callback`, `once?`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `event` | `string` |  |
| `callback` | [`EventCallback`](../modules.md#eventcallback) |  |
| `once?` | `boolean` |  |

#### Returns

`void`

#### Defined in

[client/src/libs/ecs.ts:452](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L452)

___

### query

▸ `Protected` **query**(`componentTypes`): `Iterator`<[`Entity`](Entity.md)\>

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `componentTypes` | `number`[] |  |

#### Returns

`Iterator`<[`Entity`](Entity.md)\>

#### Defined in

[client/src/libs/ecs.ts:436](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L436)

___

### update

▸ `Optional` **update**(`entity`, `time`, `delta`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `entity` | [`Entity`](Entity.md) |  |
| `time` | `number` |  |
| `delta` | `number` |  |

#### Returns

`void`

#### Defined in

[client/src/libs/ecs.ts:373](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L373)
