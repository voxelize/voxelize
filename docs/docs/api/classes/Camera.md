---
id: "Camera"
title: "Class: Camera"
sidebar_label: "Camera"
sidebar_position: 0
custom_edit_url: null
---

The main Voxelize camera class using ThreeJS's `PerspectiveCamera`, adding custom functionalities such as FOV interpolating and camera zooming.
The camera by default has a zoom of 1.0.

## Example
This is an example on binding the `v` key to zooming the camera by a factor of 2.
```ts 
client.inputs.bind(
  "v",
  () => {
    client.camera.setZoom(2);
  },
  "in-game",
  {
    occasion: "keydown",
  }
);

client.inputs.bind(
  "v",
  () => {
    client.camera.setZoom(1);
  },
  "in-game",
  {
    occasion: "keyup",
  }
);
```

## Properties

### params

• **params**: [`CameraParams`](../modules.md#cameraparams-56)

Parameters to customize the Voxelize camera.

___

### threeCamera

• **threeCamera**: `PerspectiveCamera`

The inner ThreeJS perspective camera instance.

___

### client

• **client**: [`Client`](Client.md)

## Constructors

### constructor

• **new Camera**(`client`, `params?`)

Construct a new Voxelize camera instance, setting up ThreeJS camera.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `client` | [`Client`](Client.md) | Reference back to the client instance. |
| `params` | `Partial`<[`CameraParams`](../modules.md#cameraparams-56)\> | Parameters to customize this Voxelize camera. |

## Methods

### setZoom

▸ **setZoom**(`zoom`): `void`

Interpolate the camera's zoom. Default zoom is 1.0.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `zoom` | `number` | The new zoom for the camera to lerp to. |

#### Returns

`void`

___

### setFOV

▸ **setFOV**(`fov`): `void`

Interpolate the camera's FOV. Default FOV is 90.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `fov` | `number` | The new field of view to lerp to. |

#### Returns

`void`
