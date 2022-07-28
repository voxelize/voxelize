[@voxelize/client](../README.md) / [Exports](../modules.md) / ECS

# Class: ECS

## Table of contents

### Constructors

- [constructor](ECS.md#constructor)

### Properties

- [entities](ECS.md#entities)
- [entitySubscription](ECS.md#entitysubscription)
- [entitySystemLastUpdate](ECS.md#entitysystemlastupdate)
- [entitySystemLastUpdateGame](ECS.md#entitysystemlastupdategame)
- [entitySystems](ECS.md#entitysystems)
- [gameTime](ECS.md#gametime)
- [lastUpdate](ECS.md#lastupdate)
- [systems](ECS.md#systems)
- [timeScale](ECS.md#timescale)
- [Component](ECS.md#component)
- [Entity](ECS.md#entity)
- [System](ECS.md#system)

### Methods

- [addEntity](ECS.md#addentity)
- [addSystem](ECS.md#addsystem)
- [destroy](ECS.md#destroy)
- [getEntity](ECS.md#getentity)
- [indexEntity](ECS.md#indexentity)
- [indexEntitySystem](ECS.md#indexentitysystem)
- [inject](ECS.md#inject)
- [onEntityUpdate](ECS.md#onentityupdate)
- [query](ECS.md#query)
- [removeEntity](ECS.md#removeentity)
- [removeSystem](ECS.md#removesystem)
- [systemTrigger](ECS.md#systemtrigger)
- [update](ECS.md#update)

## Constructors

### constructor

• **new ECS**(`systems?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `systems?` | [`System`](System.md)[] |

#### Defined in

[client/src/libs/ecs.ts:565](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L565)

## Properties

### entities

• `Private` **entities**: [`Entity`](Entity.md)[] = `[]`

#### Defined in

[client/src/libs/ecs.ts:495](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L495)

___

### entitySubscription

• `Private` **entitySubscription**: `Object` = `{}`

#### Index signature

▪ [key: `number`]: () => `void`

#### Defined in

[client/src/libs/ecs.ts:518](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L518)

___

### entitySystemLastUpdate

• `Private` **entitySystemLastUpdate**: `Object` = `{}`

#### Index signature

▪ [key: `number`]: { `[key: number]`: `number`;  }

#### Defined in

[client/src/libs/ecs.ts:505](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L505)

___

### entitySystemLastUpdateGame

• `Private` **entitySystemLastUpdateGame**: `Object` = `{}`

#### Index signature

▪ [key: `number`]: { `[key: number]`: `number`;  }

#### Defined in

[client/src/libs/ecs.ts:511](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L511)

___

### entitySystems

• `Private` **entitySystems**: `Object` = `{}`

#### Index signature

▪ [key: `number`]: [`System`](System.md)[]

#### Defined in

[client/src/libs/ecs.ts:500](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L500)

___

### gameTime

• `Private` **gameTime**: `number` = `0`

#### Defined in

[client/src/libs/ecs.ts:563](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L563)

___

### lastUpdate

• `Private` **lastUpdate**: `number`

#### Defined in

[client/src/libs/ecs.ts:555](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L555)

___

### systems

• `Private` **systems**: [`System`](System.md)[] = `[]`

#### Defined in

[client/src/libs/ecs.ts:490](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L490)

___

### timeScale

• **timeScale**: `number` = `1`

#### Defined in

[client/src/libs/ecs.ts:550](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L550)

___

### Component

▪ `Static` **Component**: typeof [`Component`](Component.md) = `Component`

#### Defined in

[client/src/libs/ecs.ts:485](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L485)

___

### Entity

▪ `Static` **Entity**: typeof [`Entity`](Entity.md) = `Entity`

#### Defined in

[client/src/libs/ecs.ts:483](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L483)

___

### System

▪ `Static` **System**: typeof [`System`](System.md) = `System`

#### Defined in

[client/src/libs/ecs.ts:481](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L481)

## Methods

### addEntity

▸ **addEntity**(`entity`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `entity` | [`Entity`](Entity.md) |  |

#### Returns

`void`

#### Defined in

[client/src/libs/ecs.ts:600](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L600)

___

### addSystem

▸ **addSystem**(`system`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `system` | [`System`](System.md) |  |

#### Returns

`void`

#### Defined in

[client/src/libs/ecs.ts:672](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L672)

___

### destroy

▸ **destroy**(): `void`

#### Returns

`void`

#### Defined in

[client/src/libs/ecs.ts:576](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L576)

___

### getEntity

▸ **getEntity**(`entId`): [`Entity`](Entity.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `entId` | `number` |  |

#### Returns

[`Entity`](Entity.md)

#### Defined in

[client/src/libs/ecs.ts:591](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L591)

___

### indexEntity

▸ `Private` **indexEntity**(`entity`, `system?`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `entity` | [`Entity`](Entity.md) |  |
| `system?` | [`System`](System.md) | - |

#### Returns

`void`

#### Defined in

[client/src/libs/ecs.ts:1007](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L1007)

___

### indexEntitySystem

▸ `Private` **indexEntitySystem**(`entity`, `system`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `entity` | [`Entity`](Entity.md) |
| `system` | [`System`](System.md) |

#### Returns

`void`

#### Defined in

[client/src/libs/ecs.ts:948](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L948)

___

### inject

▸ `Private` **inject**(`system`): [`System`](System.md)

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `system` | [`System`](System.md) |  |

#### Returns

[`System`](System.md)

#### Defined in

[client/src/libs/ecs.ts:879](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L879)

___

### onEntityUpdate

▸ `Private` **onEntityUpdate**(`entity`, `added?`, `removed?`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `entity` | [`Entity`](Entity.md) |  |
| `added?` | [`Component`](Component.md)<`any`\> | - |
| `removed?` | [`Component`](Component.md)<`any`\> | - |

#### Returns

`void`

#### Defined in

[client/src/libs/ecs.ts:890](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L890)

___

### query

▸ **query**(`componentTypes`): `Iterator`<[`Entity`](Entity.md)\>

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `componentTypes` | `number`[] |  |

#### Returns

`Iterator`<[`Entity`](Entity.md)\>

#### Defined in

[client/src/libs/ecs.ts:746](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L746)

___

### removeEntity

▸ **removeEntity**(`idOrInstance`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `idOrInstance` | `number` \| [`Entity`](Entity.md) |  |

#### Returns

`void`

#### Defined in

[client/src/libs/ecs.ts:630](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L630)

___

### removeSystem

▸ **removeSystem**(`system`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `system` | [`System`](System.md) |  |

#### Returns

`void`

#### Defined in

[client/src/libs/ecs.ts:707](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L707)

___

### systemTrigger

▸ `Private` **systemTrigger**(`event`, `data`): `void`

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `event` | `string` |  |
| `data` | `any` |  |

#### Returns

`void`

#### Defined in

[client/src/libs/ecs.ts:526](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L526)

___

### update

▸ **update**(): `void`

#### Returns

`void`

#### Defined in

[client/src/libs/ecs.ts:780](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/ecs.ts#L780)
