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

▸ **buildComparison**(`cx`, `cz`, `level`, `transfer`, `shared`): [`MeshTransferBenchmarkResult`](../#meshtransferbenchmarkresult)

#### Parameters

| Name | Type |
| :------ | :------ |
| `cx` | `number` |
| `cz` | `number` |
| `level` | `number` |
| `transfer` | [`MeshTransferBenchmarkModeResult`](../#meshtransferbenchmarkmoderesult) |
| `shared` | [`MeshTransferBenchmarkModeResult`](../#meshtransferbenchmarkmoderesult) |

#### Returns

[`MeshTransferBenchmarkResult`](../#meshtransferbenchmarkresult)

___

### configure

▸ **configure**(`config`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `config` | `Partial`<[`WorkerTransferConfig`](../#workertransferconfig)\> |

#### Returns

`void`

___

### getMode

▸ **getMode**(): [`WorkerTransferMode`](../#workertransfermode)

#### Returns

[`WorkerTransferMode`](../#workertransfermode)

___

### getStats

▸ **getStats**(`strategy?`): [`MeshWorkerTransferStats`](../#meshworkertransferstats) \| `Record`<[`WorkerTransferStrategy`](../#workertransferstrategy), [`MeshWorkerTransferStats`](../#meshworkertransferstats)\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `strategy?` | [`WorkerTransferStrategy`](../#workertransferstrategy) |

#### Returns

[`MeshWorkerTransferStats`](../#meshworkertransferstats) \| `Record`<[`WorkerTransferStrategy`](../#workertransferstrategy), [`MeshWorkerTransferStats`](../#meshworkertransferstats)\>

___

### getStrategy

▸ **getStrategy**(): [`WorkerTransferStrategy`](../#workertransferstrategy)

#### Returns

[`WorkerTransferStrategy`](../#workertransferstrategy)

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
| `sample` | [`MeshWorkerTransferSample`](../#meshworkertransfersample) |

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
| `strategy` | [`WorkerTransferStrategy`](../#workertransferstrategy) |

#### Returns

`void`

___

### summarizeIterations

▸ **summarizeIterations**(`strategy`, `warmupIterations`, `measuredIterations`): [`MeshTransferBenchmarkModeResult`](../#meshtransferbenchmarkmoderesult)

#### Parameters

| Name | Type |
| :------ | :------ |
| `strategy` | [`WorkerTransferStrategy`](../#workertransferstrategy) |
| `warmupIterations` | `number` |
| `measuredIterations` | [`MeshTransferBenchmarkIteration`](../#meshtransferbenchmarkiteration)[] |

#### Returns

[`MeshTransferBenchmarkModeResult`](../#meshtransferbenchmarkmoderesult)
