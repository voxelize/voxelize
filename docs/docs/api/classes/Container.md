---
id: "Container"
title: "Class: Container"
sidebar_label: "Container"
sidebar_position: 0
custom_edit_url: null
---

The **built-in** class managing the container of the game. Does the following:
- Create/use passed in `HTMLDivElement` to contain the game and its UI components.
- Create/use passed in `HTMLCanvasElement` to draw the game on.

# Example
Bind the key <kbd>k</kbd> to toggle full screen:
```ts
client.inputs.bind("k", client.container.toggleFullScreen, "in-game");
```

## Properties

### client

• **client**: [`Client`](Client.md)

Reference linking back to the Voxelize client instance.

___

### params

• **params**: [`ContainerParams`](../modules.md#containerparams-210)

Parameters to initialize the Voxelize container.

___

### domElement

• **domElement**: `HTMLElement`

The `div` containing the game, parent to `container.canvas`

**`memberof`** Container

___

### canvas

• **canvas**: `HTMLCanvasElement`

The `canvas` that the game draws on, child of `container.domElement`

___

### crosshair

• **crosshair**: `HTMLDivElement`

A div that draws the crosshair of the container.

## Methods

### toggleFullScreen

▸ **toggleFullScreen**(): `void`

Toggle fullscreen for Voxelize.

#### Returns

`void`

___

### showCrosshair

▸ **showCrosshair**(): `void`

Show the crosshair.

#### Returns

`void`

___

### hideCrosshair

▸ **hideCrosshair**(): `void`

Hide the crosshair.

#### Returns

`void`
