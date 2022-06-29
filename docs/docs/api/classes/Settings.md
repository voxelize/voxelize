---
id: "Settings"
title: "Class: Settings"
sidebar_label: "Settings"
sidebar_position: 0
custom_edit_url: null
---

The **built-in** Voxelize settings.

## Indexable

▪ [key: `string`]: `any`

Settings' fields, `string` to `any`.

## Constructors

### constructor

• **new Settings**(`client`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `client` | [`Client`](Client.md) |

## Properties

### client

• **client**: [`Client`](Client.md)

## Methods

### add

▸ **add**(`property`, `value`, `onChange?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `property` | `string` |
| `value` | [`SettingsField`](../modules.md#settingsfield-66) |
| `onChange?` | `SettingsChangeHandler` |

#### Returns

`void`

___

### listen

▸ **listen**(`property`, `onChange`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `property` | `string` |
| `onChange` | `SettingsChangeHandler` |

#### Returns

`void`
