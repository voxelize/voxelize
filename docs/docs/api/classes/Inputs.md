---
id: "Inputs"
title: "Class: Inputs"
sidebar_label: "Inputs"
sidebar_position: 0
custom_edit_url: null
---

A **built-in** key-bind manager for Voxelize. Uses the [mousetrap](https://github.com/ccampbell/mousetrap)
library internally.

## Example
Print "Hello world" on <kbd>p</kbd> presses:
```typescript
client.inputs.bind(
  "p",
  () => {
    console.log("Hello world");
  },
  "*"
);
```

## Properties

### client

• **client**: [`Client`](Client.md)

Reference linking back to the Voxelize client instance.

___

### namespace

• **namespace**: [`InputNamespace`](../modules.md#inputnamespace-48) = `"menu"`

The namespace that the Voxelize inputs is in. Use `setNamespace` to
set the namespace for namespace checking.

## Methods

### click

▸ **click**(`type`, `callback`, `namespace`): `void`

Register a new click event listener.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `type` | [`ClickType`](../modules.md#clicktype-48) | Which mouse button to register on. |
| `callback` | () => `void` | What to do when that button is clicked. |
| `namespace` | [`InputNamespace`](../modules.md#inputnamespace-48) | Which namespace should this event be fired? |

#### Returns

`void`

___

### scroll

▸ **scroll**(`up`, `down`, `namespace`): `void`

Register a new scroll event listener.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `up` | (`delta?`: `number`) => `void` | What to do when scrolled upwards. |
| `down` | (`delta?`: `number`) => `void` | What to do when scrolled downwards. |
| `namespace` | [`InputNamespace`](../modules.md#inputnamespace-48) | Which namespace should this even be fired? |

#### Returns

`void`

___

### bind

▸ **bind**(`name`, `callback`, `namespace`, `specifics?`): `void`

Register a key-bind event listener.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the key or key combo to listen on. |
| `callback` | () => `void` | What to do when the key/combo is pressed. |
| `namespace` | [`InputNamespace`](../modules.md#inputnamespace-48) | The namespace in which the to fire this event. |
| `specifics` | `Object` | Used to specify in more details when/where the press occurs. |
| `specifics.occasion?` | [`InputOccasion`](../modules.md#inputoccasion-48) | Which pressing occasion should the event be fired. Defaults to "keydown". |
| `specifics.element?` | `HTMLElement` | Which element should the key binding be bound to. Defaults to "document". |

#### Returns

`void`

___

### setNamespace

▸ **setNamespace**(`namespace`): `void`

Set the namespace of the inputs instance, also checks if the namespace is valid.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `namespace` | [`InputNamespace`](../modules.md#inputnamespace-48) | The namespace to set to. |

#### Returns

`void`

___

### dispose

▸ **dispose**(): `void`

Dispose all event listeners.

**`internal`**

#### Returns

`void`
