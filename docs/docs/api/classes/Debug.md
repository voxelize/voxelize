---
id: "Debug"
title: "Class: Debug"
sidebar_label: "Debug"
sidebar_position: 0
custom_edit_url: null
---

Debugger for Voxelize, including the following features:
- Top-left panel for in-game object attribute inspection
- Bottom-left corner for detailed FPS data
- Top-right corner for interactive debugging pane

## Properties

### gui

• **gui**: `Pane`

Top-right corner of debug, used for interactive debugging

**`memberof`** Debug

___

### stats

• **stats**: `Stats`

Bottom-left panel for performance statistics

**`memberof`** Debug

___

### dataWrapper

• **dataWrapper**: `HTMLDivElement`

___

### dataEntries

• **dataEntries**: { `ele`: `HTMLParagraphElement` ; `obj?`: `any` ; `attribute?`: `string` ; `title`: `string` ; `formatter`: `FormatterType`  }[] = `[]`

___

### client

• **client**: [`Client`](Client.md)

## Constructors

### constructor

• **new Debug**(`client`, `params?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `client` | [`Client`](Client.md) |
| `params` | `Partial`<`DebugParams`\> |

## Methods

### update

▸ **update**(): `void`

Update for the debug of the game

**`memberof`** Debug

#### Returns

`void`

___

### toggle

▸ **toggle**(): `void`

Toggle debug visually, both UI and in-game elements

**`memberof`** Debug

#### Returns

`void`

___

### registerDisplay

▸ **registerDisplay**(`title`, `object?`, `attribute?`, `formatter?`): `void`

Register an entry for the debug info-panel, which gets appended
to the top left corner of the debug screen

**`memberof`** Debug

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `title` | `string` | The title of the entry |
| `object?` | `any` | The object to listen to changes on |
| `attribute?` | `string` | - |
| `formatter` | `FormatterType` | - |

#### Returns

`void`

___

### displayTitle

▸ **displayTitle**(`title`): `void`

Display a static title in the debug info-panel

**`memberof`** Debug

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `title` | `string` | Title content of display entry |

#### Returns

`void`

___

### displayNewline

▸ **displayNewline**(): `void`

Add a new line at the bottom of current info-panel

**`memberof`** Debug

#### Returns

`void`

## Accessors

### memoryUsage

• `get` **memoryUsage**(): `string`

Memory usage of current page

**`readonly`**

**`memberof`** Debug

#### Returns

`string`

___

### light

• `get` **light**(): `number`

#### Returns

`number`

___

### maxHeight

• `get` **maxHeight**(): `number`

#### Returns

`number`
