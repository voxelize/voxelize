---
id: "Inputs"
title: "Class: Inputs"
sidebar_label: "Inputs"
sidebar_position: 0
custom_edit_url: null
---

## Properties

### namespace

• **namespace**: `InputNamespace` = `"menu"`

___

### combos

• **combos**: `Map`<`string`, `string`\>

___

### callbacks

• **callbacks**: `Map`<`string`, () => `void`\>

___

### clickCallbacks

• **clickCallbacks**: `Map`<`ClickType`, `ClickCallbacks`\>

___

### scrollCallbacks

• **scrollCallbacks**: `ScrollCallbacks` = `[]`

___

### client

• **client**: [`Client`](Client.md)

## Constructors

### constructor

• **new Inputs**(`client`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `client` | [`Client`](Client.md) |

## Methods

### initClickListener

▸ **initClickListener**(): `void`

#### Returns

`void`

___

### initScrollListener

▸ **initScrollListener**(): `void`

#### Returns

`void`

___

### click

▸ **click**(`type`, `callback`, `namespace`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `type` | `ClickType` |
| `callback` | () => `void` |
| `namespace` | `InputNamespace` |

#### Returns

`void`

___

### scroll

▸ **scroll**(`up`, `down`, `namespace`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `up` | (`delta?`: `number`) => `void` |
| `down` | (`delta?`: `number`) => `void` |
| `namespace` | `InputNamespace` |

#### Returns

`void`

___

### add

▸ **add**(`name`, `combo`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |
| `combo` | `string` |

#### Returns

`void`

___

### bind

▸ **bind**(`name`, `callback`, `namespace`, `__namedParameters?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |
| `callback` | () => `void` |
| `namespace` | `InputNamespace` |
| `__namedParameters` | `Object` |
| `__namedParameters.occasion?` | `InputOccasion` |
| `__namedParameters.element?` | `HTMLElement` |

#### Returns

`void`

___

### setNamespace

▸ **setNamespace**(`namespace`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `namespace` | `InputNamespace` |

#### Returns

`void`

___

### dispose

▸ **dispose**(): `void`

#### Returns

`void`
