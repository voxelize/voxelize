---
id: "WorkerPool"
title: "Class: WorkerPool"
sidebar_label: "WorkerPool"
sidebar_position: 0
custom_edit_url: null
---

A pool of web workers that can be used to execute jobs. The pool will create
workers up to the maximum number of workers specified in the parameters.
When a job is queued, the pool will find the first available worker and
execute the job. If no workers are available, the job will be queued until
a worker becomes available.

## Properties

### Proto

• **Proto**: () => `Worker`

#### Type declaration

• **new WorkerPool**()

The worker class to create.

___

### WORKING\_COUNT

▪ `Static` **WORKING\_COUNT**: `number` = `0`

A static count of working web workers across all worker pools.

___

### params

• **params**: [`WorkerPoolParams`](../modules.md#workerpoolparams) = `defaultParams`

The parameters to create the worker pool.

___

### queue

• **queue**: [`WorkerPoolJob`](../modules.md#workerpooljob)[] = `[]`

The queue of jobs that are waiting to be executed.

## Methods

### addJob

▸ **addJob**(`job`): `void`

Append a new job to be executed by a worker.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `job` | [`WorkerPoolJob`](../modules.md#workerpooljob) | The job to queue. |

#### Returns

`void`

## Constructors

### constructor

• **new WorkerPool**(`Proto`, `params?`)

Create a new worker pool.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `Proto` | () => `Worker` | `undefined` | The worker class to create. |
| `params` | [`WorkerPoolParams`](../modules.md#workerpoolparams) | `defaultParams` | The parameters to create the worker pool. |

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
