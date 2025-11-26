---
id: "DOMUtils"
title: "Class: DOMUtils"
sidebar_label: "DOMUtils"
sidebar_position: 0
custom_edit_url: null
---

A utility class for doing DOM manipulation.

## Methods

### applyStyles

▸ **applyStyles**(`ele`, `style`): `HTMLElement` \| `HTMLElement`[]

Apply styles directly onto DOM element(s).

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `ele` | `HTMLElement` \| `HTMLElement`[] | The element(s) to add styles to. |
| `style` | `Partial`\<`CSSStyleDeclaration`\> | The style(s) to add. |

#### Returns

`HTMLElement` \| `HTMLElement`[]

The element(s) with the added styles.

___

### mapKeyToCode

▸ **mapKeyToCode**(`key`): `string`

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |

#### Returns

`string`

___

### rgba

▸ **rgba**(`r`, `g`, `b`, `a`): `string`

Create a CSS color string from numbers.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `r` | `number` | Red channel |
| `g` | `number` | Green channel |
| `b` | `number` | Blue channel |
| `a` | `number` | Alpha channel |

#### Returns

`string`

A CSS color string
