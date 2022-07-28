[@voxelize/client](../README.md) / [Exports](../modules.md) / WorkerPool

# Class: WorkerPool

## Table of contents

### Constructors

- [constructor](WorkerPool.md#constructor)

### Properties

- [Proto](WorkerPool.md#proto)
- [available](WorkerPool.md#available)
- [params](WorkerPool.md#params)
- [queue](WorkerPool.md#queue)
- [workers](WorkerPool.md#workers)
- [WORKING\_COUNT](WorkerPool.md#working_count)

### Accessors

- [isBusy](WorkerPool.md#isbusy)
- [workingCount](WorkerPool.md#workingcount)

### Methods

- [addJob](WorkerPool.md#addjob)
- [process](WorkerPool.md#process)

## Constructors

### constructor

• **new WorkerPool**(`Proto`, `params?`)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `Proto` | () => `Worker` | `undefined` |
| `params` | [`WorkerPoolParams`](../modules.md#workerpoolparams) | `defaultParams` |

#### Defined in

[client/src/libs/worker-pool.ts:23](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/worker-pool.ts#L23)

## Properties

### Proto

• **Proto**: () => `Worker`

#### Type declaration

• **new WorkerPool**()

___

### available

• `Private` **available**: `number`[] = `[]`

#### Defined in

[client/src/libs/worker-pool.ts:21](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/worker-pool.ts#L21)

___

### params

• **params**: [`WorkerPoolParams`](../modules.md#workerpoolparams) = `defaultParams`

___

### queue

• **queue**: [`WorkerPoolJob`](../modules.md#workerpooljob)[] = `[]`

#### Defined in

[client/src/libs/worker-pool.ts:16](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/worker-pool.ts#L16)

___

### workers

• `Private` **workers**: `Worker`[] = `[]`

#### Defined in

[client/src/libs/worker-pool.ts:20](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/worker-pool.ts#L20)

___

### WORKING\_COUNT

▪ `Static` **WORKING\_COUNT**: `number` = `0`

#### Defined in

[client/src/libs/worker-pool.ts:18](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/worker-pool.ts#L18)

## Accessors

### isBusy

• `get` **isBusy**(): `boolean`

#### Returns

`boolean`

#### Defined in

[client/src/libs/worker-pool.ts:62](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/worker-pool.ts#L62)

___

### workingCount

• `get` **workingCount**(): `number`

#### Returns

`number`

#### Defined in

[client/src/libs/worker-pool.ts:66](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/worker-pool.ts#L66)

## Methods

### addJob

▸ **addJob**(`job`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `job` | [`WorkerPoolJob`](../modules.md#workerpooljob) |

#### Returns

`void`

#### Defined in

[client/src/libs/worker-pool.ts:35](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/worker-pool.ts#L35)

___

### process

▸ **process**(): `void`

#### Returns

`void`

#### Defined in

[client/src/libs/worker-pool.ts:40](https://github.com/shaoruu/voxelize/blob/63b1cce/client/src/libs/worker-pool.ts#L40)
