---
id: "Camera"
title: "Class: Camera"
sidebar_label: "Camera"
sidebar_position: 0
custom_edit_url: null
---

The main Voxelize camera class using ThreeJS's `PerspectiveCamera`, adding custom functionalities such as FOV interpolating and camera zooming.

## Example
```typescript
// Access it by:
console.log(client.camera)
```

## Properties

### params

• **params**: [`CameraParams`](../modules.md#cameraparams)

Parameters to customize the Voxelize camera.

___

### threeCamera

• **threeCamera**: `PerspectiveCamera`

___

### client

• **client**: [`Client`](Client.md)

## Constructors

### constructor

• **new Camera**(`client`, `params?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `client` | [`Client`](Client.md) |
| `params` | `Partial`<[`CameraParams`](../modules.md#cameraparams)\> |

## Methods

### update

▸ **update**(): `void`

#### Returns

`void`

___

### setZoom

▸ **setZoom**(`zoom`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `zoom` | `number` |

#### Returns

`void`

___

### setFOV

▸ **setFOV**(`fov`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `fov` | `number` |

#### Returns

`void`
