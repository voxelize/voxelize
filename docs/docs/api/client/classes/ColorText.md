---
id: "ColorText"
title: "Class: ColorText"
sidebar_label: "ColorText"
sidebar_position: 0
custom_edit_url: null
---

This module is used to separate plain text into colored text objects to be further rendered.

# Example
```ts
const text = "$green$Hello, world!$yellow$The rest is yellow.";

// Change the default splitter.
ColorText.SPLITTER = "$";

// Parse the text into colored text objects.
const splitted = ColorText.split(text);

// Expected:
// [
//   {
//     text: "Hello, world!",
//     color: "green"
//   },
//   {
//     text: "The rest is yellow.",
//     color: "yellow"
//   },
// ]
```

![ColorText](/img/docs/colortext.png)

## Properties

### SPLITTER

▪ `Static` **SPLITTER**: `string` = `"∆"`

The symbol used to separate a text into a colored text object array.

## Constructors

### constructor

• **new ColorText**()

## Methods

### split

▸ `Static` **split**(`text`, `defaultColor?`): { `color`: `string` ; `text`: `string`  }[]

Split a text into a colored text object array by [SPLITTER](ColorText.md#splitter-96).

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `text` | `string` | `undefined` | The text to split. |
| `defaultColor` | `string` | `"black"` | The default color to apply to the text. |

#### Returns

{ `color`: `string` ; `text`: `string`  }[]

An array of colored text objects.
