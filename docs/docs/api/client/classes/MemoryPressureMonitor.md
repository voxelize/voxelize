---
id: "MemoryPressureMonitor"
title: "Class: MemoryPressureMonitor"
sidebar_label: "MemoryPressureMonitor"
sidebar_position: 0
custom_edit_url: null
---

Samples the renderer's heap and tells its owner when to shed load.

This is the backstop under every individual queue cap: a bounded queue
only protects against the growth path someone thought to bound, while a
heap watchdog notices the ones nobody found. Sampling is pure and
time-injected ([MemoryPressureMonitor.sample](MemoryPressureMonitor.md#sample)) so the state machine
is testable without timers, and a missing `performance.memory` degrades to
a permanently `steady` monitor rather than a throw.

## Constructors

### constructor

• **new MemoryPressureMonitor**(`options?`, `readHeap?`): [`MemoryPressureMonitor`](MemoryPressureMonitor.md)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `options` | `Partial`<[`MemoryPressureOptions`](../#memorypressureoptions)\> | `{}` |
| `readHeap` | [`HeapReader`](../#heapreader) | `readChromiumHeap` |

#### Returns

[`MemoryPressureMonitor`](MemoryPressureMonitor.md)

## Properties

### options

• `Readonly` **options**: [`MemoryPressureOptions`](../#memorypressureoptions)

## Methods

### getStatus

▸ **getStatus**(): [`MemoryPressureStatus`](../#memorypressurestatus)

#### Returns

[`MemoryPressureStatus`](../#memorypressurestatus)

___

### sample

▸ **sample**(`nowMs`): [`MemoryPressureVerdict`](../#memorypressureverdict)

#### Parameters

| Name | Type |
| :------ | :------ |
| `nowMs` | `number` |

#### Returns

[`MemoryPressureVerdict`](../#memorypressureverdict)

___

### start

▸ **start**(`onVerdict`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `onVerdict` | (`verdict`: ``"shed"`` \| ``"relieved"``, `status`: [`MemoryPressureStatus`](../#memorypressurestatus)) => `void` |

#### Returns

`void`

___

### stop

▸ **stop**(): `void`

#### Returns

`void`
