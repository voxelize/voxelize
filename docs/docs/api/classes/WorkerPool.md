---
id: "WorkerPool"
title: "Class: WorkerPool"
sidebar_label: "WorkerPool"
sidebar_position: 0
custom_edit_url: null
---

## Properties

### queue

• **queue**: [`WorkerPoolJob`](../modules.md#workerpooljob-260)[] = `[]`

___

### Proto

• **Proto**: () => `Worker`

#### Type declaration

• **new WorkerPool**()

___

### params

• **params**: [`WorkerPoolParams`](../modules.md#workerpoolparams-260) = `defaultParams`

## Constructors

### constructor

• **new WorkerPool**(`Proto`, `params?`)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `Proto` | () => `Worker` | `undefined` |
| `params` | [`WorkerPoolParams`](../modules.md#workerpoolparams-260) | `defaultParams` |

## Methods

### addJob

▸ **addJob**(`job`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `job` | [`WorkerPoolJob`](../modules.md#workerpooljob-260) |

#### Returns

`void`

___

### process

▸ **process**(): `void`

#### Returns

`void`

## Accessors

### isBusy

• `get` **isBusy**(): `boolean`

#### Returns

`boolean`

___

### workingCount

• `get` **workingCount**(): `number`

#### Returns

`number`
