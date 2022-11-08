---
id: "BlockBreakParticles"
title: "Class: BlockBreakParticles"
sidebar_label: "BlockBreakParticles"
sidebar_position: 0
custom_edit_url: null
---

A particle system that emits particles when a block is broken. This system implements `NetIntercept` and
listens to any `UPDATE` type message which indicates a block break. Remember to call `network.register` to
register this system to listen to incoming network packets.

This module depends on the [`three-nebula`](https://three-nebula.org/) package.

# Example
```ts
import { MeshRenderer } from "three-nebula";

const particleRenderer = new MeshRenderer(world, THREE);
const particles = new VOXELIZE.BlockBreakParticles(world, { ... });
particles.addRenderer(particleRenderer);

// Listen to incoming network packets.
network.register(particles);

// In the animate loop.
particles.update();
```

![Block break particles](/img/block-break-particles.png)

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

Create a new block break particle system.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `world` | [`World`](World.md) | The world that the particle system is in. |
| `params` | `Partial`<[`BlockBreakParticlesParams`](../modules.md#blockbreakparticlesparams)\> | Parameters to create a block break particle system. |

#### Overrides

System.constructor

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

[NetIntercept](../interfaces/NetIntercept.md).[onMessage](../interfaces/NetIntercept.md#onmessage)

## Properties

### world

• **world**: [`World`](World.md)
