---
id: "ShadowFrameLedger"
title: "Class: ShadowFrameLedger"
sidebar_label: "ShadowFrameLedger"
sidebar_position: 0
custom_edit_url: null
---

The shared per-frame shadow budget, charged in *face units* (one 256²
local face = 1; the CSM near cascade ≈ 4; a far cascade ≈ 6 — calibration
lives in [LocalLightsOptions](../interfaces/LocalLightsOptions.md)). Both shadow consumers — the CSM
cascades and the local light atlas — draw depth from the same GPU in the
same frame, so they share one explicit budget instead of discovering each
other through dropped frames.

Grant order per frame, matching the RFC:

 1. CSM near cascade — priority 1, *never* denied. Gameplay-critical, and
    denying it would change CSM behavior in zero-light worlds
    (invariant 6). Overdraft is recorded, not prevented.
 2. Dynamic local faces — a held light follows the player; staleness is
    visible immediately. The local scheduler *reserves* these units before
    CSM renders so a far cascade cannot eat them first.
 3. CSM far cascades — already deferred one-per-frame today; the ledger
    formalizes it. To keep CSM byte-identical when no local lights are
    active, denial only applies while locals are actually consuming
    (reservation or spend); and to prevent starvation under a permanently
    reserving held light, a far cascade denied `maxFarDeferrals` frames in
    a row is force-granted on the next.
 4. Invalidated static local faces, FIFO — drain over frames; a TNT blast
    re-renders torch shadows over several frames, not one.

## Constructors

### constructor

• **new ShadowFrameLedger**(`maxFarDeferrals?`): [`ShadowFrameLedger`](ShadowFrameLedger.md)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `maxFarDeferrals` | `number` | `2` |

#### Returns

[`ShadowFrameLedger`](ShadowFrameLedger.md)

## Properties

### frameStats

• `Readonly` **frameStats**: `Object`

Mutated in place every frame; never reallocated.

#### Type declaration

| Name | Type |
| :------ | :------ |
| `budget` | `number` |
| `csmFarDenied` | `number` |
| `csmFarForced` | `number` |
| `csmFarUnits` | `number` |
| `csmNearUnits` | `number` |
| `localDenied` | `number` |
| `localDynamicUnits` | `number` |
| `localStaticUnits` | `number` |
| `reservedUnits` | `number` |
| `used` | `number` |

## Accessors

### remaining

• `get` **remaining**(): `number`

Free units left this frame (after reservations).

#### Returns

`number`

## Methods

### beginFrame

▸ **beginFrame**(`budgetUnits`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `budgetUnits` | `number` |

#### Returns

`void`

___

### chargeCsmNear

▸ **chargeCsmNear**(`units`): `void`

CSM near cascade: unconditional. Records the spend, may overdraw.

#### Parameters

| Name | Type |
| :------ | :------ |
| `units` | `number` |

#### Returns

`void`

___

### requestCsmFar

▸ **requestCsmFar**(`units`): `boolean`

CSM far cascade: granted unless local lights are actively sharing the
frame *and* the cascade does not fit next to their reservation. A denial
leaves the cascade's dirty flag set upstream, so it retries next frame;
after `maxFarDeferrals` consecutive denials the grant is forced.

#### Parameters

| Name | Type |
| :------ | :------ |
| `units` | `number` |

#### Returns

`boolean`

___

### requestLocal

▸ **requestLocal**(`kind`, `units`): `boolean`

Local faces. `dynamic` requests may consume their reservation even when
a forced far cascade overdrew the frame; `static` requests only ever use
budget that nobody reserved — they are the drain-over-frames tier.

#### Parameters

| Name | Type |
| :------ | :------ |
| `kind` | ``"dynamic"`` \| ``"static"`` |
| `units` | `number` |

#### Returns

`boolean`

___

### reserveDynamic

▸ **reserveDynamic**(`units`): `number`

Reserve units for this frame's dynamic local faces, before CSM renders.
Returns the units actually reserved (never more than the free budget, so
a huge demand cannot push CSM near into overdraft on its own).

#### Parameters

| Name | Type |
| :------ | :------ |
| `units` | `number` |

#### Returns

`number`
