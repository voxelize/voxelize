---
id: "Debug"
title: "Class: Debug"
sidebar_label: "Debug"
sidebar_position: 0
custom_edit_url: null
---

Debugger for Voxelize, including the following features:
- Top-left panel for in-game object attribute inspection and FPS data.
- Top-right corner for interactive debugging pane>

## Properties

### client

• **client**: [`Client`](Client.md)

Reference linking back to the Voxelize client instance.

___

### gui

• **gui**: `Pane`

Top-right corner [pane](https://cocopon.github.io/tweakpane/) of debug,
used for interactive debugging.

___

### stats

• **stats**: `Stats`

Panel for performance statistics. Check out [stats.js](https://github.com/mrdoob/stats.js/) for more.

___

### dataWrapper

• **dataWrapper**: `HTMLDivElement`

A DOM wrapper for the top-left panel.

## Methods

### toggle

▸ **toggle**(): `void`

Toggle debug visually, both UI and in-game elements.

#### Returns

`void`

___

### registerDisplay

▸ **registerDisplay**(`title`, `object?`, `attribute?`, `formatter?`): `void`

Register an entry for the debug info-panel, which gets appended
to the top left corner of the debug screen.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `title` | `string` | The title of the entry. |
| `object?` | `any` | The object to listen to changes on. |
| `attribute?` | `string` | The attribute in the object to listen on. |
| `formatter` | [`Formatter`](../modules.md#formatter-48) | A function passed on the new data before updating the entry. |

#### Returns

`void`

___

### removeDisplay

▸ **removeDisplay**(`title`): `void`

Remove a display from the top left debug panel.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `title` | `string` | The title of the display to remove from the debug. |

#### Returns

`void`

___

### displayTitle

▸ **displayTitle**(`title`): `void`

Display a static title in the debug info-panel.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `title` | `string` | Title content of display entry. |

#### Returns

`void`

___

### displayNewline

▸ **displayNewline**(): `void`

Add a new line at the bottom of current info-panel.

#### Returns

`void`

## Accessors

### memoryUsage

• `get` **memoryUsage**(): `string`

Memory usage of current page.

#### Returns

`string`

___

### light

• `get` **light**(): `number`

The light value at which the client is at.

#### Returns

`number`
