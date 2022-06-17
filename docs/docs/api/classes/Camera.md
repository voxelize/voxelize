---
id: "Camera"
title: "Class: Camera"
sidebar_label: "Camera"
sidebar_position: 0
custom_edit_url: null
---

The **built-in** Voxelize camera class using ThreeJS's `PerspectiveCamera`, adding custom functionalities such as FOV interpolating and camera zooming.
The camera by default has a zoom of 1.0.

## Example
This is an example on binding the <kbd>v</kbd> key to zooming the camera by a factor of 2.
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

### client

• **client**: [`Client`](Client.md)

Reference linking back to the Voxelize client instance.

___

### params

• **params**: [`CameraParams`](../modules.md#cameraparams-42)

Parameters to initialize the Voxelize camera.

___

### threeCamera

• **threeCamera**: `PerspectiveCamera`

The inner ThreeJS perspective camera instance.

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
