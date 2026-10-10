---
id: "CSMShadowLedger"
title: "Interface: CSMShadowLedger"
sidebar_label: "CSMShadowLedger"
sidebar_position: 0
custom_edit_url: null
---

The slice of the shared shadow ledger CSM consults. Injected rather than
imported so the CSM renderer stays constructible without the local-light
system (and byte-identical in behavior when no ledger is attached).

## Methods

### chargeCsmNear

▸ **chargeCsmNear**(`units`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `units` | `number` |

#### Returns

`void`

___

### requestCsmFar

▸ **requestCsmFar**(`units`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `units` | `number` |

#### Returns

`boolean`
