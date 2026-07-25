---
id: "WorkerTransfer"
title: "Class: WorkerTransfer"
sidebar_label: "WorkerTransfer"
sidebar_position: 0
custom_edit_url: null
---

## Constructors

### constructor

• **new WorkerTransfer**(): [`WorkerTransfer`](WorkerTransfer.md)

#### Returns

[`WorkerTransfer`](WorkerTransfer.md)

## Methods

### buildComparison

▸ **buildComparison**(`cx`, `cz`, `level`, `transfer`, `shared`): [`MeshTransferBenchmarkResult`](../modules.md#meshtransferbenchmarkresult)

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |
| `level` | `number` |
| `transfer` | [`MeshTransferBenchmarkModeResult`](../modules.md#meshtransferbenchmarkmoderesult) |
| `shared` | [`MeshTransferBenchmarkModeResult`](../modules.md#meshtransferbenchmarkmoderesult) |

#### Returns

[`MeshTransferBenchmarkResult`](../modules.md#meshtransferbenchmarkresult)

___

### configure

▸ **configure**(`config`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `config` | `Partial`\<[`WorkerTransferConfig`](../modules.md#workertransferconfig)\> |

#### Returns

`void`

___

### getMode

▸ **getMode**(): [`WorkerTransferMode`](../modules.md#workertransfermode)

#### Returns

[`WorkerTransferMode`](../modules.md#workertransfermode)

___

### getStats

▸ **getStats**(`strategy?`): [`MeshWorkerTransferStats`](../modules.md#meshworkertransferstats) \| `Record`\<[`WorkerTransferStrategy`](../modules.md#workertransferstrategy), [`MeshWorkerTransferStats`](../modules.md#meshworkertransferstats)\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `strategy?` | [`WorkerTransferStrategy`](../modules.md#workertransferstrategy) |

#### Returns

[`MeshWorkerTransferStats`](../modules.md#meshworkertransferstats) \| `Record`\<[`WorkerTransferStrategy`](../modules.md#workertransferstrategy), [`MeshWorkerTransferStats`](../modules.md#meshworkertransferstats)\>

___

### getStrategy

▸ **getStrategy**(): [`WorkerTransferStrategy`](../modules.md#workertransferstrategy)

#### Returns

[`WorkerTransferStrategy`](../modules.md#workertransferstrategy)

___

### isSharedArrayBufferAvailable

▸ **isSharedArrayBufferAvailable**(): `boolean`

#### Returns

`boolean`

___

### recordSample

▸ **recordSample**(`sample`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `sample` | [`MeshWorkerTransferSample`](../modules.md#meshworkertransfersample) |

#### Returns

`void`

___

### resetStats

▸ **resetStats**(): `void`

#### Returns

`void`

___

### setStrategy

▸ **setStrategy**(`strategy`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `strategy` | [`WorkerTransferStrategy`](../modules.md#workertransferstrategy) |

#### Returns

`void`

___

### summarizeIterations

▸ **summarizeIterations**(`strategy`, `warmupIterations`, `measuredIterations`): [`MeshTransferBenchmarkModeResult`](../modules.md#meshtransferbenchmarkmoderesult)

#### Parameters

| Name | Type |
| :------ | :------ |
| `strategy` | [`WorkerTransferStrategy`](../modules.md#workertransferstrategy) |
| `warmupIterations` | `number` |
| `measuredIterations` | [`MeshTransferBenchmarkIteration`](../modules.md#meshtransferbenchmarkiteration)[] |

#### Returns

[`MeshTransferBenchmarkModeResult`](../modules.md#meshtransferbenchmarkmoderesult)
