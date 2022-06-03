---
id: "Container"
title: "Class: Container"
sidebar_label: "Container"
sidebar_position: 0
custom_edit_url: null
---

The class managing the container of the game. Does the following:
- Create/use passed in `HTMLDivElement` to contain the game
- Create/use passed in `HTMLCanvasElement` to draw the game on

## Properties

### params

• **params**: [`ContainerParams`](../modules.md#containerparams)

An object storing the parameters passed on `Container` construction

**`memberof`** Container

___

### focused

• **focused**: `boolean` = `false`

A flag to indicate whether the game is locked, in other words, if
the pointer-lock controls are locked

**`memberof`** Container

___

### domElement

• **domElement**: `HTMLElement`

The `div` containing the game, parent to `container.canvas`

**`memberof`** Container

___

### canvas

• **canvas**: `HTMLCanvasElement`

The `canvas` that the game draws on, child of `container.domElement`

**`memberof`** Container

___

### crosshair

• **crosshair**: `HTMLDivElement`

___

### client

• **client**: [`Client`](Client.md)

## Constructors

### constructor

• **new Container**(`client`, `params?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `client` | [`Client`](Client.md) |
| `params` | `Partial`<[`ContainerParams`](../modules.md#containerparams)\> |

## Methods

### toggleFullScreen

▸ **toggleFullScreen**(): `void`

Toggle fullscreen for game

**`memberof`** Container

#### Returns

`void`

___

### dispose

▸ **dispose**(): `void`

Disposal of container, unbinds all existing event listeners
on `domElement` and `canvas`

**`memberof`** Container

#### Returns

`void`

___

### showCrosshair

▸ **showCrosshair**(): `void`

#### Returns

`void`

___

### hideCrosshair

▸ **hideCrosshair**(): `void`

#### Returns

`void`
