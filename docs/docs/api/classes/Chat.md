---
id: "Chat"
title: "Class: Chat"
sidebar_label: "Chat"
sidebar_position: 0
custom_edit_url: null
---

## Properties

### params

• **params**: [`ChatParams`](../modules.md#chatparams-56)

___

### enabled

• **enabled**: `boolean` = `false`

___

### messages

• **messages**: [`ChatMessage`](ChatMessage.md)[] = `[]`

___

### history

• **history**: [`ChatHistory`](ChatHistory.md)

___

### gui

• **gui**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `messages` | `HTMLUListElement` |
| `wrapper` | `HTMLDivElement` |
| `input` | `HTMLInputElement` |

___

### client

• **client**: [`Client`](Client.md)

## Constructors

### constructor

• **new Chat**(`client`, `params?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `client` | [`Client`](Client.md) |
| `params` | `Partial`<[`ChatParams`](../modules.md#chatparams-56)\> |

## Methods

### add

▸ **add**(`__namedParameters`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `__namedParameters` | `Object` |
| `__namedParameters.type` | `MESSAGE_TYPE` |
| `__namedParameters.sender?` | `string` |
| `__namedParameters.body?` | `string` |

#### Returns

`void`

___

### enable

▸ **enable**(`isCommand?`): `void`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `isCommand` | `boolean` | `false` |

#### Returns

`void`

___

### disable

▸ **disable**(): `void`

#### Returns

`void`

___

### showMessages

▸ **showMessages**(): `void`

#### Returns

`void`

___

### showInput

▸ **showInput**(): `void`

#### Returns

`void`

___

### hideInput

▸ **hideInput**(): `void`

#### Returns

`void`

___

### resetInput

▸ **resetInput**(): `string`

#### Returns

`string`

___

### focusInput

▸ **focusInput**(): `void`

#### Returns

`void`

___

### blurInput

▸ **blurInput**(): `void`

#### Returns

`void`

___

### applyMessagesStyles

▸ **applyMessagesStyles**(`styles`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `styles` | `Partial`<`CSSStyleDeclaration`\> |

#### Returns

`void`

___

### applyInputStyles

▸ **applyInputStyles**(`styles`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `styles` | `Partial`<`CSSStyleDeclaration`\> |

#### Returns

`void`

## Accessors

### inputValue

• `get` **inputValue**(): `string`

#### Returns

`string`

• `set` **inputValue**(`value`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `value` | `string` |

#### Returns

`void`
