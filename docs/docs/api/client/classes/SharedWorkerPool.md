---
id: "SharedWorkerPool"
title: "Class: SharedWorkerPool"
sidebar_label: "SharedWorkerPool"
sidebar_position: 0
custom_edit_url: null
---

A pool of web workers that can be used to execute jobs. The pool will create
workers up to the maximum number of workers specified in the options.
When a job is queued, the pool will find the first available worker and
execute the job. If no workers are available, the job will be queued until
a worker becomes available.

## Constructors

### constructor

• **new SharedWorkerPool**(`Proto`, `options?`): [`SharedWorkerPool`](SharedWorkerPool.md)

Create a new worker pool.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `Proto` | () => `SharedWorker` | `undefined` | The worker class to create. |
| `options` | [`SharedWorkerPoolOptions`](../modules.md#sharedworkerpooloptions) | `defaultOptions` | The options to create the worker pool. |

#### Returns

[`SharedWorkerPool`](SharedWorkerPool.md)

## Properties

### Proto

• **Proto**: () => `SharedWorker`

#### Type declaration

• **new Proto**(): `SharedWorker`

The worker class to create.

##### Returns

`SharedWorker`

___

### WORKING\_COUNT

▪ `Static` **WORKING\_COUNT**: `number` = `0`

A static count of working web workers across all worker pools.

___

### options

• **options**: [`SharedWorkerPoolOptions`](../modules.md#sharedworkerpooloptions) = `defaultOptions`

The options to create the worker pool.

___

### queue

• **queue**: [`SharedWorkerPoolJob`](../modules.md#sharedworkerpooljob)[] = `[]`

The queue of jobs that are waiting to be executed.

## Accessors

### isBusy

• `get` **isBusy**(): `boolean`

Whether or not are there no available workers.

#### Returns

`boolean`

___

### workingCount

• `get` **workingCount**(): `number`

The number of workers that are simultaneously working.

#### Returns

`number`

## Methods

### addJob

▸ **addJob**(`job`): `void`

Append a new job to be executed by a worker.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `job` | [`SharedWorkerPoolJob`](../modules.md#sharedworkerpooljob) | The job to queue. |

#### Returns

`void`
