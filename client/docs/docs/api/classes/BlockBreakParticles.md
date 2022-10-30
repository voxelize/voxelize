---
id: "BlockBreakParticles"
title: "Class: BlockBreakParticles"
sidebar_label: "BlockBreakParticles"
sidebar_position: 0
custom_edit_url: null
---

## Hierarchy

- `"three-nebula"`

  ↳ **`BlockBreakParticles`**

## Implements

- [`NetIntercept`](../interfaces/NetIntercept.md)

## Indexable

▪ [key: `string`]: `any`

## Constructors

### constructor

• **new BlockBreakParticles**(`world`, `params?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `world` | [`World`](World.md) |
| `params` | `Partial`<[`BlockBreakParticlesParams`](../modules.md#blockbreakparticlesparams-210)\> |

#### Overrides

System.constructor

## Properties

### world

• **world**: [`World`](World.md)

## Methods

### onMessage

▸ **onMessage**(`message`): `void`

A listener to be implemented to handle incoming packets.

#### Parameters

| Name | Type |
| :------ | :------ |
| `message` | `MessageProtocol`<`any`, `any`, `any`, `any`\> |

#### Returns

`void`

#### Implementation of

[NetIntercept](../interfaces/NetIntercept.md).[onMessage](../interfaces/NetIntercept.md#onmessage-210)
