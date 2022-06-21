---
id: "Particles"
title: "Class: Particles"
sidebar_label: "Particles"
sidebar_position: 0
custom_edit_url: null
---

A **built-in** manager for everything particles in Voxelize.

## Properties

### client

• **client**: [`Client`](Client.md)

Reference linking back to the Voxelize client instance.

___

### groups

• **groups**: [`ParticleGroup`](../modules.md#particlegroup-88)[] = `[]`

An array of active particle groups.

___

### private

• **private**: `any`

## Methods

### addBreakParticles

▸ **addBreakParticles**(`voxels`, `params?`): [`ParticleGroup`](../modules.md#particlegroup-88)

Create a group of particles for a voxel breaking effect. Returns `null` if empty voxels is passed in.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `voxels` | { `voxel`: [`Coords3`](../modules.md#coords3-88) ; `type`: `number`  }[] | The original voxel and block type that was broken. |
| `params` | `Partial`<[`ParticleParams`](../modules.md#particleparams-88)\> | Parameters to customize the particle initialization. |

#### Returns

[`ParticleGroup`](../modules.md#particlegroup-88)
